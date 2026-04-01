import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEXT_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.css']);
const SOURCE_MAP_PATTERNS = [
  /\n\/\/# sourceMappingURL=.*$/gm,
  /\n\/\*# sourceMappingURL=.*?\*\/$/gm,
];

function isWithinRoot(path, root) {
  return path === root || path.startsWith(`${root}${sep}`);
}

function walk(targetPath, visitor, rootRealPath) {
  const stats = lstatSync(targetPath);
  if (stats.isSymbolicLink()) {
    return;
  }

  const resolvedPath = realpathSync(targetPath);
  if (!isWithinRoot(resolvedPath, rootRealPath)) {
    return;
  }

  if (stats.isDirectory()) {
    for (const entry of readdirSync(resolvedPath)) {
      walk(join(resolvedPath, entry), visitor, rootRealPath);
    }
    return;
  }
  visitor(resolvedPath);
}

function stripSourceMapReference(filePath) {
  const original = readFileSync(filePath, 'utf8');
  const cleaned = SOURCE_MAP_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, ''),
    original,
  );

  if (cleaned !== original) {
    writeFileSync(filePath, cleaned, 'utf8');
  }
}

export function stripBuildArtifacts(targetDir) {
  const root = resolve(targetDir);
  if (!existsSync(root)) {
    return;
  }
  const rootRealPath = realpathSync(root);

  walk(rootRealPath, (filePath) => {
    if (filePath.endsWith('.map')) {
      rmSync(filePath, { force: true });
      return;
    }

    const extension = extname(filePath);
    if (
      TEXT_EXTENSIONS.has(extension) ||
      filePath.endsWith('.d.ts') ||
      filePath.endsWith('.d.cts')
    ) {
      stripSourceMapReference(filePath);
    }
  }, rootRealPath);
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const targetDir = process.argv[2];
  if (!targetDir) {
    throw new Error('Usage: node scripts/release/strip-build-artifacts.mjs <dir>');
  }
  stripBuildArtifacts(targetDir);
}

import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEXT_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.css']);
const SOURCE_MAP_MARKER = 'sourceMappingURL=';

function walk(targetPath, visitor) {
  const stats = lstatSync(targetPath);
  if (stats.isDirectory()) {
    for (const entry of readdirSync(targetPath)) {
      walk(join(targetPath, entry), visitor);
    }
    return;
  }
  visitor(targetPath);
}

export function verifyNoSourcemaps(targetDirs) {
  const failures = [];

  for (const targetDir of targetDirs) {
    const root = resolve(targetDir);
    if (!existsSync(root)) {
      failures.push(`missing build output: ${root}`);
      continue;
    }

    walk(root, (filePath) => {
      if (filePath.endsWith('.map')) {
        failures.push(`unexpected sourcemap file: ${filePath}`);
        return;
      }

      const extension = extname(filePath);
      if (
        TEXT_EXTENSIONS.has(extension) ||
        filePath.endsWith('.d.ts') ||
        filePath.endsWith('.d.cts')
      ) {
        const text = readFileSync(filePath, 'utf8');
        if (text.includes(SOURCE_MAP_MARKER)) {
          failures.push(`unexpected sourceMappingURL marker: ${filePath}`);
        }
      }
    });
  }

  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    throw new Error(
      'Usage: node scripts/release/verify-no-sourcemaps.mjs <dir> [additional dirs...]',
    );
  }

  verifyNoSourcemaps(targets);
}

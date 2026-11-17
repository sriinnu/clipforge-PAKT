#!/usr/bin/env node
/**
 * Fail if npm would auto-correct @sriinnu/pakt's package.json on publish.
 *
 * npm 11 drops fields it considers invalid instead of normalizing them as
 * npm 10 did. A `bin` path written as `./bin/pakt.js` is silently removed,
 * which would ship a package with no `pakt` command. Run before staging.
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/pakt-core');
const run = spawnSync('npm', ['publish', '--dry-run', '--ignore-scripts'], {
  cwd: pkgDir,
  encoding: 'utf8',
});
const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;

const corrections = output
  .split('\n')
  .filter((line) => /npm warn publish\s+"/.test(line))
  .map((line) => line.replace(/^.*npm warn publish\s+/, ''));

if (/auto-corrected/.test(output) || corrections.length > 0) {
  console.error('npm would auto-correct packages/pakt-core/package.json on publish:');
  for (const c of corrections) console.error(`  - ${c}`);
  console.error('Fix the manifest (see `npm pkg fix`) before staging.');
  process.exit(1);
}

if (run.status !== 0) {
  console.error(output);
  process.exit(run.status ?? 1);
}

console.log('@sriinnu/pakt manifest publishes without npm corrections.');

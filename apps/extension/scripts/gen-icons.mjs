/**
 * Regenerate the shared ClipForge icon set.
 * The heavy lifting lives in the root Python script so desktop + extension
 * stay visually aligned.
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const generator = resolve(__dirname, '..', '..', '..', 'scripts', 'generate_clipforge_icons.py');
const result = spawnSync('python3', [generator], { stdio: 'inherit' });

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

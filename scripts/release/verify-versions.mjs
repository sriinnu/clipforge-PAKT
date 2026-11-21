#!/usr/bin/env node
/**
 * Fail when any shipped version disagrees with the root package.json.
 *
 * The workspace package.json files are bumped together, but the desktop crate
 * (Cargo.toml / Cargo.lock) and the extension's manifest.json were missed for
 * three releases and stayed at 0.10.0 (#70). tauri.conf.json reads its version
 * from apps/desktop/package.json, and the extension build stamps manifest.json
 * from its package.json; this check keeps the checked-in copies honest too.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const expected = json('package.json').version;
const found = [];

for (const p of [
  'packages/pakt-core/package.json',
  'apps/desktop/package.json',
  'apps/extension/package.json',
  'apps/playground/package.json',
  'apps/extension/manifest.json',
]) {
  found.push([p, json(p).version]);
}

const tauri = json('apps/desktop/src-tauri/tauri.conf.json').version;
found.push([
  'apps/desktop/src-tauri/tauri.conf.json',
  tauri === '../package.json' ? json('apps/desktop/package.json').version : tauri,
]);

const cargo = read('apps/desktop/src-tauri/Cargo.toml').match(
  /^\[package\][^[]*?^version\s*=\s*"([^"]+)"/m,
);
found.push(['apps/desktop/src-tauri/Cargo.toml', cargo?.[1]]);

const lock = read('apps/desktop/src-tauri/Cargo.lock').match(
  /^name = "clipforge-desktop"\r?\nversion = "([^"]+)"/m,
);
found.push(['apps/desktop/src-tauri/Cargo.lock', lock?.[1]]);

const bad = found.filter(([, v]) => v !== expected);
if (bad.length > 0) {
  console.error(`Versions out of sync with package.json (${expected}):`);
  for (const [p, v] of bad) console.error(`  ${p}: ${v ?? '(not found)'}`);
  process.exit(1);
}
console.log(`All ${found.length} manifests at ${expected}.`);

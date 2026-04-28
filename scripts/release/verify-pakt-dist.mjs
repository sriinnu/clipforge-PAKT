import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.cwd(), 'dist');
const input = JSON.stringify({ user: { name: 'Alice', role: 'developer' } });

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function verifyApi(api, label) {
  assert(typeof api.compress === 'function', `${label}: missing compress export`);
  assert(typeof api.decompress === 'function', `${label}: missing decompress export`);
  assert(typeof api.detect === 'function', `${label}: missing detect export`);
  assert(api.detect(input).format === 'json', `${label}: detect() failed JSON smoke test`);

  const result = api.compress(input, { fromFormat: 'json' });
  assert(typeof result.compressed === 'string', `${label}: compress() returned no text`);
  assert(result.compressed.length > 0, `${label}: compress() returned empty text`);

  const restored = api.decompress(result.compressed, 'json');
  assert(restored.text.includes('Alice'), `${label}: decompress() smoke test lost data`);
}

const esm = await import(pathToFileURL(resolve(root, 'index.js')).href);
verifyApi(esm, 'esm');

const require = createRequire(import.meta.url);
const cjs = require(resolve(root, 'index.cjs'));
verifyApi(cjs, 'cjs');

console.log('Verified @sriinnu/pakt dist ESM/CJS smoke imports.');

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Compression benchmarks for @yugenlab/pakt.
 *
 * Measures compress() throughput across all supported input formats
 * (JSON, YAML, CSV) and varying data shapes (small, tabular, nested,
 * API response, wide object).
 */
import { bench, describe } from 'vitest';
import { compress } from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, 'fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

const smallObjects = loadFixture('small-objects.json');
const tabular50 = loadFixture('tabular-50.json');
const nestedConfig = loadFixture('nested-config.json');
const apiResponse = loadFixture('api-response.json');
const wideObject = loadFixture('wide-object.json');
const mixedYaml = loadFixture('mixed-types.yaml');
const largeCsv = loadFixture('large-table.csv');

// ---------------------------------------------------------------------------
// Report fixture sizes for context
// ---------------------------------------------------------------------------

function sizeKB(s: string): string {
  return (Buffer.byteLength(s, 'utf-8') / 1024).toFixed(1);
}

console.log('--- Fixture sizes ---');
console.log(`  small-objects.json : ${sizeKB(smallObjects)} KB`);
console.log(`  tabular-50.json   : ${sizeKB(tabular50)} KB`);
console.log(`  nested-config.json: ${sizeKB(nestedConfig)} KB`);
console.log(`  api-response.json : ${sizeKB(apiResponse)} KB`);
console.log(`  wide-object.json  : ${sizeKB(wideObject)} KB`);
console.log(`  mixed-types.yaml  : ${sizeKB(mixedYaml)} KB`);
console.log(`  large-table.csv   : ${sizeKB(largeCsv)} KB`);
console.log('');

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe('compress — JSON inputs', () => {
  bench('small objects (10 users)', () => {
    compress(smallObjects);
  });

  bench('tabular 50-row array', () => {
    compress(tabular50);
  });

  bench('nested config (3-4 levels deep)', () => {
    compress(nestedConfig);
  });

  bench('API response (GitHub-style repos)', () => {
    compress(apiResponse);
  });

  bench('wide object (30+ keys)', () => {
    compress(wideObject);
  });
});

describe('compress — non-JSON inputs', () => {
  bench('YAML (services + infra config)', () => {
    compress(mixedYaml, { fromFormat: 'yaml' });
  });

  bench('CSV (100-row sales table)', () => {
    compress(largeCsv, { fromFormat: 'csv' });
  });
});

// ---------------------------------------------------------------------------
// Log compression ratios (printed once, not benchmarked)
// ---------------------------------------------------------------------------

const fixtures: Array<[string, string, Parameters<typeof compress>[1]?]> = [
  ['small-objects.json', smallObjects],
  ['tabular-50.json', tabular50],
  ['nested-config.json', nestedConfig],
  ['api-response.json', apiResponse],
  ['wide-object.json', wideObject],
  ['mixed-types.yaml', mixedYaml, { fromFormat: 'yaml' }],
  ['large-table.csv', largeCsv, { fromFormat: 'csv' }],
];

console.log('--- Compression ratios ---');
for (const [name, data, opts] of fixtures) {
  const result = compress(data, opts);
  const origLen = Buffer.byteLength(data, 'utf-8');
  const compLen = Buffer.byteLength(result.compressed, 'utf-8');
  const byteRatio = ((1 - compLen / origLen) * 100).toFixed(1);
  console.log(
    `  ${name.padEnd(22)} ` +
      `tokens: ${String(result.originalTokens).padStart(5)} -> ${String(result.compressedTokens).padStart(5)} ` +
      `(${result.savings.totalPercent}% token savings, ${byteRatio}% byte savings)`,
  );
}
console.log('');

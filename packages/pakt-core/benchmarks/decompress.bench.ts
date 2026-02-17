/**
 * Decompression benchmarks for @yugenlab/pakt.
 *
 * Pre-compresses each fixture, then benchmarks decompress() throughput.
 * This isolates decompression performance from compression overhead.
 */
import { bench, describe } from 'vitest';
import { compress, decompress } from '../src/index.js';
import type { PaktFormat } from '../src/index.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, 'fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

// ---------------------------------------------------------------------------
// Pre-compress all fixtures
// ---------------------------------------------------------------------------

interface PreCompressed {
  name: string;
  pakt: string;
  outputFormat: PaktFormat;
  originalSize: number;
  paktSize: number;
}

function preCompress(
  name: string,
  data: string,
  opts?: Parameters<typeof compress>[1],
): PreCompressed {
  const result = compress(data, opts);
  const outputFormat = result.detectedFormat === 'pakt' ? 'json' : result.detectedFormat;
  return {
    name,
    pakt: result.compressed,
    outputFormat,
    originalSize: Buffer.byteLength(data, 'utf-8'),
    paktSize: Buffer.byteLength(result.compressed, 'utf-8'),
  };
}

const fixtures: PreCompressed[] = [
  preCompress('small objects (10 users)', loadFixture('small-objects.json')),
  preCompress('tabular 50-row array', loadFixture('tabular-50.json')),
  preCompress('nested config', loadFixture('nested-config.json')),
  preCompress('API response (repos)', loadFixture('api-response.json')),
  preCompress('wide object (30+ keys)', loadFixture('wide-object.json')),
  preCompress('YAML (services + infra)', loadFixture('mixed-types.yaml'), { fromFormat: 'yaml' }),
  preCompress('CSV (100-row table)', loadFixture('large-table.csv'), { fromFormat: 'csv' }),
];

// ---------------------------------------------------------------------------
// Report pre-compressed sizes
// ---------------------------------------------------------------------------

console.log('--- Pre-compressed PAKT sizes ---');
for (const f of fixtures) {
  const paktKB = (f.paktSize / 1024).toFixed(1);
  console.log(`  ${f.name.padEnd(30)} ${paktKB} KB PAKT -> decompress to ${f.outputFormat}`);
}
console.log('');

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe('decompress — JSON targets', () => {
  for (const f of fixtures.filter((x) => x.outputFormat === 'json')) {
    bench(`decompress ${f.name}`, () => {
      decompress(f.pakt, f.outputFormat);
    });
  }
});

describe('decompress — non-JSON targets', () => {
  for (const f of fixtures.filter((x) => x.outputFormat !== 'json')) {
    bench(`decompress ${f.name}`, () => {
      decompress(f.pakt, f.outputFormat);
    });
  }
});

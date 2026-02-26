import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Per-layer benchmarks for @sriinnu/pakt.
 *
 * Compares L1-only (structural) versus L1+L2 (structural + dictionary)
 * compression on the 50-row tabular data to show per-layer contribution.
 */
import { bench, describe } from 'vitest';
import { compress } from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, 'fixtures');

const tabular50 = readFileSync(join(fixturesDir, 'tabular-50.json'), 'utf-8');

// ---------------------------------------------------------------------------
// Report per-layer savings
// ---------------------------------------------------------------------------

const l1Only = compress(tabular50, {
  layers: { structural: true, dictionary: false },
});
const l1l2 = compress(tabular50, {
  layers: { structural: true, dictionary: true },
});

console.log('--- Layer contribution (tabular-50.json) ---');
console.log(`  Original tokens   : ${l1l2.originalTokens}`);
console.log(
  `  After L1 (struct) : ${l1Only.compressedTokens} tokens (${l1Only.savings.totalPercent}% saved)`,
);
console.log(
  `  After L1+L2 (dict): ${l1l2.compressedTokens} tokens (${l1l2.savings.totalPercent}% saved)`,
);
console.log(`  L1 savings        : ${l1l2.savings.byLayer.structural} tokens`);
console.log(`  L2 savings        : ${l1l2.savings.byLayer.dictionary} tokens`);
console.log(`  Dictionary entries : ${l1l2.dictionary.length}`);
if (l1l2.dictionary.length > 0) {
  console.log('  Top dict entries  :');
  for (const e of l1l2.dictionary.slice(0, 5)) {
    console.log(
      `    ${e.alias} -> "${e.expansion}" (${e.occurrences}x, ${e.tokensSaved} tokens saved)`,
    );
  }
}
console.log('');

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe('layers — L1 only vs L1+L2 (tabular-50)', () => {
  bench('L1 only (structural)', () => {
    compress(tabular50, {
      layers: { structural: true, dictionary: false },
    });
  });

  bench('L1 + L2 (structural + dictionary)', () => {
    compress(tabular50, {
      layers: { structural: true, dictionary: true },
    });
  });
});

describe('layers — L1 only vs L1+L2 (nested config)', () => {
  const nestedConfig = readFileSync(join(fixturesDir, 'nested-config.json'), 'utf-8');

  const ncL1 = compress(nestedConfig, {
    layers: { structural: true, dictionary: false },
  });
  const ncL1L2 = compress(nestedConfig, {
    layers: { structural: true, dictionary: true },
  });

  console.log('--- Layer contribution (nested-config.json) ---');
  console.log(`  Original tokens   : ${ncL1L2.originalTokens}`);
  console.log(
    `  After L1 (struct) : ${ncL1.compressedTokens} tokens (${ncL1.savings.totalPercent}% saved)`,
  );
  console.log(
    `  After L1+L2 (dict): ${ncL1L2.compressedTokens} tokens (${ncL1L2.savings.totalPercent}% saved)`,
  );
  console.log(`  L1 savings        : ${ncL1L2.savings.byLayer.structural} tokens`);
  console.log(`  L2 savings        : ${ncL1L2.savings.byLayer.dictionary} tokens`);
  console.log('');

  bench('L1 only (structural)', () => {
    compress(nestedConfig, {
      layers: { structural: true, dictionary: false },
    });
  });

  bench('L1 + L2 (structural + dictionary)', () => {
    compress(nestedConfig, {
      layers: { structural: true, dictionary: true },
    });
  });
});

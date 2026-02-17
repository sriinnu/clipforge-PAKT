/**
 * Dictionary (L2) benchmarks for @yugenlab/pakt.
 *
 * Isolates the L2 dictionary layer performance by comparing:
 * - High-repetition data (50-row tabular: many repeated departments, statuses)
 * - Low-repetition data (nested config: mostly unique values)
 *
 * Shows dictionary savings contribution and alias efficiency.
 */
import { bench, describe } from 'vitest';
import { compress } from '../src/index.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, 'fixtures');

const tabular50 = readFileSync(join(fixturesDir, 'tabular-50.json'), 'utf-8');
const nestedConfig = readFileSync(join(fixturesDir, 'nested-config.json'), 'utf-8');

// ---------------------------------------------------------------------------
// Report dictionary statistics
// ---------------------------------------------------------------------------

function reportDict(label: string, data: string, opts?: Parameters<typeof compress>[1]): void {
  const withDict = compress(data, {
    ...opts,
    layers: { structural: true, dictionary: true },
  });
  const withoutDict = compress(data, {
    ...opts,
    layers: { structural: true, dictionary: false },
  });

  const dictSavings = withoutDict.compressedTokens - withDict.compressedTokens;
  const dictPercent = withoutDict.compressedTokens > 0
    ? ((dictSavings / withoutDict.compressedTokens) * 100).toFixed(1)
    : '0.0';

  console.log(`--- Dictionary analysis: ${label} ---`);
  console.log(`  Tokens without dict : ${withoutDict.compressedTokens}`);
  console.log(`  Tokens with dict    : ${withDict.compressedTokens}`);
  console.log(`  Dict savings        : ${dictSavings} tokens (${dictPercent}% of L1 output)`);
  console.log(`  Dictionary entries  : ${withDict.dictionary.length}`);
  if (withDict.dictionary.length > 0) {
    console.log('  Aliases:');
    for (const e of withDict.dictionary) {
      console.log(`    ${e.alias} -> "${e.expansion}" (${e.occurrences}x, saved ${e.tokensSaved} tokens)`);
    }
  } else {
    console.log('  No aliases created (values too unique or below min-savings threshold)');
  }
  console.log('');
}

reportDict('tabular-50 (HIGH repetition)', tabular50);
reportDict('nested-config (LOW repetition)', nestedConfig);

// ---------------------------------------------------------------------------
// Benchmarks: high-repetition data
// ---------------------------------------------------------------------------

describe('dictionary — high repetition (tabular-50)', () => {
  bench('compress with dictionary (L1+L2)', () => {
    compress(tabular50, {
      layers: { structural: true, dictionary: true },
    });
  });

  bench('compress without dictionary (L1 only)', () => {
    compress(tabular50, {
      layers: { structural: true, dictionary: false },
    });
  });
});

// ---------------------------------------------------------------------------
// Benchmarks: low-repetition data
// ---------------------------------------------------------------------------

describe('dictionary — low repetition (nested-config)', () => {
  bench('compress with dictionary (L1+L2)', () => {
    compress(nestedConfig, {
      layers: { structural: true, dictionary: true },
    });
  });

  bench('compress without dictionary (L1 only)', () => {
    compress(nestedConfig, {
      layers: { structural: true, dictionary: false },
    });
  });
});

// ---------------------------------------------------------------------------
// Benchmarks: dictionary sensitivity to minSavings threshold
// ---------------------------------------------------------------------------

describe('dictionary — minSavings sensitivity (tabular-50)', () => {
  bench('dictMinSavings = 1 (aggressive)', () => {
    compress(tabular50, {
      layers: { structural: true, dictionary: true },
      dictMinSavings: 1,
    });
  });

  bench('dictMinSavings = 3 (default)', () => {
    compress(tabular50, {
      layers: { structural: true, dictionary: true },
      dictMinSavings: 3,
    });
  });

  bench('dictMinSavings = 10 (conservative)', () => {
    compress(tabular50, {
      layers: { structural: true, dictionary: true },
      dictMinSavings: 10,
    });
  });
});

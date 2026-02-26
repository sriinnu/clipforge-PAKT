import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Pattern detection benchmarks for @sriinnu/pakt.
 *
 * Benchmarks the L2 dictionary layer's four pattern detection modes:
 * 1. **Prefix detection** — shared URL/path prefixes (e.g. `/api/v2/`)
 * 2. **Suffix detection** — shared file extensions/endings
 * 3. **Substring detection** — repeated infixes at arbitrary positions
 * 4. **Mixed patterns** — combination of all pattern types
 *
 * For each mode, reports:
 * - Original vs compressed token counts
 * - Savings percentage
 * - Dictionary entries (aliases + expansions)
 * - Whether the expected pattern was correctly detected
 */
import { bench, describe } from 'vitest';
import { compress } from '../src/index.js';
import type { PaktResult } from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, 'fixtures');

/** Load a fixture file from the benchmarks/fixtures directory. */
function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

const urlEndpoints = loadFixture('url-endpoints.json');

// ---------------------------------------------------------------------------
// Synthetic fixtures for targeted pattern tests
// ---------------------------------------------------------------------------

/**
 * Prefix-heavy fixture: API endpoints sharing `/api/v2/` base paths.
 * All paths share the `https://api.example.com/v2/` prefix.
 */
const prefixData = JSON.stringify([
  { url: 'https://api.example.com/v2/users', method: 'GET' },
  { url: 'https://api.example.com/v2/users/123', method: 'GET' },
  { url: 'https://api.example.com/v2/users/456', method: 'PUT' },
  { url: 'https://api.example.com/v2/products', method: 'GET' },
  { url: 'https://api.example.com/v2/products/789', method: 'GET' },
  { url: 'https://api.example.com/v2/orders', method: 'GET' },
  { url: 'https://api.example.com/v2/orders/101', method: 'POST' },
  { url: 'https://api.example.com/v2/analytics', method: 'GET' },
  { url: 'https://api.example.com/v2/analytics/daily', method: 'GET' },
  { url: 'https://api.example.com/v2/categories', method: 'GET' },
  { url: 'https://api.example.com/v2/search', method: 'POST' },
  { url: 'https://api.example.com/v2/health', method: 'GET' },
]);

/**
 * Suffix-heavy fixture: file paths sharing common extensions.
 * All paths end with `.component.tsx` or `.service.ts`.
 */
const suffixData = JSON.stringify([
  { file: 'src/components/Button.component.tsx', size: 1240, type: 'component' },
  { file: 'src/components/Modal.component.tsx', size: 2350, type: 'component' },
  { file: 'src/components/Header.component.tsx', size: 890, type: 'component' },
  { file: 'src/components/Footer.component.tsx', size: 670, type: 'component' },
  { file: 'src/components/Sidebar.component.tsx', size: 1580, type: 'component' },
  { file: 'src/components/NavBar.component.tsx', size: 1100, type: 'component' },
  { file: 'src/services/auth.service.ts', size: 3200, type: 'service' },
  { file: 'src/services/user.service.ts', size: 2800, type: 'service' },
  { file: 'src/services/order.service.ts', size: 4100, type: 'service' },
  { file: 'src/services/product.service.ts', size: 2600, type: 'service' },
  { file: 'src/services/analytics.service.ts', size: 1900, type: 'service' },
  { file: 'src/services/notification.service.ts', size: 1500, type: 'service' },
]);

/**
 * Substring-heavy fixture: values sharing common infixes like
 * `_production_`, `internal.acme.com`, etc.
 */
const substringData = JSON.stringify({
  databases: {
    primary: { host: 'db-primary.internal.acme.com', port: 5432 },
    replica: { host: 'db-replica.internal.acme.com', port: 5432 },
    analytics: { host: 'db-analytics.internal.acme.com', port: 5432 },
    staging: { host: 'db-staging.internal.acme.com', port: 5432 },
    cache_host: 'redis-cache.internal.acme.com',
    queue_host: 'mq-broker.internal.acme.com',
  },
  environments: {
    web: 'app_production_us_east_1',
    api: 'api_production_us_east_1',
    worker: 'worker_production_us_east_1',
    cron: 'cron_production_us_east_1',
    staging_web: 'app_production_eu_west_1',
    staging_api: 'api_production_eu_west_1',
  },
});

/**
 * Mixed-pattern fixture: combines prefix, suffix, and substring patterns.
 * Tests how all three detection modes interact.
 */
const mixedPatternData = JSON.stringify({
  services: [
    {
      endpoint: 'https://api.example.com/v2/users',
      log: 'logs/users.service.ts.log',
      env: 'svc_production_us_east',
    },
    {
      endpoint: 'https://api.example.com/v2/orders',
      log: 'logs/orders.service.ts.log',
      env: 'svc_production_us_east',
    },
    {
      endpoint: 'https://api.example.com/v2/products',
      log: 'logs/products.service.ts.log',
      env: 'svc_production_us_east',
    },
    {
      endpoint: 'https://api.example.com/v2/analytics',
      log: 'logs/analytics.service.ts.log',
      env: 'svc_production_us_west',
    },
    {
      endpoint: 'https://api.example.com/v2/billing',
      log: 'logs/billing.service.ts.log',
      env: 'svc_production_us_west',
    },
    {
      endpoint: 'https://api.example.com/v2/search',
      log: 'logs/search.service.ts.log',
      env: 'svc_production_eu_west',
    },
  ],
});

// ---------------------------------------------------------------------------
// Pattern detection reporting
// ---------------------------------------------------------------------------

/**
 * Report compression results for a pattern-focused fixture.
 * Logs token counts, savings, dictionary entries, and detected patterns.
 *
 * @param label - Human-readable label for the report
 * @param data - Raw JSON string to compress
 * @param expectedPattern - Substring expected in at least one dictionary entry
 */
function reportPatternDetection(label: string, data: string, expectedPattern: string): void {
  /** Full L1+L2 compression result. */
  const full: PaktResult = compress(data, {
    layers: { structural: true, dictionary: true },
    dictMinSavings: 1,
  });

  /** L1-only result (no dictionary) for comparison. */
  const l1Only: PaktResult = compress(data, {
    layers: { structural: true, dictionary: false },
  });

  const dictSavings = l1Only.compressedTokens - full.compressedTokens;
  const dictPercent =
    l1Only.compressedTokens > 0
      ? ((dictSavings / l1Only.compressedTokens) * 100).toFixed(1)
      : '0.0';

  /** Check whether the expected pattern appears in any dictionary expansion. */
  const patternDetected = full.dictionary.some((e) => e.expansion.includes(expectedPattern));

  console.log(`--- ${label} ---`);
  console.log(`  Original tokens     : ${full.originalTokens}`);
  console.log(`  After L1 (struct)   : ${l1Only.compressedTokens}`);
  console.log(`  After L1+L2 (dict)  : ${full.compressedTokens}`);
  console.log(`  Total savings       : ${full.savings.totalPercent}%`);
  console.log(`  L1 savings          : ${full.savings.byLayer.structural} tokens`);
  console.log(`  L2 savings          : ${dictSavings} tokens (${dictPercent}% of L1 output)`);
  console.log(`  Dictionary entries  : ${full.dictionary.length}`);
  console.log(
    `  Pattern detected    : ${patternDetected ? 'YES' : 'NO'} (looking for "${expectedPattern}")`,
  );
  if (full.dictionary.length > 0) {
    console.log('  Entries:');
    for (const e of full.dictionary) {
      console.log(
        `    ${e.alias} -> "${e.expansion}" (${e.occurrences}x, saved ${e.tokensSaved} tokens)`,
      );
    }
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Print pattern detection reports (executed once during bench setup)
// ---------------------------------------------------------------------------

reportPatternDetection('Prefix detection (API URLs)', prefixData, 'https://api.example.com/v2/');

reportPatternDetection('Suffix detection (file extensions)', suffixData, '.component.tsx');

reportPatternDetection('Substring detection (infixes)', substringData, 'internal.acme.com');

reportPatternDetection(
  'Mixed patterns (prefix + suffix + substring)',
  mixedPatternData,
  'https://api.example.com/v2/',
);

reportPatternDetection(
  'URL endpoints fixture (realistic API spec)',
  urlEndpoints,
  'application/json',
);

// ---------------------------------------------------------------------------
// Benchmarks: prefix detection
// ---------------------------------------------------------------------------

describe('patterns — prefix detection (API URLs)', () => {
  bench('L1+L2 with prefix-heavy data', () => {
    compress(prefixData, {
      layers: { structural: true, dictionary: true },
      dictMinSavings: 1,
    });
  });

  bench('L1 only (no dictionary) baseline', () => {
    compress(prefixData, {
      layers: { structural: true, dictionary: false },
    });
  });
});

// ---------------------------------------------------------------------------
// Benchmarks: suffix detection
// ---------------------------------------------------------------------------

describe('patterns — suffix detection (file extensions)', () => {
  bench('L1+L2 with suffix-heavy data', () => {
    compress(suffixData, {
      layers: { structural: true, dictionary: true },
      dictMinSavings: 1,
    });
  });

  bench('L1 only (no dictionary) baseline', () => {
    compress(suffixData, {
      layers: { structural: true, dictionary: false },
    });
  });
});

// ---------------------------------------------------------------------------
// Benchmarks: substring detection
// ---------------------------------------------------------------------------

describe('patterns — substring detection (infixes)', () => {
  bench('L1+L2 with substring-heavy data', () => {
    compress(substringData, {
      layers: { structural: true, dictionary: true },
      dictMinSavings: 1,
    });
  });

  bench('L1 only (no dictionary) baseline', () => {
    compress(substringData, {
      layers: { structural: true, dictionary: false },
    });
  });
});

// ---------------------------------------------------------------------------
// Benchmarks: mixed patterns
// ---------------------------------------------------------------------------

describe('patterns — mixed (prefix + suffix + substring)', () => {
  bench('L1+L2 with mixed-pattern data', () => {
    compress(mixedPatternData, {
      layers: { structural: true, dictionary: true },
      dictMinSavings: 1,
    });
  });

  bench('L1 only (no dictionary) baseline', () => {
    compress(mixedPatternData, {
      layers: { structural: true, dictionary: false },
    });
  });
});

// ---------------------------------------------------------------------------
// Benchmarks: realistic URL endpoints fixture
// ---------------------------------------------------------------------------

describe('patterns — realistic URL endpoints fixture', () => {
  bench('L1+L2 (full pipeline)', () => {
    compress(urlEndpoints, {
      layers: { structural: true, dictionary: true },
    });
  });

  bench('L1 only (structural baseline)', () => {
    compress(urlEndpoints, {
      layers: { structural: true, dictionary: false },
    });
  });

  bench('L1+L2 with aggressive dictMinSavings=1', () => {
    compress(urlEndpoints, {
      layers: { structural: true, dictionary: true },
      dictMinSavings: 1,
    });
  });
});

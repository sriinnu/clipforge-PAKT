/**
 * @module tests/L1-delta-numeric
 * Tests for numeric-delta encoding (`+N` / `-N` sentinels).
 *
 * Covers: basic timestamps, basic IDs, negative deltas, mixed columns
 * (skip), single-row passthrough, 100-row round-trip stress, and the
 * interaction with the `~` exact-delta sentinel.
 */

import { describe, expect, it } from 'vitest';
import { compress } from '../src/compress.js';
import { decompress } from '../src/decompress.js';
import { compressL1 } from '../src/layers/L1-compress.js';
import { decompressL1 } from '../src/layers/L1-decompress.js';
import { isDeltaSentinel } from '../src/layers/L1-delta-exact.js';
import { isNumericDeltaSentinel, needsNumericDeltaQuote } from '../src/layers/L1-delta-numeric.js';
import { applyDeltaEncoding, revertDeltaEncoding } from '../src/layers/L1-delta.js';
import type { DocumentNode, TabularArrayNode } from '../src/parser/ast.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compress → delta-encode → delta-decode → decompress. Assert equality. */
function deltaRoundtrip(data: unknown, label = ''): void {
  const doc = compressL1(data, 'json');
  const encoded = applyDeltaEncoding(doc);
  const decoded = revertDeltaEncoding(encoded);
  const restored = decompressL1(decoded.body);
  expect(restored, `numeric delta roundtrip failed${label ? `: ${label}` : ''}`).toEqual(data);
}

/** Find the first tabular array in a document body. */
function findTabular(doc: DocumentNode): TabularArrayNode | undefined {
  for (const node of doc.body) {
    if (node.type === 'tabularArray') return node;
  }
  return undefined;
}

/** Count `+N` / `-N` sentinels across all tabular rows. */
function countNumericSentinels(doc: DocumentNode): number {
  let count = 0;
  for (const node of doc.body) {
    if (node.type === 'tabularArray') {
      for (const row of node.rows) {
        for (const val of row.values) {
          if (isNumericDeltaSentinel(val)) count++;
        }
      }
    }
  }
  return count;
}

/** Compress and delta-encode. */
function deltaEncode(data: unknown): DocumentNode {
  const doc = compressL1(data, 'json');
  return applyDeltaEncoding(doc);
}

// ===========================================================================
// 1. Basic timestamps
// ===========================================================================

describe('L1-delta-numeric: timestamps', () => {
  it('encodes a monotonic timestamp column as +N sentinels', () => {
    const data = [
      { ts: 1700000000, name: 'Alice' },
      { ts: 1700000060, name: 'Bob' },
      { ts: 1700000120, name: 'Carol' },
      { ts: 1700000180, name: 'Dave' },
    ];
    const encoded = deltaEncode(data);
    const sentinels = countNumericSentinels(encoded);
    /* Rows 1-3 of the ts column should be +60 sentinels (3 total) */
    expect(sentinels).toBe(3);

    /* @compress delta header must be present */
    expect(encoded.headers.some((h) => h.headerType === 'compress' && h.value === 'delta')).toBe(
      true,
    );

    deltaRoundtrip(data, 'timestamps');
  });
});

// ===========================================================================
// 2. Basic sequential IDs
// ===========================================================================

describe('L1-delta-numeric: sequential IDs', () => {
  it('encodes sequential integer IDs as +1 sentinels', () => {
    const data = [
      { id: 1001, label: 'a' },
      { id: 1002, label: 'b' },
      { id: 1003, label: 'c' },
      { id: 1004, label: 'd' },
      { id: 1005, label: 'e' },
    ];
    const encoded = deltaEncode(data);
    expect(countNumericSentinels(encoded)).toBe(4);
    deltaRoundtrip(data, 'sequential ids');
  });
});

// ===========================================================================
// 3. Negative deltas
// ===========================================================================

describe('L1-delta-numeric: negative deltas', () => {
  it('encodes decreasing sequences with -N sentinels', () => {
    /* Use values that give strong savings so the 20% threshold fires:
       5-digit originals, single-digit deltas. */
    const data = [
      { v: 50000, tag: 'a' },
      { v: 49999, tag: 'b' },
      { v: 49998, tag: 'c' },
      { v: 49997, tag: 'd' },
      { v: 49996, tag: 'e' },
    ];
    const encoded = deltaEncode(data);
    const tab = findTabular(encoded);
    expect(tab).toBeDefined();

    /* Sentinels should all be "-1" */
    const negSentinels = tab!.rows
      .flatMap((r) => r.values)
      .filter((v) => isNumericDeltaSentinel(v))
      .map((v) => v.value);
    expect(negSentinels).toEqual(['-1', '-1', '-1', '-1']);

    deltaRoundtrip(data, 'negative deltas');
  });

  it('handles mixed-sign deltas on the same column', () => {
    const data = [
      { n: 10, k: 'a' },
      { n: 15, k: 'b' },
      { n: 13, k: 'c' },
      { n: 20, k: 'd' },
      { n: 18, k: 'e' },
    ];
    deltaRoundtrip(data, 'mixed sign deltas');
  });
});

// ===========================================================================
// 4. Mixed columns — skip
// ===========================================================================

describe('L1-delta-numeric: ineligible columns are skipped', () => {
  it('skips a column with mixed ints and strings', () => {
    const data = [
      { id: '1001', label: 'a' }, // note: string, not int
      { id: '1002', label: 'b' },
      { id: '1003', label: 'c' },
      { id: '1004', label: 'd' },
    ];
    const encoded = deltaEncode(data);
    expect(countNumericSentinels(encoded)).toBe(0);
    deltaRoundtrip(data, 'string ids');
  });

  it('skips a column that contains floats', () => {
    const data = [
      { price: 10.5, tag: 'a' },
      { price: 11.5, tag: 'b' },
      { price: 12.5, tag: 'c' },
      { price: 13.5, tag: 'd' },
    ];
    const encoded = deltaEncode(data);
    expect(countNumericSentinels(encoded)).toBe(0);
    deltaRoundtrip(data, 'float prices');
  });

  it('skips a column with a null value', () => {
    const data = [
      { id: 1, tag: 'a' },
      { id: null, tag: 'b' },
      { id: 3, tag: 'c' },
      { id: 4, tag: 'd' },
    ];
    const encoded = deltaEncode(data);
    expect(countNumericSentinels(encoded)).toBe(0);
    deltaRoundtrip(data, 'null id');
  });

  it('skips a column whose numeric-delta savings is below 20%', () => {
    /* Large jumps, few digits saved — not worth the encode */
    const data = [
      { n: 1, k: 'a' },
      { n: 999999999, k: 'b' },
      { n: 3, k: 'c' },
      { n: 999999999, k: 'd' },
    ];
    const encoded = deltaEncode(data);
    expect(countNumericSentinels(encoded)).toBe(0);
    deltaRoundtrip(data, 'non-compressible numbers');
  });
});

// ===========================================================================
// 5. Single-row / passthrough
// ===========================================================================

describe('L1-delta-numeric: passthrough cases', () => {
  it('leaves a single-row tabular alone', () => {
    /* With only one row there is no "previous" to delta against. */
    const data = [{ id: 1, label: 'only' }];
    const encoded = deltaEncode(data);
    expect(countNumericSentinels(encoded)).toBe(0);
    deltaRoundtrip(data, 'single row');
  });

  it('leaves a two-row tabular alone (below MIN rows)', () => {
    const data = [
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
    ];
    const encoded = deltaEncode(data);
    expect(countNumericSentinels(encoded)).toBe(0);
    deltaRoundtrip(data, 'two rows');
  });
});

// ===========================================================================
// 6. 100-row round-trip stress
// ===========================================================================

describe('L1-delta-numeric: 100-row roundtrip', () => {
  it('round-trips a 100-row table with numeric id + timestamp + string cols', () => {
    const data = Array.from({ length: 100 }, (_, i) => ({
      id: 10_000 + i,
      ts: 1_700_000_000 + i * 60,
      category: i % 3 === 0 ? 'x' : i % 3 === 1 ? 'y' : 'z',
      label: `row_${i}`,
    }));
    deltaRoundtrip(data, '100-row stress');

    /* Sanity: sentinels must actually have fired for id + ts columns */
    const encoded = deltaEncode(data);
    const sentinels = countNumericSentinels(encoded);
    /* Ideal: 99 rows × 2 columns = 198. Allow some slack in case the
       threshold excludes borderline columns. */
    expect(sentinels).toBeGreaterThanOrEqual(100);
  });

  it('round-trips through the full compress/decompress pipeline', () => {
    const data = {
      rows: Array.from({ length: 50 }, (_, i) => ({
        id: i,
        ts: 1_700_000_000 + i * 120,
        name: `user_${i}`,
      })),
    };
    const input = JSON.stringify(data);
    const compressed = compress(input);
    const decompressed = decompress(compressed.compressed, 'json');
    expect(JSON.parse(decompressed.text)).toEqual(data);
  });
});

// ===========================================================================
// 7. Interaction with `~` exact sentinel
// ===========================================================================

describe('L1-delta-numeric: interaction with ~ sentinel', () => {
  it('prefers ~ over +0 when every delta on the column is zero', () => {
    const data = [
      { id: 42, name: 'a' },
      { id: 42, name: 'b' },
      { id: 42, name: 'c' },
      { id: 42, name: 'd' },
    ];
    const encoded = deltaEncode(data);
    /* No numeric sentinels — column is all repeats, handled by ~ */
    expect(countNumericSentinels(encoded)).toBe(0);

    /* There must be `~` sentinels instead (3 for the id column) */
    const tab = findTabular(encoded);
    const exactSentinels = tab!.rows.flatMap((r) => r.values).filter((v) => isDeltaSentinel(v));
    expect(exactSentinels.length).toBeGreaterThanOrEqual(3);

    deltaRoundtrip(data, 'all-equal id column prefers ~');
  });

  it('numeric-encoded cells are not collapsed into ~ even if strings match', () => {
    /* Sequential IDs → all deltas are +1. The exact-delta pass must NOT
       replace adjacent `+1` cells with `~` — each cell represents an
       independent per-row delta that would decode incorrectly if merged. */
    const data = Array.from({ length: 20 }, (_, i) => ({
      id: 100 + i,
      tag: 'const', // this column will get `~` sentinels, which is fine
    }));
    deltaRoundtrip(data, 'sequential ids with constant tag column');
  });

  it('force-quotes user string values that look like numeric sentinels', () => {
    /* A literal "+5" in the data must round-trip as a string, not be
       mistaken for a delta sentinel on re-encode. */
    const data = [
      { code: '+5', name: 'a' },
      { code: '-12', name: 'b' },
      { code: '+5', name: 'c' },
      { code: '+5', name: 'd' },
    ];
    const input = JSON.stringify(data);
    const compressed = compress(input);
    const decompressed = decompress(compressed.compressed, 'json');
    expect(JSON.parse(decompressed.text)).toEqual(data);
  });

  it('needsNumericDeltaQuote agrees with the sentinel shape', () => {
    expect(needsNumericDeltaQuote('+5')).toBe(true);
    expect(needsNumericDeltaQuote('-12')).toBe(true);
    expect(needsNumericDeltaQuote('+0')).toBe(false); // zero delta disallowed
    expect(needsNumericDeltaQuote('+')).toBe(false);
    expect(needsNumericDeltaQuote('5')).toBe(false);
    expect(needsNumericDeltaQuote('+5.5')).toBe(false);
  });
});

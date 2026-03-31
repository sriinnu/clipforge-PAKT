/**
 * @module tests/L1-delta
 * Tests for delta encoding of tabular arrays.
 *
 * Covers: encoding, decoding, roundtrip fidelity, edge cases,
 * threshold gating, nested structures, and sentinel handling.
 */

import { describe, expect, it } from 'vitest';
import { compressL1 } from '../src/layers/L1-compress.js';
import { decompressL1 } from '../src/layers/L1-decompress.js';
import {
  MIN_DELTA_RATIO,
  applyDeltaEncoding,
  computeDeltaRatio,
  isDeltaSentinel,
  revertDeltaEncoding,
} from '../src/layers/L1-delta.js';
import type { DocumentNode, TabularArrayNode } from '../src/parser/ast.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a PAKT doc from data via L1, apply delta, then revert and decompress. */
function deltaRoundtrip(data: unknown, label = ''): void {
  const doc = compressL1(data, 'json');
  const encoded = applyDeltaEncoding(doc);
  const decoded = revertDeltaEncoding(encoded);
  const restored = decompressL1(decoded.body);
  expect(restored, `delta roundtrip failed${label ? `: ${label}` : ''}`).toEqual(data);
}

/** Compress and delta-encode, returning the encoded doc. */
function deltaEncode(data: unknown): DocumentNode {
  const doc = compressL1(data, 'json');
  return applyDeltaEncoding(doc);
}

/** Find the first tabular array in a document body. */
function findTabular(doc: DocumentNode): TabularArrayNode | undefined {
  for (const node of doc.body) {
    if (node.type === 'tabularArray') return node;
  }
  return undefined;
}

/** Count `~` sentinels in all tabular rows. */
function countSentinels(doc: DocumentNode): number {
  let count = 0;
  for (const node of doc.body) {
    if (node.type === 'tabularArray') {
      for (const row of node.rows) {
        for (const val of row.values) {
          if (isDeltaSentinel(val)) count++;
        }
      }
    }
  }
  return count;
}

// ===========================================================================
// 1. Basic delta encoding
// ===========================================================================

describe('L1-delta: basic encoding', () => {
  it('replaces repeated adjacent values with ~ sentinels', () => {
    const data = [
      { name: 'Alice', role: 'dev', city: 'NYC' },
      { name: 'Bob', role: 'dev', city: 'NYC' },
      { name: 'Charlie', role: 'dev', city: 'NYC' },
    ];
    const encoded = deltaEncode(data);
    const tab = findTabular(encoded);
    expect(tab).toBeDefined();

    /* Row 0 should be unchanged (reference frame) */
    const row0 = tab!.rows[0]!;
    expect(row0.values.some((v) => isDeltaSentinel(v))).toBe(false);

    /* Rows 1-2 should have sentinels for role and city */
    const sentinels = countSentinels(encoded);
    expect(sentinels).toBeGreaterThan(0);

    /* role and city are repeated — 2 fields × 2 rows = 4 sentinels */
    expect(sentinels).toBe(4);
  });

  it('preserves changed values (no sentinel)', () => {
    const data = [
      { name: 'Alice', role: 'dev', city: 'NYC' },
      { name: 'Bob', role: 'dev', city: 'SF' },
      { name: 'Charlie', role: 'mgr', city: 'SF' },
    ];
    const encoded = deltaEncode(data);
    const tab = findTabular(encoded);

    /* Row 1: role=dev (sentinel), city=SF (changed) → 1 sentinel */
    /* Row 2: role=mgr (changed), city=SF (sentinel) → 1 sentinel */
    expect(countSentinels(encoded)).toBe(2);
  });

  it('adds @compress delta header', () => {
    const data = [
      { a: 1, b: 'x' },
      { a: 1, b: 'x' },
      { a: 1, b: 'x' },
    ];
    const encoded = deltaEncode(data);
    const compressHeader = encoded.headers.find(
      (h) => h.headerType === 'compress' && h.value === 'delta',
    );
    expect(compressHeader).toBeDefined();
  });
});

// ===========================================================================
// 2. Delta decoding (revert)
// ===========================================================================

describe('L1-delta: decoding', () => {
  it('resolves ~ sentinels back to original values', () => {
    const data = [
      { name: 'Alice', role: 'dev', city: 'NYC' },
      { name: 'Bob', role: 'dev', city: 'NYC' },
      { name: 'Charlie', role: 'dev', city: 'SF' },
    ];
    const encoded = deltaEncode(data);
    const decoded = revertDeltaEncoding(encoded);
    const tab = findTabular(decoded);

    /* No sentinels should remain after decoding */
    for (const row of tab!.rows) {
      for (const val of row.values) {
        expect(isDeltaSentinel(val)).toBe(false);
      }
    }
  });

  it('removes @compress delta header after decoding', () => {
    const data = [
      { x: 1, y: 2 },
      { x: 1, y: 2 },
      { x: 1, y: 2 },
    ];
    const encoded = deltaEncode(data);
    const decoded = revertDeltaEncoding(encoded);
    const compressHeader = decoded.headers.find(
      (h) => h.headerType === 'compress' && h.value === 'delta',
    );
    expect(compressHeader).toBeUndefined();
  });

  it('handles chained repetitions (A→B→C where B=A and C=B)', () => {
    const data = [
      { v: 'alpha' },
      { v: 'alpha' }, // same as row 0
      { v: 'alpha' }, // same as row 1 (which was sentinel)
      { v: 'beta' }, // changed
      { v: 'beta' }, // same as row 3
    ];
    deltaRoundtrip(data, 'chained repetitions');
  });
});

// ===========================================================================
// 3. Roundtrip fidelity
// ===========================================================================

describe('L1-delta: roundtrip', () => {
  it('preserves data through encode → decode cycle', () => {
    const data = [
      { id: 1, name: 'Alice', role: 'engineer', dept: 'platform', city: 'NYC' },
      { id: 2, name: 'Bob', role: 'engineer', dept: 'platform', city: 'NYC' },
      { id: 3, name: 'Charlie', role: 'engineer', dept: 'platform', city: 'SF' },
      { id: 4, name: 'Diana', role: 'designer', dept: 'product', city: 'SF' },
      { id: 5, name: 'Eve', role: 'designer', dept: 'product', city: 'SF' },
    ];
    deltaRoundtrip(data, '5-row employee table');
  });

  it('roundtrips with mixed types (string, number, boolean, null)', () => {
    const data = [
      { name: 'a', count: 10, active: true, bio: null },
      { name: 'b', count: 10, active: true, bio: null },
      { name: 'c', count: 10, active: false, bio: null },
    ];
    deltaRoundtrip(data, 'mixed types');
  });

  it('roundtrips with all-identical rows', () => {
    const data = [
      { x: 'same', y: 42 },
      { x: 'same', y: 42 },
      { x: 'same', y: 42 },
      { x: 'same', y: 42 },
    ];
    deltaRoundtrip(data, 'all identical');
  });

  it('roundtrips with all-unique rows (no deltas)', () => {
    const data = [
      { x: 'a', y: 1 },
      { x: 'b', y: 2 },
      { x: 'c', y: 3 },
    ];
    deltaRoundtrip(data, 'all unique');
  });

  it('preserves real ~ values in data (no sentinel collision)', () => {
    const data = [
      { name: 'Alice', status: '~' },
      { name: 'Bob', status: 'active' },
      { name: 'Charlie', status: '~' },
    ];
    deltaRoundtrip(data, 'real tilde values');
  });

  it('preserves ~ in reference frame row', () => {
    const data = [
      { val: '~', other: 'x' },
      { val: '~', other: 'x' },
      { val: '~', other: 'y' },
    ];
    deltaRoundtrip(data, 'tilde in reference frame');
  });

  it('delta encodes tabular arrays nested inside list arrays', () => {
    /* Construct data where list items contain tabular-eligible arrays */
    const data = {
      groups: [
        {
          members: [
            { name: 'A', role: 'dev' },
            { name: 'B', role: 'dev' },
            { name: 'C', role: 'dev' },
          ],
        },
      ],
    };
    deltaRoundtrip(data, 'tabular inside list array');
  });

  it('roundtrips objects containing tabular arrays', () => {
    const data = {
      meta: 'test',
      items: [
        { k: 'v1', s: 'shared' },
        { k: 'v2', s: 'shared' },
        { k: 'v3', s: 'shared' },
      ],
    };
    deltaRoundtrip(data, 'object with nested tabular');
  });
});

// ===========================================================================
// 4. Threshold gating
// ===========================================================================

describe('L1-delta: threshold gating', () => {
  it('skips delta encoding when rows < MIN_DELTA_ROWS', () => {
    const data = [
      { a: 1, b: 'x' },
      { a: 1, b: 'x' },
    ]; // only 2 rows
    const doc = compressL1(data, 'json');
    const encoded = applyDeltaEncoding(doc);

    /* Should be unchanged — no delta header */
    expect(encoded).toBe(doc); // same reference
    expect(encoded.headers.find((h) => h.value === 'delta')).toBeUndefined();
  });

  it('skips delta encoding when delta ratio < MIN_DELTA_RATIO', () => {
    const data = [
      { a: 1, b: 'x', c: 'y', d: 'z' },
      { a: 2, b: 'w', c: 'v', d: 'u' },
      { a: 3, b: 't', c: 's', d: 'r' },
    ];
    const doc = compressL1(data, 'json');
    const ratio = computeDeltaRatio(findTabular(doc)!);
    expect(ratio).toBeLessThan(MIN_DELTA_RATIO);

    const encoded = applyDeltaEncoding(doc);
    expect(encoded).toBe(doc); // unchanged
  });

  it('applies delta encoding when ratio ≥ MIN_DELTA_RATIO', () => {
    const data = [
      { a: 'same', b: 'same', c: 'same' },
      { a: 'same', b: 'same', c: 'diff' },
      { a: 'same', b: 'same', c: 'same' },
    ];
    const doc = compressL1(data, 'json');
    const ratio = computeDeltaRatio(findTabular(doc)!);
    expect(ratio).toBeGreaterThanOrEqual(MIN_DELTA_RATIO);

    const encoded = applyDeltaEncoding(doc);
    expect(encoded).not.toBe(doc); // modified
    expect(countSentinels(encoded)).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 5. Delta ratio computation
// ===========================================================================

describe('L1-delta: computeDeltaRatio', () => {
  it('returns 0 for arrays with < MIN_DELTA_ROWS', () => {
    const doc = compressL1([{ a: 1 }, { a: 1 }], 'json');
    const tab = findTabular(doc);
    expect(computeDeltaRatio(tab!)).toBe(0);
  });

  it('returns ~1.0 for all-identical rows', () => {
    const data = Array.from({ length: 5 }, () => ({ a: 'x', b: 'y' }));
    const doc = compressL1(data, 'json');
    const ratio = computeDeltaRatio(findTabular(doc)!);
    expect(ratio).toBe(1.0);
  });

  it('returns 0 for all-unique rows', () => {
    const data = [
      { a: '1', b: '2' },
      { a: '3', b: '4' },
      { a: '5', b: '6' },
    ];
    const doc = compressL1(data, 'json');
    const ratio = computeDeltaRatio(findTabular(doc)!);
    expect(ratio).toBe(0);
  });
});

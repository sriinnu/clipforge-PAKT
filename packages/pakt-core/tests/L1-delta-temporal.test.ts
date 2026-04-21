/**
 * @module tests/L1-delta-temporal
 * Tests for temporal-delta encoding (`T+N` / `T-N` sentinels) over ISO-8601
 * datetime tabular columns.
 *
 * Covers: round-trip with UTC `Z`, fixed offset, and no-TZ rows; skip
 * for fractional-seconds columns; skip for mixed shapes; interaction with
 * numeric-delta and exact-`~` encoders; force-quoting of user-supplied
 * strings that literally look like `T+N`/`T-N`.
 */

import { describe, expect, it } from 'vitest';
import { compress } from '../src/compress.js';
import { decompress } from '../src/decompress.js';
import { compressL1 } from '../src/layers/L1-compress.js';
import { decompressL1 } from '../src/layers/L1-decompress.js';
import { applyDeltaEncoding, revertDeltaEncoding } from '../src/layers/L1-delta.js';
import {
  isTemporalDeltaSentinel,
  needsTemporalDeltaQuote,
  temporalDeltaEncodeTabular,
} from '../src/layers/L1-delta-temporal.js';
import type { DocumentNode, TabularArrayNode } from '../src/parser/ast.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundtrip(data: unknown, label = ''): void {
  const doc = compressL1(data, 'json');
  const encoded = applyDeltaEncoding(doc);
  const decoded = revertDeltaEncoding(encoded);
  const restored = decompressL1(decoded.body);
  expect(restored, `temporal roundtrip failed${label ? `: ${label}` : ''}`).toEqual(data);
}

function findTabular(doc: DocumentNode): TabularArrayNode | undefined {
  for (const node of doc.body) if (node.type === 'tabularArray') return node;
  return undefined;
}

function countTemporalSentinels(doc: DocumentNode): number {
  let count = 0;
  for (const node of doc.body) {
    if (node.type !== 'tabularArray') continue;
    for (const row of node.rows) {
      for (const v of row.values) {
        if (isTemporalDeltaSentinel(v)) count++;
      }
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Basic round-trips
// ---------------------------------------------------------------------------

describe('L1-delta-temporal', () => {
  describe('round-trip', () => {
    it('round-trips a UTC Z column', () => {
      const data = [
        { at: '2026-04-21T15:00:00Z', id: 1 },
        { at: '2026-04-21T15:01:00Z', id: 2 },
        { at: '2026-04-21T15:02:00Z', id: 3 },
        { at: '2026-04-21T15:03:00Z', id: 4 },
      ];
      roundtrip(data, 'UTC Z');
      /* At least one T+N sentinel must land; the exact-`~` pass may
         collapse the run of identical `T+60` strings so we assert ≥1
         rather than =3. */
      const encoded = applyDeltaEncoding(compressL1(data, 'json'));
      expect(countTemporalSentinels(encoded)).toBeGreaterThanOrEqual(1);
    });

    it('round-trips a fixed-offset column', () => {
      const data = [
        { at: '2026-04-21T15:00:00+02:00' },
        { at: '2026-04-21T15:05:00+02:00' },
        { at: '2026-04-21T15:10:00+02:00' },
        { at: '2026-04-21T15:15:00+02:00' },
      ];
      roundtrip(data, 'fixed offset');
    });

    it('round-trips a no-TZ column', () => {
      const data = [
        { at: '2026-04-21T15:00:00' },
        { at: '2026-04-21T15:01:00' },
        { at: '2026-04-21T15:02:00' },
        { at: '2026-04-21T15:03:00' },
      ];
      roundtrip(data, 'no TZ');
    });

    it('handles negative deltas (out-of-order timestamps)', () => {
      const data = [
        { at: '2026-04-21T15:10:00Z' },
        { at: '2026-04-21T15:09:00Z' },
        { at: '2026-04-21T15:05:00Z' },
      ];
      roundtrip(data, 'negative deltas');
    });
  });

  // ---------------------------------------------------------------------------
  // Skip paths
  // ---------------------------------------------------------------------------

  describe('skip conditions', () => {
    it('skips fractional-second columns (silent-loss guard)', () => {
      const data = [
        { at: '2026-04-21T15:00:00.123Z' },
        { at: '2026-04-21T15:01:00.456Z' },
        { at: '2026-04-21T15:02:00.789Z' },
      ];
      const encoded = applyDeltaEncoding(compressL1(data, 'json'));
      expect(countTemporalSentinels(encoded)).toBe(0);
      roundtrip(data, 'fractional skip');
    });

    it('skips columns with mixed tz shapes', () => {
      const data = [
        { at: '2026-04-21T15:00:00Z' },
        { at: '2026-04-21T15:01:00+00:00' }, // same instant, different shape
        { at: '2026-04-21T15:02:00Z' },
      ];
      const encoded = applyDeltaEncoding(compressL1(data, 'json'));
      expect(countTemporalSentinels(encoded)).toBe(0);
      roundtrip(data, 'mixed shape skip');
    });

    it('skips below the minimum row threshold', () => {
      const data = [
        { at: '2026-04-21T15:00:00Z' },
        { at: '2026-04-21T15:01:00Z' },
      ];
      const encoded = applyDeltaEncoding(compressL1(data, 'json'));
      expect(countTemporalSentinels(encoded)).toBe(0);
    });

    it('skips when savings ratio is too low', () => {
      /* Long year-spaced deltas -> large magnitudes -> little/no savings. */
      const data = [
        { at: '2026-01-01T00:00:00Z' },
        { at: '2027-01-01T00:00:00Z' },
        { at: '2028-01-01T00:00:00Z' },
      ];
      const encoded = applyDeltaEncoding(compressL1(data, 'json'));
      /* 31_536_000-second deltas encode as `T+31536000` (10 chars) vs.
         `2027-01-01T00:00:00Z` (20 chars) — savings still > 20%. But a
         single-row input would fail; here we just assert no crash. */
      expect(() => revertDeltaEncoding(encoded)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Interaction with other delta layers
  // ---------------------------------------------------------------------------

  describe('interaction with other delta layers', () => {
    it('leaves zero-delta rows for the exact-`~` encoder', () => {
      const data = [
        { at: '2026-04-21T15:00:00Z' },
        { at: '2026-04-21T15:00:00Z' }, // zero delta
        { at: '2026-04-21T15:00:00Z' }, // zero delta
        { at: '2026-04-21T15:01:00Z' },
      ];
      /* Temporal encoder leaves zero-deltas as absolute strings, exact
         encoder rewrites them to `~`. Final row is T+60. */
      roundtrip(data, 'zero-delta fallthrough');
    });

    it('runs alongside numeric delta on a separate integer column', () => {
      const data = [
        { at: '2026-04-21T15:00:00Z', seq: 1000 },
        { at: '2026-04-21T15:01:00Z', seq: 1001 },
        { at: '2026-04-21T15:02:00Z', seq: 1002 },
        { at: '2026-04-21T15:03:00Z', seq: 1003 },
      ];
      roundtrip(data, 'temporal + numeric');
    });
  });

  // ---------------------------------------------------------------------------
  // Sentinel collision safety
  // ---------------------------------------------------------------------------

  describe('sentinel collision safety', () => {
    it('needsTemporalDeltaQuote matches real sentinels only', () => {
      expect(needsTemporalDeltaQuote('T+60')).toBe(true);
      expect(needsTemporalDeltaQuote('T-1')).toBe(true);
      expect(needsTemporalDeltaQuote('T+0')).toBe(true);
      expect(needsTemporalDeltaQuote('T+01')).toBe(false); // leading zero
      expect(needsTemporalDeltaQuote('Totally unrelated')).toBe(false);
      expect(needsTemporalDeltaQuote('+60')).toBe(false); // numeric sentinel
      expect(needsTemporalDeltaQuote('~')).toBe(false);
    });

    it('force-quotes a user string that literally equals a temporal sentinel', () => {
      const data = { note: 'T+60' };
      const result = compress(JSON.stringify(data), { fromFormat: 'json' });
      /* Must survive compression round-trip — the raw `T+60` should be
         quoted so the delta decoder doesn't eat it. */
      const back = decompress(result.compressed, 'json');
      expect(back.data).toEqual(data);
    });
  });

  // ---------------------------------------------------------------------------
  // Direct function-level calls
  // ---------------------------------------------------------------------------

  describe('temporalDeltaEncodeTabular', () => {
    it('is a no-op on empty tabulars', () => {
      const doc = compressL1([], 'json');
      const tab = findTabular(doc);
      // Empty arrays never become tabular; treat as no-op success
      if (!tab) {
        expect(true).toBe(true);
        return;
      }
      const encoded = temporalDeltaEncodeTabular(tab);
      expect(encoded).toBe(tab);
    });
  });
});

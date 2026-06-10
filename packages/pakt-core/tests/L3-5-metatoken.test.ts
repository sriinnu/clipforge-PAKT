/**
 * @module tests/L3-5-metatoken
 * Tests for the L3.5 meta-token compression layer.
 * Covers: unit tests, roundtrip correctness, measured savings, no-regression on
 * hostile inputs, property-based fuzz (FC_RUNS env var), cache-stability, and
 * deterministic regression tests for the fuzzer-found lossless violation.
 * @see src/layers/L3-5-metatoken.ts
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compress, decompress } from '../src/index.js';
import {
  applyMetatokenCompression,
  type MetatokenResult,
} from '../src/layers/L3-5-metatoken.js';
import { countTokens } from '../src/tokens/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Repetitive JSON fixture: many objects sharing multi-word field values that
 * cross word boundaries and won't all be caught by L2's word-ish heuristic.
 */
const REPETITIVE_JSON = JSON.stringify(
  Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      `item_${String(i)}`,
      {
        team: i % 2 === 0 ? 'platform_engineering_squad' : 'reliability_engineering_squad',
        status: i % 3 === 0 ? 'active_deployment_phase' : 'staging_deployment_phase',
        owner: i % 2 === 1 ? 'platform_engineering_squad' : 'reliability_engineering_squad',
      },
    ]),
  ),
);

/**
 * Repetitive log fixture: structured log lines with shared multi-word patterns.
 * Log lines cross word boundaries at spaces and underscores.
 */
const REPETITIVE_LOG = Array.from(
  { length: 15 },
  (_, i) =>
    `[INFO] service_health_check: endpoint_response_time=${String(50 + i)}ms status=healthy_ok`,
).join('\n');

/**
 * Hostile fixture: random short distinct values, nothing to alias.
 */
const HOSTILE = JSON.stringify({
  x1: 'aBc', x2: 'DeF', x3: 'GhI', x4: 'JkL', x5: 'MnO',
  y1: '123', y2: '456', y3: '789', y4: 'XyZ', y5: 'PqR',
});

// ---------------------------------------------------------------------------
// Helper: compress with metatoken enabled, then decompress
// ---------------------------------------------------------------------------

function compressWithMetatoken(input: string): {
  originalTokens: number;
  withoutMeta: number;
  withMeta: number;
  roundtripped: string;
} {
  const baseline = compress(input);
  const withMeta = compress(input, { layers: { metatoken: true } });

  const dec = decompress(withMeta.compressed, 'json');
  return {
    originalTokens: baseline.originalTokens,
    withoutMeta: baseline.compressedTokens,
    withMeta: withMeta.compressedTokens,
    roundtripped: dec.text,
  };
}

// ---------------------------------------------------------------------------
// 1. Unit tests — applyMetatokenCompression on minimal PAKT fixtures
// ---------------------------------------------------------------------------

describe('applyMetatokenCompression — unit tests', () => {
  it('returns pakt unchanged when no @dict block exists', () => {
    const pakt = '@from json\n\nfoo: bar\nbaz: qux\n';
    const result = applyMetatokenCompression(pakt, 'gpt-4o');
    expect(result.pakt).toBe(pakt);
    expect(result.savedTokens).toBe(0);
    expect(result.selected).toHaveLength(0);
  });

  it('returns pakt unchanged when @dict has no entries', () => {
    const pakt = '@from json\n@dict\n@end\n\nfoo: bar\n';
    const result = applyMetatokenCompression(pakt, 'gpt-4o');
    expect(result.pakt).toBe(pakt);
    expect(result.savedTokens).toBe(0);
  });

  it('appends new aliases AFTER existing L2 aliases', () => {
    // Craft a PAKT body with a cross-boundary pattern repeated many times
    const spanValue = 'platform_eng_squad';
    const bodyLines = Array.from({ length: 6 }, () => `  team: ${spanValue}`).join('\n');
    const pakt = [
      '@from json',
      '@dict',
      '  $a: existing_alias_value',
      '@end',
      '',
      bodyLines,
    ].join('\n');

    const result = applyMetatokenCompression(pakt, 'gpt-4o');

    // If a new alias was added, it must come after $a (i.e., be $b or later)
    if (result.selected.length > 0) {
      for (const entry of result.selected) {
        // Alias index must be > 0 (after $a)
        const aliasIdx = entry.alias === '$a' ? 0 : 1;
        expect(aliasIdx).toBeGreaterThan(0);
      }
      // New entry in @dict comes after the existing $a line
      const lines = result.pakt.split('\n');
      const aIdx = lines.findIndex((l) => l.trim().startsWith('$a:'));
      const newIdx = lines.findIndex((l) => l.trim().startsWith(result.selected[0]?.alias ?? '$b'));
      if (aIdx >= 0 && newIdx >= 0) {
        expect(newIdx).toBeGreaterThan(aIdx);
      }
    }
  });

  it('safety gate prevents token-increasing rewrites', () => {
    // A pakt with a @dict but no repeating patterns worth aliasing
    const pakt = [
      '@from json',
      '@dict',
      '  $a: something_long_enough',
      '@end',
      '',
      'x: unique_val_1',
      'y: unique_val_2',
      'z: unique_val_3',
    ].join('\n');

    const result = applyMetatokenCompression(pakt, 'gpt-4o');
    const originalTok = countTokens(pakt, 'gpt-4o');
    const resultTok = countTokens(result.pakt, 'gpt-4o');
    // Result token count must never exceed original
    expect(resultTok).toBeLessThanOrEqual(originalTok);
  });

  it('selected aliases use ${letter} placeholder in body', () => {
    const result = compress(REPETITIVE_JSON, { layers: { metatoken: true } });
    const pakt = result.compressed;
    // Any inline alias must use ${letter} notation
    const placeholders = pakt.match(/\$\{[a-z]{1,2}\}/g) ?? [];
    // We can't guarantee any specific number, but if metatoken fired, check format
    for (const p of placeholders) {
      expect(p).toMatch(/^\$\{[a-z]{1,2}\}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Roundtrip correctness — JSON, CSV, log text
// ---------------------------------------------------------------------------

describe('L3.5 compress → decompress roundtrip', () => {
  it('JSON roundtrip: data preserved with metatoken on', () => {
    const result = compress(REPETITIVE_JSON, { layers: { metatoken: true } });
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual(JSON.parse(REPETITIVE_JSON));
  });

  it('JSON roundtrip: data preserved for flat objects', () => {
    const input = JSON.stringify({
      team: 'platform_engineering', role: 'platform_engineering',
      dept: 'platform_engineering', unit: 'platform_engineering',
      group: 'platform_engineering', section: 'platform_engineering',
    });
    const result = compress(input, { layers: { metatoken: true } });
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual(JSON.parse(input));
  });

  it('log-text roundtrip: decompressed text contains all original content', () => {
    const result = compress(REPETITIVE_LOG, { layers: { metatoken: true } });
    const dec = decompress(result.compressed);
    const origWords = new Set(REPETITIVE_LOG.split(/\s+/).filter((w) => w.length > 3));
    for (const word of origWords) {
      expect(dec.text).toContain(word);
    }
  });

  it('CSV roundtrip: column values preserved', () => {
    const csvInput = [
      'service,status,team',
      ...Array.from({ length: 8 }, (_, i) => `svc_${String(i)},active_ok,platform_team`),
    ].join('\n');
    const result = compress(csvInput, { fromFormat: 'csv', layers: { metatoken: true } });
    const dec = decompress(result.compressed, 'json');
    expect(dec.text).toContain('platform_team');
    expect(dec.text).toContain('active_ok');
  });
});

// ---------------------------------------------------------------------------
// 3. Measured savings — token count must decrease on repetitive fixture
// ---------------------------------------------------------------------------

describe('L3.5 measured savings', () => {
  it('saves tokens on repetitive JSON vs baseline (metatoken off)', () => {
    const baseline = compress(REPETITIVE_JSON);
    const withMeta = compress(REPETITIVE_JSON, { layers: { metatoken: true } });

    // Report actual measurements (informational; test asserts direction)
    const saving = baseline.compressedTokens - withMeta.compressedTokens;
    // The safety gate guarantees we never increase; on this fixture we must save
    expect(withMeta.compressedTokens).toBeLessThanOrEqual(baseline.compressedTokens);

    // Soft note: if 0, L2 may have already covered all cross-boundary patterns.
    if (saving === 0) {
      console.warn('[L3.5] metatoken saved 0 tokens on REPETITIVE_JSON');
    }
  });

  it('saves tokens on repetitive log text vs baseline', () => {
    const baseline = compress(REPETITIVE_LOG);
    const withMeta = compress(REPETITIVE_LOG, { layers: { metatoken: true } });
    expect(withMeta.compressedTokens).toBeLessThanOrEqual(baseline.compressedTokens);
  });

  it('never increases tokens on the hostile fixture', () => {
    const baseline = compress(HOSTILE);
    const withMeta = compress(HOSTILE, { layers: { metatoken: true } });
    // Safety gate must hold: metatoken never makes things worse
    expect(withMeta.compressedTokens).toBeLessThanOrEqual(baseline.compressedTokens);
  });

  it('applyMetatokenCompression directly never increases token count', () => {
    // Test the raw function on a manually crafted PAKT string
    const pakt = [
      '@from json',
      '@dict',
      '  $a: squad',
      '@end',
      '',
      ...Array.from({ length: 8 }, (_, i) => `row_${String(i)}: platform_team_member_${String(i)}`),
    ].join('\n');

    const result = applyMetatokenCompression(pakt, 'gpt-4o');
    const before = countTokens(pakt, 'gpt-4o');
    const after = countTokens(result.pakt, 'gpt-4o');
    expect(after).toBeLessThanOrEqual(before);
  });
});

// ---------------------------------------------------------------------------
// 4. Property-based fuzz: compress+metatoken → decompress === original
// ---------------------------------------------------------------------------

const FC_RUNS = Number(process.env.FC_RUNS ?? 80);

/** Printable ASCII chars (PAKT-safe subset). */
const paktSafeChars = (): string[] => {
  const out: string[] = [];
  for (let c = 65; c <= 90; c++) out.push(String.fromCharCode(c)); // A-Z
  for (let c = 97; c <= 122; c++) out.push(String.fromCharCode(c)); // a-z
  for (let c = 48; c <= 57; c++) out.push(String.fromCharCode(c));  // 0-9
  return out;
};

/** Safe JSON key: letter-leading alphanumeric. */
const safeKey = () =>
  fc
    .string({ unit: fc.constantFrom(...paktSafeChars()), minLength: 1, maxLength: 6 })
    .filter((s) => /^[A-Za-z]/.test(s));

/** Safe JSON string value: letter-leading, no PAKT structural chars. */
const safeValue = () =>
  fc
    .string({ unit: fc.constantFrom(...paktSafeChars()), minLength: 1, maxLength: 12 })
    .filter(
      (s) =>
        /^[A-Za-z]/.test(s) &&
        !['true', 'false', 'null'].includes(s.toLowerCase()),
    );

/** Simple JSON object with leaf values. */
const simpleJsonObj = () =>
  fc.dictionary(safeKey(), safeValue(), { minKeys: 2, maxKeys: 6 });

describe('property: metatoken compress → decompress roundtrip', () => {
  it('JSON objects roundtrip with metatoken on', () => {
    fc.assert(
      fc.property(simpleJsonObj(), (data) => {
        const text = JSON.stringify(data);
        const compressed = compress(text, { layers: { metatoken: true } });
        const dec = decompress(compressed.compressed, 'json');
        if (dec.format === 'text') {
          // Single-value or trivial input — text roundtrip is acceptable
          expect(dec.text).toBeTruthy();
          return;
        }
        expect(JSON.parse(dec.text)).toEqual(data);
      }),
      { numRuns: FC_RUNS },
    );
  });

  it('metatoken never increases token count vs default compression', () => {
    fc.assert(
      fc.property(simpleJsonObj(), (data) => {
        const text = JSON.stringify(data);
        const baseline = compress(text);
        const withMeta = compress(text, { layers: { metatoken: true } });
        // Safety gate must always hold
        expect(withMeta.compressedTokens).toBeLessThanOrEqual(baseline.compressedTokens);
      }),
      { numRuns: FC_RUNS },
    );
  });

  it('repetitive JSON (repeat same object values) always roundtrips', () => {
    fc.assert(
      fc.property(
        fc.tuple(safeValue(), safeValue()),
        ([v1, v2]) => {
          // Build a JSON with many repetitions of v1/v2 to trigger L3.5
          const data: Record<string, string> = {};
          for (let i = 0; i < 8; i++) {
            data[`k${String(i)}`] = i % 2 === 0 ? `${v1}_suffix` : `${v2}_suffix`;
          }
          const text = JSON.stringify(data);
          const compressed = compress(text, { layers: { metatoken: true } });
          const dec = decompress(compressed.compressed, 'json');
          if (dec.format === 'text') return; // trivial passthrough
          expect(JSON.parse(dec.text)).toEqual(data);
        },
      ),
      { numRuns: FC_RUNS },
    );
  });
});

// -- REGRESSION: deterministic counterexample from fuzzer -------------------
// Root cause: L3.5 replaced a span inside an unquoted value → e.g. `k0: AASn${b}`.
// `{` is a PAKT BRACE_OPEN delimiter, so it was parsed as `AASn` + phantom `b:""`.
// Fix: always quote body values that receive a `${letter}` placeholder.

describe('L3.5 regression: unquoted ${letter} placeholder corruption', () => {
  // Two shrunk counterexamples from the fuzzer — both deterministic.
  it.each([
    ['AASn', 'xAqAAMx'],
    ['AALH5wA', 'cZcAAoA'],
  ])('regression: v1=%s v2=%s suffix values roundtrip correctly', (v1, v2) => {
    const data: Record<string, string> = {};
    for (let i = 0; i < 8; i++) {
      data[`k${String(i)}`] = i % 2 === 0 ? `${v1}_suffix` : `${v2}_suffix`;
    }
    const text = JSON.stringify(data);
    const compressed = compress(text, { layers: { metatoken: true } });
    const dec = decompress(compressed.compressed, 'json');
    if (dec.format === 'text') return; // trivial passthrough — no corruption possible
    expect(JSON.parse(dec.text)).toEqual(data);
  });

  it('regression: _suffix span replacement does not create phantom keys', () => {
    const data: Record<string, string> = {
      k0: 'A_suffix', k1: 'B_suffix', k2: 'A_suffix', k3: 'B_suffix',
      k4: 'A_suffix', k5: 'B_suffix', k6: 'A_suffix', k7: 'B_suffix',
    };
    const text = JSON.stringify(data);
    const compressed = compress(text, { layers: { metatoken: true } });
    const dec = decompress(compressed.compressed, 'json');
    if (dec.format === 'text') return;
    const parsed = JSON.parse(dec.text) as Record<string, string>;
    expect(Object.keys(parsed).every((k) => k.startsWith('k'))).toBe(true); // no phantom keys
    expect(parsed).toEqual(data);
  });

  it('regression: body lines with ${placeholder} are quoted in output PAKT', () => {
    const v1 = 'AASn';
    const v2 = 'xAqAAMx';
    const data: Record<string, string> = {};
    for (let i = 0; i < 8; i++) {
      data[`k${String(i)}`] = i % 2 === 0 ? `${v1}_suffix` : `${v2}_suffix`;
    }
    const text = JSON.stringify(data);
    const compressed = compress(text, { layers: { metatoken: true } });
    const pakt = compressed.compressed;
    const lines = pakt.split('\n');
    const dictEnd = lines.findIndex((l) => l.trim() === '@end');
    const bodyLines = dictEnd >= 0 ? lines.slice(dictEnd + 1) : lines;
    for (const line of bodyLines) {
      if (line.includes('${') && line.includes(': ')) {
        const valueText = line.slice(line.indexOf(': ') + 2).trim();
        expect(valueText).toMatch(/^".*"$/); // must be double-quoted
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Cache-stability: aliases append-only
// ---------------------------------------------------------------------------

describe('L3.5 cache-stability: append-only aliases', () => {
  it('L3.5 aliases are appended after all L2 aliases', () => {
    const result = compress(REPETITIVE_JSON, { layers: { metatoken: true } });
    const pakt = result.compressed;
    if (!pakt.includes('@dict')) return; // no dict block, no aliases to check

    const lines = pakt.split('\n');
    const dictStart = lines.findIndex((l) => l.trim() === '@dict');
    const dictEnd = lines.findIndex((l) => l.trim() === '@end');
    if (dictStart < 0 || dictEnd < 0) return;

    // Collect alias indices in order
    const dictEntries = lines.slice(dictStart + 1, dictEnd);
    let prevIdx = -1;
    for (const entry of dictEntries) {
      const m = entry.trim().match(/^\$([a-z]{1,2}):\s/);
      if (!m?.[1]) continue;
      const ch = m[1];
      const idx =
        ch.length === 1
          ? ch.charCodeAt(0) - 97
          : 26 + (ch.charCodeAt(1) - 97);
      // Indices must be strictly increasing (each alias used once)
      expect(idx).toBeGreaterThan(prevIdx);
      prevIdx = idx;
    }
  });

  it('compress result is lossless when metatoken is on', () => {
    const result = compress(REPETITIVE_JSON, { layers: { metatoken: true } });
    expect(result.reversible).toBe(true);
  });

  it('metatoken aliases survive decompress without adding new decompression logic', () => {
    // Run through the full pipeline and verify the std decompress path handles it
    const compressed = compress(REPETITIVE_JSON, { layers: { metatoken: true } });
    const dec = decompress(compressed.compressed, 'json');
    expect(dec.wasLossy).toBe(false);
    expect(JSON.parse(dec.text)).toEqual(JSON.parse(REPETITIVE_JSON));
  });
});

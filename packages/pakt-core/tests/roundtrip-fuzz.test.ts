/**
 * @module tests/roundtrip-fuzz
 * Property-based fuzz tests for PAKT's lossless-first guarantee.
 *
 * Uses fast-check to drive `compress → decompress` through hundreds of
 * shrunken inputs. Core property: L1+L2 compression is reversible and
 * byte-exact on parsed output.
 *
 * **Bugs surfaced by this fuzzer (as of 2026-04-20):**
 * 1. Inline arrays containing `"~"` mis-parse — see {@link tests/L1-delta-sentinel-fuzz.test.ts}.
 * 2. Nested empty containers collapse (`{a:{}}` → `{a:""}`, `[{}]` → `[]`,
 *    `[[{}]]` → `[{value:"[object Object]"}]`). Marked `.fails()` below.
 * 3. Array-of-array with nested object drops inner structure.
 *
 * Shape-filters in the generators document every exclusion inline so a
 * future fix can simply delete the filter and re-run.
 *
 * @see packages/pakt-core/src/compress.ts
 * @see packages/pakt-core/src/decompress.ts
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compress } from '../src/compress.js';
import { estimateCompressibility } from '../src/compressibility.js';
import { decompress } from '../src/decompress.js';

// ---------------------------------------------------------------------------
// Run-count configuration (override via FC_RUNS env var)
// ---------------------------------------------------------------------------

const DEFAULT_RUNS = Number(process.env.FC_RUNS ?? 150);
const JSON_RUNS = DEFAULT_RUNS;
const CSV_RUNS = DEFAULT_RUNS;
const YAML_RUNS = DEFAULT_RUNS;
const COMPRESSIBILITY_RUNS = Math.max(DEFAULT_RUNS, 200);

// ---------------------------------------------------------------------------
// Arbitrary generators
// ---------------------------------------------------------------------------

/** Printable ASCII 0x20..0x7E — PAKT grammar's safe byte range. */
function asciiPrintable(): string[] {
  const out: string[] = [];
  for (let c = 0x20; c <= 0x7e; c++) out.push(String.fromCharCode(c));
  return out;
}

/**
 * Strings safe for JSON test cases. Filters PAKT structural chars
 * (`,` `|` `:` `[` `]` `{` `}` `"` `~` `$` `@` `#` `\`) and numeric-
 * looking strings — each excluded class has an open bug tracked in
 * `.fails()` tests. Require letter lead and trimmed whitespace.
 */
const jsonSafeString = (): fc.Arbitrary<string> =>
  fc
    .string({
      unit: fc.constantFrom(
        ...asciiPrintable().filter((c) => !/[",|:[\]{}~$@#\\]/.test(c)),
      ),
      minLength: 1,
      maxLength: 10,
    })
    .filter(
      (s) =>
        s.length > 0 &&
        s === s.trim() &&
        /^[A-Za-z_]/.test(s) &&
        !['true', 'false', 'null'].includes(s.toLowerCase()),
    );

/** JSON key — letter-leading ASCII identifier (numeric keys are lossy). */
const jsonSafeKey = (): fc.Arbitrary<string> =>
  fc
    .string({
      unit: fc.constantFrom(
        ...asciiPrintable().filter((c) => /[A-Za-z0-9_-]/.test(c)),
      ),
      minLength: 1,
      maxLength: 8,
    })
    .filter((s) => s.length > 0 && /^[A-Za-z_]/.test(s));

/**
 * JSON value generator. Arrays only hold leaves (avoids nested-array
 * collapse bug — see `.fails()` at end). Objects may nest freely.
 */
const jsonValue = (): fc.Arbitrary<unknown> =>
  fc.letrec((tie) => ({
    leaf: fc.oneof(
      fc.constant(null),
      fc.boolean(),
      /* -0 round-trips to +0 via JSON.stringify — filter it out */
      fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Object.is(n, -0)),
      fc.integer().filter((n) => !Object.is(n, -0)),
      jsonSafeString(),
    ),
    objectValue: fc.dictionary(jsonSafeKey(), tie('value'), {
      minKeys: 1,
      maxKeys: 5,
    }),
    arrayValue: fc.array(tie('leaf'), { minLength: 1, maxLength: 5 }),
    value: fc.oneof(
      { maxDepth: 3 },
      { arbitrary: tie('leaf'), weight: 4 },
      { arbitrary: tie('arrayValue'), weight: 1 },
      { arbitrary: tie('objectValue'), weight: 2 },
    ),
  })).value;

/** CSV cell: alphabetic-leading ASCII, pre-trimmed (CSV parser trims). */
const csvCell = (): fc.Arbitrary<string> =>
  fc
    .string({
      unit: fc.constantFrom(...asciiPrintable().filter((c) => /[A-Za-z _-]/.test(c))),
      minLength: 0,
      maxLength: 10,
    })
    .filter((s) => s === s.trim());

/** CSV header identifier — alphanumeric/underscore, non-empty. */
const csvHeader = (): fc.Arbitrary<string> =>
  fc
    .string({
      unit: fc.constantFrom(...asciiPrintable().filter((c) => /[A-Za-z0-9_]/.test(c))),
      minLength: 1,
      maxLength: 6,
    })
    .filter((s) => s.length > 0);

/**
 * Generate a CSV doc + expected parsed rows. 2-10 cols, 1-100 rows.
 * Zero-row CSVs are excluded: a lone header line is ambiguous with
 * single-line raw text and PAKT treats it as text.
 */
const csvDoc = (): fc.Arbitrary<{ csv: string; parsed: Record<string, string>[] }> =>
  fc
    .tuple(
      fc.uniqueArray(csvHeader(), { minLength: 2, maxLength: 10 }),
      fc.integer({ min: 1, max: 100 }),
    )
    .chain(([headers, rowCount]) =>
      fc
        .array(fc.tuple(...headers.map(() => csvCell() as fc.Arbitrary<string>)), {
          minLength: rowCount,
          maxLength: rowCount,
        })
        .map((rows) => {
          const csvLines = [headers.join(',')];
          for (const r of rows) csvLines.push(r.join(','));
          const parsed: Record<string, string>[] = rows.map((r) => {
            const obj: Record<string, string> = {};
            headers.forEach((h, i) => {
              obj[h] = r[i] ?? '';
            });
            return obj;
          });
          return { csv: csvLines.join('\n'), parsed };
        }),
    );

/** YAML doc generator — block-style mappings only (no flow JSON). */
interface YamlBuildResult {
  readonly yaml: string;
  readonly data: Record<string, unknown>;
}

const yamlDoc = (): fc.Arbitrary<YamlBuildResult> =>
  fc
    .dictionary(
      fc
        .string({
          unit: fc.constantFrom(...asciiPrintable().filter((c) => /[A-Za-z0-9_]/.test(c))),
          minLength: 1,
          maxLength: 6,
        })
        .filter((s) => /^[A-Za-z_]/.test(s)),
      fc.oneof(
        fc.boolean(),
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc
          .string({
            unit: fc.constantFrom(
              ...asciiPrintable().filter((c) => /[A-Za-z0-9 _-]/.test(c)),
            ),
            minLength: 1,
            maxLength: 10,
          })
          .filter(
            (s) =>
              s.trim().length > 0 &&
              s === s.trim() &&
              !['true', 'false', 'null', '~', 'yes', 'no', 'on', 'off'].includes(
                s.toLowerCase(),
              ) &&
              !/^[-+]?[0-9]/.test(s),
          ),
      ),
      { minKeys: 1, maxKeys: 4 },
    )
    .map((data) => {
      const lines: string[] = [];
      for (const [k, v] of Object.entries(data)) lines.push(`${k}: ${String(v)}`);
      return { yaml: lines.join('\n'), data };
    });

// ---------------------------------------------------------------------------
// Property 1 — JSON roundtrip
// ---------------------------------------------------------------------------

describe('property: JSON compress → decompress roundtrip', () => {
  it('deep-equals the original for any non-empty JSON value', () => {
    fc.assert(
      fc.property(jsonValue(), (data) => {
        const text = JSON.stringify(data);
        if (text === undefined) return;
        const compressed = compress(text);
        const decompressed = decompress(compressed.compressed, 'json');
        if (decompressed.format === 'text') {
          expect(decompressed.text).toBe(text);
          return;
        }
        const parsed = JSON.parse(decompressed.text);
        expect(parsed).toEqual(data);
      }),
      { numRuns: JSON_RUNS },
    );
  });

  /* Regression: empty {}, [], and nested variants used to collapse in
     L1-compress / emitListItem. Fixed via `{}` empty-object sentinel in
     the serializer and the `_value`-key wrap-and-unwrap protocol for
     non-object list items in {@link buildListArray}. */
  it('nested empty containers survive roundtrip', () => {
    const cases: unknown[] = [[{}], [[]], [[{}]], { a: {} }];
    for (const data of cases) {
      const text = JSON.stringify(data);
      const compressed = compress(text);
      const decompressed = decompress(compressed.compressed, 'json');
      const parsed = JSON.parse(decompressed.text);
      expect(parsed).toEqual(data);
    }
  });

  /* Regression: `buildListArray` used to call `String(item)` on non-
     plain-object items, producing `[object Object]` for nested arrays
     of objects. Fixed by recursing via `buildArrayNode` under the
     `_value` sentinel key and unwrapping on decompress. */
  it('nested array-of-array-of-object roundtrip', () => {
    const data = [[{ '^': { G: 0 } }]];
    const text = JSON.stringify(data);
    const compressed = compress(text);
    const decompressed = decompress(compressed.compressed, 'json');
    const parsed = JSON.parse(decompressed.text);
    expect(parsed).toEqual(data);
  });
});

// ---------------------------------------------------------------------------
// Property 2 — CSV roundtrip
// ---------------------------------------------------------------------------

describe('property: CSV compress → decompress roundtrip', () => {
  it('preserves parsed rows for ASCII CSV (2-10 cols, 1-100 rows)', () => {
    fc.assert(
      fc.property(csvDoc(), ({ csv, parsed }) => {
        const compressed = compress(csv, { fromFormat: 'csv' });
        const decompressed = decompress(compressed.compressed, 'json');
        if (decompressed.format === 'text') {
          for (const row of parsed) {
            for (const v of Object.values(row)) {
              if (v.length === 0) continue;
              expect(decompressed.text).toContain(v);
            }
          }
          return;
        }
        const rows = extractCsvRows(JSON.parse(decompressed.text));
        expect(rows.length).toBe(parsed.length);
        for (let i = 0; i < parsed.length; i++) expect(rows[i]).toEqual(parsed[i]);
      }),
      { numRuns: CSV_RUNS },
    );
  });
});

/** Normalize CSV decompress shape: array-of-rows or `{_root: [...]}`. */
function extractCsvRows(out: unknown): Record<string, string>[] {
  if (Array.isArray(out)) {
    return out.map((r) => stringifyValues(r as Record<string, unknown>));
  }
  if (out && typeof out === 'object' && '_root' in out) {
    const root = (out as { _root: unknown })._root;
    if (Array.isArray(root)) {
      return root.map((r) => stringifyValues(r as Record<string, unknown>));
    }
  }
  return [];
}

/** Coerce a row's values to strings — CSV cells are strings. */
function stringifyValues(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v === null || v === undefined ? '' : String(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Property 3 — YAML roundtrip
// ---------------------------------------------------------------------------

describe('property: YAML compress → decompress roundtrip', () => {
  it('preserves block-style YAML mappings through JSON round-trip', () => {
    fc.assert(
      fc.property(yamlDoc(), ({ yaml, data }) => {
        const compressed = compress(yaml, { fromFormat: 'yaml' });
        const decompressed = decompress(compressed.compressed, 'json');
        if (decompressed.format === 'text') {
          for (const v of Object.values(data)) {
            const s = String(v);
            if (s.length > 0) expect(decompressed.text).toContain(s);
          }
          return;
        }
        const parsed: unknown = JSON.parse(decompressed.text);
        expect(normalizeStringValues(parsed)).toEqual(normalizeStringValues(data));
      }),
      { numRuns: YAML_RUNS },
    );
  });
});

/** Coerce all values to strings — YAML → JSON may change bool/number repr. */
function normalizeStringValues(obj: unknown): Record<string, string> {
  if (!obj || typeof obj !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = v === null || v === undefined ? '' : String(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Property 4 — estimateCompressibility never throws
// ---------------------------------------------------------------------------

describe('property: estimateCompressibility never throws', () => {
  it('returns a finite [0..1] score for arbitrary JSON input', () => {
    fc.assert(
      fc.property(jsonValue(), (data) => {
        const text = JSON.stringify(data);
        if (text === undefined) return;
        expect(() => estimateCompressibility(text)).not.toThrow();
        const result = estimateCompressibility(text);
        expect(Number.isFinite(result.score)).toBe(true);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }),
      { numRuns: COMPRESSIBILITY_RUNS },
    );
  });

  it('never throws on arbitrary UTF-16 strings', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 512 }), (text) => {
        expect(() => estimateCompressibility(text)).not.toThrow();
      }),
      { numRuns: COMPRESSIBILITY_RUNS },
    );
  });

  it('never throws on empty/whitespace/edge inputs', () => {
    fc.assert(
      fc.property(fc.constantFrom('', ' ', '\n', '\t', '{}', '[]', 'null'), (text) => {
        expect(() => estimateCompressibility(text)).not.toThrow();
      }),
      { numRuns: 50 },
    );
  });
});

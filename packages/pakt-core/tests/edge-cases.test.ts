/**
 * Edge-case roundtrip tests for the PAKT compression engine.
 *
 * Covers scenarios that stress the compress -> decompress pipeline:
 * - Deep nesting (5, 8, 10 levels)
 * - Mixed arrays (primitives + objects + nested arrays)
 * - Unicode / emoji keys and values
 * - Empty containers at depth
 * - Large dataset stress (500+ rows)
 * - PAKT special characters in values (pipes, colons, dollars, etc.)
 *
 * Every test follows the pattern:
 *   compress(JSON.stringify(data)) -> decompress(result, 'json') -> deepEqual(original)
 */
import { describe, expect, it } from 'vitest';
import { compress, decompress } from '../src/index.js';

// ---------------------------------------------------------------------------
// Helper: roundtrip shorthand — compress JSON, decompress back, return parsed
// ---------------------------------------------------------------------------

/**
 * Compress a JS value as JSON, decompress back, and return the parsed result.
 * @param data - The original JS value to roundtrip
 * @returns The parsed JS value after compress -> decompress
 */
function roundtrip(data: unknown): unknown {
  const json = JSON.stringify(data);
  const result = compress(json, { fromFormat: 'json' });
  const dec = decompress(result.compressed, 'json');
  return JSON.parse(dec.text);
}

// ========================= 1. Deep nesting =================================

describe('Edge cases: deep nesting', () => {
  it('5-level nesting roundtrips losslessly', () => {
    const deep5 = { a: { b: { c: { d: { e: 'leaf' } } } } };
    expect(roundtrip(deep5)).toEqual(deep5);
  });

  it('8-level nesting roundtrips losslessly', () => {
    const deep8 = {
      l1: { l2: { l3: { l4: { l5: { l6: { l7: { l8: 'deep' } } } } } } },
    };
    expect(roundtrip(deep8)).toEqual(deep8);
  });

  it('10-level nesting roundtrips losslessly', () => {
    /* Build a 10-level nested object programmatically */
    let deep10: Record<string, unknown> = { value: 'bottom' };
    for (let i = 9; i >= 0; i--) {
      deep10 = { [`level${i}`]: deep10 };
    }
    expect(roundtrip(deep10)).toEqual(deep10);
  });

  it('deep nesting with mixed types at each level', () => {
    /** Nesting that mixes objects, arrays, and scalars at various depths */
    const mixed = {
      a: {
        b: {
          tags: ['x', 'y'],
          c: {
            d: {
              count: 42,
              active: true,
              e: { label: 'final' },
            },
          },
        },
      },
    };
    expect(roundtrip(mixed)).toEqual(mixed);
  });
});

// ========================= 2. Mixed arrays =================================

describe('Edge cases: mixed arrays', () => {
  /**
   * Known PAKT behavior: heterogeneous arrays (mixed primitives, objects,
   * nested arrays) are converted to list-style items. Primitive values get
   * wrapped in `{value: ...}` and nested arrays become comma-joined strings.
   * This tests that compress -> decompress completes without error and
   * preserves the data in PAKT's normalized form.
   */
  it('mixed array compresses and decompresses without error', () => {
    const mixed = {
      items: [1, 'text', { key: 'val' }, true, null, [1, 2]],
    };
    const json = JSON.stringify(mixed);
    const result = compress(json, { fromFormat: 'json' });
    const dec = decompress(result.compressed, 'json');
    const recovered = JSON.parse(dec.text) as { items: unknown[] };
    /* Array length is preserved (each element becomes a list item) */
    expect(recovered.items).toHaveLength(6);
    /* Object element retains its key:val structure */
    expect(recovered.items[2]).toEqual({ key: 'val' });
  });

  it('homogeneous array of objects roundtrips exactly', () => {
    /** Arrays of uniform objects use tabular compression — perfect roundtrip */
    const data = {
      items: [
        { name: 'Alice', role: 'dev' },
        { name: 'Bob', role: 'qa' },
        { name: 'Carol', role: 'pm' },
      ],
    };
    expect(roundtrip(data)).toEqual(data);
  });

  it('homogeneous array of primitives roundtrips exactly', () => {
    /** Arrays of same-type primitives use inline-array — perfect roundtrip */
    const data = { tags: ['alpha', 'beta', 'gamma', 'delta'] };
    expect(roundtrip(data)).toEqual(data);
  });
});

// ========================= 3. Unicode / emoji ==============================

describe('Edge cases: unicode', () => {
  it('emoji keys and values roundtrip', () => {
    const unicode = {
      '\u{1F680}': 1,
      '\u65E5\u672C\u8A9E': 'value',
      'caf\u00E9': 'r\u00E9sum\u00E9',
      key: 'emoji \u{1F389} value',
      '\u4E2D\u6587\u952E': '\u4E2D\u6587\u503C',
    };
    expect(roundtrip(unicode)).toEqual(unicode);
  });

  it('multi-byte characters in deeply nested values', () => {
    const data = {
      user: {
        name: '\u00C9lodie',
        bio: 'Loves \u{1F31F} and \u{1F30D}',
        address: { city: 'Z\u00FCrich', country: '\u00D6sterreich' },
      },
    };
    expect(roundtrip(data)).toEqual(data);
  });

  it('CJK characters in tabular data', () => {
    /** Tabular array with CJK (Chinese/Japanese/Korean) values */
    const data = {
      cities: [
        { name: '\u6771\u4EAC', country: '\u65E5\u672C' },
        { name: '\u5317\u4EAC', country: '\u4E2D\u56FD' },
        { name: '\u30BD\u30A6\u30EB', country: '\u97D3\u56FD' },
      ],
    };
    expect(roundtrip(data)).toEqual(data);
  });
});

// ====================== 4. Empty containers ================================

describe('Edge cases: empty containers', () => {
  /**
   * Empty containers round-trip losslessly at every depth. Leaf-level
   * empty objects are emitted as `key {}` (and `- {}` for list items),
   * disambiguating them from empty-string scalars. Empty arrays remain
   * `key [0]:` as before. Root-level empties are handled as special cases.
   */
  it('deeply nested empty object roundtrips losslessly', () => {
    const emptyDeep = { a: { b: { c: {} } } };
    expect(roundtrip(emptyDeep)).toEqual(emptyDeep);
  });

  it('deeply nested empty array roundtrips', () => {
    const emptyArrayDeep = { a: { b: { c: [] } } };
    expect(roundtrip(emptyArrayDeep)).toEqual(emptyArrayDeep);
  });

  it('mixed empty containers — arrays and objects both preserved', () => {
    const mixedEmpty = { a: {}, b: [], c: { d: {} } };
    expect(roundtrip(mixedEmpty)).toEqual(mixedEmpty);
  });

  it('empty root object roundtrips', () => {
    expect(roundtrip({})).toEqual({});
  });

  it('empty root array roundtrips', () => {
    expect(roundtrip([])).toEqual([]);
  });

  it('objects with non-empty children survive even when siblings are empty', () => {
    /** Verify that having some empty siblings does not corrupt filled ones */
    const data = { filled: { name: 'Alice' }, empty: {}, tags: ['a', 'b'] };
    const result = roundtrip(data) as Record<string, unknown>;
    expect(result.filled).toEqual({ name: 'Alice' });
    expect(result.tags).toEqual(['a', 'b']);
  });
});

// ====================== 5. Large dataset stress ============================

describe('Edge cases: large dataset', () => {
  /**
   * Generate 500 rows of tabular data with repeating role/active patterns.
   * Roles cycle: admin -> editor -> viewer (3 values).
   * Active flag cycles: true 4/5 of the time, false 1/5.
   */
  const largeData = {
    records: Array.from({ length: 500 }, (_, i) => ({
      id: i,
      name: `user_${i}`,
      email: `user${i}@example.com`,
      role: i % 3 === 0 ? 'admin' : i % 3 === 1 ? 'editor' : 'viewer',
      active: i % 5 !== 0,
    })),
  };

  it('500-row dataset compresses and decompresses losslessly', () => {
    const json = JSON.stringify(largeData);
    const result = compress(json, { fromFormat: 'json' });
    const dec = decompress(result.compressed, 'json');
    const recovered = JSON.parse(dec.text);
    expect(recovered).toEqual(largeData);
  });

  it('500-row dataset achieves measurable compression', () => {
    const json = JSON.stringify(largeData);
    const result = compress(json, { fromFormat: 'json' });
    /* With 500 rows of repetitive data, savings must be non-trivial */
    expect(result.savings.totalPercent).toBeGreaterThan(0);
    expect(result.originalTokens).toBeGreaterThan(result.compressedTokens);
  });

  it('dictionary finds repeated role patterns in large dataset', () => {
    const json = JSON.stringify(largeData);
    const result = compress(json, { fromFormat: 'json' });

    /**
     * With 500 rows and only 3 role values each appearing ~167 times,
     * L2 dictionary should create entries for the repeated strings.
     */
    if (result.dictionary.length > 0) {
      const expansions = result.dictionary.map((d) => d.expansion);
      /* At least one of the role values or email suffix should be aliased */
      const hasRepeatingPattern = expansions.some(
        (e) =>
          ['admin', 'editor', 'viewer'].includes(e) ||
          e.includes('@example.com') ||
          e.includes('user_'),
      );
      expect(hasRepeatingPattern).toBe(true);
    }

    /* Roundtrip must still be exact regardless of dictionary contents */
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual(largeData);
  });

  it('1000-row dataset roundtrips without error', () => {
    /** Extreme stress: 1000 rows to verify no stack/memory issues */
    const huge = {
      items: Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        label: `item_${i}`,
        category: i % 4 === 0 ? 'A' : i % 4 === 1 ? 'B' : i % 4 === 2 ? 'C' : 'D',
      })),
    };
    expect(roundtrip(huge)).toEqual(huge);
  });
});

// ===================== 6. Special characters ===============================

describe('Edge cases: special characters', () => {
  it('PAKT-sensitive characters roundtrip in values', () => {
    /** Characters that have meaning in PAKT syntax: pipes, colons, dollars */
    const specialChars = {
      colon: 'key:val',
      pipe: 'a|b|c',
      dollar: '$price',
      percent: '%discount',
      quote: 'say "hello"',
      backslash: 'path\\to\\file',
      newline: 'line1\nline2',
      mixed: 'key:val|pipe$alias%comment',
    };
    expect(roundtrip(specialChars)).toEqual(specialChars);
  });

  it('special characters in tabular data roundtrip', () => {
    /** Multiple rows with special chars — tests both L1 quoting and L2 aliasing */
    const data = {
      rows: [
        { id: 1, path: 'src|main', tag: '$var', note: 'a:b' },
        { id: 2, path: 'lib|core', tag: '$env', note: 'c:d' },
        { id: 3, path: 'bin|cli', tag: '$cfg', note: 'e:f' },
      ],
    };
    expect(roundtrip(data)).toEqual(data);
  });

  it('values that look like PAKT aliases survive roundtrip', () => {
    /**
     * Strings starting with $ could be confused with dictionary aliases.
     * The serializer should quote them to prevent mis-interpretation.
     */
    const data = {
      price: '$99.99',
      alias: '$a',
      template: '${name}',
      env: '$HOME',
    };
    expect(roundtrip(data)).toEqual(data);
  });

  it('bracket and brace characters roundtrip', () => {
    const data = {
      code: 'if (x) { return [1]; }',
      regex: '/^[a-z]+$/i',
      template: '{{name}}',
      array: '[1,2,3]',
    };
    expect(roundtrip(data)).toEqual(data);
  });

  it('tab characters in values roundtrip losslessly', () => {
    /**
     * Tab characters are escaped as \\t in quoted strings by the serializer.
     * The tokenizer supports \\t escape sequences during parsing, so
     * tabs survive the compress -> decompress roundtrip.
     */
    const data = { tabbed: 'col1\tcol2\tcol3' };
    expect(roundtrip(data)).toEqual(data);
  });

  it('carriage-return in values roundtrips losslessly', () => {
    /**
     * Carriage returns are escaped as \\r in quoted strings by the serializer.
     * CRLF sequences are preserved through the compress -> decompress roundtrip.
     */
    const data = { crlf: 'line1\r\nline2' };
    expect(roundtrip(data)).toEqual(data);
  });

  it('empty string values roundtrip', () => {
    const data = { empty: '', nested: { also: '' } };
    expect(roundtrip(data)).toEqual(data);
  });

  it('extremely long string value roundtrips', () => {
    /** A single value of 2000 characters to stress serializer line handling */
    const longVal = 'x'.repeat(2000);
    const data = { payload: longVal };
    expect(roundtrip(data)).toEqual(data);
  });
});

// ===================== 7. Empty / whitespace input =========================

describe('Edge cases: empty input', () => {
  it('compress("") returns a valid PaktResult with zero savings', () => {
    /** Empty string should not crash — returns a minimal valid result */
    const result = compress('');
    expect(result.compressed).toBe('');
    expect(result.originalTokens).toBe(result.compressedTokens);
    expect(result.savings.totalPercent).toBe(0);
    expect(result.savings.totalTokens).toBe(0);
    expect(result.detectedFormat).toBe('text');
    expect(result.dictionary).toEqual([]);
    expect(result.reversible).toBe(true);
  });

  it('compress whitespace-only input returns valid PaktResult', () => {
    /** Whitespace-only string is treated like empty — no structure to compress */
    const result = compress('   \n  \n   ');
    expect(result.compressed).toBe('   \n  \n   ');
    expect(result.savings.totalPercent).toBe(0);
    expect(result.detectedFormat).toBe('text');
    expect(result.dictionary).toEqual([]);
  });
});

// ============================ 8. Input size cap ============================

describe('Edge cases: input size cap', () => {
  it('passes through unchanged when input exceeds maxInputBytes', () => {
    /* Build a JSON payload over a tiny explicit cap so the guard fires
       without us having to allocate megabytes in tests. */
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: i, role: 'engineer' }));
    const big = JSON.stringify(rows);
    expect(big.length).toBeGreaterThan(500);
    const result = compress(big, { fromFormat: 'json', maxInputBytes: 200 });
    expect(result.compressed).toBe(big);
    expect(result.savings.totalPercent).toBe(0);
    expect(result.savings.totalTokens).toBe(0);
    expect(result.reversible).toBe(true);
  });

  it('compresses normally when input is under the cap', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i, role: 'engineer' }));
    const payload = JSON.stringify(rows);
    const result = compress(payload, { fromFormat: 'json', maxInputBytes: 10_000 });
    /* Should actually compress (not passthrough) */
    expect(result.compressed.length).toBeLessThan(payload.length);
    expect(result.savings.totalPercent).toBeGreaterThan(0);
  });

  it('treats maxInputBytes=0 as disabled (no cap)', () => {
    /* Explicit opt-out: a consumer that knows their memory budget. */
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i, role: 'engineer' }));
    const payload = JSON.stringify(rows);
    const result = compress(payload, { fromFormat: 'json', maxInputBytes: 0 });
    expect(result.compressed.length).toBeLessThan(payload.length);
    expect(result.savings.totalPercent).toBeGreaterThan(0);
  });

  it('measures UTF-8 bytes not char count (multi-byte input)', () => {
    /* 4-byte UTF-8 emoji (U+1F680 = 🚀). 50 of them = 200 UTF-8 bytes
       but only 100 UTF-16 code units. Cap at 150 bytes → must reject
       based on real byte count, not string length. */
    const big = JSON.stringify({ msg: '🚀'.repeat(50) });
    const result = compress(big, { fromFormat: 'json', maxInputBytes: 150 });
    expect(result.compressed).toBe(big);
    expect(result.savings.totalPercent).toBe(0);
  });
});

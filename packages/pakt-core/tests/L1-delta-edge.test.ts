/**
 * @module tests/L1-delta-edge
 * Edge-case, serialization, and safety tests for delta encoding.
 *
 * Split from L1-delta.test.ts to stay under the 400-line limit.
 * Covers: sentinel utilities, serialized output appearance,
 * safe behaviour on non-delta / non-tabular documents,
 * full-pipeline roundtrips with `~` values, ragged rows,
 * deep nesting bail-out, and L2 clone expansion safety.
 */

import { describe, expect, it } from 'vitest';
import { compress } from '../src/compress.js';
import { decompress } from '../src/decompress.js';
import { compressL1 } from '../src/layers/L1-compress.js';
import {
  DELTA_SENTINEL,
  MAX_DELTA_DEPTH,
  applyDeltaEncoding,
  isDeltaSentinel,
  revertDeltaEncoding,
} from '../src/layers/L1-delta.js';
import { cloneScalar } from '../src/layers/L2-clone.js';
import type {
  DocumentNode,
  ObjectNode,
  ScalarNode,
  SourcePosition,
  TabularArrayNode,
  TabularRowNode,
} from '../src/parser/ast.js';
import { serialize } from '../src/serializer/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compress and delta-encode, returning the encoded doc. */
function deltaEncode(data: unknown): DocumentNode {
  const doc = compressL1(data, 'json');
  return applyDeltaEncoding(doc);
}

/** Synthetic position for test-constructed AST nodes. */
const POS: SourcePosition = { line: 0, column: 0, offset: 0 };

/** Build a scalar node for test construction. */
function sc(value: string, scalarType: 'string' | 'number' = 'string'): ScalarNode {
  return { type: 'scalar', scalarType, value, quoted: false, position: POS };
}

// ===========================================================================
// 6. Sentinel utilities
// ===========================================================================

describe('L1-delta: sentinel utilities', () => {
  it('DELTA_SENTINEL is ~', () => {
    expect(DELTA_SENTINEL).toBe('~');
  });

  it('isDeltaSentinel identifies ~ scalars', () => {
    const sentinel: ScalarNode = {
      type: 'scalar',
      scalarType: 'string',
      value: '~',
      quoted: false,
      position: { line: 0, column: 0, offset: 0 },
    };
    expect(isDeltaSentinel(sentinel)).toBe(true);
  });

  it('isDeltaSentinel rejects non-sentinel scalars', () => {
    const notSentinel: ScalarNode = {
      type: 'scalar',
      scalarType: 'string',
      value: 'hello',
      quoted: false,
      position: { line: 0, column: 0, offset: 0 },
    };
    expect(isDeltaSentinel(notSentinel)).toBe(false);
  });

  it('isDeltaSentinel rejects quoted ~ (real tilde value, not sentinel)', () => {
    /* A quoted "~" is a literal tilde string, not a sentinel.
       isDeltaSentinel checks quoted === false, so quoted tildes are safe. */
    const quotedTilde: ScalarNode = {
      type: 'scalar',
      scalarType: 'string',
      value: '~',
      quoted: true,
      position: { line: 0, column: 0, offset: 0 },
    };
    expect(isDeltaSentinel(quotedTilde)).toBe(false);
  });
});

// ===========================================================================
// 7. Serialization appearance
// ===========================================================================

describe('L1-delta: serialized output', () => {
  it('produces ~ in serialized PAKT output', () => {
    const data = [
      { name: 'Alice', role: 'dev' },
      { name: 'Bob', role: 'dev' },
      { name: 'Charlie', role: 'dev' },
    ];
    const encoded = deltaEncode(data);
    const text = serialize(encoded);

    /* Should contain ~ sentinel in the output */
    expect(text).toContain('~');
    /* Should contain @compress delta header */
    expect(text).toContain('@compress delta');
  });

  it('does not produce @compress delta when no deltas applied', () => {
    const data = [
      { a: 1, b: 2 },
      { a: 3, b: 4 },
      { a: 5, b: 6 },
    ];
    const encoded = deltaEncode(data);
    const text = serialize(encoded);
    expect(text).not.toContain('@compress delta');
  });
});

// ===========================================================================
// 8. Safe on non-delta documents
// ===========================================================================

describe('L1-delta: safety', () => {
  it('revertDeltaEncoding is no-op on non-delta documents', () => {
    const doc = compressL1({ a: 1, b: 2 }, 'json');
    const result = revertDeltaEncoding(doc);
    expect(result).toBe(doc); // same reference, no mutation
  });

  it('applyDeltaEncoding is no-op on non-tabular documents', () => {
    const doc = compressL1({ x: 'hello', y: 42 }, 'json');
    const result = applyDeltaEncoding(doc);
    expect(result).toBe(doc);
  });
});

// ===========================================================================
// 9. Full pipeline roundtrip with literal `~` values (Test 1)
// ===========================================================================

describe('L1-delta: full pipeline roundtrip with ~ values', () => {
  it('preserves literal ~ values through compress → decompress', () => {
    const input = JSON.stringify([
      { status: '~', name: 'Alice' },
      { status: '~', name: 'Bob' },
      { status: '~', name: 'Carol' },
    ]);
    const compressed = compress(input);
    const decompressed = decompress(compressed.compressed, 'json');
    const parsed = JSON.parse(decompressed.text);

    /* Every row must retain its `~` value as data, not a delta sentinel */
    expect(parsed).toHaveLength(3);
    for (const row of parsed) {
      expect(row.status).toBe('~');
    }
    expect(parsed[0].name).toBe('Alice');
    expect(parsed[1].name).toBe('Bob');
    expect(parsed[2].name).toBe('Carol');
  });

  it('preserves mixed ~ and non-~ values through roundtrip', () => {
    const input = JSON.stringify([
      { flag: '~', val: 'a' },
      { flag: 'ok', val: 'b' },
      { flag: '~', val: 'c' },
    ]);
    const compressed = compress(input);
    const decompressed = decompress(compressed.compressed, 'json');
    const parsed = JSON.parse(decompressed.text);

    expect(parsed[0].flag).toBe('~');
    expect(parsed[1].flag).toBe('ok');
    expect(parsed[2].flag).toBe('~');
  });
});

// ===========================================================================
// 10. Mode 3 expansion producing `~` — cloneScalar safety (Test 2)
// ===========================================================================

describe('L1-delta: cloneScalar expansion producing ~', () => {
  it('force-quotes expanded value that equals ~', () => {
    /* Simulate L2 decompression: a dict entry $a maps to "~" */
    const map = new Map([['$a', '~']]);
    const input: ScalarNode = {
      type: 'scalar',
      scalarType: 'string',
      value: '${a}',
      quoted: true,
      position: POS,
    };
    /* includeQuoted=true for decompression expansion (Mode 3) */
    const result = cloneScalar(input, map, true);

    expect(result.value).toBe('~');
    /* Must be quoted so it is NOT mistaken for a delta sentinel */
    expect(result.quoted).toBe(true);
  });

  it('exact replacement also force-quotes ~', () => {
    /* Mode 1: exact match where alias expands to ~ */
    const map = new Map([['tilde', '~']]);
    const input: ScalarNode = {
      type: 'scalar',
      scalarType: 'string',
      value: 'tilde',
      quoted: false,
      position: POS,
    };
    const result = cloneScalar(input, map, false);

    expect(result.value).toBe('~');
    expect(result.quoted).toBe(true);
  });
});

// ===========================================================================
// 11. Ragged rows in encode path (Test 3)
// ===========================================================================

describe('L1-delta: ragged rows in deltaEncodeTabular', () => {
  it('preserves carry-forward behavior for ragged rows through encode and decode', () => {
    /* Build a tabular array manually where rows have unequal lengths */
    const fields = [sc('name'), sc('role'), sc('dept')];
    const rows: TabularRowNode[] = [
      { type: 'tabularRow', values: [sc('Alice'), sc('dev'), sc('eng')], position: POS },
      { type: 'tabularRow', values: [sc('Alice'), sc('dev')], position: POS }, // missing dept
      { type: 'tabularRow', values: [sc('Alice'), sc('dev'), sc('eng')], position: POS },
      { type: 'tabularRow', values: [sc('Alice')], position: POS }, // only name
    ];
    const tabular: TabularArrayNode = {
      type: 'tabularArray',
      key: 'people',
      fields,
      rows,
      position: POS,
    };
    const doc: DocumentNode = { type: 'document', headers: [], body: [tabular] };

    const encoded = applyDeltaEncoding(doc);
    const encodedTabular = encoded.body[0] as TabularArrayNode;

    expect(encoded.headers).toHaveLength(1);
    expect(encodedTabular.rows[0]?.values).toHaveLength(3);
    expect(encodedTabular.rows[1]?.values).toHaveLength(3);
    expect(encodedTabular.rows[2]?.values).toHaveLength(3);
    expect(encodedTabular.rows[3]?.values).toHaveLength(3);

    const decoded = revertDeltaEncoding(encoded);
    const decodedTabular = decoded.body[0] as TabularArrayNode;

    expect(decoded.headers).toHaveLength(0);
    expect(decodedTabular.rows[0]?.values.map((value) => value.value)).toEqual([
      'Alice',
      'dev',
      'eng',
    ]);
    expect(decodedTabular.rows[1]?.values.map((value) => value.value)).toEqual([
      'Alice',
      'dev',
      'eng',
    ]);
    expect(decodedTabular.rows[2]?.values.map((value) => value.value)).toEqual([
      'Alice',
      'dev',
      'eng',
    ]);
    expect(decodedTabular.rows[3]?.values.map((value) => value.value)).toEqual([
      'Alice',
      'dev',
      'eng',
    ]);
  });
});

// ===========================================================================
// 12. MAX_DELTA_DEPTH bail-out (Test 4)
// ===========================================================================

describe('L1-delta: MAX_DELTA_DEPTH bail-out', () => {
  it('preserves the delta header when decode bails out on deep ASTs', () => {
    /* Build a chain of nested objects deeper than MAX_DELTA_DEPTH */
    const leaf: TabularArrayNode = {
      type: 'tabularArray',
      key: 'data',
      fields: [sc('a'), sc('b')],
      rows: [
        { type: 'tabularRow', values: [sc('x'), sc('y')], position: POS },
        { type: 'tabularRow', values: [sc('~'), sc('~')], position: POS },
        { type: 'tabularRow', values: [sc('~'), sc('~')], position: POS },
      ],
      position: POS,
    };

    /* Wrap the leaf in MAX_DELTA_DEPTH + 5 levels of nested objects */
    let body: (ObjectNode | TabularArrayNode)[] = [leaf];
    for (let i = 0; i < MAX_DELTA_DEPTH + 5; i++) {
      const wrapper: ObjectNode = {
        type: 'object',
        key: `level${i}`,
        children: body,
        position: POS,
      };
      body = [wrapper];
    }

    const doc: DocumentNode = { type: 'document', headers: [], body };

    /* Encode: the deeply buried tabular array should NOT get delta-encoded */
    const encoded = applyDeltaEncoding(doc);
    /* No @compress delta header because nothing was actually encoded */
    expect(encoded).toBe(doc);

    /* Decode: preserve the header because the sentinels remain undecoded */
    const withHeader: DocumentNode = {
      ...doc,
      headers: [{ type: 'header', headerType: 'compress', value: 'delta', position: POS }],
    };
    const decoded = revertDeltaEncoding(withHeader);
    expect(decoded.headers).toEqual(withHeader.headers);

    let cursor = decoded.body[0] as ObjectNode | TabularArrayNode;
    while (cursor.type === 'object') {
      cursor = cursor.children[0] as ObjectNode | TabularArrayNode;
    }

    expect(cursor.rows[1]?.values.map((value) => value.value)).toEqual(['~', '~']);
  });

  it('preserves the delta header when sentinels remain unresolved', () => {
    const doc: DocumentNode = {
      type: 'document',
      headers: [{ type: 'header', headerType: 'compress', value: 'delta', position: POS }],
      body: [
        {
          type: 'tabularArray',
          key: 'data',
          fields: [sc('a'), sc('b')],
          rows: [
            { type: 'tabularRow', values: [sc('x')], position: POS },
            { type: 'tabularRow', values: [sc('~'), sc('~')], position: POS },
          ],
          position: POS,
        },
      ],
    };

    const decoded = revertDeltaEncoding(doc);
    const tabular = decoded.body[0] as TabularArrayNode;

    expect(decoded.headers).toEqual(doc.headers);
    expect(tabular.rows[1]?.values.map((value) => value.value)).toEqual(['x', '~']);
  });
});

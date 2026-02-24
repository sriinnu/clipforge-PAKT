/**
 * L4 semantic compression tests.
 *
 * Validates that the L4 stub functions behave as identity
 * pass-throughs and that enabling the `semantic` layer in the
 * compression pipeline does not break existing functionality.
 */
import { describe, it, expect } from 'vitest';
import { compress, decompress } from '../src/index.js';
import {
  compressL4,
  decompressL4,
  applyL4Transforms,
} from '../src/layers/L4-semantic.js';
import type {
  DocumentNode,
  BodyNode,
  ScalarNode,
  KeyValueNode,
  HeaderNode,
  SourcePosition,
} from '../src/parser/ast.js';

// -- Helpers -----------------------------------------------------------------

/** Shared zero-position for test nodes. */
const p: SourcePosition = { line: 0, column: 0, offset: 0 };

/** Create a string scalar node. */
const s = (v: string, q = false): ScalarNode =>
  ({ type: 'scalar', scalarType: 'string', value: v, quoted: q, position: p });

/** Create a key-value node. */
const kv = (key: string, val: ScalarNode): KeyValueNode =>
  ({ type: 'keyValue', key, value: val, position: p });

/** Create a document node with optional headers. */
const doc = (body: BodyNode[], headers: HeaderNode[] = []): DocumentNode =>
  ({ type: 'document', headers, dictionary: null, body, position: p });

// ---------------------------------------------------------------------------
// Unit tests: compressL4 stub
// ---------------------------------------------------------------------------

describe('compressL4 (stub)', () => {
  it('returns the document unchanged', () => {
    const d = doc([kv('name', s('Alice'))]);
    const result = compressL4(d, 500);
    expect(result).toBe(d);
  });

  it('returns unchanged for zero budget', () => {
    const d = doc([kv('x', s('y'))]);
    const result = compressL4(d, 0);
    expect(result).toBe(d);
  });

  it('preserves all body nodes', () => {
    const body: BodyNode[] = [
      kv('a', s('1')),
      kv('b', s('2')),
      kv('c', s('3')),
    ];
    const d = doc(body);
    const result = compressL4(d, 100);
    expect(result.body).toHaveLength(3);
    expect(result.body).toBe(body);
  });

  it('preserves existing headers', () => {
    const headers: HeaderNode[] = [
      { type: 'header', headerType: 'from', value: 'json', position: p },
    ];
    const d = doc([kv('k', s('v'))], headers);
    const result = compressL4(d, 200);
    expect(result.headers).toHaveLength(1);
    expect(result.headers[0].headerType).toBe('from');
  });
});

// ---------------------------------------------------------------------------
// Unit tests: decompressL4 stub
// ---------------------------------------------------------------------------

describe('decompressL4 (stub)', () => {
  it('returns the document unchanged', () => {
    const d = doc([kv('name', s('Bob'))]);
    const result = decompressL4(d);
    expect(result).toBe(d);
  });

  it('preserves dictionary reference', () => {
    const d: DocumentNode = {
      type: 'document',
      headers: [],
      dictionary: {
        type: 'dictBlock',
        entries: [{ type: 'dictEntry', alias: '$a', expansion: 'hello', position: p }],
        position: p,
      },
      body: [kv('msg', s('$a'))],
      position: p,
    };
    const result = decompressL4(d);
    expect(result.dictionary).toBe(d.dictionary);
  });
});

// ---------------------------------------------------------------------------
// Unit tests: applyL4Transforms stub
// ---------------------------------------------------------------------------

describe('applyL4Transforms (stub)', () => {
  it('returns text unchanged', () => {
    const text = '@from json\n\nname: Alice\nage: 30';
    const result = applyL4Transforms(text, 100);
    expect(result).toBe(text);
  });

  it('returns empty string unchanged', () => {
    expect(applyL4Transforms('', 0)).toBe('');
  });

  it('preserves multi-line content verbatim', () => {
    const text = [
      '@from json',
      '@target l3',
      '',
      'users [2]{name|role}:',
      '  Alice|dev',
      '  Bob|admin',
    ].join('\n');
    const result = applyL4Transforms(text, 50);
    expect(result).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// Pipeline integration: semantic layer enabled
// ---------------------------------------------------------------------------

describe('L4 pipeline integration', () => {
  const LAYERS_L4 = {
    structural: true,
    dictionary: true,
    tokenizerAware: false,
    semantic: true,
  };

  it('compress with semantic: true does not break output', () => {
    const input = JSON.stringify({ name: 'Alice', role: 'developer' });
    const result = compress(input, { layers: LAYERS_L4 });
    expect(result.compressed).toBeDefined();
    expect(result.compressed.length).toBeGreaterThan(0);
  });

  it('roundtrips losslessly with semantic: true (stub is no-op)', () => {
    const data = { name: 'Alice', age: 30, active: true };
    const input = JSON.stringify(data);
    const result = compress(input, { layers: LAYERS_L4 });
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual(data);
  });

  it('roundtrips tabular data with semantic: true', () => {
    const data = {
      users: [
        { name: 'Alice', role: 'dev' },
        { name: 'Bob', role: 'admin' },
      ],
    };
    const result = compress(JSON.stringify(data), { layers: LAYERS_L4 });
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual(data);
  });

  it('reports zero semantic savings (stub)', () => {
    const data = JSON.stringify({
      items: Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        label: `item-${i}`,
        status: 'active',
      })),
    });
    const result = compress(data, { layers: LAYERS_L4 });
    expect(result.savings.byLayer.semantic).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { compressL2, decompressL2, extractDictEntries } from '../src/layers/L2-dictionary.js';
import type {
  BodyNode,
  DocumentNode,
  HeaderNode,
  InlineArrayNode,
  KeyValueNode,
  ListArrayNode,
  ListItemNode,
  ObjectNode,
  ScalarNode,
  SourcePosition,
  StringScalar,
  TabularArrayNode,
  TabularRowNode,
} from '../src/parser/ast.js';

// -- Helpers -----------------------------------------------------------------
const p: SourcePosition = { line: 0, column: 0, offset: 0 };
const s = (v: string, q = false): ScalarNode => ({
  type: 'scalar',
  scalarType: 'string',
  value: v,
  quoted: q,
  position: p,
});
const n = (v: number): ScalarNode => ({
  type: 'scalar',
  scalarType: 'number',
  value: v,
  raw: String(v),
  position: p,
});
const b = (v: boolean): ScalarNode => ({
  type: 'scalar',
  scalarType: 'boolean',
  value: v,
  position: p,
});
const nil = (): ScalarNode => ({ type: 'scalar', scalarType: 'null', value: null, position: p });
const kv = (key: string, val: ScalarNode): KeyValueNode => ({
  type: 'keyValue',
  key,
  value: val,
  position: p,
});
const obj = (key: string, ch: BodyNode[]): ObjectNode => ({
  type: 'object',
  key,
  children: ch,
  position: p,
});
const row = (vals: ScalarNode[]): TabularRowNode => ({
  type: 'tabularRow',
  values: vals,
  position: p,
});
const item = (ch: BodyNode[]): ListItemNode => ({ type: 'listItem', children: ch, position: p });
const hdr = (ht: HeaderNode['headerType'], v: string): HeaderNode =>
  ({ type: 'header', headerType: ht, value: v, position: p }) as HeaderNode;
const doc = (body: BodyNode[], headers: HeaderNode[] = []): DocumentNode => ({
  type: 'document',
  headers,
  dictionary: null,
  body,
  position: p,
});

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: test helper walks all AST node types recursively
function collectValues(nodes: readonly BodyNode[]): string[] {
  const result: string[] = [];
  for (const nd of nodes) {
    switch (nd.type) {
      case 'keyValue':
        if (nd.value.scalarType === 'string' && !nd.value.quoted) result.push(nd.value.value);
        break;
      case 'object':
        result.push(...collectValues(nd.children));
        break;
      case 'tabularArray':
        for (const r of nd.rows)
          for (const v of r.values)
            if (v.scalarType === 'string' && !v.quoted) result.push(v.value);
        break;
      case 'inlineArray':
        for (const v of nd.values) if (v.scalarType === 'string' && !v.quoted) result.push(v.value);
        break;
      case 'listArray':
        for (const li of nd.items) result.push(...collectValues(li.children));
        break;
    }
  }
  return result;
}

// 1. High repetition
describe('L2: high repetition', () => {
  it('creates dictionary entries for repeated values', () => {
    // "Engineering" (11 chars, ~3 tok) x6 => net=(3-1)*6-(3+3)=6 >= 3
    // "in-progress" (11 chars, ~3 tok) x6 => same
    const tab: TabularArrayNode = {
      type: 'tabularArray',
      key: 'employees',
      count: 6,
      fields: ['id', 'name', 'dept', 'status'],
      position: p,
      rows: [
        row([n(1), s('Alice'), s('Engineering'), s('in-progress')]),
        row([n(2), s('Bob'), s('Engineering'), s('in-progress')]),
        row([n(3), s('Carol'), s('Engineering'), s('in-progress')]),
        row([n(4), s('Dave'), s('Engineering'), s('in-progress')]),
        row([n(5), s('Eve'), s('Engineering'), s('in-progress')]),
        row([n(6), s('Frank'), s('Engineering'), s('in-progress')]),
      ],
    };
    const compressed = compressL2(doc([tab]));
    expect(compressed.dictionary).not.toBeNull();
    const expansions = compressed.dictionary?.entries.map((e) => e.expansion);
    expect(expansions).toContain('Engineering');
    expect(expansions).toContain('in-progress');
    const aliasValues = collectValues(compressed.body).filter((v) => v.startsWith('$'));
    expect(aliasValues.length).toBeGreaterThan(0);
  });
});

// 2. No repetition
describe('L2: no repetition', () => {
  it('passes through when all values are unique', () => {
    const input = doc([
      kv('a', s('Alice')),
      kv('b', s('developer')),
      kv('c', s('Hyderabad')),
      kv('d', s('TypeScript')),
    ]);
    const compressed = compressL2(input);
    if (compressed.dictionary !== null) expect(compressed.dictionary.entries).toHaveLength(0);
    const vals = collectValues(compressed.body);
    expect(vals).toContain('Alice');
    expect(vals).toContain('TypeScript');
  });
});

// 3. Below threshold
describe('L2: below threshold', () => {
  it('does not alias values appearing only 2 times', () => {
    const input = doc([
      kv('d1', s('Engineering')),
      kv('d2', s('Engineering')),
      kv('s1', s('active')),
      kv('s2', s('active')),
    ]);
    const compressed = compressL2(input);
    if (compressed.dictionary !== null) expect(compressed.dictionary.entries).toHaveLength(0);
    const vals = collectValues(compressed.body);
    expect(vals).toContain('Engineering');
    expect(vals.filter((v) => v.startsWith('$'))).toHaveLength(0);
  });
});

// 4. Roundtrip
describe('L2: roundtrip', () => {
  it('compressL2 -> decompressL2 yields identical scalar values', () => {
    const tab: TabularArrayNode = {
      type: 'tabularArray',
      key: 'projects',
      count: 5,
      fields: ['id', 'name', 'dept', 'status'],
      position: p,
      rows: [
        row([n(1), s('VAAYU'), s('Engineering'), s('active')]),
        row([n(2), s('ClipForge'), s('Engineering'), s('planning')]),
        row([n(3), s('Substack'), s('Content'), s('active')]),
        row([n(4), s('ChromeExt'), s('Engineering'), s('in-progress')]),
        row([n(5), s('ToonParser'), s('Engineering'), s('planning')]),
      ],
    };
    const input = doc(
      [kv('org', s('YugenLab')), tab, kv('tags', s('Engineering'))],
      [hdr('from', 'json')],
    );
    const original = collectValues(input.body);
    const decompressed = decompressL2(compressL2(input));
    expect(collectValues(decompressed.body)).toEqual(original);
    expect(decompressed.dictionary).toBeNull();
  });

  it('preserves headers through compress/decompress', () => {
    const input = doc(
      [kv('d1', s('Engineering')), kv('d2', s('Engineering')), kv('d3', s('Engineering'))],
      [hdr('from', 'json'), hdr('version', '1.0.0')],
    );
    const decompressed = decompressL2(compressL2(input));
    expect(decompressed.headers).toHaveLength(2);
    expect(decompressed.headers[0]?.headerType).toBe('from');
    expect(decompressed.headers[1]?.headerType).toBe('version');
  });
});

// 5. Literal dollar
describe('L2: literal dollar values', () => {
  it('does not alias quoted string values starting with $', () => {
    // Need 6 occurrences of "Engineering" for net savings >= 3
    const input = doc([
      kv('alias', s('$a', true)),
      kv('d1', s('Engineering')),
      kv('d2', s('Engineering')),
      kv('d3', s('Engineering')),
      kv('d4', s('Engineering')),
      kv('d5', s('Engineering')),
      kv('d6', s('Engineering')),
    ]);
    const compressed = compressL2(input);
    const kvAlias = compressed.body[0] as KeyValueNode;
    const scAlias = kvAlias.value as StringScalar;
    expect(scAlias.quoted).toBe(true);
    expect(scAlias.value).toBe('$a');
  });

  it('expands both quoted and unquoted $-aliases during decompression', () => {
    // Dictionary aliases like $a are always serialized as quoted ("$a") by the
    // serializer (because $ triggers quoting). Decompression must expand them
    // regardless of quoted flag to enable correct round-tripping.
    const input: DocumentNode = {
      type: 'document',
      headers: [],
      position: p,
      dictionary: {
        type: 'dictBlock',
        position: p,
        entries: [{ type: 'dictEntry', alias: '$a', expansion: 'Engineering', position: p }],
      },
      body: [kv('dept', s('$a')), kv('literal', s('$a', true))],
    };
    const decompressed = decompressL2(input);
    expect((decompressed.body[0] as KeyValueNode).value.value).toBe('Engineering');
    // Quoted $a is also expanded because the serializer always quotes aliases
    expect((decompressed.body[1] as KeyValueNode).value.value).toBe('Engineering');
  });
});

// 6. Mixed node types
describe('L2: mixed node types', () => {
  it('scans and aliases values across all node types', () => {
    const tab: TabularArrayNode = {
      type: 'tabularArray',
      key: 'data',
      count: 2,
      fields: ['id', 'val'],
      position: p,
      rows: [row([n(1), s('Engineering')]), row([n(2), s('Engineering')])],
    };
    const inline: InlineArrayNode = {
      type: 'inlineArray',
      key: 'tags',
      count: 1,
      position: p,
      values: [s('Engineering')],
    };
    const list: ListArrayNode = {
      type: 'listArray',
      key: 'items',
      count: 1,
      position: p,
      items: [item([kv('dept', s('Engineering'))])],
    };
    const input = doc([kv('dept', s('Engineering')), tab, inline, list]);
    // "Engineering" appears 5 times across different node types
    const compressed = compressL2(input);
    expect(compressed.dictionary).not.toBeNull();
    expect(compressed.dictionary?.entries.find((e) => e.expansion === 'Engineering')).toBeDefined();
    const decompressed = decompressL2(compressed);
    expect(collectValues(decompressed.body).filter((v) => v === 'Engineering').length).toBe(5);
  });
});

// 7. Alias ordering
describe('L2: alias ordering', () => {
  it('assigns $a to the highest net-savings value', () => {
    // "Engineering" x8: net=(3-1)*8-(3+3)=10, "in-progress" x5: net=(3-1)*5-(3+3)=4
    const tab: TabularArrayNode = {
      type: 'tabularArray',
      key: 'data',
      count: 8,
      fields: ['dept', 'status'],
      position: p,
      rows: [
        row([s('Engineering'), s('in-progress')]),
        row([s('Engineering'), s('in-progress')]),
        row([s('Engineering'), s('in-progress')]),
        row([s('Engineering'), s('in-progress')]),
        row([s('Engineering'), s('in-progress')]),
        row([s('Engineering'), s('Development')]),
        row([s('Engineering'), s('Development')]),
        row([s('Engineering'), s('Development')]),
      ],
    };
    const compressed = compressL2(doc([tab]));
    expect(compressed.dictionary).not.toBeNull();
    expect(compressed.dictionary?.entries.length).toBeGreaterThanOrEqual(2);
    expect(compressed.dictionary?.entries[0]?.alias).toBe('$a');
    expect(compressed.dictionary?.entries[0]?.expansion).toBe('Engineering');
  });
});

// 8. Max 52 aliases
describe('L2: max 52 aliases', () => {
  it('limits aliases to 52 even with 60+ candidates', () => {
    const kvs: BodyNode[] = [];
    // Use values with no shared substrings so each becomes an exact candidate
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 60; i++) {
      // 12-char values with no shared >=6-char substrings
      const a = chars[(i * 7) % 62]!;
      const b = chars[(i * 13 + 3) % 62]!;
      const c = chars[(i * 11 + 7) % 62]!;
      const d = chars[(i * 17 + 11) % 62]!;
      const value = `${a}${b}${c}${d}xz${d}${c}${b}${a}qr`;
      for (let j = 0; j < 5; j++) kvs.push(kv(`key_${i}_${j}`, s(value)));
    }
    const compressed = compressL2(doc(kvs));
    expect(compressed.dictionary).not.toBeNull();
    // Should have at most 52 aliases (the cap)
    expect(compressed.dictionary?.entries.length).toBeLessThanOrEqual(52);
    // Should have at least some aliases
    expect(compressed.dictionary?.entries.length).toBeGreaterThan(0);
    // First alias should be $a
    const aliases = compressed.dictionary?.entries.map((e) => e.alias);
    expect(aliases[0]).toBe('$a');
    // Roundtrip: all 300 values present
    expect(collectValues(decompressL2(compressed).body)).toHaveLength(300);
  });

  it('greedy selection prefers one efficient substring over many exact aliases', () => {
    // 60 values sharing "repeated_value_number_" prefix → the substring
    // is more efficient than 52 exact aliases
    const kvs: BodyNode[] = [];
    for (let i = 0; i < 60; i++) {
      const value = `repeated_value_number_${i.toString().padStart(3, '0')}`;
      for (let j = 0; j < 5; j++) kvs.push(kv(`key_${i}_${j}`, s(value)));
    }
    const compressed = compressL2(doc(kvs));
    expect(compressed.dictionary).not.toBeNull();
    // Smart algorithm finds shared substring → fewer aliases needed
    expect(compressed.dictionary?.entries.length).toBeLessThan(52);
    // Roundtrip: all 300 values present
    expect(collectValues(decompressL2(compressed).body)).toHaveLength(300);
  });
});

// 9. Preserves structure
describe('L2: preserves structure', () => {
  it('preserves headers, object nesting, and array types', () => {
    const nested = obj('config', [
      kv('d', s('Engineering')),
      obj('inner', [kv('d', s('Engineering')), kv('d2', s('Engineering'))]),
    ]);
    const tab: TabularArrayNode = {
      type: 'tabularArray',
      key: 'items',
      count: 2,
      fields: ['id', 'val'],
      position: p,
      rows: [row([n(1), s('Engineering')]), row([n(2), s('Engineering')])],
    };
    const compressed = compressL2(doc([nested, tab], [hdr('from', 'json')]));
    expect(compressed.headers).toHaveLength(1);
    expect(compressed.headers[0]?.headerType).toBe('from');
    const compObj = compressed.body[0] as ObjectNode;
    expect(compObj.type).toBe('object');
    expect(compObj.key).toBe('config');
    expect(compObj.children).toHaveLength(2);
    expect((compObj.children[1] as ObjectNode).key).toBe('inner');
    const compTab = compressed.body[1] as TabularArrayNode;
    expect(compTab.type).toBe('tabularArray');
    expect(compTab.fields).toEqual(['id', 'val']);
    expect(compTab.rows).toHaveLength(2);
  });

  it('does not mutate the input document', () => {
    const input = doc([
      kv('a', s('Engineering')),
      kv('b', s('Engineering')),
      kv('c', s('Engineering')),
    ]);
    const origA = (input.body[0] as KeyValueNode).value.value;
    compressL2(input);
    expect((input.body[0] as KeyValueNode).value.value).toBe(origA);
    expect(input.dictionary).toBeNull();
  });
});

// extractDictEntries
describe('extractDictEntries', () => {
  it('returns empty array when no dictionary', () => {
    expect(extractDictEntries(doc([kv('name', s('Alice'))]))).toEqual([]);
  });

  it('returns DictEntry[] with occurrences and tokensSaved', () => {
    // net=(3-1)*6-(3+3)=6 for "Engineering" x6
    const tab: TabularArrayNode = {
      type: 'tabularArray',
      key: 'data',
      count: 6,
      fields: ['dept'],
      position: p,
      rows: Array.from({ length: 6 }, () => row([s('Engineering')])),
    };
    const compressed = compressL2(doc([tab]));
    const entries = extractDictEntries(compressed);
    expect(entries.length).toBeGreaterThan(0);
    const eng = entries.find((e) => e.expansion === 'Engineering');
    expect(eng).toBeDefined();
    expect(eng?.alias).toBe('$a');
    expect(eng?.occurrences).toBe(6);
    expect(eng?.tokensSaved).toBeGreaterThan(0);
  });
});

// Edge cases
describe('L2: edge cases', () => {
  it('handles document with no body', () => {
    expect(compressL2(doc([], [hdr('from', 'json')])).body).toHaveLength(0);
  });

  it('handles document with only comments', () => {
    const input = doc([{ type: 'comment', text: 'a comment', inline: false, position: p }]);
    const compressed = compressL2(input);
    expect(compressed.body).toHaveLength(1);
    expect(compressed.body[0]?.type).toBe('comment');
  });

  it('decompressL2 with no dictionary returns body unchanged', () => {
    const decompressed = decompressL2(doc([kv('name', s('Alice'))]));
    expect(decompressed.dictionary).toBeNull();
    expect(collectValues(decompressed.body)).toEqual(['Alice']);
  });

  it('does not alias short values (1 char)', () => {
    const input = doc([kv('a1', s('x')), kv('a2', s('x')), kv('a3', s('x')), kv('a4', s('x'))]);
    const compressed = compressL2(input);
    if (compressed.dictionary !== null) expect(compressed.dictionary.entries).toHaveLength(0);
  });

  it('does not alias non-string scalars', () => {
    const input = doc([
      kv('a1', n(42)),
      kv('a2', n(42)),
      kv('a3', n(42)),
      kv('b1', b(true)),
      kv('b2', b(true)),
      kv('b3', b(true)),
      kv('c1', nil()),
      kv('c2', nil()),
      kv('c3', nil()),
    ]);
    const compressed = compressL2(input);
    if (compressed.dictionary !== null) expect(compressed.dictionary.entries).toHaveLength(0);
  });
});

// Suffix detection
describe('L2: suffix detection', () => {
  it('detects common suffixes and creates aliases', () => {
    // 5 values ending with "-controller.ts" (14 chars = 4 tokens)
    // net = (4-1)*5 - (4+3) = 15-7 = 8 >= 3
    const tab: TabularArrayNode = {
      type: 'tabularArray',
      key: 'files',
      count: 5,
      fields: ['path'],
      position: p,
      rows: [
        row([s('user-controller.ts', true)]),
        row([s('auth-controller.ts', true)]),
        row([s('post-controller.ts', true)]),
        row([s('chat-controller.ts', true)]),
        row([s('item-controller.ts', true)]),
      ],
    };
    const compressed = compressL2(doc([tab]));
    expect(compressed.dictionary).not.toBeNull();
    // Should find some shared pattern (suffix or substring)
    const expansions = compressed.dictionary?.entries.map((e) => e.expansion);
    const hasSuffix = expansions.some(
      (e) => '-controller.ts'.includes(e) || e.includes('-controller'),
    );
    expect(hasSuffix).toBe(true);
    // Roundtrip
    const decompressed = decompressL2(compressed);
    const values = collectAllValues(decompressed.body);
    expect(values).toContain('user-controller.ts');
    expect(values).toContain('auth-controller.ts');
    expect(values).toContain('item-controller.ts');
  });
});

// Substring detection
describe('L2: substring detection', () => {
  it('detects common substrings at any position', () => {
    // 5 values containing "error-handler" (13 chars = 4 tokens)
    const tab: TabularArrayNode = {
      type: 'tabularArray',
      key: 'modules',
      count: 5,
      fields: ['name'],
      position: p,
      rows: [
        row([s('type-error-handler-v1', true)]),
        row([s('value-error-handler-v2', true)]),
        row([s('range-error-handler-v1', true)]),
        row([s('parse-error-handler-v3', true)]),
        row([s('input-error-handler-v2', true)]),
      ],
    };
    const compressed = compressL2(doc([tab]));
    expect(compressed.dictionary).not.toBeNull();
    const expansions = compressed.dictionary?.entries.map((e) => e.expansion);
    // Should find "error-handler" or some shared substring
    const hasSubstring = expansions.some(
      (e) => 'error-handler'.includes(e) || e.includes('error-handler'),
    );
    expect(hasSubstring).toBe(true);
    // Roundtrip
    const decompressed = decompressL2(compressed);
    const values = collectAllValues(decompressed.body);
    expect(values).toContain('type-error-handler-v1');
    expect(values).toContain('parse-error-handler-v3');
  });

  it('roundtrips with multiple inline aliases in one value', () => {
    // Values with two shared substrings
    const input = doc([
      kv('a1', s('http://api.example.com/users/endpoint.json', true)),
      kv('a2', s('http://api.example.com/posts/endpoint.json', true)),
      kv('a3', s('http://api.example.com/items/endpoint.json', true)),
      kv('a4', s('http://api.example.com/teams/endpoint.json', true)),
      kv('a5', s('http://api.example.com/roles/endpoint.json', true)),
    ]);
    const compressed = compressL2(input);
    const decompressed = decompressL2(compressed);
    const values = collectAllValues(decompressed.body);
    expect(values).toContain('http://api.example.com/users/endpoint.json');
    expect(values).toContain('http://api.example.com/teams/endpoint.json');
  });
});

// Helper that collects ALL string values (quoted + unquoted)
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: test helper walks all AST node types recursively
function collectAllValues(nodes: readonly BodyNode[]): string[] {
  const result: string[] = [];
  for (const nd of nodes) {
    switch (nd.type) {
      case 'keyValue':
        if (nd.value.scalarType === 'string') result.push(nd.value.value);
        break;
      case 'object':
        result.push(...collectAllValues(nd.children));
        break;
      case 'tabularArray':
        for (const r of nd.rows)
          for (const v of r.values) if (v.scalarType === 'string') result.push(v.value);
        break;
      case 'inlineArray':
        for (const v of nd.values) if (v.scalarType === 'string') result.push(v.value);
        break;
      case 'listArray':
        for (const li of nd.items) result.push(...collectAllValues(li.children));
        break;
    }
  }
  return result;
}

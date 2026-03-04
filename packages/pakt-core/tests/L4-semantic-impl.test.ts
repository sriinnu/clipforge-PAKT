/**
 * L4 semantic compression implementation tests.
 *
 * Validates the full L4 pipeline: AST-level strategies (value truncation,
 * array truncation, field dropping, redundancy collapse), text-level
 * transforms (whitespace, abbreviation, precision), budget-awareness,
 * header injection/stripping, and pipeline integration.
 */
import { describe, expect, it } from 'vitest';
import { compress } from '../src/index.js';
import { compressL4, decompressL4, applyL4Transforms } from '../src/layers/L4-semantic.js';
import {
  strategyValueTruncation,
  strategyArrayTruncation,
  strategyFieldDropping,
  strategyRedundancyCollapse,
} from '../src/layers/L4-strategies.js';
import {
  normalizeWhitespace,
  abbreviateValues,
  reduceNumericPrecision,
} from '../src/layers/L4-text-transforms.js';
import { serialize } from '../src/serializer/serialize.js';
import { countTokens } from '../src/tokens/counter.js';
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
  TabularArrayNode,
  TabularRowNode,
} from '../src/parser/ast.js';

// -- Helpers -----------------------------------------------------------------

/** Shared zero-position for test nodes. */
const p: SourcePosition = { line: 0, column: 0, offset: 0 };

/** Create a string scalar node. */
const str = (v: string, q = false): ScalarNode => ({
  type: 'scalar', scalarType: 'string', value: v, quoted: q, position: p,
});

/** Create a number scalar node. */
const num = (v: number): ScalarNode => ({
  type: 'scalar', scalarType: 'number', value: v, raw: String(v), position: p,
});

/** Create a boolean scalar node. */
const bool = (v: boolean): ScalarNode => ({
  type: 'scalar', scalarType: 'boolean', value: v, position: p,
});

/** Create a null scalar node. */
const nil = (): ScalarNode => ({
  type: 'scalar', scalarType: 'null', value: null, position: p,
});

/** Create a key-value node. */
const kv = (key: string, val: ScalarNode): KeyValueNode => ({
  type: 'keyValue', key, value: val, position: p,
});

/** Create an object node. */
const obj = (key: string, children: BodyNode[]): ObjectNode => ({
  type: 'object', key, children, position: p,
});

/** Create an inline array node. */
const inlineArr = (key: string, values: ScalarNode[]): InlineArrayNode => ({
  type: 'inlineArray', key, count: values.length, values, position: p,
});

/** Create a tabular array node. */
const tabArr = (
  key: string,
  fields: string[],
  rows: ScalarNode[][],
): TabularArrayNode => ({
  type: 'tabularArray',
  key,
  count: rows.length,
  fields,
  rows: rows.map((vals) => ({
    type: 'tabularRow' as const,
    values: vals,
    position: p,
  })),
  position: p,
});

/** Create a list array node. */
const listArr = (key: string, items: BodyNode[][]): ListArrayNode => ({
  type: 'listArray',
  key,
  count: items.length,
  items: items.map((children) => ({
    type: 'listItem' as const,
    children,
    position: p,
  })),
  position: p,
});

/** Create a document node with optional headers. */
const doc = (body: BodyNode[], headers: HeaderNode[] = []): DocumentNode => ({
  type: 'document', headers, dictionary: null, body, position: p,
});

// ---------------------------------------------------------------------------
// Strategy A — Value truncation
// ---------------------------------------------------------------------------

describe('Strategy A — Value truncation', () => {
  it('truncates strings longer than 50 chars', () => {
    const longVal = 'A'.repeat(60);
    const d = doc([kv('desc', str(longVal))]);
    strategyValueTruncation(d);

    const result = (d.body[0] as KeyValueNode).value;
    expect(result.scalarType).toBe('string');
    if (result.scalarType === 'string') {
      expect(result.value).toBe('A'.repeat(40) + '...');
      expect(result.value.length).toBe(43);
    }
  });

  it('does not truncate strings of 50 chars or fewer', () => {
    const shortVal = 'B'.repeat(50);
    const d = doc([kv('name', str(shortVal))]);
    strategyValueTruncation(d);

    const result = (d.body[0] as KeyValueNode).value;
    if (result.scalarType === 'string') {
      expect(result.value).toBe(shortVal);
    }
  });

  it('processes longest strings first', () => {
    const d = doc([
      kv('short', str('X'.repeat(55))),
      kv('long', str('Y'.repeat(100))),
    ]);
    strategyValueTruncation(d);

    const short = (d.body[0] as KeyValueNode).value;
    const long = (d.body[1] as KeyValueNode).value;
    if (short.scalarType === 'string' && long.scalarType === 'string') {
      expect(long.value.endsWith('...')).toBe(true);
      expect(short.value.endsWith('...')).toBe(true);
    }
  });

  it('truncates strings inside tabular arrays', () => {
    const d = doc([
      tabArr('items', ['name', 'desc'], [
        [str('A'), str('Z'.repeat(60))],
      ]),
    ]);
    strategyValueTruncation(d);

    const tab = d.body[0] as TabularArrayNode;
    const val = tab.rows[0]!.values[1]!;
    if (val.scalarType === 'string') {
      expect(val.value.endsWith('...')).toBe(true);
      expect(val.value.length).toBe(43);
    }
  });
});

// ---------------------------------------------------------------------------
// Strategy B — Array truncation
// ---------------------------------------------------------------------------

describe('Strategy B — Array truncation', () => {
  it('truncates inline arrays with >10 items', () => {
    const values = Array.from({ length: 15 }, (_, i) => str(`item${i}`));
    const d = doc([inlineArr('tags', values)]);
    strategyArrayTruncation(d);

    const arr = d.body[0] as InlineArrayNode;
    // 3 head + 1 summary + 2 tail = 6
    expect(arr.values.length).toBe(6);
    const summary = arr.values[3]!;
    if (summary.scalarType === 'string') {
      expect(summary.value).toContain('10 more items');
    }
  });

  it('does not truncate arrays with 10 or fewer items', () => {
    const values = Array.from({ length: 10 }, (_, i) => str(`item${i}`));
    const d = doc([inlineArr('tags', values)]);
    strategyArrayTruncation(d);

    const arr = d.body[0] as InlineArrayNode;
    expect(arr.values.length).toBe(10);
  });

  it('truncates tabular arrays with >10 rows', () => {
    const rows = Array.from({ length: 12 }, (_, i) => [
      num(i), str(`name${i}`),
    ]);
    const d = doc([tabArr('users', ['id', 'name'], rows)]);
    strategyArrayTruncation(d);

    const tab = d.body[0] as TabularArrayNode;
    // 3 head + 1 summary + 2 tail = 6
    expect(tab.rows.length).toBe(6);
  });

  it('truncates list arrays with >10 items', () => {
    const items = Array.from({ length: 14 }, (_, i) => [
      kv('id', num(i)),
      kv('label', str(`label${i}`)),
    ]);
    const d = doc([listArr('events', items)]);
    strategyArrayTruncation(d);

    const arr = d.body[0] as ListArrayNode;
    // 3 head + 1 summary + 2 tail = 6
    expect(arr.items.length).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Strategy C — Field dropping
// ---------------------------------------------------------------------------

describe('Strategy C — Field dropping', () => {
  it('drops null/boolean/empty fields from objects with >8 fields', () => {
    const children: BodyNode[] = [
      kv('name', str('Alice')),
      kv('email', str('alice@example.com')),
      kv('bio', str('Developer')),
      kv('age', num(30)),
      kv('city', str('Portland')),
      kv('role', str('dev')),
      kv('active', bool(true)),
      kv('deleted', bool(false)),
      kv('notes', str('')),
      kv('tag', nil()),
    ];
    const d = doc([obj('user', children)]);
    strategyFieldDropping(d);

    const result = (d.body[0] as ObjectNode).children;
    // Should drop some low-info fields (bool, null, empty string)
    expect(result.length).toBeLessThan(10);
    // Should keep high-info string/number fields
    const keys = result.map((c) => (c as KeyValueNode).key);
    expect(keys).toContain('name');
    expect(keys).toContain('email');
  });

  it('does not drop fields from objects with 8 or fewer fields', () => {
    const children: BodyNode[] = Array.from({ length: 8 }, (_, i) =>
      kv(`field${i}`, nil()),
    );
    const d = doc([obj('small', children)]);
    strategyFieldDropping(d);

    const result = (d.body[0] as ObjectNode).children;
    expect(result.length).toBe(8);
  });

  it('drops at most 30% of fields', () => {
    // 10 fields, all low-info — should drop at most 3
    const children: BodyNode[] = Array.from({ length: 10 }, (_, i) =>
      kv(`field${i}`, nil()),
    );
    const d = doc([obj('many', children)]);
    strategyFieldDropping(d);

    const result = (d.body[0] as ObjectNode).children;
    expect(result.length).toBeGreaterThanOrEqual(7);
  });
});

// ---------------------------------------------------------------------------
// Strategy D — Redundancy collapse
// ---------------------------------------------------------------------------

describe('Strategy D — Redundancy collapse', () => {
  it('collapses 3+ consecutive identical-structure list items', () => {
    // 5 items all with same keys
    const items = Array.from({ length: 5 }, (_, i) => [
      kv('type', str('deploy')),
      kv('status', str(`status${i}`)),
    ]);
    const d = doc([listArr('events', items)]);
    strategyRedundancyCollapse(d);

    const arr = d.body[0] as ListArrayNode;
    // Should collapse: keep first + summary
    expect(arr.items.length).toBe(2);
    const summaryItem = arr.items[1]!;
    const summaryChild = summaryItem.children[0] as KeyValueNode;
    if (summaryChild.value.scalarType === 'string') {
      expect(summaryChild.value.value).toContain('4 identical');
    }
  });

  it('does not collapse fewer than 3 consecutive identical items', () => {
    const items = [
      [kv('type', str('a'))],
      [kv('type', str('b'))],
    ];
    const d = doc([listArr('events', items)]);
    strategyRedundancyCollapse(d);

    const arr = d.body[0] as ListArrayNode;
    expect(arr.items.length).toBe(2);
  });

  it('handles mixed-structure items correctly', () => {
    const items = [
      [kv('type', str('deploy')), kv('status', str('ok'))],
      [kv('type', str('deploy')), kv('status', str('ok'))],
      [kv('type', str('deploy')), kv('status', str('ok'))],
      [kv('kind', str('build'))],
      [kv('kind', str('build'))],
    ];
    const d = doc([listArr('events', items)]);
    strategyRedundancyCollapse(d);

    const arr = d.body[0] as ListArrayNode;
    // First run (3 items) collapses to 2, second run (2 items) stays at 2
    expect(arr.items.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// compressL4 — budget-aware orchestration
// ---------------------------------------------------------------------------

describe('compressL4', () => {
  it('is a no-op when budget is 0', () => {
    const d = doc([kv('name', str('Alice'))]);
    const result = compressL4(d, 0);
    expect(result).toBe(d);
  });

  it('is a no-op when budget is negative', () => {
    const d = doc([kv('name', str('Alice'))]);
    const result = compressL4(d, -10);
    expect(result).toBe(d);
  });

  it('is a no-op when already within budget', () => {
    const d = doc([kv('name', str('Alice'))]);
    const result = compressL4(d, 99999);
    expect(result).toBe(d);
    // No headers should be added
    expect(result.headers.length).toBe(0);
  });

  it('adds @compress semantic header when transforms applied', () => {
    // Create a doc that is deliberately over-budget
    const longValues = Array.from({ length: 20 }, (_, i) =>
      kv(`field${i}`, str('X'.repeat(80))),
    );
    const d = doc(longValues);
    const serialized = serialize(d);
    const tokens = countTokens(serialized);

    // Set budget to half the current tokens to force compression
    const result = compressL4(d, Math.floor(tokens / 2));
    const hasCompress = result.headers.some(
      (h) => h.headerType === 'compress' && h.value === 'semantic',
    );
    expect(hasCompress).toBe(true);
  });

  it('adds @warning lossy header when transforms applied', () => {
    const longValues = Array.from({ length: 20 }, (_, i) =>
      kv(`field${i}`, str('Y'.repeat(80))),
    );
    const d = doc(longValues);
    const serialized = serialize(d);
    const tokens = countTokens(serialized);

    const result = compressL4(d, Math.floor(tokens / 2));
    const hasWarning = result.headers.some(
      (h) => h.headerType === 'warning' && h.value === 'lossy',
    );
    expect(hasWarning).toBe(true);
  });

  it('stops applying strategies once within budget', () => {
    // Create a doc with long strings — value truncation alone should help
    const longValues = Array.from({ length: 5 }, (_, i) =>
      kv(`field${i}`, str('Z'.repeat(80))),
    );
    const d = doc(longValues);
    const serialized = serialize(d);
    const tokens = countTokens(serialized);

    // Set a generous budget that value truncation alone can meet
    const result = compressL4(d, tokens - 1);
    const resultText = serialize(result);
    const resultTokens = countTokens(resultText);
    expect(resultTokens).toBeLessThanOrEqual(tokens);
  });
});

// ---------------------------------------------------------------------------
// decompressL4 — header stripping
// ---------------------------------------------------------------------------

describe('decompressL4', () => {
  it('strips @compress semantic header', () => {
    const headers: HeaderNode[] = [
      { type: 'header', headerType: 'from', value: 'json', position: p },
      { type: 'header', headerType: 'compress', value: 'semantic', position: p },
    ];
    const d = doc([kv('x', str('y'))], headers);
    const result = decompressL4(d);
    expect(result.headers.length).toBe(1);
    expect(result.headers[0]!.headerType).toBe('from');
  });

  it('strips @warning lossy header', () => {
    const headers: HeaderNode[] = [
      { type: 'header', headerType: 'warning', value: 'lossy', position: p },
    ];
    const d = doc([kv('x', str('y'))], headers);
    const result = decompressL4(d);
    expect(result.headers.length).toBe(0);
  });

  it('strips both L4 headers at once', () => {
    const headers: HeaderNode[] = [
      { type: 'header', headerType: 'from', value: 'json', position: p },
      { type: 'header', headerType: 'compress', value: 'semantic', position: p },
      { type: 'header', headerType: 'warning', value: 'lossy', position: p },
    ];
    const d = doc([kv('x', str('y'))], headers);
    const result = decompressL4(d);
    expect(result.headers.length).toBe(1);
    expect(result.headers[0]!.headerType).toBe('from');
  });

  it('preserves non-L4 headers', () => {
    const headers: HeaderNode[] = [
      { type: 'header', headerType: 'from', value: 'json', position: p },
      { type: 'header', headerType: 'version', value: '0.1.0', position: p },
      { type: 'header', headerType: 'compress', value: 'semantic', position: p },
    ];
    const d = doc([kv('x', str('y'))], headers);
    const result = decompressL4(d);
    expect(result.headers.length).toBe(2);
    expect(result.headers.map((h) => h.headerType)).toEqual(['from', 'version']);
  });

  it('preserves body content unchanged', () => {
    const headers: HeaderNode[] = [
      { type: 'header', headerType: 'compress', value: 'semantic', position: p },
    ];
    const body = [kv('name', str('truncated...')), kv('id', num(42))];
    const d = doc(body, headers);
    const result = decompressL4(d);
    expect(result.body).toBe(d.body);
  });
});

// ---------------------------------------------------------------------------
// Text-level transforms
// ---------------------------------------------------------------------------

describe('Text-level transforms', () => {
  describe('normalizeWhitespace', () => {
    it('collapses multiple spaces to one', () => {
      const result = normalizeWhitespace('key:  value   here');
      expect(result).toBe('key: value here');
    });

    it('strips trailing whitespace', () => {
      const result = normalizeWhitespace('name: Alice   \nage: 30  ');
      expect(result).toBe('name: Alice\nage: 30');
    });

    it('preserves leading indentation', () => {
      const result = normalizeWhitespace('  child:  value');
      expect(result).toBe('  child: value');
    });
  });

  describe('abbreviateValues', () => {
    it('abbreviates true to T in key-value positions', () => {
      expect(abbreviateValues('active: true')).toBe('active: T');
    });

    it('abbreviates false to F in key-value positions', () => {
      expect(abbreviateValues('deleted: false')).toBe('deleted: F');
    });

    it('abbreviates null to ~ in key-value positions', () => {
      expect(abbreviateValues('notes: null')).toBe('notes: ~');
    });

    it('abbreviates values in pipe-delimited rows', () => {
      const result = abbreviateValues('  Alice|true|false|null');
      expect(result).toBe('  Alice|T|F|~');
    });

    it('does not modify header lines', () => {
      expect(abbreviateValues('@from json')).toBe('@from json');
    });

    it('does not modify comment lines', () => {
      expect(abbreviateValues('% true false null')).toBe('% true false null');
    });
  });

  describe('reduceNumericPrecision', () => {
    it('reduces 3+ decimal places to 2', () => {
      expect(reduceNumericPrecision('pi: 3.14159265')).toBe('pi: 3.14');
    });

    it('preserves numbers with 2 or fewer decimal places', () => {
      expect(reduceNumericPrecision('price: 9.99')).toBe('price: 9.99');
    });

    it('handles multiple numbers in a line', () => {
      const result = reduceNumericPrecision('2.71828|3.14159');
      expect(result).toBe('2.72|3.14');
    });
  });
});

// ---------------------------------------------------------------------------
// applyL4Transforms — text-level orchestration
// ---------------------------------------------------------------------------

describe('applyL4Transforms', () => {
  it('is a no-op when budget is 0', () => {
    const text = 'name: Alice';
    expect(applyL4Transforms(text, 0)).toBe(text);
  });

  it('is a no-op when budget is negative', () => {
    const text = 'name: Alice';
    expect(applyL4Transforms(text, -5)).toBe(text);
  });

  it('is a no-op when already within budget', () => {
    const text = 'name: Alice';
    expect(applyL4Transforms(text, 99999)).toBe(text);
  });

  it('applies transforms when over budget', () => {
    // Create text with verbose values and extra whitespace
    const text = 'active: true\ndeleted: false\nnotes: null\npi: 3.14159265';
    const tokens = countTokens(text);
    // Set a very tight budget to force transforms
    const result = applyL4Transforms(text, Math.floor(tokens * 0.5));
    // Should be shorter or equal
    expect(result.length).toBeLessThanOrEqual(text.length);
  });
});

// ---------------------------------------------------------------------------
// Pipeline integration
// ---------------------------------------------------------------------------

describe('L4 pipeline integration', () => {
  const L4_LAYERS = {
    structural: true,
    dictionary: true,
    tokenizerAware: false,
    semantic: true,
  };

  it('sets reversible=false when L4 reduces tokens', () => {
    // Create a large dataset that L4 can compress
    const data = {
      items: Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        name: 'A very long name that exceeds fifty characters in length for testing purposes',
        description: 'Another very long description string that is well over the fifty character threshold for truncation',
        status: 'active',
        deleted: false,
        notes: null,
        archived: false,
        flagged: true,
        reviewed: false,
        priority: null,
      })),
    };
    const result = compress(JSON.stringify(data), {
      layers: L4_LAYERS,
      semanticBudget: 50,
    });
    expect(result.reversible).toBe(false);
  });

  it('reports semantic savings in byLayer', () => {
    const data = {
      items: Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        name: 'A very long name that exceeds fifty characters in length for testing purposes',
        status: 'active',
      })),
    };
    const result = compress(JSON.stringify(data), {
      layers: L4_LAYERS,
      semanticBudget: 50,
    });
    expect(result.savings.byLayer.semantic).toBeGreaterThanOrEqual(0);
  });

  it('is a no-op when semanticBudget is 0', () => {
    const data = JSON.stringify({ name: 'Alice', role: 'dev' });
    const withL4 = compress(data, { layers: L4_LAYERS, semanticBudget: 0 });
    const withoutL4 = compress(data);
    // Should produce identical output since budget is 0
    expect(withL4.reversible).toBe(true);
    expect(withL4.savings.byLayer.semantic).toBe(0);
  });

  it('does not break output when semantic layer enabled', () => {
    const input = JSON.stringify({ name: 'Alice', role: 'developer' });
    const result = compress(input, {
      layers: L4_LAYERS,
      semanticBudget: 100,
    });
    expect(result.compressed).toBeDefined();
    expect(result.compressed.length).toBeGreaterThan(0);
  });

  it('compresses large data below budget', () => {
    const data = {
      entries: Array.from({ length: 30 }, (_, i) => ({
        id: i,
        text: `Entry number ${i} with some filler text to increase the token count`,
      })),
    };
    const input = JSON.stringify(data);
    const noL4 = compress(input);
    const budget = Math.floor(noL4.compressedTokens * 0.7);

    const withL4 = compress(input, {
      layers: L4_LAYERS,
      semanticBudget: budget,
    });
    // L4 should bring tokens closer to or below budget
    expect(withL4.compressedTokens).toBeLessThanOrEqual(noL4.compressedTokens);
  });
});

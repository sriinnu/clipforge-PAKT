import { describe, expect, it } from 'vitest';
import { compressL1 } from '../src/layers/L1-compress.js';
import { decompressL1 } from '../src/layers/L1-decompress.js';
import type { DocumentNode } from '../src/parser/ast.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compress then decompress — the result must deep-equal the input. */
function roundtrip(data: unknown, label = ''): void {
  const doc = compressL1(data, 'json');
  const restored = decompressL1(doc.body);
  expect(restored, `roundtrip failed${label ? `: ${label}` : ''}`).toEqual(data);
}

function compress(data: unknown): DocumentNode {
  return compressL1(data, 'json');
}

// ===========================================================================
// 1. Flat object — simple key-value pairs
// ===========================================================================

describe('L1: flat object', () => {
  it('converts string, number, boolean, null key-value pairs', () => {
    const data = { name: 'Sriinnu', age: 28, active: true, bio: null };
    const doc = compress(data);

    expect(doc.headers).toHaveLength(1);
    expect(doc.headers[0]?.headerType).toBe('from');
    expect(doc.headers[0]?.value).toBe('json');
    expect(doc.dictionary).toBeNull();
    expect(doc.body).toHaveLength(4);

    const [n, a, act, b] = doc.body;
    expect(n?.type).toBe('keyValue');
    expect(a?.type).toBe('keyValue');
    expect(act?.type).toBe('keyValue');
    expect(b?.type).toBe('keyValue');
  });

  it('round-trips a flat object', () => {
    roundtrip({ name: 'Sriinnu', age: 28, active: true, bio: null });
  });

  it('handles empty object', () => {
    const doc = compress({});
    expect(doc.body).toHaveLength(0);
    roundtrip({});
  });
});

// ===========================================================================
// 2. Nested object — 2-3 levels deep
// ===========================================================================

describe('L1: nested object', () => {
  it('produces ObjectNode for nested objects', () => {
    const data = { user: { name: 'Sriinnu', role: 'developer' } };
    const doc = compress(data);

    expect(doc.body).toHaveLength(1);
    expect(doc.body[0]?.type).toBe('object');
    const obj = doc.body[0] as Extract<(typeof doc.body)[0], { type: 'object' }>;
    expect(obj.key).toBe('user');
    expect(obj.children).toHaveLength(2);
  });

  it('handles 3-level nesting', () => {
    const data = {
      config: {
        database: {
          host: 'localhost',
          port: 5432,
        },
        cache: {
          enabled: true,
        },
      },
    };
    roundtrip(data);
  });

  it('handles empty nested object', () => {
    const data = { metadata: {} };
    const doc = compress(data);
    expect(doc.body[0]?.type).toBe('object');
    roundtrip(data);
  });
});

// ===========================================================================
// 3. Tabular array — uniform objects with same keys
// ===========================================================================

describe('L1: tabular array', () => {
  it('detects uniform objects as TabularArrayNode', () => {
    const data = {
      users: [
        { id: 1, name: 'Alice', active: true },
        { id: 2, name: 'Bob', active: false },
        { id: 3, name: 'Carol', active: true },
      ],
    };
    const doc = compress(data);
    const arr = doc.body[0]!;
    expect(arr.type).toBe('tabularArray');
    if (arr.type === 'tabularArray') {
      expect(arr.fields).toEqual(['id', 'name', 'active']);
      expect(arr.count).toBe(3);
      expect(arr.rows).toHaveLength(3);
    }
  });

  it('round-trips tabular array', () => {
    roundtrip({
      employees: [
        { id: 1, name: 'Alice', dept: 'Engineering' },
        { id: 2, name: 'Bob', dept: 'Design' },
      ],
    });
  });

  it('uses ListArray when objects have different keys', () => {
    const data = {
      items: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob', extra: true },
      ],
    };
    const doc = compress(data);
    expect(doc.body[0]?.type).toBe('listArray');
  });

  it('uses ListArray when object values contain nested objects', () => {
    const data = {
      items: [
        { id: 1, meta: { x: 1 } },
        { id: 2, meta: { x: 2 } },
      ],
    };
    const doc = compress(data);
    expect(doc.body[0]?.type).toBe('listArray');
  });
});

// ===========================================================================
// 4. Inline array — array of primitives
// ===========================================================================

describe('L1: inline array', () => {
  it('detects array of strings as InlineArrayNode', () => {
    const data = { tags: ['React', 'TypeScript', 'Rust'] };
    const doc = compress(data);
    const arr = doc.body[0]!;
    expect(arr.type).toBe('inlineArray');
    if (arr.type === 'inlineArray') {
      expect(arr.count).toBe(3);
      expect(arr.values).toHaveLength(3);
    }
  });

  it('detects array of numbers as InlineArrayNode', () => {
    const data = { scores: [95, 87, 92, 78] };
    const doc = compress(data);
    expect(doc.body[0]?.type).toBe('inlineArray');
  });

  it('detects mixed primitives as InlineArrayNode', () => {
    const data = { mixed: ['hello', 42, true, null] };
    const doc = compress(data);
    expect(doc.body[0]?.type).toBe('inlineArray');
    roundtrip(data);
  });

  it('round-trips inline array', () => {
    roundtrip({ tags: ['React', 'TypeScript', 'Rust'] });
    roundtrip({ nums: [1, 2, 3, 4, 5] });
  });
});

// ===========================================================================
// 5. List array — non-uniform objects
// ===========================================================================

describe('L1: list array', () => {
  it('uses ListArrayNode for objects with different keys', () => {
    const data = {
      events: [
        { type: 'deploy', success: true },
        { type: 'alert', message: 'CPU spike', severity: 'warning' },
      ],
    };
    const doc = compress(data);
    expect(doc.body[0]?.type).toBe('listArray');
    if (doc.body[0]?.type === 'listArray') {
      expect(doc.body[0]?.count).toBe(2);
      expect(doc.body[0]?.items).toHaveLength(2);
    }
  });

  it('round-trips list array', () => {
    roundtrip({
      events: [
        { type: 'deploy', success: true },
        { type: 'alert', message: 'CPU spike', severity: 'warning' },
      ],
    });
  });
});

// ===========================================================================
// 6. Mixed document — combination of all types
// ===========================================================================

describe('L1: mixed document', () => {
  it('handles mixed structures', () => {
    const data = {
      apiVersion: 'v2',
      status: 'healthy',
      uptime: 99.97,
      server: {
        hostname: 'prod-east-1',
        region: 'us-east-1',
        tags: ['production', 'primary', 'monitored'],
      },
      services: [
        { name: 'auth', port: 8080, status: 'running', cpu: 23.5 },
        { name: 'api', port: 8081, status: 'running', cpu: 45.2 },
      ],
      alerts: [
        { type: 'warning', message: 'CPU above 80%' },
        { type: 'info', message: 'Scheduled maintenance' },
      ],
    };
    roundtrip(data);
  });

  it('produces correct node types for mixed document', () => {
    const data = {
      name: 'test',
      nested: { a: 1, b: 2 },
      table: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
      list: [{ a: 1 }, { b: 2 }],
      tags: [1, 2, 3],
    };
    const doc = compress(data);
    expect(doc.body[0]?.type).toBe('keyValue');
    expect(doc.body[1]?.type).toBe('object');
    expect(doc.body[2]?.type).toBe('tabularArray');
    expect(doc.body[3]?.type).toBe('listArray');
    expect(doc.body[4]?.type).toBe('inlineArray');
  });
});

// ===========================================================================
// 7. Empty values — empty array, empty object, empty string
// ===========================================================================

describe('L1: empty values', () => {
  it('handles empty array', () => {
    const data = { tags: [] as unknown[] };
    const doc = compress(data);
    expect(doc.body[0]?.type).toBe('inlineArray');
    if (doc.body[0]?.type === 'inlineArray') {
      expect(doc.body[0]?.count).toBe(0);
      expect(doc.body[0]?.values).toHaveLength(0);
    }
    roundtrip(data);
  });

  it('handles empty object', () => {
    roundtrip({ meta: {} });
  });

  it('handles empty string', () => {
    const data = { name: '' };
    roundtrip(data);
  });

  it('handles root empty object', () => {
    roundtrip({});
  });
});

// ===========================================================================
// 8. Type preservation — string "42" stays string, number 42 stays number
// ===========================================================================

describe('L1: type preservation', () => {
  it('preserves string "42" as quoted string (not number)', () => {
    const data = { id: '42' };
    const doc = compress(data);
    const kv = doc.body[0]!;
    if (kv.type === 'keyValue') {
      expect(kv.value.scalarType).toBe('string');
      expect(kv.value.value).toBe('42');
      if (kv.value.scalarType === 'string') {
        expect(kv.value.quoted).toBe(true);
      }
    }
    roundtrip(data);
  });

  it('preserves number 42 as number', () => {
    const data = { count: 42 };
    const doc = compress(data);
    if (doc.body[0]?.type === 'keyValue') {
      expect(doc.body[0]?.value.scalarType).toBe('number');
      expect(doc.body[0]?.value.value).toBe(42);
    }
    roundtrip(data);
  });

  it('preserves string "true" as quoted string', () => {
    const data = { flag: 'true' };
    const doc = compress(data);
    if (doc.body[0]?.type === 'keyValue') {
      const val = doc.body[0]?.value;
      expect(val.scalarType).toBe('string');
      if (val.scalarType === 'string') {
        expect(val.quoted).toBe(true);
      }
    }
    roundtrip(data);
  });

  it('preserves boolean true as boolean', () => {
    roundtrip({ active: true });
  });

  it('preserves string "false" as quoted string', () => {
    roundtrip({ flag: 'false' });
  });

  it('preserves string "null" as quoted string', () => {
    const data = { val: 'null' };
    const doc = compress(data);
    if (doc.body[0]?.type === 'keyValue') {
      const val = doc.body[0]?.value;
      expect(val.scalarType).toBe('string');
      if (val.scalarType === 'string') {
        expect(val.quoted).toBe(true);
      }
    }
    roundtrip(data);
  });

  it('preserves null as null', () => {
    roundtrip({ val: null });
  });

  it('preserves 0 as number', () => {
    roundtrip({ zero: 0 });
  });

  it('preserves negative numbers', () => {
    roundtrip({ offset: -1, temp: -3.14 });
  });

  it('preserves float numbers', () => {
    roundtrip({ price: 3.14, rate: 0.001 });
  });
});

// ===========================================================================
// 9. Special characters — colons, pipes, dollar signs, etc.
// ===========================================================================

describe('L1: special characters', () => {
  it('quotes strings containing colons', () => {
    const data = { msg: 'Error: timeout' };
    const doc = compress(data);
    if (doc.body[0]?.type === 'keyValue' && doc.body[0]?.value.scalarType === 'string') {
      expect(doc.body[0]?.value.quoted).toBe(true);
    }
    roundtrip(data);
  });

  it('quotes strings containing pipes', () => {
    const data = { formula: 'x|y' };
    const doc = compress(data);
    if (doc.body[0]?.type === 'keyValue' && doc.body[0]?.value.scalarType === 'string') {
      expect(doc.body[0]?.value.quoted).toBe(true);
    }
    roundtrip(data);
  });

  it('quotes strings starting with $', () => {
    const data = { ref: '$notAlias' };
    const doc = compress(data);
    if (doc.body[0]?.type === 'keyValue' && doc.body[0]?.value.scalarType === 'string') {
      expect(doc.body[0]?.value.quoted).toBe(true);
    }
    roundtrip(data);
  });

  it('quotes strings starting with %', () => {
    const data = { ref: '%notComment' };
    const doc = compress(data);
    if (doc.body[0]?.type === 'keyValue' && doc.body[0]?.value.scalarType === 'string') {
      expect(doc.body[0]?.value.quoted).toBe(true);
    }
    roundtrip(data);
  });

  it('quotes strings with leading spaces', () => {
    const data = { padded: '  indented' };
    const doc = compress(data);
    if (doc.body[0]?.type === 'keyValue' && doc.body[0]?.value.scalarType === 'string') {
      expect(doc.body[0]?.value.quoted).toBe(true);
    }
    roundtrip(data);
  });

  it('quotes strings with trailing spaces', () => {
    const data = { padded: 'value  ' };
    const doc = compress(data);
    if (doc.body[0]?.type === 'keyValue' && doc.body[0]?.value.scalarType === 'string') {
      expect(doc.body[0]?.value.quoted).toBe(true);
    }
    roundtrip(data);
  });

  it('quotes strings containing newlines', () => {
    const data = { msg: 'line one\nline two' };
    const doc = compress(data);
    if (doc.body[0]?.type === 'keyValue' && doc.body[0]?.value.scalarType === 'string') {
      expect(doc.body[0]?.value.quoted).toBe(true);
    }
    roundtrip(data);
  });

  it('quotes strings containing tabs', () => {
    const data = { msg: 'col1\tcol2' };
    roundtrip(data);
  });

  it('quotes strings containing double quotes', () => {
    const data = { msg: 'she said "hello"' };
    roundtrip(data);
  });

  it('quotes strings containing commas', () => {
    const data = { msg: 'hello, world' };
    roundtrip(data);
  });
});

// ===========================================================================
// 10. Roundtrip — THE critical test
// ===========================================================================

describe('L1: roundtrip (compressL1 -> decompressL1 -> deepEqual)', () => {
  it('roundtrips simple flat object', () => {
    roundtrip({ name: 'Sriinnu', age: 28, active: true, bio: null });
  });

  it('roundtrips deeply nested object', () => {
    roundtrip({
      company: {
        name: 'KaalaBrahma',
        founded: 2024,
        headquarters: {
          city: 'Hyderabad',
          country: 'India',
          coordinates: { lat: 17.385, lng: 78.4867 },
        },
        active: true,
      },
    });
  });

  it('roundtrips tabular arrays', () => {
    roundtrip({
      employees: [
        { id: 1, name: 'Alice', dept: 'Engineering', active: true },
        { id: 2, name: 'Bob', dept: 'Design', active: false },
        { id: 3, name: 'Carol', dept: 'Engineering', active: true },
      ],
    });
  });

  it('roundtrips inline arrays', () => {
    roundtrip({ tags: ['React', 'TypeScript', 'Rust'] });
    roundtrip({ scores: [95, 87, 92, 78, 88] });
    roundtrip({ flags: [true, false, true] });
  });

  it('roundtrips list arrays', () => {
    roundtrip({
      events: [
        { type: 'deploy', timestamp: '2026-02-17T10:30:00Z', success: true },
        { type: 'alert', message: 'CPU spike on node-3', severity: 'warning' },
        { type: 'config_change', field: 'max_connections', oldValue: 100, newValue: 200 },
      ],
    });
  });

  it('roundtrips the full mixed document from the spec', () => {
    roundtrip({
      apiVersion: 'v2',
      status: 'healthy',
      uptime: 99.97,
      server: {
        hostname: 'prod-east-1',
        region: 'us-east-1',
        tags: ['production', 'primary', 'monitored'],
      },
      services: [
        { name: 'auth', port: 8080, status: 'running', cpu: 23.5 },
        { name: 'api', port: 8081, status: 'running', cpu: 45.2 },
        { name: 'worker', port: 8082, status: 'degraded', cpu: 89.1 },
        { name: 'cache', port: 6379, status: 'running', cpu: 12.8 },
      ],
      alerts: [
        { type: 'warning', message: 'Worker CPU above 80%', timestamp: '2026-02-17T10:15:00Z' },
        { type: 'info', message: 'Scheduled maintenance in 2 hours' },
      ],
    });
  });

  it('roundtrips type-ambiguous values', () => {
    roundtrip({
      stringNum: '42',
      realNum: 42,
      stringBool: 'true',
      realBool: true,
      stringNull: 'null',
      realNull: null,
      stringZero: '0',
      realZero: 0,
      stringNeg: '-1',
      realNeg: -1,
    });
  });

  it('roundtrips special character values', () => {
    roundtrip({
      withColon: 'Error: connection refused',
      withPipe: 'x|y|z',
      withDollar: '$notAnAlias',
      withPercent: '%notAComment',
      withNewline: 'line one\nline two',
      withTab: 'col1\tcol2',
      withQuote: 'she said "hello"',
      leadingSpace: '  indented',
      trailingSpace: 'padded  ',
      withComma: 'hello, world',
    });
  });

  it('roundtrips root-level array of primitives', () => {
    roundtrip([1, 2, 3]);
  });

  it('roundtrips root-level array of objects (tabular)', () => {
    roundtrip([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]);
  });

  it('roundtrips root-level array of objects (list)', () => {
    roundtrip([{ a: 1, b: 2 }, { c: 3 }]);
  });

  it('roundtrips root-level primitive values', () => {
    roundtrip('hello');
    roundtrip(42);
    roundtrip(true);
    roundtrip(null);
  });

  it('roundtrips empty array', () => {
    roundtrip({ items: [] as unknown[] });
  });

  it('roundtrips Q1 Sales Summary from the spec', () => {
    roundtrip({
      report: {
        title: 'Q1 Sales Summary',
        generated: '2026-02-17',
        currency: 'USD',
      },
      regions: [
        { name: 'North America', revenue: 1250000, growth: 12.5, target_met: true },
        { name: 'Europe', revenue: 980000, growth: 8.3, target_met: true },
        { name: 'Asia Pacific', revenue: 750000, growth: 22.1, target_met: false },
        { name: 'Latin America', revenue: 320000, growth: 15.7, target_met: true },
      ],
      topProducts: ['Widget Pro', 'Gadget Max', 'Tool Suite'],
      notes: null,
    });
  });
});

// ===========================================================================
// 11. @from header
// ===========================================================================

describe('L1: @from header', () => {
  it('sets @from json', () => {
    const doc = compressL1({}, 'json');
    expect(doc.headers[0]?.value).toBe('json');
  });

  it('sets @from yaml', () => {
    const doc = compressL1({}, 'yaml');
    expect(doc.headers[0]?.value).toBe('yaml');
  });

  it('sets @from csv', () => {
    const doc = compressL1({}, 'csv');
    expect(doc.headers[0]?.value).toBe('csv');
  });
});

// ===========================================================================
// 12. Root-level arrays and primitives
// ===========================================================================

describe('L1: root-level non-object values', () => {
  it('wraps root array in _root key', () => {
    const doc = compress([1, 2, 3]);
    expect(doc.body).toHaveLength(1);
    expect(doc.body[0]?.type).toBe('inlineArray');
    if (doc.body[0]?.type === 'inlineArray') {
      expect(doc.body[0]?.key).toBe('_root');
    }
  });

  it('wraps root primitive in _value key', () => {
    const doc = compress('hello');
    expect(doc.body).toHaveLength(1);
    expect(doc.body[0]?.type).toBe('keyValue');
    if (doc.body[0]?.type === 'keyValue') {
      expect(doc.body[0]?.key).toBe('_value');
    }
  });

  it('decompressL1 unwraps _root array', () => {
    const doc = compress([1, 2, 3]);
    const result = decompressL1(doc.body);
    expect(result).toEqual([1, 2, 3]);
  });

  it('decompressL1 unwraps _value primitive', () => {
    const doc = compress('hello');
    const result = decompressL1(doc.body);
    expect(result).toBe('hello');
  });

  it('decompressL1 returns empty object for empty body', () => {
    const result = decompressL1([]);
    expect(result).toEqual({});
  });
});

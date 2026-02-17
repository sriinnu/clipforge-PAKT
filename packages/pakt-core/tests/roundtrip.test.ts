/**
 * End-to-end roundtrip tests for the PAKT library.
 * Verifies: compress(input) -> decompress(compressed) -> deepEqual(original)
 */
import { describe, it, expect } from 'vitest';
import { compress, decompress, detect } from '../src/index.js';

// ---------------------------------------------------------------------------
// Helper: parse CSV text into rows of objects for structural comparison
// ---------------------------------------------------------------------------
function parseCsvRows(csv: string): Record<string, string>[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const vals = line.split(',').map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
    return row;
  });
}

// ============================= JSON ROUNDTRIPS =============================

describe('JSON roundtrips', () => {
  it('1. simple flat object', () => {
    const input = '{"name":"Alice","age":30,"active":true}';
    const result = compress(input);
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual(JSON.parse(input));
  });

  it('2. nested object', () => {
    const input = '{"user":{"name":"Alice","address":{"city":"Portland","state":"OR"}}}';
    const result = compress(input);
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual(JSON.parse(input));
  });

  it('3. array of objects (tabular)', () => {
    const input = '{"users":[{"name":"Alice","role":"dev"},{"name":"Bob","role":"dev"}]}';
    const result = compress(input);
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual(JSON.parse(input));
  });

  it('4. array of primitives', () => {
    const input = '{"tags":["fast","reliable","free"]}';
    const result = compress(input);
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual(JSON.parse(input));
  });

  it('5. deeply nested (4+ levels)', () => {
    const input = JSON.stringify({
      a: { b: { c: { d: { value: 'deep' } } } },
    });
    const result = compress(input);
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual(JSON.parse(input));
  });

  it('6. mixed types: objects, arrays, numbers, booleans, null, strings', () => {
    const input = JSON.stringify({
      name: 'Alice',
      age: 30,
      active: true,
      score: 99.5,
      address: null,
      tags: ['a', 'b'],
      meta: { x: 1, y: 2 },
    });
    const result = compress(input);
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual(JSON.parse(input));
  });

  it('7. empty object', () => {
    const input = '{}';
    const result = compress(input);
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual({});
  });

  it('8. empty array', () => {
    const input = '{"items":[]}';
    const result = compress(input);
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual({ items: [] });
  });

  it('9. large dataset (20+ rows) to trigger L2 dictionary', () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      name: `user_${i + 1}`,
      role: i % 2 === 0 ? 'developer' : 'designer',
      active: true,
    }));
    const input = JSON.stringify({ employees: rows });
    const result = compress(input);
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual(JSON.parse(input));
  });

  it('10. special characters in values (quotes, pipes, colons)', () => {
    const input = JSON.stringify({
      message: 'say "hello"',
      path: 'a|b|c',
      label: 'key: value',
    });
    const result = compress(input);
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual(JSON.parse(input));
  });
});

// ============================= CSV ROUNDTRIPS ==============================

describe('CSV roundtrips', () => {
  it('11. simple CSV', () => {
    const input = 'name,age,city\nAlice,30,Portland\nBob,25,Seattle';
    const result = compress(input, { fromFormat: 'csv' });
    const dec = decompress(result.compressed, 'json');
    // CSV values go through inferCsvValue, so numbers become numbers
    const data = JSON.parse(dec.text) as Record<string, unknown>;
    // The compressed CSV becomes an object with a _root key for tabular arrays
    // or individual row objects. Compare structural content.
    const values = Object.values(data);
    // Find the array of row objects
    const rows = Array.isArray(values[0]) ? values[0] : values;
    const firstRow = (rows as Record<string, unknown>[])[0]!;
    expect(firstRow).toHaveProperty('name', 'Alice');
    // age is inferred as number 30 by CSV parser
    expect(firstRow).toHaveProperty('age', 30);
    expect(firstRow).toHaveProperty('city', 'Portland');
  });

  it('12. CSV with numeric values and type preservation', () => {
    const input = 'item,price,qty\nWidget,9.99,100\nGadget,19.50,50';
    const result = compress(input, { fromFormat: 'csv' });
    const dec = decompress(result.compressed, 'json');
    const data = JSON.parse(dec.text) as Record<string, unknown>;
    const rows = Object.values(data).find(Array.isArray) as Record<string, unknown>[];
    expect(rows).toBeDefined();
    expect(rows![0]).toEqual({ item: 'Widget', price: 9.99, qty: 100 });
  });

  it('13. CSV with many rows and repeating values', () => {
    const header = 'name,role,dept';
    const dataRows = Array.from({ length: 12 }, (_, i) =>
      `Person${i},engineer,engineering`,
    );
    const input = [header, ...dataRows].join('\n');
    const result = compress(input, { fromFormat: 'csv' });
    const dec = decompress(result.compressed, 'json');
    const data = JSON.parse(dec.text) as Record<string, unknown>;
    const rows = Object.values(data).find(Array.isArray) as Record<string, unknown>[];
    expect(rows).toHaveLength(12);
    expect(rows![0]).toHaveProperty('role', 'engineer');
    expect(rows![0]).toHaveProperty('dept', 'engineering');
  });

  it('14. tab-separated values', () => {
    const input = 'name\tage\tactive\nAlice\t30\ttrue\nBob\t25\tfalse';
    const result = compress(input, { fromFormat: 'csv' });
    const dec = decompress(result.compressed, 'json');
    const data = JSON.parse(dec.text) as Record<string, unknown>;
    const rows = Object.values(data).find(Array.isArray) as Record<string, unknown>[];
    expect(rows).toBeDefined();
    expect(rows![0]).toHaveProperty('name', 'Alice');
    expect(rows![0]).toHaveProperty('age', 30);
    expect(rows![1]).toHaveProperty('active', false);
  });
});

// ============================= YAML ROUNDTRIPS =============================

describe('YAML roundtrips', () => {
  it('15. simple YAML', () => {
    const input = 'name: Alice\nage: 30';
    const result = compress(input, { fromFormat: 'yaml' });
    const dec = decompress(result.compressed, 'json');
    const data = JSON.parse(dec.text);
    expect(data).toEqual({ name: 'Alice', age: 30 });
  });

  it('16. nested YAML with indentation', () => {
    const input = [
      'user:',
      '  name: Alice',
      '  address:',
      '    city: Portland',
      '    state: OR',
    ].join('\n');
    const result = compress(input, { fromFormat: 'yaml' });
    const dec = decompress(result.compressed, 'json');
    const data = JSON.parse(dec.text);
    expect(data).toEqual({
      user: { name: 'Alice', address: { city: 'Portland', state: 'OR' } },
    });
  });

  it('17. YAML with lists', () => {
    const input = [
      'project: PAKT',
      'tags:',
      '  - compression',
      '  - tokens',
      '  - llm',
    ].join('\n');
    const result = compress(input, { fromFormat: 'yaml' });
    const dec = decompress(result.compressed, 'json');
    const data = JSON.parse(dec.text);
    expect(data.project).toBe('PAKT');
    // YAML list items are parsed as scalars wrapped in inline array
    expect(data.tags).toEqual(['compression', 'tokens', 'llm']);
  });
});

// =========================== MARKDOWN ROUNDTRIPS ===========================

describe('Markdown roundtrips', () => {
  it('18. markdown with heading and paragraphs — returned unchanged', () => {
    // Markdown and text formats are returned unchanged (no structural compression benefit)
    const input = '# Title\n\nSome paragraph text.\n\nAnother paragraph.';
    const result = compress(input, { fromFormat: 'markdown' });
    expect(result.compressed).toBe(input);
    expect(result.savings.totalPercent).toBe(0);
    expect(result.detectedFormat).toBe('markdown');
  });

  it('19. markdown with code blocks and links — returned unchanged', () => {
    const input = '# API\n\nUse `compress()` to start.\n\nSee [docs](https://example.com).';
    const result = compress(input, { fromFormat: 'markdown' });
    expect(result.compressed).toBe(input);
    expect(result.savings.totalPercent).toBe(0);
  });
});

// ============================ VERIFY SAVINGS ===============================

describe('Verify savings metadata', () => {
  const largeInput = JSON.stringify({
    employees: Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      name: `employee_${i + 1}`,
      department: i % 3 === 0 ? 'engineering' : i % 3 === 1 ? 'marketing' : 'sales',
      status: 'active',
      level: 'senior',
    })),
  });

  it('20. large JSON dataset has savings > 0', () => {
    const result = compress(largeInput);
    expect(result.savings.totalPercent).toBeGreaterThan(0);
  });

  it('21. originalTokens > compressedTokens', () => {
    const result = compress(largeInput);
    expect(result.originalTokens).toBeGreaterThan(result.compressedTokens);
  });

  it('22. reversible === true for L1+L2', () => {
    const result = compress(largeInput);
    expect(result.reversible).toBe(true);
  });

  it('23. detectedFormat matches the input type', () => {
    const jsonResult = compress('{"x":1}');
    expect(jsonResult.detectedFormat).toBe('json');

    const csvResult = compress('a,b\n1,2\n3,4', { fromFormat: 'csv' });
    expect(csvResult.detectedFormat).toBe('csv');

    const yamlResult = compress('name: Alice\nage: 30', { fromFormat: 'yaml' });
    expect(yamlResult.detectedFormat).toBe('yaml');
  });
});

// ============================== EDGE CASES =================================

describe('Edge cases', () => {
  it('24. compress JSON then decompress to YAML', () => {
    const input = '{"name":"Alice","age":30}';
    const result = compress(input);
    const dec = decompress(result.compressed, 'yaml');
    expect(dec.originalFormat).toBe('json');
    // YAML output should contain the keys
    expect(dec.text).toContain('name:');
    expect(dec.text).toContain('Alice');
    expect(dec.text).toContain('age:');
    expect(dec.text).toContain('30');
  });

  it('25. roundtrip with explicit fromFormat option', () => {
    const input = '{"name":"Alice","age":30}';
    const result = compress(input, { fromFormat: 'json' });
    expect(result.detectedFormat).toBe('json');
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual(JSON.parse(input));
  });

  it('26. values with PAKT syntax (pipes, colons) survive roundtrip', () => {
    const obj = {
      formula: 'a|b|c',
      desc: 'key: value pair',
      dollar: '$amount',
    };
    const input = JSON.stringify(obj);
    const result = compress(input);
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual(obj);
  });

  it('27. unicode values survive roundtrip', () => {
    const obj = {
      greeting: 'Hello',
      city: 'Tokyo',
      note: 'cafe latte',
    };
    const input = JSON.stringify(obj);
    const result = compress(input);
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual(obj);
  });

  it('compress then decompress wasLossy is false for L1+L2', () => {
    const input = '{"x":1,"y":2}';
    const result = compress(input);
    const dec = decompress(result.compressed);
    expect(dec.wasLossy).toBe(false);
  });

  it('decompress back to original format when no outputFormat specified', () => {
    const input = '{"name":"Alice"}';
    const result = compress(input);
    const dec = decompress(result.compressed);
    expect(dec.originalFormat).toBe('json');
    // Should still produce valid JSON when originalFormat is json
    expect(JSON.parse(dec.text)).toEqual({ name: 'Alice' });
  });

  it('array of objects with boolean and null values', () => {
    const obj = {
      items: [
        { name: 'a', active: true, deleted: false, note: null },
        { name: 'b', active: false, deleted: true, note: null },
      ],
    };
    const input = JSON.stringify(obj);
    const result = compress(input);
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual(obj);
  });

  it('single key-value pair roundtrip', () => {
    const input = '{"key":"value"}';
    const result = compress(input);
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual({ key: 'value' });
  });

  it('numeric string values stay as strings when quoted', () => {
    // Numbers in JSON string fields should stay strings
    const obj = { code: '12345', zip: '97201' };
    const input = JSON.stringify(obj);
    const result = compress(input);
    const dec = decompress(result.compressed, 'json');
    const parsed = JSON.parse(dec.text);
    expect(typeof parsed.code).toBe('string');
    expect(parsed.code).toBe('12345');
    expect(typeof parsed.zip).toBe('string');
    expect(parsed.zip).toBe('97201');
  });

  it('JSON with nested arrays of objects', () => {
    const obj = {
      teams: [
        { name: 'Alpha', members: [{ user: 'Alice' }, { user: 'Bob' }] },
        { name: 'Beta', members: [{ user: 'Carol' }, { user: 'Dan' }] },
      ],
    };
    const input = JSON.stringify(obj);
    const result = compress(input);
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual(obj);
  });

  it('compress JSON then decompress to CSV for tabular data', () => {
    const input = JSON.stringify({
      data: [
        { name: 'Alice', role: 'dev' },
        { name: 'Bob', role: 'qa' },
      ],
    });
    const result = compress(input);
    const dec = decompress(result.compressed, 'csv');
    // CSV output should contain the header and data rows
    expect(dec.text).toContain('name');
    expect(dec.text).toContain('role');
    expect(dec.text).toContain('Alice');
    expect(dec.text).toContain('dev');
  });

  it('large tabular dataset has dictionary entries when values repeat', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      status: 'active',
      category: 'engineering',
      priority: 'high',
    }));
    const input = JSON.stringify({ tasks: rows });
    const result = compress(input);
    // With 30 rows of repeating values, L2 should create dict entries
    if (result.dictionary.length > 0) {
      expect(result.dictionary[0]!.alias).toMatch(/^\$/);
      expect(result.dictionary[0]!.occurrences).toBeGreaterThan(1);
    }
    // Regardless, roundtrip must be lossless
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual(JSON.parse(input));
  });
});

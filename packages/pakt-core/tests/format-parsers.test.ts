/**
 * @module tests/format-parsers
 * Tests for format-parsers: stripJsonComments, parseInput dispatcher,
 * YAML parser (scalars, objects, lists, nested), and CSV parser
 * (delimiter detection, quoted fields, type inference).
 */
import { describe, it, expect } from 'vitest';
import {
  stripJsonComments, parseInput, parseYaml, yamlScalar,
  parseCsv, splitCsvLine, detectCsvDelimiter, inferCsvValue,
} from '../src/format-parsers/index.js';

// ── 1. stripJsonComments ────────────────────────────────────────────────────

describe('stripJsonComments', () => {
  it('strips single-line // comments', () => {
    const out = stripJsonComments('{\n  "a": 1 // inline comment\n}');
    expect(JSON.parse(out)).toEqual({ a: 1 });
  });

  it('strips standalone // comment lines', () => {
    const out = stripJsonComments('// top comment\n{"key": "value"}');
    expect(JSON.parse(out)).toEqual({ key: 'value' });
  });

  it('strips block /* */ comments', () => {
    const out = stripJsonComments('{"a": /* block */ 1}');
    expect(JSON.parse(out)).toEqual({ a: 1 });
  });

  it('strips multi-line block comments', () => {
    const out = stripJsonComments('{\n  /* this\n     spans\n     lines */\n  "x": 42\n}');
    expect(JSON.parse(out)).toEqual({ x: 42 });
  });

  it('does NOT strip // inside string values', () => {
    const out = stripJsonComments('{"url": "http://example.com"}');
    expect(JSON.parse(out)).toEqual({ url: 'http://example.com' });
  });

  it('preserves // and /* */ inside double-quoted strings', () => {
    expect(JSON.parse(stripJsonComments('{"a": "see // this"}'))).toEqual({ a: 'see // this' });
    expect(JSON.parse(stripJsonComments('{"a": "x /* y */ z"}'))).toEqual({ a: 'x /* y */ z' });
  });

  it('handles escaped quotes inside strings', () => {
    const out = stripJsonComments('{"msg": "say \\"hello\\""}');
    expect(JSON.parse(out)).toEqual({ msg: 'say "hello"' });
  });

  it('returns empty string for empty input', () => {
    expect(stripJsonComments('')).toBe('');
  });

  it('handles input with only comments', () => {
    expect(stripJsonComments('// comment\n/* block */').trim()).toBe('');
  });

  it('handles a slash that is not a comment start', () => {
    const out = stripJsonComments('{"path": "/usr/bin"}');
    expect(JSON.parse(out)).toEqual({ path: '/usr/bin' });
  });
});

// ── 2. parseInput — JSON ────────────────────────────────────────────────────

describe('parseInput — JSON', () => {
  it('parses valid JSON object and array', () => {
    expect(parseInput('{"name":"Alice","age":30}', 'json')).toEqual({ name: 'Alice', age: 30 });
    expect(parseInput('[1, 2, 3]', 'json')).toEqual([1, 2, 3]);
  });

  it('parses JSONC with // and block comments via fallback', () => {
    expect(parseInput('{\n  // greeting\n  "hello": "world"\n}', 'json'))
      .toEqual({ hello: 'world' });
    expect(parseInput('{"a": /* val */ 1}', 'json')).toEqual({ a: 1 });
  });

  it('throws on invalid JSON', () => {
    expect(() => parseInput('{invalid json}', 'json')).toThrow();
    expect(() => parseInput('not json at all', 'json')).toThrow();
  });
});

// ── 3. parseInput — YAML ────────────────────────────────────────────────────

describe('parseInput — YAML', () => {
  it('parses a simple key-value object', () => {
    expect(parseInput('name: Alice\nage: 30', 'yaml')).toEqual({ name: 'Alice', age: 30 });
  });

  it('parses nested objects', () => {
    expect(parseInput('user:\n  name: Bob\n  role: admin', 'yaml'))
      .toEqual({ user: { name: 'Bob', role: 'admin' } });
  });

  it('parses a simple list', () => {
    expect(parseInput('- apple\n- banana\n- cherry', 'yaml'))
      .toEqual(['apple', 'banana', 'cherry']);
  });

  it('parses mixed structures (list of objects)', () => {
    expect(parseInput('- name: Alice\n  age: 30\n- name: Bob\n  age: 25', 'yaml'))
      .toEqual([{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }]);
  });
});

// ── 4. parseInput — CSV ─────────────────────────────────────────────────────

describe('parseInput — CSV', () => {
  it('parses headers + data rows with comma delimiter', () => {
    expect(parseInput('name,age\nAlice,30\nBob,25', 'csv'))
      .toEqual([{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }]);
  });

  it('auto-detects tab delimiter', () => {
    expect(parseInput('name\tage\nAlice\t30\nBob\t25', 'csv'))
      .toEqual([{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }]);
  });

  it('auto-detects semicolon delimiter', () => {
    expect(parseInput('name;age\nAlice;30\nBob;25', 'csv'))
      .toEqual([{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }]);
  });
});

// ── 5. parseInput — passthrough formats ─────────────────────────────────────

describe('parseInput — passthrough formats', () => {
  it('markdown returns { _markdown: input }', () => {
    const md = '# Hello\n\nSome **bold** text';
    expect(parseInput(md, 'markdown')).toEqual({ _markdown: md });
  });

  it('text returns { _text: input }', () => {
    expect(parseInput('plain text', 'text')).toEqual({ _text: 'plain text' });
  });

  it('pakt returns { _pakt: input }', () => {
    expect(parseInput('PAKT payload', 'pakt')).toEqual({ _pakt: 'PAKT payload' });
  });

  it('passthrough preserves empty strings', () => {
    expect(parseInput('', 'markdown')).toEqual({ _markdown: '' });
    expect(parseInput('', 'text')).toEqual({ _text: '' });
    expect(parseInput('', 'pakt')).toEqual({ _pakt: '' });
  });
});

// ── 6. YAML edge cases ─────────────────────────────────────────────────────

describe('YAML edge cases', () => {
  it('returns null for empty / whitespace-only / comment-only input', () => {
    expect(parseYaml('')).toBeNull();
    expect(parseYaml('   \n  \n  ')).toBeNull();
    expect(parseYaml('# just a comment\n# another one')).toBeNull();
  });

  it('strips --- and ... document markers', () => {
    expect(parseYaml('---\nname: Alice\n...')).toEqual({ name: 'Alice' });
  });

  it('parses nested lists under object keys', () => {
    expect(parseYaml('fruits:\n  - apple\n  - banana\n  - cherry'))
      .toEqual({ fruits: ['apple', 'banana', 'cherry'] });
  });

  it('parses deeply nested structures', () => {
    const input = 'server:\n  host: localhost\n  port: 8080\n  db:\n    name: mydb\n    pool: 5';
    expect(parseYaml(input)).toEqual({
      server: { host: 'localhost', port: 8080, db: { name: 'mydb', pool: 5 } },
    });
  });

  it('handles list items with nested objects (kv on item line)', () => {
    expect(parseYaml('- id: 1\n  name: Alice\n- id: 2\n  name: Bob'))
      .toEqual([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]);
  });
});

// ── 6b. yamlScalar — type inference ─────────────────────────────────────────

describe('yamlScalar', () => {
  it('parses null variants (null, ~, empty)', () => {
    expect(yamlScalar('null')).toBeNull();
    expect(yamlScalar('~')).toBeNull();
    expect(yamlScalar('')).toBeNull();
  });

  it('parses booleans', () => {
    expect(yamlScalar('true')).toBe(true);
    expect(yamlScalar('false')).toBe(false);
  });

  it('parses integers and floats', () => {
    expect(yamlScalar('42')).toBe(42);
    expect(yamlScalar('0')).toBe(0);
    expect(yamlScalar('-7')).toBe(-7);
    expect(yamlScalar('3.14')).toBe(3.14);
    expect(yamlScalar('-0.5')).toBe(-0.5);
  });

  it('parses scientific notation', () => {
    expect(yamlScalar('1e10')).toBe(1e10);
    expect(yamlScalar('2.5E-3')).toBe(2.5e-3);
  });

  it('strips double-quoted and single-quoted strings', () => {
    expect(yamlScalar('"hello world"')).toBe('hello world');
    expect(yamlScalar("'hello world'")).toBe('hello world');
  });

  it('returns plain strings as-is', () => {
    expect(yamlScalar('hello')).toBe('hello');
    expect(yamlScalar('some long text')).toBe('some long text');
  });

  it('trims whitespace before inference', () => {
    expect(yamlScalar('  42  ')).toBe(42);
    expect(yamlScalar('  true  ')).toBe(true);
    expect(yamlScalar('  null  ')).toBeNull();
  });
});

// ── 7. CSV edge cases ───────────────────────────────────────────────────────

describe('CSV edge cases', () => {
  it('returns { _line: ... } for single-row (header-only) input', () => {
    expect(parseCsv('name,age')).toEqual([{ _line: 'name,age' }]);
  });

  it('returns empty array for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('handles quoted fields with commas inside', () => {
    expect(parseCsv('name,city\n"Smith, John","New York, NY"'))
      .toEqual([{ name: 'Smith, John', city: 'New York, NY' }]);
  });

  it('handles quoted fields with escaped double quotes', () => {
    expect(parseCsv('name,quote\nAlice,"She said ""hello"""\n'))
      .toEqual([{ name: 'Alice', quote: 'She said "hello"' }]);
  });

  it('handles blank lines in input (filtered out)', () => {
    expect(parseCsv('name,age\n\nAlice,30\n\nBob,25\n'))
      .toEqual([{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }]);
  });
});

// ── 7b. inferCsvValue — type inference ──────────────────────────────────────

describe('inferCsvValue', () => {
  it('infers null from "null" and "NULL"', () => {
    expect(inferCsvValue('null')).toBeNull();
    expect(inferCsvValue('NULL')).toBeNull();
  });

  it('infers booleans (case variants)', () => {
    expect(inferCsvValue('true')).toBe(true);
    expect(inferCsvValue('TRUE')).toBe(true);
    expect(inferCsvValue('false')).toBe(false);
    expect(inferCsvValue('FALSE')).toBe(false);
  });

  it('infers integers and floats', () => {
    expect(inferCsvValue('42')).toBe(42);
    expect(inferCsvValue('0')).toBe(0);
    expect(inferCsvValue('-3')).toBe(-3);
    expect(inferCsvValue('3.14')).toBe(3.14);
    expect(inferCsvValue('-0.5')).toBe(-0.5);
  });

  it('returns empty string for empty input', () => {
    expect(inferCsvValue('')).toBe('');
  });

  it('returns plain strings for non-numeric text', () => {
    expect(inferCsvValue('Alice')).toBe('Alice');
    expect(inferCsvValue('hello world')).toBe('hello world');
  });
});

// ── 7c. splitCsvLine ────────────────────────────────────────────────────────

describe('splitCsvLine', () => {
  it('splits comma-delimited and tab-delimited fields', () => {
    expect(splitCsvLine('a,b,c', ',')).toEqual(['a', 'b', 'c']);
    expect(splitCsvLine('a\tb\tc', '\t')).toEqual(['a', 'b', 'c']);
  });

  it('handles quoted fields with delimiter inside', () => {
    expect(splitCsvLine('"a,b",c', ',')).toEqual(['a,b', 'c']);
  });

  it('handles escaped double-quotes inside quoted fields', () => {
    expect(splitCsvLine('"say ""hi""",ok', ',')).toEqual(['say "hi"', 'ok']);
  });

  it('trims whitespace from fields', () => {
    expect(splitCsvLine(' a , b , c ', ',')).toEqual(['a', 'b', 'c']);
  });
});

// ── 7d. detectCsvDelimiter ──────────────────────────────────────────────────

describe('detectCsvDelimiter', () => {
  it('detects comma delimiter', () => {
    expect(detectCsvDelimiter(['name,age,city', 'Alice,30,NY', 'Bob,25,LA'])).toBe(',');
  });

  it('detects tab delimiter', () => {
    expect(detectCsvDelimiter(['name\tage\tcity', 'Alice\t30\tNY', 'Bob\t25\tLA'])).toBe('\t');
  });

  it('detects semicolon delimiter', () => {
    expect(detectCsvDelimiter(['name;age;city', 'Alice;30;NY', 'Bob;25;LA'])).toBe(';');
  });

  it('prefers the most consistent delimiter', () => {
    expect(detectCsvDelimiter(['a,b,c', '1,2,3', '4,5,6'])).toBe(',');
  });
});

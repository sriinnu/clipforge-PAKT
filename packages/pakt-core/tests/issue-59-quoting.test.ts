/**
 * @module tests/issue-59-quoting
 * Regression tests for issue #59: JSON round-trip corrupted quoted
 * inline-array items and keys / tabular cells containing PAKT delimiters.
 */

import { describe, expect, it } from 'vitest';
import { compress } from '../src/compress.js';
import { decompress } from '../src/decompress.js';
import { repair } from '../src/utils/repair.js';
import { validate } from '../src/utils/validate.js';

const roundtrip = (value: unknown): unknown =>
  JSON.parse(decompress(compress(JSON.stringify(value)).compressed, 'json').text);

describe('issue #59: round-trip with delimiters', () => {
  it.each([
    [['ok', 'hello, world']],
    [['local', 'https://example.com']],
    [[1, '1']],
    [['1', 1]],
    [['ok', 'x y', '"q"', 'a\\"b']],
    [['"lead"', 'x y', 'a,b']],
    [[true, 'true', null, 'null']],
  ])('inline array %j', (arr) => {
    expect(roundtrip(arr)).toEqual(arr);
    expect(roundtrip({ k: arr })).toEqual({ k: arr });
  });

  it.each([
    'a]',
    'a[',
    'a,b',
    'x{',
    'x}',
    'a:b',
    'a|b',
    'a%',
    '%a',
    'a b',
    '\\"',
    '\\\\',
    '1',
    '42',
  ])('object key %j', (key) => {
    const obj = { [key]: 1, b: 2 };
    expect(roundtrip(obj)).toEqual(obj);
    expect(roundtrip({ o: { [key]: [1, 2] } })).toEqual({ o: { [key]: [1, 2] } });
  });

  it.each(['a[', 'a]', 'a{', 'a}', 'a,b', 'a%', 'a|b'])('tabular cell and field %j', (s) => {
    const rows = [
      { [s]: s, n: 1 },
      { [s]: 'y', n: 2 },
    ];
    expect(roundtrip(rows)).toEqual(rows);
  });
});

describe('issue #59: validate/repair count quoted commas correctly', () => {
  const doc = compress(JSON.stringify({ a: ['ok', 'hello, world', 'x'] })).compressed;

  it('validate accepts a quoted comma inside an inline array', () => {
    expect(validate(doc).errors).toEqual([]);
  });

  it('repair leaves a correct inline count untouched', () => {
    expect(repair(doc)).toBe(doc);
  });
});

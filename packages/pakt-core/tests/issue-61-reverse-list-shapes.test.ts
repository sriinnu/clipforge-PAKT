/**
 * Regression for the type error `tsc` flagged in #61: since #59, list items
 * may be primitives or arrays, but the YAML / Markdown reverse emitters
 * treated every item as an object (`"alpha"` became `0: a, 1: l, ...`, and
 * numbers vanished).
 */
import { describe, expect, it } from 'vitest';
import { compress, decompress } from '../src/index.js';
import type { DocumentNode } from '../src/parser/ast.js';
import { type PaktParseError, parse } from '../src/parser/parser.js';

const data = {
  tags: ['alpha', 'beta', 42, null, {}, { a: 1, n: { b: [1, 'x: y'] } }, [1, 2]],
};
const pakt = compress(JSON.stringify(data), { fromFormat: 'json' }).compressed;

describe('reverse emitters: mixed list item shapes (#61)', () => {
  it('YAML emits each element as itself', () => {
    expect(decompress(pakt, 'yaml').text).toBe(
      [
        'tags:',
        '  - alpha',
        '  - beta',
        '  - 42',
        '  - null',
        '  - {}',
        '  - a: 1',
        '    n: {b: [1, "x: y"]}',
        '  - [1, 2]',
        '',
      ].join('\n'),
    );
  });

  it('Markdown never splits a string into characters', () => {
    const md = decompress(pakt, 'markdown').text;
    expect(md).toContain('- alpha\n- beta\n- 42\n');
    expect(md).toContain('- `[1,2]`');
    expect(md).not.toMatch(/\*\*0\*\*/);
  });
});

describe('parser: malformed `- {` sentinel reports a real position (#61)', () => {
  const bad = 'items [1]:\n  - { x\n';

  it('strict mode throws with numeric line:column', () => {
    expect(() => parse(bad, 'strict')).toThrow(/Parse error at 2:\d+ — Expected `}`/);
  });

  it('lenient mode records line and column as numbers', () => {
    const doc = parse(bad, 'lenient') as DocumentNode & { errors?: PaktParseError[] };
    const err = doc.errors?.find((e) => e.message.includes('empty-object sentinel'));
    expect(err?.line).toBe(2);
    expect(typeof err?.column).toBe('number');
  });
});

/**
 * @module tests/L1-delta-sentinel-fuzz
 * Exhaustive fuzz tests for the `~` delta-encoding sentinel.
 *
 * The `~` character is the sentinel used by L1 delta-encoding
 * ({@link packages/pakt-core/src/layers/L1-delta.ts}) to indicate
 * "value unchanged from previous row". Any literal `~` appearing in
 * user data must survive a compress/decompress roundtrip byte-exactly.
 *
 * These tests probe placement of `~` at every structurally interesting
 * position — start, middle, end, adjacent to PAKT delimiters, inside
 * keys vs values, quoted vs bare, and across tabular columns where the
 * sentinel semantics collide with literal data.
 *
 * The assertion shape is always:
 *   JSON.parse(decompress(compress(JSON.stringify(data))).text) deep-equals data
 *
 * If a case fails, it is marked `.fails()` with a comment describing the
 * observed break — the fix must land under user signoff, not silently.
 */

import { describe, expect, it } from 'vitest';
import { compress } from '../src/compress.js';
import { decompress } from '../src/decompress.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a JSON value through compress → decompress and assert byte-exact
 * roundtrip when parsed back. Uses deep-equality (toEqual) because the
 * serialized text may differ in key ordering or whitespace.
 */
function roundtrip(data: unknown, label: string): void {
  const text = JSON.stringify(data);
  const compressed = compress(text);
  const decompressed = decompress(compressed.compressed, 'json');
  const parsed = JSON.parse(decompressed.text);
  expect(parsed, `roundtrip mismatch: ${label}`).toEqual(data);
}

// ===========================================================================
// 1. `~` at start of value (scalars inside an object)
// ===========================================================================

describe('sentinel fuzz: ~ at start of value', () => {
  const cases: Array<[string, unknown]> = [
    ['"~hello"', { msg: '~hello' }],
    ['sole "~"', { msg: '~' }],
    ['"~ "', { msg: '~ ' }],
    ['"~x~"', { msg: '~x~' }],
    ['"~~"', { msg: '~~' }],
    ['"~\\n"', { msg: '~\n' }],
  ];
  for (const [label, data] of cases) {
    it(`roundtrips ${label}`, () => roundtrip(data, label));
  }
});

// ===========================================================================
// 2. `~` at end of value
// ===========================================================================

describe('sentinel fuzz: ~ at end of value', () => {
  const cases: Array<[string, unknown]> = [
    ['"hello~"', { msg: 'hello~' }],
    ['"hello ~"', { msg: 'hello ~' }],
    ['"a ~"', { msg: 'a ~' }],
    ['" ~"', { msg: ' ~' }],
  ];
  for (const [label, data] of cases) {
    it(`roundtrips ${label}`, () => roundtrip(data, label));
  }
});

// ===========================================================================
// 3. `~` in the middle of a value
// ===========================================================================

describe('sentinel fuzz: ~ in the middle of value', () => {
  const cases: Array<[string, unknown]> = [
    ['"a~b"', { msg: 'a~b' }],
    ['"a ~ b"', { msg: 'a ~ b' }],
    ['"x~y~z"', { msg: 'x~y~z' }],
    ['"before~after"', { msg: 'before~after' }],
  ];
  for (const [label, data] of cases) {
    it(`roundtrips ${label}`, () => roundtrip(data, label));
  }
});

// ===========================================================================
// 4. `~` adjacent to PAKT delimiters inside the original string
//    (`|` for tabular separator, `:` for key/value, `,` for inline arrays)
// ===========================================================================

describe('sentinel fuzz: ~ adjacent to delimiter-like characters', () => {
  const cases: Array<[string, unknown]> = [
    ['"|~"', { msg: '|~' }],
    ['"~|"', { msg: '~|' }],
    ['":~"', { msg: ':~' }],
    ['"~:"', { msg: '~:' }],
    ['",~"', { msg: ',~' }],
    ['"~,"', { msg: '~,' }],
    ['"|~|"', { msg: '|~|' }],
    ['"a|~|b"', { msg: 'a|~|b' }],
    ['"~:~"', { msg: '~:~' }],
  ];
  for (const [label, data] of cases) {
    it(`roundtrips ${label}`, () => roundtrip(data, label));
  }
});

// ===========================================================================
// 5. `~` inside JSON object keys
// ===========================================================================

describe('sentinel fuzz: ~ inside keys', () => {
  it('key equals "~"', () => roundtrip({ '~': 'value' }, 'key=~'));
  it('key starts with ~', () => roundtrip({ '~key': 1 }, 'key=~key'));
  it('key ends with ~', () => roundtrip({ 'key~': 1 }, 'key=key~'));
  it('key has ~ in middle', () => roundtrip({ 'a~b': 1 }, 'key=a~b'));
  it('multiple keys with ~', () =>
    roundtrip({ '~a': 1, 'b~': 2, 'c~d': 3, '~': 4 }, 'many-~-keys'));
});

// ===========================================================================
// 6. Tabular arrays where every row has the literal `~` value
//    — delta encoding would APPLY (all rows match row 0) but the values
//    themselves are the sentinel. Without force-quoting, every row after
//    the first would decode to the row-0 value (identical) which is
//    semantically equal but relies on correct sentinel-vs-literal tracking.
// ===========================================================================

describe('sentinel fuzz: tabular column where every row is literal ~', () => {
  it('all rows have status = "~"', () =>
    roundtrip(
      [
        { status: '~', name: 'Alice' },
        { status: '~', name: 'Bob' },
        { status: '~', name: 'Carol' },
        { status: '~', name: 'Dave' },
      ],
      'all-~',
    ));

  it('all rows have both fields = "~"', () =>
    roundtrip(
      [
        { a: '~', b: '~' },
        { a: '~', b: '~' },
        { a: '~', b: '~' },
      ],
      'all-~-both',
    ));
});

// ===========================================================================
// 7. Mixed: one row has literal `~`, another has value different from
//    previous row — the classic sentinel-ambiguity test.
// ===========================================================================

describe('sentinel fuzz: tabular rows mixing literal ~ with delta candidates', () => {
  it('literal ~ row preceded by delta-candidate row', () =>
    roundtrip(
      [
        { flag: 'yes', val: 'a' },
        { flag: '~', val: 'b' },
        { flag: '~', val: 'c' },
      ],
      'literal-~-mid',
    ));

  it('alternating ~ literal and other values', () =>
    roundtrip(
      [
        { flag: '~', val: 'x' },
        { flag: 'ok', val: 'y' },
        { flag: '~', val: 'z' },
        { flag: 'ok', val: 'w' },
      ],
      'alternating-~',
    ));

  it('column where delta repeats alongside literal-~ in another column', () =>
    roundtrip(
      [
        { role: 'dev', status: '~' },
        { role: 'dev', status: 'ok' },
        { role: 'dev', status: '~' },
        { role: 'dev', status: 'ok' },
      ],
      'dev+mixed-~',
    ));

  it('literal ~ appearing only in row 0 (reference frame)', () =>
    roundtrip(
      [
        { status: '~', id: 1 },
        { status: 'ok', id: 2 },
        { status: 'ok', id: 3 },
      ],
      'row0-only-~',
    ));

  it('literal ~ appearing only in last row', () =>
    roundtrip(
      [
        { status: 'ok', id: 1 },
        { status: 'ok', id: 2 },
        { status: '~', id: 3 },
      ],
      'last-row-only-~',
    ));
});

// ===========================================================================
// 8. Values that look like quoted strings containing ~
// ===========================================================================

describe('sentinel fuzz: quoted-looking ~ values', () => {
  const cases: Array<[string, unknown]> = [
    ['"\\"~\\""', { msg: '"~"' }],
    ['"\'~\'"', { msg: "'~'" }],
    ['"~ with spaces ~"', { msg: '~ with spaces ~' }],
    ['nested ~', { outer: { inner: { deep: '~' } } }],
  ];
  for (const [label, data] of cases) {
    it(`roundtrips ${label}`, () => roundtrip(data, label));
  }

  /**
   * BUG: Inline arrays containing `"~"` (quoted tilde) are mis-parsed on
   * decompress. The compressed output is syntactically valid PAKT
   * (`arr [3]: "~",hello,"~"`), but the parser appears to break on the
   * quoted `~` token inside an inline array, producing `{ arr: [], '~': '', hello: '' }`.
   * Marked `.fails()` pending user signoff on the fix path.
   */
  it.fails('roundtrips JSON array (BUG: inline array with "~" mis-parsed)', () =>
    roundtrip({ arr: ['~', 'hello', '~'] }, 'JSON array'),
  );
});

// ===========================================================================
// 9. `~` as sole value of the entire document
// ===========================================================================

describe('sentinel fuzz: ~ as sole document value', () => {
  it('bare scalar "~" at root', () => roundtrip('~', 'root-scalar-~'));
  it('single-key object where value is "~"', () => roundtrip({ x: '~' }, 'single-key-~'));

  /**
   * BUG: Same root-cause as the inline-array bug. Root arrays are
   * serialized as `_root [N]: ...` which is an inline array, and the
   * quoted `"~"` tokens are mis-parsed into spurious keys on decompress.
   */
  it.fails('array containing only "~" (BUG: inline-array parse)', () =>
    roundtrip(['~'], 'array-only-~'),
  );
  it.fails('array of three "~" strings (BUG: inline-array parse)', () =>
    roundtrip(['~', '~', '~'], 'array-3-~'),
  );
});

// ===========================================================================
// 10. Large stress pattern — many rows, many columns, ~ at random positions
// ===========================================================================

describe('sentinel fuzz: large tabular with scattered ~', () => {
  it('20 rows × 5 columns with ~ scattered', () => {
    const rows: Array<Record<string, string>> = [];
    for (let i = 0; i < 20; i++) {
      rows.push({
        a: i % 3 === 0 ? '~' : `a${i}`,
        b: i % 4 === 0 ? '~' : `b${i}`,
        c: i % 5 === 0 ? '~' : 'const',
        d: i % 2 === 0 ? '~' : '~other',
        e: i % 7 === 0 ? 'tilde~tail' : `e${i}`,
      });
    }
    roundtrip(rows, 'scattered-~-grid');
  });
});

// ===========================================================================
// 11. Inline-array edge cases — ~ at boundary of inline array serialization
// ===========================================================================

/**
 * BUG (confirmed via fuzzing): PAKT's inline-array serializer force-quotes
 * `~` to `"~"` (correctly — so delta encoding can't misinterpret it) but
 * the parser in {@link packages/pakt-core/src/parser/index.ts} does NOT
 * recognize `"~"` as a valid scalar token when it appears after `[N]: ` in
 * an inline array context. Observed serialized output:
 *   `tags [4]: "~",a,"~",b`
 * gets decompressed to:
 *   `{ tags: [], '~': '', a: '', b: '' }`
 * which is a lossless-claim violation.
 *
 * These tests are marked `.fails()` pending user signoff on the fix.
 * The fix likely lives in the inline-array tokenizer — allowing `"~"` as
 * a regular quoted-string scalar rather than treating it as a keyword.
 */
describe('sentinel fuzz: ~ in inline arrays (BUG: inline-array parse)', () => {
  it.fails('inline array with ~ values', () =>
    roundtrip({ tags: ['~', 'a', '~', 'b'] }, 'inline-~'),
  );
  it.fails('inline array of just ~', () => roundtrip({ tags: ['~'] }, 'inline-single-~'));
  it.fails('inline array of all ~', () => roundtrip({ tags: ['~', '~', '~'] }, 'inline-all-~'));
});

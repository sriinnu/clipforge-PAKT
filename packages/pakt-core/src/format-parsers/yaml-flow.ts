/**
 * @module format-parsers/yaml-flow
 * YAML value parsing beyond plain block scalars: flow collections
 * (`[a, b]`, `{k: v}`, nested to any depth) and quoted scalars with their
 * escapes (`"a\\"b"`, `'it''s'`).
 *
 * `to-yaml` emits all of these, so without them PAKT could not read its own
 * YAML back (#69). Recursive descent over one string; on malformed input the
 * caller falls back to treating the text as a plain scalar.
 */

/** Infer a plain (unquoted) YAML scalar: null, booleans, numbers, else string. */
export function plainScalar(raw: string): unknown {
  const v = raw.trim();
  if (v === '' || v === '~' || v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return v;
}

const chr = String.fromCharCode;
/** YAML 1.2 double-quoted single-character escapes. */
const ESCAPES: Record<string, string> = {
  '0': chr(0),
  a: chr(7),
  b: chr(8),
  t: chr(9),
  [chr(9)]: chr(9),
  n: chr(10),
  v: chr(11),
  f: chr(12),
  r: chr(13),
  e: chr(27),
  ' ': ' ',
  '"': '"',
  '/': '/',
  [chr(92)]: chr(92),
  N: chr(0x85),
  _: chr(0xa0),
  L: chr(0x2028),
  P: chr(0x2029),
};
/** `\x`, `\u`, `\U` escapes and their hex digit counts. */
const HEX_LEN: Record<string, number> = { x: 2, u: 4, U: 8 };

class FlowError extends Error {}

/** Cursor over one YAML value string. */
class Reader {
  i = 0;
  constructor(readonly s: string) {}

  ws(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i] as string)) this.i++;
  }

  peek(): string | undefined {
    return this.s[this.i];
  }

  expect(ch: string): void {
    if (this.s[this.i] !== ch) throw new FlowError(`expected ${ch} at ${this.i}`);
    this.i++;
  }

  /** `"..."` with YAML double-quoted escapes. */
  doubleQuoted(): string {
    this.expect('"');
    let out = '';
    while (this.i < this.s.length) {
      const c = this.s[this.i++] as string;
      if (c === '"') return out;
      out += c === chr(92) ? this.escape() : c;
    }
    throw new FlowError('unterminated double quote');
  }

  /** One escape sequence, the backslash already consumed. */
  escape(): string {
    const e = this.s[this.i++];
    if (e === undefined) throw new FlowError('unterminated double quote');
    const hex = HEX_LEN[e];
    if (hex === undefined) {
      const out = ESCAPES[e];
      if (out === undefined) throw new FlowError(`unknown escape ${e}`);
      return out;
    }
    const code = this.s.slice(this.i, this.i + hex);
    if (code.length !== hex || !/^[0-9a-fA-F]+$/.test(code)) throw new FlowError('bad escape');
    this.i += hex;
    return String.fromCodePoint(Number.parseInt(code, 16));
  }

  /** `'...'`, where `''` is a literal quote. */
  singleQuoted(): string {
    this.expect("'");
    let out = '';
    while (this.i < this.s.length) {
      const c = this.s[this.i++] as string;
      if (c !== "'") {
        out += c;
      } else if (this.s[this.i] === "'") {
        out += "'";
        this.i++;
      } else {
        return out;
      }
    }
    throw new FlowError('unterminated single quote');
  }

  /** Plain scalar inside a flow collection: ends at a flow indicator, or `: ` for keys. */
  plain(isKey: boolean): string {
    const start = this.i;
    while (this.i < this.s.length) {
      const c = this.s[this.i] as string;
      if (c === ',' || c === ']' || c === '}' || c === '[' || c === '{') break;
      if (c === ':' && isKey) {
        const next = this.s[this.i + 1];
        if (next === undefined || /[\s,\]}]/.test(next)) break;
      }
      this.i++;
    }
    return this.s.slice(start, this.i).trim();
  }

  value(): unknown {
    this.ws();
    const c = this.peek();
    if (c === '[') return this.sequence();
    if (c === '{') return this.mapping();
    if (c === '"') return this.doubleQuoted();
    if (c === "'") return this.singleQuoted();
    return plainScalar(this.plain(false));
  }

  /** Separator after an entry: true to continue, false at the closer. */
  more(): boolean {
    this.ws();
    if (this.peek() !== ',') return false;
    this.i++;
    return true;
  }

  sequence(): unknown[] {
    this.expect('[');
    const out: unknown[] = [];
    do {
      this.ws();
      if (this.peek() === ']') break;
      out.push(this.value());
    } while (this.more());
    this.ws();
    this.expect(']');
    return out;
  }

  key(): string {
    this.ws();
    const c = this.peek();
    if (c === '"') return this.doubleQuoted();
    if (c === "'") return this.singleQuoted();
    return this.plain(true);
  }

  mapping(): Record<string, unknown> {
    this.expect('{');
    const out: Record<string, unknown> = {};
    do {
      this.ws();
      if (this.peek() === '}') break;
      const k = this.key();
      this.ws();
      let v: unknown = null;
      if (this.peek() === ':') {
        this.i++;
        this.ws();
        const n = this.peek();
        if (n !== ',' && n !== '}') v = this.value();
      }
      out[k] = v;
    } while (this.more());
    this.ws();
    this.expect('}');
    return out;
  }
}

/**
 * Parse one complete YAML value: a flow collection, a quoted scalar, or a
 * plain scalar. Text left over after a flow or quoted value (other than a
 * `#` comment) means it was not one, so it is read as a plain scalar.
 */
export function parseYamlValue(raw: string): unknown {
  const v = raw.trim();
  const c = v[0];
  if (c !== '[' && c !== '{' && c !== '"' && c !== "'") return plainScalar(v);
  try {
    const r = new Reader(v);
    const out = r.value();
    r.ws();
    if (r.i === v.length || v[r.i] === '#') return out;
  } catch (err) {
    if (!(err instanceof FlowError)) throw err;
  }
  return plainScalar(v);
}

/**
 * Bracket depth of a flow value that opens on one line and closes on a later
 * one (`x: [` / `1,` / `]`). Quoted text is skipped so `"]"` does not count.
 */
export function flowDepth(text: string): number {
  let depth = 0;
  // A quote opens a quoted scalar only where a scalar starts; `n'` is plain.
  let atStart = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if ((c === '"' || c === "'") && atStart) {
      i = closingQuote(text, i);
      atStart = false;
      continue;
    }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    atStart = startsScalar(text, i) || (atStart && /\s/.test(c));
  }
  return depth;
}

/** True when the next scalar may start right after `text[i]`. */
function startsScalar(text: string, i: number): boolean {
  const c = text[i];
  if (c === '[' || c === '{' || c === ',') return true;
  return c === ':' && /\s/.test(text[i + 1] ?? ' ');
}

/** Index of the quote closing the one at `open` (or the end of the text). */
function closingQuote(text: string, open: number): number {
  const q = text[open];
  for (let i = open + 1; i < text.length; i++) {
    if (q === '"' && text[i] === chr(92)) i++;
    else if (text[i] === q) {
      if (q === "'" && text[i + 1] === "'") i++;
      else return i;
    }
  }
  return text.length;
}

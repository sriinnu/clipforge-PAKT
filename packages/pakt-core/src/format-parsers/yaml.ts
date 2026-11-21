/**
 * @module format-parsers/yaml
 * YAML parser covering what PAKT's own `to-yaml` emits and common payloads:
 * block mappings and sequences (including `- - x` nested sequences and
 * `- key: v` items with sibling keys), flow collections (`[a, b]`,
 * `{k: v}`, also spread over several lines), and quoted scalars with escapes.
 *
 * Not supported: anchors/aliases, tags, block scalars (`|`, `>`), and
 * multi-document streams.
 */

import { flowDepth, parseYamlValue, plainScalar } from './yaml-flow.js';

export { parseYamlValue } from './yaml-flow.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed YAML line with indent tracking. */
interface YamlLine {
  indent: number;
  raw: string;
  trimmed: string;
}

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

/**
 * Infer a scalar YAML value to its JS type (numbers, booleans, null), and
 * unquote quoted strings, applying their escapes.
 * @param raw - Raw YAML value string
 * @returns Typed JS value (null, boolean, number, or string)
 * @example
 * ```ts
 * yamlScalar('true');      // true
 * yamlScalar('42');        // 42
 * yamlScalar('~');         // null
 * yamlScalar('"a\\tb"');   // 'a<TAB>b'
 * ```
 */
export function yamlScalar(raw: string): unknown {
  const v = raw.trim();
  if (v.startsWith('"') || v.startsWith("'")) {
    const q = parseYamlValue(v);
    if (typeof q === 'string' && q !== v) return q;
  }
  return plainScalar(v);
}

// ---------------------------------------------------------------------------
// Indent helper
// ---------------------------------------------------------------------------

/**
 * Count leading spaces in a line.
 * @param line - Source line
 * @returns Number of leading space characters
 */
export function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** A mapping entry's key and the text after its colon. */
interface KeySplit {
  key: string;
  rest: string;
}

/**
 * Split `key: rest` where the key may be quoted (`"a: b": 1`).
 * @param strict - Plain keys need `: ` or a trailing `:` (list items, so
 *   `- http://x` stays a scalar); otherwise the first `:` splits.
 */
function splitKey(text: string, strict: boolean): KeySplit | null {
  const q = text[0];
  if (q === '"' || q === "'") {
    const close = quotedEnd(text);
    if (close < 0) return null;
    const after = text.slice(close + 1).trimStart();
    if (!after.startsWith(':') || (after.length > 1 && !/\s/.test(after[1] as string))) return null;
    const key = yamlScalar(text.slice(0, close + 1));
    return { key: String(key), rest: after.slice(1).trim() };
  }
  if (q === '[' || q === '{') return null;
  const m = strict ? text.match(/^([^:]*?):(?:\s+(.*))?$/s) : text.match(/^([^:]*):(.*)$/s);
  if (!m) return null;
  return { key: (m[1] as string).trim(), rest: (m[2] ?? '').trim() };
}

/** Index of the quote closing a quoted scalar that starts at 0, or -1. */
function quotedEnd(text: string): number {
  const q = text[0];
  for (let i = 1; i < text.length; i++) {
    const c = text[i];
    if (q === '"' && c === '\\') i++;
    else if (c === q) {
      if (q === "'" && text[i + 1] === "'") i++;
      else return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/** The value part of a line: after any `- ` markers and a `key:`. */
function valuePart(trimmed: string): string {
  let t = trimmed;
  while (t.startsWith('- ')) t = t.slice(2).trimStart();
  const kv = splitKey(t, true);
  return kv ? kv.rest : t;
}

/** Comment-free, non-blank lines, with multi-line flow values joined. */
function toLines(input: string): YamlLine[] {
  const lines: YamlLine[] = [];
  const raw = input.split(/\r?\n/);
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i] as string;
    let trimmed = line.trim();
    if (trimmed === '' || trimmed === '---' || trimmed === '...') continue;
    if (trimmed.startsWith('#')) continue;
    const v = valuePart(trimmed);
    if (v.startsWith('[') || v.startsWith('{')) {
      let depth = flowDepth(v);
      while (depth > 0 && i + 1 < raw.length) {
        const next = (raw[++i] as string).trim();
        trimmed += ` ${next}`;
        depth += flowDepth(next);
      }
    }
    lines.push({ indent: indentOf(line), raw: line, trimmed });
  }
  return lines;
}

/** End (exclusive) of the run of lines from `from` indented at least `minIndent`. */
function blockEnd(lines: YamlLine[], from: number, end: number, minIndent: number): number {
  let j = from;
  while (j < end && (lines[j]?.indent ?? 0) >= minIndent) j++;
  return j;
}

function isSeqItem(trimmed: string): boolean {
  return trimmed === '-' || trimmed.startsWith('- ');
}

// ---------------------------------------------------------------------------
// Block parser
// ---------------------------------------------------------------------------

/**
 * Parse a YAML document into a JS value.
 * Strips comments, blank lines, `---` and `...` markers before parsing.
 * @param input - Raw YAML text
 * @returns Parsed JS value (object, array, scalar, or null)
 * @example
 * ```ts
 * parseYaml('name: Alice\nroles: [dev, ops]');
 * // { name: 'Alice', roles: ['dev', 'ops'] }
 * ```
 */
export function parseYaml(input: string): unknown {
  const lines = toLines(input);
  if (lines.length === 0) return null;
  return parseYamlBlock(lines, 0, lines.length, 0);
}

/**
 * Parse a YAML block (sequence, mapping, or lone value) at a given indent.
 */
export function parseYamlBlock(
  lines: YamlLine[],
  start: number,
  end: number,
  baseIndent: number,
): unknown {
  if (start >= end) return null;
  const first = lines[start];
  if (!first) return null;
  if (isSeqItem(first.trimmed)) return parseYamlList(lines, start, end, baseIndent);
  const c = first.trimmed[0];
  if (start === end - 1 && (c === '[' || c === '{')) return parseYamlValue(first.trimmed);
  return parseYamlObject(lines, start, end, baseIndent);
}

/**
 * Parse one sequence item whose content (after `- `) sits at `col`.
 * Its block is the item line plus following lines indented at least `col`;
 * re-reading the content as its own line at `col` lets `- - x` and
 * `- key: v` (with sibling keys below) reuse the block parsers.
 */
function parseSeqItem(content: string, item: YamlLine, rest: YamlLine[]): unknown {
  const col = item.indent + 2;
  if (content === '')
    return rest.length > 0 ? parseYamlBlock(rest, 0, rest.length, rest[0]?.indent ?? col) : null;
  const self: YamlLine = { indent: col, raw: item.raw, trimmed: content };
  if (isSeqItem(content)) return parseYamlList([self, ...rest], 0, rest.length + 1, col);
  if (splitKey(content, true)) return parseYamlObject([self, ...rest], 0, rest.length + 1, col);
  return parseYamlValue(content);
}

/**
 * Parse YAML sequence items (`- value`, `- key: value`, `- - nested`).
 */
export function parseYamlList(
  lines: YamlLine[],
  start: number,
  end: number,
  baseIndent: number,
): unknown[] {
  const result: unknown[] = [];
  let i = start;
  while (i < end) {
    const line = lines[i];
    if (!line || line.indent < baseIndent) break;
    if (line.indent > baseIndent || !isSeqItem(line.trimmed)) {
      i++;
      continue;
    }
    const j = blockEnd(lines, i + 1, end, line.indent + 1);
    const content = line.trimmed === '-' ? '' : line.trimmed.slice(2).trim();
    result.push(parseSeqItem(content, line, lines.slice(i + 1, j)));
    i = j;
  }
  return result;
}

/**
 * Parse a YAML mapping (`key: value` lines) at a given indent.
 * A key with nothing after its colon takes the more-indented block below it.
 */
export function parseYamlObject(
  lines: YamlLine[],
  start: number,
  end: number,
  baseIndent: number,
): unknown {
  const obj: Record<string, unknown> = {};
  let i = start;
  while (i < end) {
    const line = lines[i];
    if (!line || line.indent < baseIndent) break;
    if (line.indent > baseIndent) {
      i++;
      continue;
    }
    const kv = splitKey(line.trimmed, false);
    if (!kv) {
      if (start === end - 1) return parseYamlValue(line.trimmed);
      i++;
      continue;
    }
    if (kv.rest) {
      obj[kv.key] = parseYamlValue(kv.rest);
      i++;
      continue;
    }
    const [value, next] = parseKeyBlock(lines, i + 1, end, baseIndent);
    obj[kv.key] = value;
    i = next;
  }
  return obj;
}

/**
 * The block under a `key:` with nothing after the colon, starting at `from`:
 * more-indented lines, or a sequence at the key's own indent (`key:\n- a`).
 * @returns The parsed value (null when there is no block) and the next line.
 */
function parseKeyBlock(
  lines: YamlLine[],
  from: number,
  end: number,
  baseIndent: number,
): [unknown, number] {
  const next = lines[from];
  let j = blockEnd(lines, from, end, baseIndent + 1);
  let childIndent = next?.indent ?? baseIndent + 2;
  if (j === from && next && next.indent === baseIndent && isSeqItem(next.trimmed)) {
    j = blockEndSeq(lines, from, end, baseIndent);
    childIndent = baseIndent;
  }
  return [j > from ? parseYamlBlock(lines, from, j, childIndent) : null, j];
}

/** End of a sequence written at the parent key's indent (`key:\n- a\n- b`). */
function blockEndSeq(lines: YamlLine[], from: number, end: number, indent: number): number {
  let j = from;
  while (j < end) {
    const l = lines[j];
    if (!l || l.indent < indent) break;
    if (l.indent === indent && !isSeqItem(l.trimmed)) break;
    j++;
  }
  return j;
}

/**
 * @module parser/parser
 * Recursive-descent parser that converts PAKT token streams into an AST.
 * Supports strict (throw on first error) and lenient (collect errors) modes.
 */

import type {
  BodyNode, CommentNode, DictBlockNode, DictEntryNode, DocumentNode,
  HeaderNode, InlineArrayNode, ListArrayNode, ListItemNode, ObjectNode,
  ScalarNode, SourcePosition, TabularArrayNode, TabularRowNode,
} from './ast.js';
import { createPosition, inferScalar } from './ast.js';
import type { Token, TokenType } from './tokenizer.js';
import { tokenize } from './tokenizer.js';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/**
 * Error raised when the parser encounters invalid PAKT syntax.
 * Carries the source line and column for diagnostics.
 */
export class PaktParseError extends Error {
  /** 1-based line number */
  line: number;
  /** 1-based column number */
  column: number;
  constructor(message: string, line: number, column: number) {
    super(`Parse error at ${line}:${column} — ${message}`);
    this.name = 'PaktParseError';
    this.line = line;
    this.column = column;
  }
}

// ---------------------------------------------------------------------------
// Parser state & helpers
// ---------------------------------------------------------------------------

interface ParserState {
  tokens: Token[];
  pos: number;
  mode: 'strict' | 'lenient';
  errors: PaktParseError[];
}

/** Peek at the current token without consuming. */
function peek(s: ParserState): Token {
  return s.tokens[s.pos] ?? s.tokens[s.tokens.length - 1]!;
}

/** Advance and return the current token. */
function advance(s: ParserState): Token {
  const t = peek(s);
  if (t.type !== 'EOF') s.pos++;
  return t;
}

/** Skip over NEWLINE tokens. */
function skipNewlines(s: ParserState): void {
  while (peek(s).type === 'NEWLINE') advance(s);
}

/** Read the indentation level from the current position (0 if none). */
function currentIndent(s: ParserState): number {
  const t = peek(s);
  return t.type === 'INDENT' ? parseInt(t.value, 10) : 0;
}

/** Expect a specific token type, or raise / collect an error. */
function expect(s: ParserState, type: TokenType, context: string): Token {
  const t = peek(s);
  if (t.type === type) return advance(s);
  const err = new PaktParseError(
    `Expected ${type} (${context}), got ${t.type} "${t.value}"`, t.line, t.column,
  );
  if (s.mode === 'strict') throw err;
  s.errors.push(err);
  return t;
}

/** Report an error (throw in strict, collect in lenient). */
function reportError(s: ParserState, msg: string, line: number, col: number): void {
  const err = new PaktParseError(msg, line, col);
  if (s.mode === 'strict') throw err;
  s.errors.push(err);
}

/** Build a SourcePosition from a token. */
function posOf(t: Token): SourcePosition { return createPosition(t.line, t.column, t.offset); }

/** Skip newlines and return the indent level of the next content line. */
function skipToContent(s: ParserState): number { skipNewlines(s); return currentIndent(s); }

/** Consume an inline COMMENT token if present. */
function eatComment(s: ParserState): void { if (peek(s).type === 'COMMENT') advance(s); }

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

/**
 * Parse a PAKT string into a {@link DocumentNode} AST.
 *
 * @param input - Raw PAKT text
 * @param mode  - `'strict'` (default) throws on first error;
 *                `'lenient'` collects errors and continues
 * @returns The root {@link DocumentNode}
 * @throws {PaktParseError} In strict mode on the first syntax error
 *
 * @example
 * ```ts
 * import { parse } from '@yugenlab/pakt';
 * const doc = parse('@from json\nname: Alice');
 * ```
 */
export function parse(input: string, mode: 'strict' | 'lenient' = 'strict'): DocumentNode {
  const tokens = tokenize(input);
  const s: ParserState = { tokens, pos: 0, mode, errors: [] };
  const firstTok = peek(s);
  const headers = parseHeaders(s);
  skipToContent(s);
  const dictionary = parseDictBlock(s);
  skipToContent(s);
  const body = parseBody(s, 0);
  const doc: DocumentNode = { type: 'document', headers, dictionary, body, position: posOf(firstTok) };
  if (s.mode === 'lenient' && s.errors.length > 0) {
    (doc as DocumentNode & { errors: PaktParseError[] }).errors = s.errors;
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

function parseHeaders(s: ParserState): HeaderNode[] {
  const headers: HeaderNode[] = [];
  while (true) {
    skipNewlines(s);
    const t = peek(s);
    if (t.type !== 'HEADER') break;
    advance(s);
    const parts = t.value.slice(1).split(/\s+/);
    const headerType = parts[0]! as HeaderNode['headerType'];
    const value = parts.slice(1).join(' ');
    headers.push({ type: 'header', headerType, value, position: posOf(t) } as HeaderNode);
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Dictionary
// ---------------------------------------------------------------------------

function parseDictBlock(s: ParserState): DictBlockNode | null {
  skipNewlines(s);
  if (peek(s).type !== 'DICT_START') return null;
  const startTok = advance(s);
  const entries: DictEntryNode[] = [];
  while (true) {
    skipNewlines(s);
    const cur = peek(s);
    if (cur.type === 'DICT_END') { advance(s); break; }
    if (cur.type === 'EOF') {
      reportError(s, 'Unterminated @dict block — expected @end', cur.line, cur.column);
      break;
    }
    if (cur.type === 'INDENT') advance(s);
    const entry = parseDictEntry(s);
    if (entry) entries.push(entry);
  }
  return { type: 'dictBlock', entries, position: posOf(startTok) };
}

function parseDictEntry(s: ParserState): DictEntryNode | null {
  const keyTok = peek(s);
  if (keyTok.type !== 'KEY') {
    reportError(s, `Expected dict alias (e.g. $a), got ${keyTok.type}`, keyTok.line, keyTok.column);
    while (peek(s).type !== 'NEWLINE' && peek(s).type !== 'EOF') advance(s);
    return null;
  }
  const alias = advance(s).value;
  expect(s, 'COLON', 'dict entry colon');
  const valTok = peek(s);
  let expansion = '';
  if (valTok.type === 'VALUE' || valTok.type === 'KEY' ||
      valTok.type === 'QUOTED_STRING' || valTok.type === 'NUMBER') {
    expansion = advance(s).value;
  }
  return { type: 'dictEntry', alias, expansion, position: posOf(keyTok) };
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

/**
 * Parse body nodes at a given indentation level.
 * Stops when indentation drops below `indent` or at EOF.
 */
function parseBody(s: ParserState, indent: number): BodyNode[] {
  const nodes: BodyNode[] = [];
  while (peek(s).type !== 'EOF') {
    skipNewlines(s);
    if (peek(s).type === 'EOF') break;
    const lineIndent = currentIndent(s);
    if (lineIndent < indent) break;

    const indentTok = peek(s);
    if (indentTok.type === 'INDENT') {
      if (parseInt(indentTok.value, 10) > indent && indent > 0) {
        reportError(s, `Unexpected indent: expected ${indent} spaces, got ${indentTok.value}`,
          indentTok.line, indentTok.column);
      }
      advance(s);
    }
    const cur = peek(s);
    if (cur.type === 'COMMENT') {
      const ct = advance(s);
      nodes.push({ type: 'comment', text: ct.value, inline: false, position: posOf(ct) } as CommentNode);
      continue;
    }
    if (cur.type === 'DICT_START' || cur.type === 'DICT_END' || cur.type === 'DASH') break;
    if (cur.type === 'KEY') {
      const node = parseKeyedNode(s, indent);
      if (node) nodes.push(node);
      continue;
    }
    advance(s); // skip unrecognised tokens
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Key-based nodes
// ---------------------------------------------------------------------------

function parseKeyedNode(s: ParserState, currentIndentLevel: number): BodyNode | null {
  const keyTok = advance(s);
  const key = keyTok.value;
  const startPos = posOf(keyTok);

  // Array annotation: key [N]...
  if (peek(s).type === 'BRACKET_OPEN') {
    return parseArrayNode(s, key, startPos, currentIndentLevel);
  }

  // Colon -> key: value  OR  key:\n  children
  if (peek(s).type === 'COLON') {
    advance(s);
    const next = peek(s);
    if (next.type === 'VALUE' || next.type === 'QUOTED_STRING' || next.type === 'NUMBER') {
      const scalar = parseScalarToken(s);
      eatComment(s);
      return { type: 'keyValue', key, value: scalar, position: startPos };
    }
    if (next.type === 'NEWLINE' || next.type === 'EOF' || next.type === 'COMMENT') {
      eatComment(s);
      const saved = s.pos;
      skipNewlines(s);
      const childIndent = currentIndent(s);
      if (childIndent > currentIndentLevel) {
        const children = parseBody(s, childIndent);
        if (children.length > 0) return { type: 'object', key, children, position: startPos };
      }
      s.pos = saved;
      return mkEmptyKV(key, startPos);
    }
    return { type: 'keyValue', key, value: inferScalar(advance(s).value, posOf(next)), position: startPos };
  }

  // Bare key -> nested object header
  const saved = s.pos;
  skipNewlines(s);
  const childIndent = currentIndent(s);
  if (childIndent > currentIndentLevel) {
    const children = parseBody(s, childIndent);
    if (children.length > 0) return { type: 'object', key, children, position: startPos } as ObjectNode;
  }
  s.pos = saved;
  return mkEmptyKV(key, startPos);
}

/** Create an empty-string KeyValueNode. */
function mkEmptyKV(key: string, pos: SourcePosition) {
  const empty: ScalarNode = { type: 'scalar', scalarType: 'string', value: '', quoted: false, position: pos };
  return { type: 'keyValue' as const, key, value: empty, position: pos };
}

// ---------------------------------------------------------------------------
// Array nodes
// ---------------------------------------------------------------------------

function parseArrayNode(
  s: ParserState, key: string, startPos: SourcePosition, indent: number,
): TabularArrayNode | InlineArrayNode | ListArrayNode | null {
  advance(s); // '['
  const count = parseInt(expect(s, 'NUMBER', 'array count').value, 10) || 0;
  expect(s, 'BRACKET_CLOSE', 'closing ]');

  if (peek(s).type === 'BRACE_OPEN') return parseTabularArray(s, key, count, startPos, indent);

  expect(s, 'COLON', 'array colon');
  if (peek(s).type === 'VALUE') return parseInlineArray(s, key, count, startPos);
  return parseListArray(s, key, count, startPos, indent);
}

function parseTabularArray(
  s: ParserState, key: string, count: number, startPos: SourcePosition, indent: number,
): TabularArrayNode {
  advance(s); // '{'
  const fields: string[] = [];
  while (peek(s).type !== 'BRACE_CLOSE' && peek(s).type !== 'EOF') {
    const ft = peek(s);
    if (ft.type === 'KEY' || ft.type === 'NUMBER') fields.push(advance(s).value);
    else if (ft.type === 'PIPE') advance(s);
    else break;
  }
  expect(s, 'BRACE_CLOSE', 'closing }');
  expect(s, 'COLON', 'tabular colon');

  const rows: TabularRowNode[] = [];
  while (true) {
    skipNewlines(s);
    if (peek(s).type === 'EOF') break;
    if (currentIndent(s) <= indent) break;
    if (peek(s).type === 'INDENT') advance(s);

    const rowTok = peek(s);
    const rowPos = posOf(rowTok);
    const values: ScalarNode[] = [];
    let first = true;

    while (peek(s).type !== 'NEWLINE' && peek(s).type !== 'EOF' && peek(s).type !== 'COMMENT') {
      if (!first && peek(s).type === 'PIPE') advance(s);
      first = false;
      const cell = peek(s);
      if (cell.type === 'PIPE' || cell.type === 'NEWLINE' || cell.type === 'EOF') {
        values.push({ type: 'scalar', scalarType: 'string', value: '', quoted: false, position: posOf(cell) });
        continue;
      }
      if (cell.type === 'QUOTED_STRING') {
        values.push({ type: 'scalar', scalarType: 'string', value: advance(s).value, quoted: true, position: posOf(cell) });
      } else if (cell.type === 'VALUE') {
        const parts = advance(s).value.split('|');
        for (const part of parts) values.push(inferScalar(part.trim(), posOf(cell)));
        break;
      } else {
        values.push(inferScalar(advance(s).value, posOf(cell)));
      }
    }
    eatComment(s);
    if (values.length > 0) rows.push({ type: 'tabularRow', values, position: rowPos });
  }
  return { type: 'tabularArray', key, count, fields, rows, position: startPos };
}

function parseInlineArray(
  s: ParserState, key: string, count: number, startPos: SourcePosition,
): InlineArrayNode {
  const valTok = advance(s);
  const parts = valTok.value.split(',').map(p => p.trim());
  const values: ScalarNode[] = parts.map(p => inferScalar(p, posOf(valTok)));
  eatComment(s);
  return { type: 'inlineArray', key, count, values, position: startPos };
}

function parseListArray(
  s: ParserState, key: string, count: number, startPos: SourcePosition, indent: number,
): ListArrayNode {
  const items: ListItemNode[] = [];
  while (true) {
    skipNewlines(s);
    if (peek(s).type === 'EOF') break;
    const itemIndent = currentIndent(s);
    if (itemIndent <= indent) break;

    const saved = s.pos;
    if (peek(s).type === 'INDENT') advance(s);
    if (peek(s).type !== 'DASH') { s.pos = saved; break; }

    const dashTok = advance(s);
    const children: BodyNode[] = [];

    if (peek(s).type === 'KEY') {
      const node = parseKeyedNode(s, itemIndent);
      if (node) children.push(node);
    }
    // Additional children at deeper indentation
    while (true) {
      skipNewlines(s);
      if (peek(s).type === 'EOF') break;
      const childIndent = currentIndent(s);
      if (childIndent <= itemIndent) break;
      if (peek(s).type === 'INDENT') advance(s);
      if (peek(s).type === 'COMMENT') {
        const ct = advance(s);
        children.push({ type: 'comment', text: ct.value, inline: false, position: posOf(ct) });
        continue;
      }
      if (peek(s).type === 'KEY') {
        const node = parseKeyedNode(s, childIndent);
        if (node) children.push(node);
        continue;
      }
      break;
    }
    items.push({ type: 'listItem', children, position: posOf(dashTok) });
  }
  return { type: 'listArray', key, count, items, position: startPos };
}

// ---------------------------------------------------------------------------
// Scalar helpers
// ---------------------------------------------------------------------------

/** Parse a scalar from the current token. */
function parseScalarToken(s: ParserState): ScalarNode {
  const t = peek(s);
  if (t.type === 'QUOTED_STRING') {
    advance(s);
    return { type: 'scalar', scalarType: 'string', value: t.value, quoted: true, position: posOf(t) };
  }
  if (t.type === 'NUMBER') {
    advance(s);
    return { type: 'scalar', scalarType: 'number', value: Number(t.value), raw: t.value, position: posOf(t) };
  }
  advance(s);
  return inferScalar(t.value, posOf(t));
}

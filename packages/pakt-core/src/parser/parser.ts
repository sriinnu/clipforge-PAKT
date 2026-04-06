/**
 * @module parser/parser
 * Recursive-descent parser that converts PAKT token streams into an AST.
 * Supports strict (throw on first error) and lenient (collect errors) modes.
 *
 * Body/expression parsing lives in {@link module:parser/parse-body}.
 * Scalar parsing lives in {@link module:parser/parse-scalars}.
 */

import { createPosition } from './ast-helpers.js';
import type {
  DictBlockNode,
  DictEntryNode,
  DocumentNode,
  HeaderNode,
  SourcePosition,
} from './ast.js';
import { parseBody } from './parse-body.js';
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

/** Internal state threaded through all parsing functions. */
export interface ParserState {
  tokens: Token[];
  pos: number;
  mode: 'strict' | 'lenient';
  errors: PaktParseError[];
}

/** Peek at the current token without consuming. */
export function peek(s: ParserState): Token {
  // biome-ignore lint/style/noNonNullAssertion: tokens array always has at least an EOF token
  return s.tokens[s.pos] ?? s.tokens[s.tokens.length - 1]!;
}

/** Advance and return the current token. */
export function advance(s: ParserState): Token {
  const t = peek(s);
  if (t.type !== 'EOF') s.pos++;
  return t;
}

/** Skip over NEWLINE tokens. */
export function skipNewlines(s: ParserState): void {
  while (peek(s).type === 'NEWLINE') advance(s);
}

/** Read the indentation level from the current position (0 if none). */
export function currentIndent(s: ParserState): number {
  const t = peek(s);
  return t.type === 'INDENT' ? Number.parseInt(t.value, 10) : 0;
}

/** Expect a specific token type, or raise / collect an error. */
export function expect(s: ParserState, type: TokenType, context: string): Token {
  const t = peek(s);
  if (t.type === type) return advance(s);
  const err = new PaktParseError(
    `Expected ${type} (${context}), got ${t.type} "${t.value}"`,
    t.line,
    t.column,
  );
  if (s.mode === 'strict') throw err;
  s.errors.push(err);
  return t;
}

/** Report an error (throw in strict, collect in lenient). */
export function reportError(s: ParserState, msg: string, line: number, col: number): void {
  const err = new PaktParseError(msg, line, col);
  if (s.mode === 'strict') throw err;
  s.errors.push(err);
}

/** Build a SourcePosition from a token. */
export function posOf(t: Token): SourcePosition {
  return createPosition(t.line, t.column, t.offset);
}

/** Skip newlines and return the indent level of the next content line. */
export function skipToContent(s: ParserState): number {
  skipNewlines(s);
  return currentIndent(s);
}

/** Consume an inline COMMENT token if present. */
export function eatComment(s: ParserState): void {
  if (peek(s).type === 'COMMENT') advance(s);
}

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
 * import { parse } from '@sriinnu/pakt';
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
  const doc: DocumentNode = {
    type: 'document',
    headers,
    dictionary,
    body,
    position: posOf(firstTok),
  };
  if (s.mode === 'lenient' && s.errors.length > 0) {
    (doc as DocumentNode & { errors: PaktParseError[] }).errors = s.errors;
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

/**
 * Parse header directives at the top of a PAKT document.
 * @param s - Current parser state
 * @returns Array of parsed header nodes
 */
function parseHeaders(s: ParserState): HeaderNode[] {
  const headers: HeaderNode[] = [];
  while (true) {
    skipNewlines(s);
    const t = peek(s);
    if (t.type !== 'HEADER') break;
    advance(s);
    const parts = t.value.slice(1).split(/\s+/);
    // biome-ignore lint/style/noNonNullAssertion: split always yields at least one element
    const headerType = parts[0]! as HeaderNode['headerType'];
    const value = parts.slice(1).join(' ');
    headers.push({ type: 'header', headerType, value, position: posOf(t) } as HeaderNode);
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Dictionary
// ---------------------------------------------------------------------------

/**
 * Parse a @dict...@end block if present.
 * @param s - Current parser state
 * @returns Parsed dictionary block node, or null if no dict block
 */
function parseDictBlock(s: ParserState): DictBlockNode | null {
  skipNewlines(s);
  if (peek(s).type !== 'DICT_START') return null;
  const startTok = advance(s);
  const entries: DictEntryNode[] = [];
  while (true) {
    skipNewlines(s);
    const cur = peek(s);
    if (cur.type === 'DICT_END') {
      advance(s);
      break;
    }
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

/**
 * Parse a single dictionary entry (alias: expansion).
 * @param s - Current parser state
 * @returns Parsed dictionary entry node, or null on error
 */
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
  if (
    valTok.type === 'VALUE' ||
    valTok.type === 'KEY' ||
    valTok.type === 'QUOTED_STRING' ||
    valTok.type === 'NUMBER'
  ) {
    expansion = advance(s).value;
  }
  return { type: 'dictEntry', alias, expansion, position: posOf(keyTok) };
}

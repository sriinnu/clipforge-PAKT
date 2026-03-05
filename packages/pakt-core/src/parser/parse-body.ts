/**
 * @module parser/parse-body
 * Body and expression parsing for the PAKT recursive-descent parser.
 * Handles objects, arrays (tabular, inline, list), and keyed nodes.
 */

import { inferScalar } from './ast-helpers.js';
import type {
  BodyNode,
  CommentNode,
  InlineArrayNode,
  ListArrayNode,
  ListItemNode,
  ObjectNode,
  ScalarNode,
  SourcePosition,
  TabularArrayNode,
  TabularRowNode,
} from './ast.js';
import { mkEmptyKV, parseScalarToken } from './parse-scalars.js';
import type { ParserState } from './parser.js';
import {
  advance,
  currentIndent,
  eatComment,
  expect,
  peek,
  posOf,
  reportError,
  skipNewlines,
} from './parser.js';

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------

/**
 * Parse body nodes at a given indentation level.
 * Stops when indentation drops below `indent` or at EOF.
 * @param s - Current parser state
 * @param indent - Minimum indentation level for this body block
 * @returns Array of parsed body nodes
 */
export function parseBody(s: ParserState, indent: number): BodyNode[] {
  const nodes: BodyNode[] = [];
  while (peek(s).type !== 'EOF') {
    skipNewlines(s);
    if (peek(s).type === 'EOF') break;
    const lineIndent = currentIndent(s);
    if (lineIndent < indent) break;

    const indentTok = peek(s);
    if (indentTok.type === 'INDENT') {
      if (Number.parseInt(indentTok.value, 10) > indent && indent > 0) {
        reportError(
          s,
          `Unexpected indent: expected ${indent} spaces, got ${indentTok.value}`,
          indentTok.line,
          indentTok.column,
        );
      }
      advance(s);
    }
    const cur = peek(s);
    if (cur.type === 'COMMENT') {
      const ct = advance(s);
      nodes.push({
        type: 'comment',
        text: ct.value,
        inline: false,
        position: posOf(ct),
      } as CommentNode);
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

/**
 * Parse a keyed node starting from the current KEY token.
 * Determines whether it's a key-value pair, object, or array based
 * on the tokens that follow the key.
 * @param s - Current parser state
 * @param currentIndentLevel - Indentation level of the current line
 * @returns Parsed body node, or null on error
 */
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
    return {
      type: 'keyValue',
      key,
      value: inferScalar(advance(s).value, posOf(next)),
      position: startPos,
    };
  }

  // Bare key -> nested object header
  const saved = s.pos;
  skipNewlines(s);
  const childIndent = currentIndent(s);
  if (childIndent > currentIndentLevel) {
    const children = parseBody(s, childIndent);
    if (children.length > 0)
      return { type: 'object', key, children, position: startPos } as ObjectNode;
  }
  s.pos = saved;
  return mkEmptyKV(key, startPos);
}

// ---------------------------------------------------------------------------
// Array nodes
// ---------------------------------------------------------------------------

/**
 * Parse an array node starting from the BRACKET_OPEN after the key.
 * Dispatches to tabular, inline, or list array based on syntax.
 * @param s - Current parser state
 * @param key - The array key name
 * @param startPos - Source position of the key token
 * @param indent - Current indentation level
 * @returns Parsed array node, or null on error
 */
function parseArrayNode(
  s: ParserState,
  key: string,
  startPos: SourcePosition,
  indent: number,
): TabularArrayNode | InlineArrayNode | ListArrayNode | null {
  advance(s); // '['
  const count = Number.parseInt(expect(s, 'NUMBER', 'array count').value, 10) || 0;
  expect(s, 'BRACKET_CLOSE', 'closing ]');

  if (peek(s).type === 'BRACE_OPEN') return parseTabularArray(s, key, count, startPos, indent);

  expect(s, 'COLON', 'array colon');
  if (peek(s).type === 'VALUE') return parseInlineArray(s, key, count, startPos);
  return parseListArray(s, key, count, startPos, indent);
}

// ---------------------------------------------------------------------------
// Tabular array
// ---------------------------------------------------------------------------

/**
 * Parse a tabular array with field headers and pipe-delimited rows.
 * @param s - Current parser state
 * @param key - The array key name
 * @param count - Declared element count from [N]
 * @param startPos - Source position of the key token
 * @param indent - Current indentation level
 * @returns Parsed tabular array node
 */
function parseTabularArray(
  s: ParserState,
  key: string,
  count: number,
  startPos: SourcePosition,
  indent: number,
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
        values.push({
          type: 'scalar',
          scalarType: 'string',
          value: '',
          quoted: false,
          position: posOf(cell),
        });
        continue;
      }
      if (cell.type === 'QUOTED_STRING') {
        values.push({
          type: 'scalar',
          scalarType: 'string',
          value: advance(s).value,
          quoted: true,
          position: posOf(cell),
        });
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

// ---------------------------------------------------------------------------
// Inline array
// ---------------------------------------------------------------------------

/**
 * Parse an inline comma-separated array.
 * @param s - Current parser state
 * @param key - The array key name
 * @param count - Declared element count from [N]
 * @param startPos - Source position of the key token
 * @returns Parsed inline array node
 */
function parseInlineArray(
  s: ParserState,
  key: string,
  count: number,
  startPos: SourcePosition,
): InlineArrayNode {
  const valTok = advance(s);
  const parts = valTok.value.split(',').map((p) => p.trim());
  const values: ScalarNode[] = parts.map((p) => inferScalar(p, posOf(valTok)));
  eatComment(s);
  return { type: 'inlineArray', key, count, values, position: startPos };
}

// ---------------------------------------------------------------------------
// List array
// ---------------------------------------------------------------------------

/**
 * Parse a dash-prefixed list array.
 * @param s - Current parser state
 * @param key - The array key name
 * @param count - Declared element count from [N]
 * @param startPos - Source position of the key token
 * @param indent - Current indentation level
 * @returns Parsed list array node
 */
function parseListArray(
  s: ParserState,
  key: string,
  count: number,
  startPos: SourcePosition,
  indent: number,
): ListArrayNode {
  const items: ListItemNode[] = [];
  while (true) {
    skipNewlines(s);
    if (peek(s).type === 'EOF') break;
    const itemIndent = currentIndent(s);
    if (itemIndent <= indent) break;

    const saved = s.pos;
    if (peek(s).type === 'INDENT') advance(s);
    if (peek(s).type !== 'DASH') {
      s.pos = saved;
      break;
    }

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

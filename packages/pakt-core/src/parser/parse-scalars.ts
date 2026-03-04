/**
 * @module parser/parse-scalars
 * Scalar value parsing and string handling for the PAKT recursive-descent
 * parser. Converts individual tokens into typed {@link ScalarNode} AST nodes.
 */

import { inferScalar } from './ast-helpers.js';
import type { ScalarNode, SourcePosition } from './ast.js';
import type { ParserState } from './parser.js';
import { advance, peek, posOf } from './parser.js';

// ---------------------------------------------------------------------------
// Scalar token parsing
// ---------------------------------------------------------------------------

/**
 * Parse a scalar from the current token.
 * Handles quoted strings, numbers, and bare values (inferred via
 * {@link inferScalar}).
 * @param s - Current parser state
 * @returns A typed {@link ScalarNode}
 */
export function parseScalarToken(s: ParserState): ScalarNode {
  const t = peek(s);
  if (t.type === 'QUOTED_STRING') {
    advance(s);
    return {
      type: 'scalar',
      scalarType: 'string',
      value: t.value,
      quoted: true,
      position: posOf(t),
    };
  }
  if (t.type === 'NUMBER') {
    advance(s);
    return {
      type: 'scalar',
      scalarType: 'number',
      value: Number(t.value),
      raw: t.value,
      position: posOf(t),
    };
  }
  advance(s);
  return inferScalar(t.value, posOf(t));
}

// ---------------------------------------------------------------------------
// Empty key-value helper
// ---------------------------------------------------------------------------

/**
 * Create an empty-string KeyValueNode.
 * Used when a key has no associated value (bare key or key with empty colon).
 * @param key - The key name
 * @param pos - Source position of the key token
 * @returns A keyValue node with an empty string scalar
 */
export function mkEmptyKV(key: string, pos: SourcePosition) {
  const empty: ScalarNode = {
    type: 'scalar',
    scalarType: 'string',
    value: '',
    quoted: false,
    position: pos,
  };
  return { type: 'keyValue' as const, key, value: empty, position: pos };
}

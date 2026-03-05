/**
 * @module parser/ast-helpers
 * Factory functions and utility helpers for creating AST nodes.
 * Type definitions live in {@link module:parser/ast}.
 */

import type { ScalarNode, SourcePosition } from './ast.js';

// ---------------------------------------------------------------------------
// Position factory
// ---------------------------------------------------------------------------

/**
 * Create a {@link SourcePosition}.
 * @param line - Line number (1-based)
 * @param column - Column number (1-based)
 * @param offset - Byte offset from start of document
 * @example
 * ```ts
 * const pos = createPosition(1, 1, 0);
 * // { line: 1, column: 1, offset: 0 }
 * ```
 */
export function createPosition(line: number, column: number, offset: number): SourcePosition {
  return { line, column, offset };
}

// ---------------------------------------------------------------------------
// Scalar inference
// ---------------------------------------------------------------------------

/**
 * Infer a typed scalar node from a raw string. Detection order:
 * null -> boolean -> number -> string (fallback). Only exact
 * lowercase matches are detected (`'true'`, not `'True'`).
 * @param raw - The raw string value to infer a type for
 * @param position - Source position for the resulting node
 * @example
 * ```ts
 * const pos = createPosition(1, 1, 0);
 * inferScalar('42', pos);     // NumberScalar  { value: 42 }
 * inferScalar('true', pos);   // BooleanScalar { value: true }
 * inferScalar('null', pos);   // NullScalar    { value: null }
 * inferScalar('hello', pos);  // StringScalar  { value: 'hello' }
 * ```
 */
export function inferScalar(raw: string, position: SourcePosition): ScalarNode {
  if (raw === 'null') {
    return { type: 'scalar', scalarType: 'null', value: null, position };
  }
  if (raw === 'true') {
    return { type: 'scalar', scalarType: 'boolean', value: true, position };
  }
  if (raw === 'false') {
    return { type: 'scalar', scalarType: 'boolean', value: false, position };
  }
  // Number: optional sign, no leading zeros, optional decimal + exponent
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) {
    const num = Number(raw);
    if (Number.isFinite(num)) {
      return { type: 'scalar', scalarType: 'number', value: num, raw, position };
    }
  }
  return { type: 'scalar', scalarType: 'string', value: raw, quoted: false, position };
}

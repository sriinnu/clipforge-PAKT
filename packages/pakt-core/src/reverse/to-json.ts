/**
 * @module reverse/to-json
 * Converts PAKT AST body nodes back to a JSON string.
 * The output is always valid JSON parseable by `JSON.parse()`.
 *
 * This is the foundation of lossless round-trip:
 * `JSON.parse(toJson(body))` must produce the exact same JS object
 * that went into L1 compression.
 */

import type { BodyNode } from '../parser/ast.js';
import { bodyToValue } from './helpers.js';

/**
 * Convert PAKT AST body nodes to a JSON string.
 *
 * The conversion logic:
 * - `KeyValueNode` becomes `{ key: value }` in the output object
 * - `ObjectNode` becomes `{ key: { ...children } }`
 * - `TabularArrayNode` becomes `{ key: [ {field1: val1, ...}, ... ] }`
 * - `InlineArrayNode` becomes `{ key: [val1, val2, ...] }`
 * - `ListArrayNode` becomes `{ key: [ {prop1: val1, ...}, ... ] }`
 * - `CommentNode` is skipped
 *
 * Scalars are converted to their JS equivalents: StringScalar to string,
 * NumberScalar to number, BooleanScalar to boolean, NullScalar to null.
 *
 * Quoted strings that look like numbers, booleans, or null remain as strings
 * (handled by the AST preserving them as StringScalar with `quoted: true`).
 *
 * @param body - The body nodes from a parsed PAKT document
 * @param indent - Number of spaces for indentation (default: 2)
 * @returns A JSON string parseable by `JSON.parse()`
 *
 * @example
 * ```ts
 * import { toJson } from './reverse/to-json.js';
 *
 * const json = toJson([
 *   { type: 'keyValue', key: 'name', value: stringScalar, position: pos },
 *   { type: 'keyValue', key: 'age', value: numberScalar, position: pos },
 * ]);
 * // '{\n  "name": "Alice",\n  "age": 30\n}'
 *
 * JSON.parse(json);
 * // { name: 'Alice', age: 30 }
 * ```
 */
export function toJson(body: BodyNode[], indent?: number): string {
  const value = bodyToValue(body);
  return JSON.stringify(value, null, indent ?? 2);
}

/**
 * @module serializer/format-scalar
 * Shared scalar formatting utilities used by both the compact serializer
 * and the pretty printer. Centralises quoting rules, escape sequences,
 * and scalar-to-string conversion for PAKT round-trip safety.
 */

import type { ScalarNode } from '../parser/ast.js';

/**
 * Format a scalar node as a PAKT value string.
 * Dispatches by scalarType and applies quoting when needed.
 *
 * @param scalar - The scalar node to format
 * @returns Formatted string suitable for PAKT output
 *
 * @example
 * ```ts
 * formatScalar({ type: 'scalar', scalarType: 'number', value: 42, raw: '42', position: p });
 * // => '42'
 * ```
 */
export function formatScalar(scalar: ScalarNode): string {
  switch (scalar.scalarType) {
    case 'number':
      return scalar.raw;
    case 'boolean':
      return String(scalar.value);
    case 'null':
      return 'null';
    case 'string':
      return formatString(scalar.value, scalar.quoted);
  }
}

/** Format a tabular cell, quoting values that contain pipe characters. */
export function formatTabularCell(scalar: ScalarNode): string {
  if (scalar.scalarType === 'string' && scalar.value.includes('|')) {
    return quoteString(scalar.value);
  }
  return formatScalar(scalar);
}

/** Format a string value, quoting it if necessary for PAKT safety. */
function formatString(value: string, wasQuoted: boolean): string {
  if (wasQuoted || needsQuoting(value)) {
    return quoteString(value);
  }
  return value;
}

/** Check if a string value requires quoting (`:`, `|`, `$`, `%`, whitespace, etc.). */
function needsQuoting(value: string): boolean {
  if (value.length === 0) return true;
  if (value.includes(':')) return true;
  if (value.includes('|')) return true;
  if (value.startsWith('$')) return true;
  if (value.startsWith('%')) return true;
  if (value !== value.trim()) return true;
  if (value.includes('\n')) return true;
  if (value.includes('"')) return true;
  if (value.includes('\\')) return true;
  return false;
}

/**
 * Wrap a string in double quotes, escaping special characters.
 * Escapes: `\` -> `\\`, `"` -> `\"`, newline -> `\n`.
 */
function quoteString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
  return `"${escaped}"`;
}

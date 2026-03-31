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

/**
 * Format a string value, quoting it if necessary for PAKT safety.
 *
 * Note on `~`: bare `~` is the delta sentinel (L1-delta) and must stay
 * unquoted when wasQuoted=false. Real user-supplied `~` values always
 * have wasQuoted=true (set by the parser and L2-clone NEEDS_QUOTE_AFTER_EXPAND_RE),
 * so they are force-quoted via the wasQuoted branch above. Adding `~` to
 * needsQuoting() would break delta sentinel round-trips.
 */
function formatString(value: string, wasQuoted: boolean): string {
  if (wasQuoted || needsQuoting(value)) {
    return quoteString(value);
  }
  return value;
}

/** Check if a string value requires quoting (`:`, `|`, `$`, `%`, whitespace, tabs, etc.). */
function needsQuoting(value: string): boolean {
  if (value.length === 0) return true;
  if (value.includes(':')) return true;
  if (value.includes('|')) return true;
  if (value.startsWith('$')) return true;
  if (value.startsWith('%')) return true;
  if (value !== value.trim()) return true;
  if (value.includes('\n')) return true;
  if (value.includes('\t')) return true;
  if (value.includes('\r')) return true;
  if (value.includes('"')) return true;
  if (value.includes('\\')) return true;
  return false;
}

/**
 * Wrap a string in double quotes, escaping special characters.
 * Escapes: `\` -> `\\`, `"` -> `\"`, newline -> `\n`, tab -> `\t`, CR -> `\r`.
 */
function quoteString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r');
  return `"${escaped}"`;
}

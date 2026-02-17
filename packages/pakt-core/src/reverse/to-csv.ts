/**
 * @module reverse/to-csv
 * Converts PAKT AST body nodes to a CSV string (RFC 4180 compliant).
 * Only works for tabular data or flat key-value structures.
 * Throws an error for non-tabular/non-flat data.
 */

import type {
  BodyNode,
  TabularArrayNode,
  KeyValueNode,
} from '../parser/ast.js';
import { scalarToJS } from './helpers.js';

/**
 * Convert PAKT AST body nodes to a CSV string.
 *
 * Supported input shapes:
 * - **TabularArrayNode**: Emits a header row from field names, then one data
 *   row per tabular row. This is the primary use case.
 * - **Flat KeyValueNodes only**: Emits two rows -- a keys row and a values row.
 *
 * Values containing commas, double quotes, or newlines are quoted per RFC 4180.
 *
 * @param body - The body nodes from a parsed PAKT document
 * @returns A CSV string with CRLF line endings (per RFC 4180)
 * @throws {Error} If no tabular or flat data is found
 *
 * @example
 * ```ts
 * import { toCsv } from './reverse/to-csv.js';
 *
 * // From a tabular array
 * const csv = toCsv([tabularArrayNode]);
 * // 'id,name,status\r\n1,VAAYU,active\r\n2,ClipForge,planning\r\n'
 *
 * // From flat key-value pairs
 * const csv2 = toCsv([kvName, kvAge, kvActive]);
 * // 'name,age,active\r\nAlice,30,true\r\n'
 * ```
 */
export function toCsv(body: BodyNode[]): string {
  // Strategy 1: Look for a TabularArrayNode
  const tabular = body.find((n): n is TabularArrayNode => n.type === 'tabularArray');
  if (tabular) {
    return tabularToCsv(tabular);
  }

  // Strategy 2: All non-comment nodes are KeyValueNodes (flat object)
  const dataNodes = body.filter((n) => n.type !== 'comment');
  const allKV = dataNodes.length > 0 && dataNodes.every((n): n is KeyValueNode => n.type === 'keyValue');
  if (allKV) {
    return flatKvToCsv(dataNodes as KeyValueNode[]);
  }

  throw new Error('Cannot convert to CSV: no tabular data found');
}

/**
 * Convert a TabularArrayNode to CSV.
 * First row is the field names, subsequent rows are data.
 */
function tabularToCsv(node: TabularArrayNode): string {
  const lines: string[] = [];

  // Header row
  lines.push(node.fields.map(csvEscape).join(','));

  // Data rows
  for (const row of node.rows) {
    const cells = row.values.map((v) => {
      const jsVal = scalarToJS(v);
      return csvEscape(formatCsvValue(jsVal));
    });
    lines.push(cells.join(','));
  }

  return lines.join('\r\n') + '\r\n';
}

/**
 * Convert flat KeyValueNodes to CSV.
 * Emits two rows: keys row and values row.
 */
function flatKvToCsv(nodes: KeyValueNode[]): string {
  const keys = nodes.map((n) => csvEscape(n.key));
  const values = nodes.map((n) => {
    const jsVal = scalarToJS(n.value);
    return csvEscape(formatCsvValue(jsVal));
  });

  return keys.join(',') + '\r\n' + values.join(',') + '\r\n';
}

/**
 * Format a JS value as a CSV cell string.
 *
 * @param value - The JS value to format
 * @returns The string representation for CSV
 */
function formatCsvValue(value: string | number | boolean | null): string {
  if (value === null) {
    return '';
  }
  return String(value);
}

/**
 * Escape a CSV field per RFC 4180 rules.
 *
 * If the field contains commas, double quotes, or newlines,
 * it is enclosed in double quotes. Any double quotes within
 * the field are escaped by doubling them.
 *
 * @param field - The field value to escape
 * @returns The RFC 4180 compliant field string
 *
 * @example
 * ```ts
 * csvEscape('hello');           // 'hello'
 * csvEscape('hello,world');     // '"hello,world"'
 * csvEscape('say "hi"');        // '"say ""hi"""'
 * csvEscape('line1\nline2');    // '"line1\nline2"'
 * ```
 */
function csvEscape(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
    return '"' + field.replace(/"/g, '""') + '"';
  }
  return field;
}

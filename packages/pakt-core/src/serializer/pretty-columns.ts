/**
 * @module serializer/pretty-columns
 * Column-alignment logic for the PAKT pretty printer.
 * Computes column widths and emits tabular rows with padded cells
 * so pipe characters align vertically.
 */

import type { TabularRowNode } from '../parser/ast.js';
import { formatTabularCell } from './format-scalar.js';

// ---------------------------------------------------------------------------
// Column width computation
// ---------------------------------------------------------------------------

/**
 * Compute the maximum display width for each column across all rows.
 * Used to pad cells so pipe characters align vertically.
 * @param rows     - All tabular data rows to measure
 * @param colCount - Number of columns (from the field header)
 * @returns Array of max widths, one per column
 */
export function computeColumnWidths(rows: TabularRowNode[], colCount: number): number[] {
  const widths = new Array<number>(colCount).fill(0);
  for (const row of rows) {
    for (let c = 0; c < row.values.length && c < colCount; c++) {
      const w = formatTabularCell(row.values[c]!).length;
      if (w > widths[c]!) widths[c] = w;
    }
  }
  return widths;
}

// ---------------------------------------------------------------------------
// Row emission
// ---------------------------------------------------------------------------

/**
 * Emit a tabular row with cells padded for vertical column alignment.
 * @param row    - The tabular row AST node
 * @param lines  - Output line accumulator (mutated in place)
 * @param prefix - Indentation prefix string
 * @param widths - Pre-computed max width per column
 */
export function emitAlignedRow(
  row: TabularRowNode,
  lines: string[],
  prefix: string,
  widths: number[],
): void {
  const cells: string[] = [];
  for (let c = 0; c < row.values.length; c++) {
    const raw = formatTabularCell(row.values[c]!);
    // Pad all columns except the last
    cells.push(c < row.values.length - 1 ? raw.padEnd(widths[c] ?? 0) : raw);
  }
  lines.push(`${prefix}${cells.join(' | ')}`);
}

/**
 * Emit a tabular row without column padding (compact mode).
 * @param row    - The tabular row AST node
 * @param lines  - Output line accumulator (mutated in place)
 * @param prefix - Indentation prefix string
 */
export function emitCompactRow(row: TabularRowNode, lines: string[], prefix: string): void {
  const cells = row.values.map((v) => formatTabularCell(v));
  lines.push(`${prefix}${cells.join('|')}`);
}

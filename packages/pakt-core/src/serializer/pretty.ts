/**
 * @module serializer/pretty
 * Pretty-prints a PAKT AST into human-readable, column-aligned PAKT format.
 * Unlike the compact serializer, this module pads tabular cells so pipe
 * characters align vertically, adds configurable section spacing, and uses
 * customisable indentation.
 */

import type {
  DocumentNode,
  HeaderNode,
  DictBlockNode,
  BodyNode,
  KeyValueNode,
  ObjectNode,
  TabularArrayNode,
  TabularRowNode,
  InlineArrayNode,
  ListArrayNode,
  ListItemNode,
  CommentNode,
} from '../parser/ast.js';
import { formatScalar, formatTabularCell } from './format-scalar.js';

// -- Header emission ordering ------------------------------------------------

const PRE_DICT_HEADERS: readonly string[] = ['version', 'from', 'target'];
const POST_DICT_HEADERS: readonly string[] = ['compress', 'warning'];

// -- Public types ------------------------------------------------------------

/**
 * Options for the pretty printer.
 * @example
 * ```ts
 * prettyPrint(ast, { indent: 4, alignColumns: true, sectionSpacing: 2 });
 * ```
 */
export interface PrettyOptions {
  /** Spaces per indent level (default: 2) */
  indent?: number;
  /** Target max line length before wrapping (default: 120) */
  maxLineLength?: number;
  /** Blank lines between top-level body sections (default: 1) */
  sectionSpacing?: number;
  /** Pad tabular cells so pipe characters align (default: true) */
  alignColumns?: boolean;
}

/** Resolved options with all defaults filled in. */
interface ResolvedOptions {
  indent: number;
  maxLineLength: number;
  sectionSpacing: number;
  alignColumns: boolean;
}

/** Fill in defaults for any omitted options. */
function resolveOptions(opts?: PrettyOptions): ResolvedOptions {
  return {
    indent: opts?.indent ?? 2,
    maxLineLength: opts?.maxLineLength ?? 120,
    sectionSpacing: opts?.sectionSpacing ?? 1,
    alignColumns: opts?.alignColumns ?? true,
  };
}

// -- Entry point -------------------------------------------------------------

/**
 * Pretty-print a PAKT AST into a human-readable PAKT string.
 *
 * Emission order matches the compact serializer:
 * pre-dict headers -> @dict...@end -> post-dict headers -> body.
 *
 * @param ast     - The document AST to pretty-print
 * @param options - Formatting options (all optional)
 * @returns The pretty-printed PAKT string
 *
 * @example
 * ```ts
 * import { prettyPrint } from './serializer/pretty.js';
 * const output = prettyPrint(documentNode, { indent: 2, alignColumns: true });
 * ```
 */
export function prettyPrint(ast: DocumentNode, options?: PrettyOptions): string {
  const opts = resolveOptions(options);
  const lines: string[] = [];

  const postDictLines = emitHeaders(ast.headers, lines);
  emitDictionary(ast.dictionary, postDictLines, lines, opts);

  // Blank separator between preamble and body
  if (lines.length > 0) lines.push('');

  emitTopLevelBody(ast.body, lines, 0, opts);
  return lines.join('\n') + (lines.length > 0 ? '\n' : '');
}

// -- Headers -----------------------------------------------------------------

/** Emit pre-dict headers into `lines`, return formatted post-dict lines. */
function emitHeaders(headers: HeaderNode[], lines: string[]): string[] {
  const postDictLines: string[] = [];
  for (const ht of PRE_DICT_HEADERS) {
    const h = headers.find((x) => x.headerType === ht);
    if (h) lines.push(`@${h.headerType} ${h.value}`);
  }
  for (const ht of POST_DICT_HEADERS) {
    const h = headers.find((x) => x.headerType === ht);
    if (h) postDictLines.push(`@${h.headerType} ${h.value}`);
  }
  return postDictLines;
}

// -- Dictionary --------------------------------------------------------------

/** Emit @dict...@end block (if present) followed by post-dict header lines. */
function emitDictionary(
  dict: DictBlockNode | null,
  postDictLines: string[],
  lines: string[],
  opts: ResolvedOptions,
): void {
  if (dict && dict.entries.length > 0) {
    const pad = ' '.repeat(opts.indent);
    lines.push('@dict');
    for (const entry of dict.entries) {
      lines.push(`${pad}${entry.alias}: ${entry.expansion}`);
    }
    lines.push('@end');
  }
  for (const line of postDictLines) lines.push(line);
}

// -- Top-level body (with section spacing) -----------------------------------

/**
 * Emit top-level body nodes with blank-line spacing between sections.
 * Adjacent comment nodes are kept tight (no spacing between them).
 */
function emitTopLevelBody(
  nodes: BodyNode[], lines: string[], depth: number, opts: ResolvedOptions,
): void {
  for (let i = 0; i < nodes.length; i++) {
    if (i > 0 && depth === 0 && opts.sectionSpacing > 0) {
      const prev = nodes[i - 1]!;
      const curr = nodes[i]!;
      // Keep adjacent comments tight
      if (prev.type !== 'comment' || curr.type !== 'comment') {
        for (let s = 0; s < opts.sectionSpacing; s++) lines.push('');
      }
    }
    emitNode(nodes[i]!, lines, depth, opts);
  }
}

// -- Node dispatch -----------------------------------------------------------

/** Emit a single body node, dispatching by type. */
function emitNode(
  node: BodyNode, lines: string[], depth: number, opts: ResolvedOptions,
): void {
  switch (node.type) {
    case 'keyValue':    return emitKeyValue(node, lines, depth, opts);
    case 'object':      return emitObject(node, lines, depth, opts);
    case 'tabularArray': return emitTabularArray(node, lines, depth, opts);
    case 'inlineArray': return emitInlineArray(node, lines, depth, opts);
    case 'listArray':   return emitListArray(node, lines, depth, opts);
    case 'comment':     return emitComment(node, lines, depth, opts);
  }
}

// -- Key-value ---------------------------------------------------------------

/** Emit `key: value`. */
function emitKeyValue(
  node: KeyValueNode, lines: string[], depth: number, opts: ResolvedOptions,
): void {
  lines.push(`${pad(depth, opts)}${node.key}: ${formatScalar(node.value)}`);
}

// -- Object ------------------------------------------------------------------

/** Emit object header then children at depth + 1. */
function emitObject(
  node: ObjectNode, lines: string[], depth: number, opts: ResolvedOptions,
): void {
  lines.push(`${pad(depth, opts)}${node.key}`);
  for (const child of node.children) emitNode(child, lines, depth + 1, opts);
}

// -- Tabular array -----------------------------------------------------------

/**
 * Compute the maximum display width for each column across all rows.
 * Used to pad cells so pipes align vertically.
 */
function computeColumnWidths(rows: TabularRowNode[], colCount: number): number[] {
  const widths = new Array<number>(colCount).fill(0);
  for (const row of rows) {
    for (let c = 0; c < row.values.length && c < colCount; c++) {
      const w = formatTabularCell(row.values[c]!).length;
      if (w > widths[c]!) widths[c] = w;
    }
  }
  return widths;
}

/** Emit a tabular array with optional column alignment. */
function emitTabularArray(
  node: TabularArrayNode, lines: string[], depth: number, opts: ResolvedOptions,
): void {
  const prefix = pad(depth, opts);
  lines.push(`${prefix}${node.key} [${node.count}]{${node.fields.join('|')}}:`);

  if (opts.alignColumns && node.rows.length > 0) {
    const widths = computeColumnWidths(node.rows, node.fields.length);
    for (const row of node.rows) emitAlignedRow(row, lines, depth + 1, opts, widths);
  } else {
    for (const row of node.rows) emitCompactRow(row, lines, depth + 1, opts);
  }
}

/** Emit a padded tabular row for column alignment. */
function emitAlignedRow(
  row: TabularRowNode, lines: string[], depth: number,
  opts: ResolvedOptions, widths: number[],
): void {
  const cells: string[] = [];
  for (let c = 0; c < row.values.length; c++) {
    const raw = formatTabularCell(row.values[c]!);
    // Pad all columns except the last
    cells.push(c < row.values.length - 1 ? raw.padEnd(widths[c] ?? 0) : raw);
  }
  lines.push(`${pad(depth, opts)}${cells.join(' | ')}`);
}

/** Emit a compact tabular row (no alignment). */
function emitCompactRow(
  row: TabularRowNode, lines: string[], depth: number, opts: ResolvedOptions,
): void {
  const cells = row.values.map((v) => formatTabularCell(v));
  lines.push(`${pad(depth, opts)}${cells.join('|')}`);
}

// -- Inline array ------------------------------------------------------------

/** Emit `key [count]: val1,val2,val3`. */
function emitInlineArray(
  node: InlineArrayNode, lines: string[], depth: number, opts: ResolvedOptions,
): void {
  const values = node.values.map((v) => formatScalar(v)).join(',');
  lines.push(`${pad(depth, opts)}${node.key} [${node.count}]: ${values}`);
}

// -- List array --------------------------------------------------------------

/** Emit `key [count]:` header followed by dash-prefixed items. */
function emitListArray(
  node: ListArrayNode, lines: string[], depth: number, opts: ResolvedOptions,
): void {
  lines.push(`${pad(depth, opts)}${node.key} [${node.count}]:`);
  for (const listItem of node.items) emitListItem(listItem, lines, depth + 1, opts);
}

/** Emit a list item: `- ` on first child, rest indented beneath. */
function emitListItem(
  listItem: ListItemNode, lines: string[], depth: number, opts: ResolvedOptions,
): void {
  const prefix = pad(depth, opts);
  for (let i = 0; i < listItem.children.length; i++) {
    const child = listItem.children[i]!;
    if (i === 0) {
      lines.push(`${prefix}- ${formatBodyNodeInline(child)}`);
    } else {
      emitNode(child, lines, depth + 1, opts);
    }
  }
}

/** Format a body node inline (for first child of a list item). */
function formatBodyNodeInline(node: BodyNode): string {
  switch (node.type) {
    case 'keyValue': return `${node.key}: ${formatScalar(node.value)}`;
    case 'comment':  return `% ${node.text}`;
    case 'object':   return node.key;
    default:         return '';
  }
}

// -- Comment -----------------------------------------------------------------

/** Emit `% comment text`. */
function emitComment(
  node: CommentNode, lines: string[], depth: number, opts: ResolvedOptions,
): void {
  lines.push(`${pad(depth, opts)}% ${node.text}`);
}

// -- Indent helper -----------------------------------------------------------

/** Generate indentation for `depth` levels using configured spacing. */
function pad(depth: number, opts: ResolvedOptions): string {
  return ' '.repeat(depth * opts.indent);
}

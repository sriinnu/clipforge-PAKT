/**
 * @module serializer/pretty
 * Pretty-prints a PAKT AST into human-readable, column-aligned PAKT format.
 * Unlike the compact serializer, this module pads tabular cells so pipe
 * characters align vertically, adds configurable section spacing, and uses
 * customisable indentation.
 *
 * Column-alignment helpers live in {@link module:serializer/pretty-columns}.
 */

import type {
  BodyNode,
  CommentNode,
  DictBlockNode,
  DocumentNode,
  HeaderNode,
  InlineArrayNode,
  KeyValueNode,
  ListArrayNode,
  ListItemNode,
  ObjectNode,
  TabularArrayNode,
} from '../parser/ast.js';
import { formatScalar } from './format-scalar.js';
import { computeColumnWidths, emitAlignedRow, emitCompactRow } from './pretty-columns.js';

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

/**
 * Fill in defaults for any omitted options.
 * @param opts - User-supplied options (may be partial or undefined)
 * @returns Fully resolved options with every field populated
 */
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

/**
 * Emit pre-dict headers into `lines`, return formatted post-dict lines.
 * @param headers - All header nodes from the AST
 * @param lines   - Output line accumulator (mutated in place)
 * @returns Post-dict header lines to be emitted after the @dict block
 */
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

/**
 * Emit @dict...@end block (if present) followed by post-dict header lines.
 * @param dict          - The dictionary AST node, or null if absent
 * @param postDictLines - Header lines to append after the dict block
 * @param lines         - Output line accumulator (mutated in place)
 * @param opts          - Resolved formatting options
 */
function emitDictionary(
  dict: DictBlockNode | null,
  postDictLines: string[],
  lines: string[],
  opts: ResolvedOptions,
): void {
  if (dict && dict.entries.length > 0) {
    const indentPad = ' '.repeat(opts.indent);
    lines.push('@dict');
    for (const entry of dict.entries) {
      lines.push(`${indentPad}${entry.alias}: ${entry.expansion}`);
    }
    lines.push('@end');
  }
  for (const line of postDictLines) lines.push(line);
}

// -- Top-level body (with section spacing) -----------------------------------

/**
 * Emit top-level body nodes with blank-line spacing between sections.
 * Adjacent comment nodes are kept tight (no spacing between them).
 * @param nodes - Body-level AST nodes to emit
 * @param lines - Output line accumulator (mutated in place)
 * @param depth - Current indentation depth
 * @param opts  - Resolved formatting options
 */
function emitTopLevelBody(
  nodes: BodyNode[],
  lines: string[],
  depth: number,
  opts: ResolvedOptions,
): void {
  for (let i = 0; i < nodes.length; i++) {
    if (i > 0 && depth === 0 && opts.sectionSpacing > 0) {
      // biome-ignore lint/style/noNonNullAssertion: i > 0 guarantees i-1 is valid
      const prev = nodes[i - 1]!;
      // biome-ignore lint/style/noNonNullAssertion: index guaranteed within bounds by loop condition
      const curr = nodes[i]!;
      // Keep adjacent comments tight
      if (prev.type !== 'comment' || curr.type !== 'comment') {
        for (let s = 0; s < opts.sectionSpacing; s++) lines.push('');
      }
    }
    // biome-ignore lint/style/noNonNullAssertion: index guaranteed within bounds by loop condition
    emitNode(nodes[i]!, lines, depth, opts);
  }
}

// -- Node dispatch -----------------------------------------------------------

/**
 * Emit a single body node, dispatching by AST node type.
 * @param node  - The body node to serialize
 * @param lines - Output line accumulator (mutated in place)
 * @param depth - Current indentation depth
 * @param opts  - Resolved formatting options
 */
function emitNode(node: BodyNode, lines: string[], depth: number, opts: ResolvedOptions): void {
  switch (node.type) {
    case 'keyValue':
      emitKeyValue(node, lines, depth, opts);
      break;
    case 'object':
      emitObject(node, lines, depth, opts);
      break;
    case 'tabularArray':
      emitTabularArray(node, lines, depth, opts);
      break;
    case 'inlineArray':
      emitInlineArray(node, lines, depth, opts);
      break;
    case 'listArray':
      emitListArray(node, lines, depth, opts);
      break;
    case 'comment':
      emitComment(node, lines, depth, opts);
      break;
  }
}

// -- Key-value ---------------------------------------------------------------

/**
 * Emit a key-value pair as `key: value`.
 * @param node  - The key-value AST node
 * @param lines - Output line accumulator (mutated in place)
 * @param depth - Current indentation depth
 * @param opts  - Resolved formatting options
 */
function emitKeyValue(
  node: KeyValueNode,
  lines: string[],
  depth: number,
  opts: ResolvedOptions,
): void {
  lines.push(`${pad(depth, opts)}${node.key}: ${formatScalar(node.value)}`);
}

// -- Object ------------------------------------------------------------------

/**
 * Emit an object header line, then recursively emit children at depth + 1.
 * @param node  - The object AST node
 * @param lines - Output line accumulator (mutated in place)
 * @param depth - Current indentation depth
 * @param opts  - Resolved formatting options
 */
function emitObject(node: ObjectNode, lines: string[], depth: number, opts: ResolvedOptions): void {
  lines.push(`${pad(depth, opts)}${node.key}`);
  for (const child of node.children) emitNode(child, lines, depth + 1, opts);
}

// -- Tabular array -----------------------------------------------------------

/**
 * Emit a tabular array with its field header and rows.
 * Uses column-aligned output when `opts.alignColumns` is true.
 * @param node  - The tabular array AST node
 * @param lines - Output line accumulator (mutated in place)
 * @param depth - Current indentation depth
 * @param opts  - Resolved formatting options
 */
function emitTabularArray(
  node: TabularArrayNode,
  lines: string[],
  depth: number,
  opts: ResolvedOptions,
): void {
  const prefix = pad(depth, opts);
  lines.push(`${prefix}${node.key} [${node.count}]{${node.fields.join('|')}}:`);

  const rowPrefix = pad(depth + 1, opts);
  if (opts.alignColumns && node.rows.length > 0) {
    const widths = computeColumnWidths(node.rows, node.fields.length);
    for (const row of node.rows) emitAlignedRow(row, lines, rowPrefix, widths);
  } else {
    for (const row of node.rows) emitCompactRow(row, lines, rowPrefix);
  }
}

// -- Inline array ------------------------------------------------------------

/**
 * Emit an inline array as `key [count]: val1,val2,val3`.
 * @param node  - The inline array AST node
 * @param lines - Output line accumulator (mutated in place)
 * @param depth - Current indentation depth
 * @param opts  - Resolved formatting options
 */
function emitInlineArray(
  node: InlineArrayNode,
  lines: string[],
  depth: number,
  opts: ResolvedOptions,
): void {
  const values = node.values.map((v) => formatScalar(v)).join(',');
  lines.push(`${pad(depth, opts)}${node.key} [${node.count}]: ${values}`);
}

// -- List array --------------------------------------------------------------

/**
 * Emit a list array: `key [count]:` header followed by dash-prefixed items.
 * @param node  - The list array AST node
 * @param lines - Output line accumulator (mutated in place)
 * @param depth - Current indentation depth
 * @param opts  - Resolved formatting options
 */
function emitListArray(
  node: ListArrayNode,
  lines: string[],
  depth: number,
  opts: ResolvedOptions,
): void {
  lines.push(`${pad(depth, opts)}${node.key} [${node.count}]:`);
  for (const listItem of node.items) emitListItem(listItem, lines, depth + 1, opts);
}

/**
 * Emit a list item: first child prefixed with `- `, rest indented beneath.
 * @param listItem - The list item AST node containing child nodes
 * @param lines    - Output line accumulator (mutated in place)
 * @param depth    - Current indentation depth
 * @param opts     - Resolved formatting options
 */
function emitListItem(
  listItem: ListItemNode,
  lines: string[],
  depth: number,
  opts: ResolvedOptions,
): void {
  const prefix = pad(depth, opts);

  // If the list item has no children, emit a bare dash at the current depth.
  if (listItem.children.length === 0) {
    lines.push(`${prefix}-`);
    return;
  }

  for (let i = 0; i < listItem.children.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index guaranteed within bounds by loop condition
    const child = listItem.children[i]!;
    if (i === 0) {
      const inline = formatBodyNodeInline(child);
      if (inline) {
        // Supported inline-first child: emit on the same line after "- ".
        lines.push(`${prefix}- ${inline}`);
      } else {
        // Unsupported type: emit bare "-" line, then child on the next indented line.
        lines.push(`${prefix}-`);
        emitNode(child, lines, depth + 1, opts);
      }
    } else {
      emitNode(child, lines, depth + 1, opts);
    }
  }
}

/**
 * Format a body node as a single inline string (for first child of a list item).
 * Only handles keyValue, comment, and object nodes; others return empty string.
 * @param node - The body node to format inline
 * @returns Single-line string representation of the node
 */
function formatBodyNodeInline(node: BodyNode): string {
  switch (node.type) {
    case 'keyValue':
      return `${node.key}: ${formatScalar(node.value)}`;
    case 'comment':
      return `% ${node.text}`;
    case 'object':
      return node.key;
    default:
      return '';
  }
}

// -- Comment -----------------------------------------------------------------

/**
 * Emit a comment line as `% comment text`.
 * @param node  - The comment AST node
 * @param lines - Output line accumulator (mutated in place)
 * @param depth - Current indentation depth
 * @param opts  - Resolved formatting options
 */
function emitComment(
  node: CommentNode,
  lines: string[],
  depth: number,
  opts: ResolvedOptions,
): void {
  lines.push(`${pad(depth, opts)}% ${node.text}`);
}

// -- Indent helper -----------------------------------------------------------

/**
 * Generate indentation whitespace for the given nesting depth.
 * @param depth - Number of indent levels
 * @param opts  - Resolved options (uses `indent` for spaces-per-level)
 * @returns String of spaces for the requested indentation
 */
function pad(depth: number, opts: ResolvedOptions): string {
  return ' '.repeat(depth * opts.indent);
}

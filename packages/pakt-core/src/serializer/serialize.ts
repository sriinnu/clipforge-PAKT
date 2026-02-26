/**
 * @module serializer/serialize
 * Converts a PAKT AST (DocumentNode) back into a compact PAKT-formatted string.
 * Handles headers, dictionary blocks, and all body node types with proper
 * indentation, quoting, and escaping for lossless round-tripping.
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
  TabularRowNode,
} from '../parser/ast.js';
import { formatScalar, formatTabularCell } from './format-scalar.js';

const INDENT = '  ';
const PRE_DICT_HEADERS: readonly string[] = ['version', 'from', 'target'];
const POST_DICT_HEADERS: readonly string[] = ['compress', 'warning'];

/**
 * Serialize a PAKT AST into a compact PAKT string.
 *
 * Emission order: pre-dict headers (@version, @from, @target) ->
 * dict block (@dict...@end) -> post-dict headers (@compress, @warning) -> body.
 *
 * @param ast - The document AST to serialize
 * @returns The PAKT-formatted string
 *
 * @example
 * ```ts
 * import { serialize } from './serializer/serialize.js';
 * const paktString = serialize(documentNode);
 * ```
 */
export function serialize(ast: DocumentNode): string {
  const lines: string[] = [];

  // 1. Emit pre-dict headers and collect post-dict header lines
  const postDictLines = emitHeaders(ast.headers, lines);

  // 2. Dictionary block + post-dict headers after @end
  emitDictionary(ast.dictionary, postDictLines, lines);

  // 3. Blank separator between preamble and body
  if (lines.length > 0) {
    lines.push('');
  }

  // 4. Body nodes
  emitBody(ast.body, lines, 0);

  return lines.join('\n') + (lines.length > 0 ? '\n' : '');
}

/**
 * Emit pre-dict headers (@version, @from, @target) into `lines` and return
 * formatted post-dict header lines (@compress, @warning) for later emission.
 */
function emitHeaders(headers: HeaderNode[], lines: string[]): string[] {
  const postDictLines: string[] = [];

  for (const ht of PRE_DICT_HEADERS) {
    const header = headers.find((h) => h.headerType === ht);
    if (header) {
      lines.push(`@${header.headerType} ${header.value}`);
    }
  }

  for (const ht of POST_DICT_HEADERS) {
    const header = headers.find((h) => h.headerType === ht);
    if (header) {
      postDictLines.push(`@${header.headerType} ${header.value}`);
    }
  }

  return postDictLines;
}

/**
 * Emit the `@dict` ... `@end` block if present, followed by any post-dict
 * header lines (@compress, @warning).
 */
function emitDictionary(
  dict: DictBlockNode | null,
  postDictLines: string[],
  lines: string[],
): void {
  if (dict && dict.entries.length > 0) {
    lines.push('@dict');
    for (const entry of dict.entries) {
      lines.push(`${INDENT}${entry.alias}: ${entry.expansion}`);
    }
    lines.push('@end');
  }

  for (const line of postDictLines) {
    lines.push(line);
  }
}

/** Emit all body nodes at a given indentation depth. */
function emitBody(nodes: BodyNode[], lines: string[], depth: number): void {
  for (const node of nodes) {
    emitNode(node, lines, depth);
  }
}

/** Emit a single body node, dispatching by node type. */
function emitNode(node: BodyNode, lines: string[], depth: number): void {
  switch (node.type) {
    case 'keyValue':
      emitKeyValue(node, lines, depth);
      break;
    case 'object':
      emitObject(node, lines, depth);
      break;
    case 'tabularArray':
      emitTabularArray(node, lines, depth);
      break;
    case 'inlineArray':
      emitInlineArray(node, lines, depth);
      break;
    case 'listArray':
      emitListArray(node, lines, depth);
      break;
    case 'comment':
      emitComment(node, lines, depth);
      break;
  }
}

/** Emit a key-value pair: `key: value`. */
function emitKeyValue(node: KeyValueNode, lines: string[], depth: number): void {
  const prefix = indent(depth);
  const value = formatScalar(node.value);
  lines.push(`${prefix}${node.key}: ${value}`);
}

/** Emit a nested object: key on its own line, children indented +2 spaces. */
function emitObject(node: ObjectNode, lines: string[], depth: number): void {
  const prefix = indent(depth);
  lines.push(`${prefix}${node.key}`);
  emitBody(node.children, lines, depth + 1);
}

/** Emit a tabular array: `key [count]{f1|f2|...}:` with pipe-delimited rows. */
function emitTabularArray(node: TabularArrayNode, lines: string[], depth: number): void {
  const prefix = indent(depth);
  const fieldList = node.fields.join('|');
  lines.push(`${prefix}${node.key} [${node.count}]{${fieldList}}:`);
  for (const row of node.rows) {
    emitTabularRow(row, lines, depth + 1);
  }
}

/** Emit a single tabular row as pipe-delimited values. */
function emitTabularRow(row: TabularRowNode, lines: string[], depth: number): void {
  const prefix = indent(depth);
  const cells = row.values.map((v) => formatTabularCell(v));
  lines.push(`${prefix}${cells.join('|')}`);
}

/** Emit an inline array: `key [count]: val1,val2,val3`. */
function emitInlineArray(node: InlineArrayNode, lines: string[], depth: number): void {
  const prefix = indent(depth);
  const values = node.values.map((v) => formatScalar(v)).join(',');
  lines.push(`${prefix}${node.key} [${node.count}]: ${values}`);
}

/** Emit a list array: `key [count]:` followed by dash-prefixed items. */
function emitListArray(node: ListArrayNode, lines: string[], depth: number): void {
  const prefix = indent(depth);
  lines.push(`${prefix}${node.key} [${node.count}]:`);
  for (const item of node.items) {
    emitListItem(item, lines, depth + 1);
  }
}

/** Emit a list item: `- ` prefix on first child, rest indented under it. */
function emitListItem(item: ListItemNode, lines: string[], depth: number): void {
  const prefix = indent(depth);

  for (let i = 0; i < item.children.length; i++) {
    const child = item.children[i]!;
    if (i === 0) {
      // First child gets the dash prefix
      const line = formatBodyNodeInline(child);
      lines.push(`${prefix}- ${line}`);
    } else {
      // Subsequent children indented under the dash (+2 for "- ")
      emitNode(child, lines, depth + 1);
    }
  }
}

/** Format a body node inline (for first child of a list item). */
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

/** Emit a comment line: `% comment text`. */
function emitComment(node: CommentNode, lines: string[], depth: number): void {
  const prefix = indent(depth);
  lines.push(`${prefix}% ${node.text}`);
}

/** Generate an indentation string for the given depth (each level = 2 spaces). */
function indent(depth: number): string {
  return INDENT.repeat(depth);
}

/**
 * @module reverse/to-markdown
 * Converts PAKT AST body nodes to a Markdown string.
 * Supports Markdown tables for tabular and flat data, and
 * formatted key-value lists for nested/complex data.
 */

import type {
  BodyNode,
  ScalarNode,
  TabularArrayNode,
  KeyValueNode,
  ObjectNode,
  InlineArrayNode,
  ListArrayNode,
} from '../parser/ast.js';
import { tabularToArray, inlineToArray, listToArray } from './helpers.js';

/**
 * Convert PAKT AST body nodes to a Markdown string.
 *
 * Output format depends on the data shape:
 * - **TabularArrayNode**: Renders as a Markdown table with header, separator,
 *   and data rows using pipe-delimited columns.
 * - **Flat KeyValueNodes**: Renders as a 2-column Markdown table (Key | Value).
 * - **Mixed/nested data**: Renders as formatted sections with headings and
 *   key-value lists.
 *
 * @param body - The body nodes from a parsed PAKT document
 * @returns A Markdown string
 *
 * @example
 * ```ts
 * import { toMarkdown } from './reverse/to-markdown.js';
 *
 * // Tabular array becomes a Markdown table
 * const md = toMarkdown([tabularArrayNode]);
 * // '| id | name | status |\n| --- | --- | --- |\n| 1 | VAAYU | active |\n'
 *
 * // Flat key-values become a 2-column table
 * const md2 = toMarkdown([kvName, kvAge]);
 * // '| Key | Value |\n| --- | --- |\n| name | Alice |\n| age | 30 |\n'
 * ```
 */
export function toMarkdown(body: BodyNode[]): string {
  const dataNodes = body.filter((n) => n.type !== 'comment');

  if (dataNodes.length === 0) {
    return '';
  }

  // Strategy 1: Single TabularArrayNode -> Markdown table
  const tabular = dataNodes.find((n): n is TabularArrayNode => n.type === 'tabularArray');
  if (tabular && dataNodes.length === 1) {
    return tabularToMarkdownTable(tabular);
  }

  // Strategy 2: All KeyValueNodes -> Key-Value table
  const allKV = dataNodes.every((n): n is KeyValueNode => n.type === 'keyValue');
  if (allKV) {
    return kvToMarkdownTable(dataNodes as KeyValueNode[]);
  }

  // Strategy 3: Mixed/complex data -> formatted sections
  return mixedToMarkdown(dataNodes);
}

/**
 * Render a TabularArrayNode as a Markdown table.
 * Includes a header row, separator row, and data rows.
 */
function tabularToMarkdownTable(node: TabularArrayNode): string {
  const lines: string[] = [];

  // Header row
  lines.push('| ' + node.fields.join(' | ') + ' |');

  // Separator row
  lines.push('| ' + node.fields.map(() => '---').join(' | ') + ' |');

  // Data rows
  for (const row of node.rows) {
    const cells = row.values.map((v) => escapeMdPipe(formatMdScalar(v)));
    lines.push('| ' + cells.join(' | ') + ' |');
  }

  return lines.join('\n') + '\n';
}

/**
 * Render flat KeyValueNodes as a 2-column Markdown table.
 */
function kvToMarkdownTable(nodes: KeyValueNode[]): string {
  const lines: string[] = [];

  lines.push('| Key | Value |');
  lines.push('| --- | --- |');

  for (const node of nodes) {
    const value = escapeMdPipe(formatMdScalar(node.value));
    lines.push(`| ${node.key} | ${value} |`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Render mixed/complex body nodes as formatted Markdown.
 * Uses headings for objects and tables for tabular arrays.
 */
function mixedToMarkdown(nodes: BodyNode[]): string {
  const parts: string[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'keyValue':
        parts.push(`**${node.key}**: ${formatMdScalar(node.value)}`);
        break;
      case 'object':
        parts.push(objectToMarkdown(node, 2));
        break;
      case 'tabularArray':
        parts.push(`### ${node.key}\n\n${tabularToMarkdownTable(node)}`);
        break;
      case 'inlineArray':
        parts.push(inlineArrayToMarkdown(node));
        break;
      case 'listArray':
        parts.push(listArrayToMarkdown(node));
        break;
      case 'comment':
        break;
    }
  }

  return parts.join('\n\n') + '\n';
}

/**
 * Render an ObjectNode as a Markdown section with a heading.
 */
function objectToMarkdown(node: ObjectNode, headingLevel: number): string {
  const heading = '#'.repeat(headingLevel);
  const lines: string[] = [`${heading} ${node.key}`];

  for (const child of node.children) {
    switch (child.type) {
      case 'keyValue':
        lines.push(`- **${child.key}**: ${formatMdScalar(child.value)}`);
        break;
      case 'object':
        lines.push('');
        lines.push(objectToMarkdown(child, Math.min(headingLevel + 1, 6)));
        break;
      case 'tabularArray':
        lines.push('');
        lines.push(tabularToMarkdownTable(child));
        break;
      case 'inlineArray':
        lines.push(inlineArrayToMarkdown(child));
        break;
      case 'listArray':
        lines.push(listArrayToMarkdown(child));
        break;
      case 'comment':
        break;
    }
  }

  return lines.join('\n');
}

/**
 * Render an InlineArrayNode as a Markdown bullet list.
 */
function inlineArrayToMarkdown(node: InlineArrayNode): string {
  const values = inlineToArray(node);
  const lines = [`**${node.key}**:`];
  for (const val of values) {
    lines.push(`- ${formatMdValue(val)}`);
  }
  return lines.join('\n');
}

/**
 * Render a ListArrayNode as a Markdown bullet list of key-value pairs.
 */
function listArrayToMarkdown(node: ListArrayNode): string {
  const items = listToArray(node);
  const lines = [`**${node.key}**:`];
  for (const item of items) {
    const entries = Object.entries(item);
    if (entries.length === 0) {
      lines.push('- (empty)');
    } else {
      const first = entries[0]!;
      lines.push(`- **${first[0]}**: ${formatMdValue(first[1])}`);
      for (let i = 1; i < entries.length; i++) {
        const entry = entries[i]!;
        lines.push(`  **${entry[0]}**: ${formatMdValue(entry[1])}`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Format a ScalarNode for Markdown output.
 */
function formatMdScalar(scalar: ScalarNode): string {
  switch (scalar.scalarType) {
    case 'null':
      return '*null*';
    case 'boolean':
      return String(scalar.value);
    case 'number':
      return String(scalar.value);
    case 'string':
      return scalar.value.length === 0 ? '*(empty)*' : scalar.value;
  }
}

/**
 * Format a plain JS value for Markdown output.
 */
function formatMdValue(value: unknown): string {
  if (value === null) {
    return '*null*';
  }
  if (typeof value === 'string') {
    return value.length === 0 ? '*(empty)*' : value;
  }
  return String(value);
}

/**
 * Escape pipe characters in Markdown table cells.
 * Pipes inside table cells must be escaped with a backslash.
 */
function escapeMdPipe(value: string): string {
  return value.replace(/\|/g, '\\|');
}

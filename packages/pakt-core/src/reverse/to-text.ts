/**
 * @module reverse/to-text
 * Converts PAKT AST body nodes to a human-readable plain text string.
 * Produces a simple, readable dump with no special formatting.
 * Uses 2-space indentation for nested structures.
 */

import type {
  BodyNode,
  InlineArrayNode,
  KeyValueNode,
  ListArrayNode,
  ObjectNode,
  ScalarNode,
  TabularArrayNode,
} from '../parser/ast.js';
import { inlineToArray, listToArray, tabularToArray } from './helpers.js';

const INDENT = '  ';

/**
 * Convert PAKT AST body nodes to a human-readable plain text string.
 *
 * Output format:
 * - Key-value pairs: `key: value` on each line
 * - Nested objects: indented with 2 spaces per level
 * - Tabular arrays: numbered items with key-value pairs
 * - Inline arrays: bullet-point list
 * - List arrays: numbered items with key-value pairs
 * - Comments are skipped
 *
 * @param body - The body nodes from a parsed PAKT document
 * @returns A plain text string
 *
 * @example
 * ```ts
 * import { toText } from './reverse/to-text.js';
 *
 * const text = toText([
 *   { type: 'keyValue', key: 'name', value: stringScalar, position: pos },
 *   { type: 'keyValue', key: 'age', value: numberScalar, position: pos },
 * ]);
 * // 'name: Alice\nage: 30\n'
 * ```
 */
export function toText(body: BodyNode[]): string {
  const lines: string[] = [];
  emitBodyNodes(body, lines, 0);
  return lines.join('\n') + (lines.length > 0 ? '\n' : '');
}

/** Emit all body nodes at a given depth. */
function emitBodyNodes(nodes: BodyNode[], lines: string[], depth: number): void {
  for (const node of nodes) {
    emitBodyNode(node, lines, depth);
  }
}

/** Dispatch a single body node to the appropriate emitter. */
function emitBodyNode(node: BodyNode, lines: string[], depth: number): void {
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
      // Comments are skipped in text output
      break;
  }
}

/** Emit a key-value pair as `key: value`. */
function emitKeyValue(node: KeyValueNode, lines: string[], depth: number): void {
  const prefix = indent(depth);
  const value = formatTextScalar(node.value);
  lines.push(`${prefix}${node.key}: ${value}`);
}

/** Emit a nested object with a header line and indented children. */
function emitObject(node: ObjectNode, lines: string[], depth: number): void {
  const prefix = indent(depth);
  lines.push(`${prefix}${node.key}:`);
  emitBodyNodes(node.children, lines, depth + 1);
}

/** Emit a tabular array as numbered items with key-value pairs. */
function emitTabularArray(node: TabularArrayNode, lines: string[], depth: number): void {
  const prefix = indent(depth);
  const items = tabularToArray(node);
  lines.push(`${prefix}${node.key}:`);

  for (let i = 0; i < items.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index guaranteed within bounds by loop condition
    const item = items[i]!;
    lines.push(`${indent(depth + 1)}${i + 1}.`);
    for (const [key, val] of Object.entries(item)) {
      lines.push(`${indent(depth + 2)}${key}: ${formatTextValue(val)}`);
    }
  }
}

/** Emit an inline array as a bullet-point list. */
function emitInlineArray(node: InlineArrayNode, lines: string[], depth: number): void {
  const prefix = indent(depth);
  const values = inlineToArray(node);
  lines.push(`${prefix}${node.key}:`);
  for (const val of values) {
    lines.push(`${indent(depth + 1)}- ${formatTextValue(val)}`);
  }
}

/** Emit a list array as numbered items with key-value pairs. */
function emitListArray(node: ListArrayNode, lines: string[], depth: number): void {
  const prefix = indent(depth);
  const items = listToArray(node);
  lines.push(`${prefix}${node.key}:`);

  for (let i = 0; i < items.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index guaranteed within bounds by loop condition
    const item = items[i]!;
    lines.push(`${indent(depth + 1)}${i + 1}.`);
    for (const [key, val] of Object.entries(item)) {
      lines.push(`${indent(depth + 2)}${key}: ${formatTextValue(val)}`);
    }
  }
}

/**
 * Format a ScalarNode for plain text output.
 */
function formatTextScalar(scalar: ScalarNode): string {
  switch (scalar.scalarType) {
    case 'null':
      return 'null';
    case 'boolean':
      return String(scalar.value);
    case 'number':
      return String(scalar.value);
    case 'string':
      return scalar.value;
  }
}

/**
 * Format a plain JS value for text output.
 */
function formatTextValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  return String(value);
}

/** Generate an indentation string for the given depth. */
function indent(depth: number): string {
  return INDENT.repeat(depth);
}

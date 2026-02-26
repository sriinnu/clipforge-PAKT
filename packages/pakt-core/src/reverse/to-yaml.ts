/**
 * @module reverse/to-yaml
 * Converts PAKT AST body nodes back to a YAML string.
 * Pure string building with no external dependencies.
 * Uses 2-space indentation consistent with common YAML conventions.
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
 * Convert PAKT AST body nodes to a YAML string.
 *
 * - Key-value pairs become `key: value`
 * - Nested objects use indented children
 * - Tabular arrays become arrays of objects with `- ` items
 * - Inline arrays become `- item` lists
 * - List arrays become arrays of objects with `- ` items
 * - Comments are skipped
 *
 * String values containing `:`, `#`, or starting with special YAML
 * characters are wrapped in double quotes.
 *
 * @param body - The body nodes from a parsed PAKT document
 * @returns A YAML string
 *
 * @example
 * ```ts
 * import { toYaml } from './reverse/to-yaml.js';
 *
 * const yaml = toYaml([
 *   { type: 'keyValue', key: 'name', value: stringScalar, position: pos },
 *   { type: 'keyValue', key: 'active', value: boolScalar, position: pos },
 * ]);
 * // 'name: Alice\nactive: true\n'
 * ```
 */
export function toYaml(body: BodyNode[]): string {
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
      // Comments are skipped in YAML output
      break;
  }
}

/** Emit a key-value pair as `key: value`. */
function emitKeyValue(node: KeyValueNode, lines: string[], depth: number): void {
  const prefix = indent(depth);
  const value = formatYamlScalar(node.value);
  lines.push(`${prefix}${node.key}: ${value}`);
}

/** Emit a nested object with indented children. */
function emitObject(node: ObjectNode, lines: string[], depth: number): void {
  const prefix = indent(depth);
  lines.push(`${prefix}${node.key}:`);
  emitBodyNodes(node.children, lines, depth + 1);
}

/** Emit a tabular array as a YAML sequence of mappings. */
function emitTabularArray(node: TabularArrayNode, lines: string[], depth: number): void {
  const prefix = indent(depth);
  const items = tabularToArray(node);
  lines.push(`${prefix}${node.key}:`);
  for (const item of items) {
    emitYamlMapping(item, lines, depth + 1);
  }
}

/** Emit an inline array as a YAML sequence. */
function emitInlineArray(node: InlineArrayNode, lines: string[], depth: number): void {
  const prefix = indent(depth);
  const values = inlineToArray(node);
  lines.push(`${prefix}${node.key}:`);
  for (const val of values) {
    lines.push(`${indent(depth + 1)}- ${formatYamlValue(val)}`);
  }
}

/** Emit a list array as a YAML sequence of mappings. */
function emitListArray(node: ListArrayNode, lines: string[], depth: number): void {
  const prefix = indent(depth);
  const items = listToArray(node);
  lines.push(`${prefix}${node.key}:`);
  for (const item of items) {
    emitYamlMapping(item, lines, depth + 1);
  }
}

/**
 * Emit a JS object as a YAML mapping entry within a sequence.
 * The first key gets the `- ` prefix, subsequent keys are indented to align.
 */
function emitYamlMapping(obj: Record<string, unknown>, lines: string[], depth: number): void {
  const prefix = indent(depth);
  const keys = Object.keys(obj);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const val = obj[key];
    if (i === 0) {
      lines.push(`${prefix}- ${key}: ${formatYamlValue(val)}`);
    } else {
      lines.push(`${prefix}  ${key}: ${formatYamlValue(val)}`);
    }
  }
}

/**
 * Format a JS value for YAML output.
 * Numbers, booleans, and null are emitted bare.
 * Strings are quoted if they need YAML escaping.
 */
function formatYamlValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string') {
    return formatYamlString(value);
  }
  // Fallback for complex types (shouldn't happen in normal flow)
  return String(value);
}

/**
 * Format a ScalarNode for YAML output.
 * Uses the scalar type information to determine proper formatting.
 */
function formatYamlScalar(scalar: ScalarNode): string {
  switch (scalar.scalarType) {
    case 'null':
      return 'null';
    case 'boolean':
      return String(scalar.value);
    case 'number':
      return String(scalar.value);
    case 'string':
      return formatYamlString(scalar.value);
  }
}

/**
 * Format a string for YAML, quoting if it contains special characters.
 *
 * Strings are quoted when they:
 * - Contain `:` followed by a space, or end with `:`
 * - Contain `#`
 * - Start with special YAML characters (`&`, `*`, `!`, `|`, `>`, `'`, `"`, `%`, `@`, `` ` ``)
 * - Are empty
 * - Would be interpreted as YAML booleans/nulls (true, false, null, yes, no, etc.)
 * - Have leading/trailing whitespace
 * - Contain newlines
 */
function formatYamlString(value: string): string {
  if (needsYamlQuoting(value)) {
    return quoteYamlString(value);
  }
  return value;
}

/** Check whether a string value needs YAML quoting. */
function needsYamlQuoting(value: string): boolean {
  if (value.length === 0) return true;
  if (value !== value.trim()) return true;
  if (value.includes('\n')) return true;

  // Colon followed by space or at end
  if (/: /.test(value) || value.endsWith(':')) return true;

  // Hash/comment
  if (value.includes('#')) return true;

  // YAML special start characters
  if (/^[&*!|>'"%@`{[\-?]/.test(value)) return true;

  // Would be misinterpreted as YAML boolean/null
  const lower = value.toLowerCase();
  const yamlKeywords = ['true', 'false', 'null', 'yes', 'no', 'on', 'off', '~'];
  if (yamlKeywords.includes(lower)) return true;

  // Looks like a number
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) return true;

  // Comma-separated could be ambiguous
  if (value.includes(', ')) return false; // Allow commas, they're fine in YAML values

  return false;
}

/** Quote a string with double quotes for YAML, escaping special characters. */
function quoteYamlString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/** Generate an indentation string for the given depth. */
function indent(depth: number): string {
  return INDENT.repeat(depth);
}

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
import { inlineToArray, isPlainRecord, listToArray, tabularToArray } from './helpers.js';

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
  // An empty body decodes to {} (see bodyToValue); say so rather than emit nothing.
  if (lines.length === 0) return '{}\n';
  return `${lines.join('\n')}\n`;
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
  lines.push(`${prefix}${formatYamlKey(node.key)}: ${value}`);
}

/** Emit a nested object with indented children. */
function emitObject(node: ObjectNode, lines: string[], depth: number): void {
  const prefix = indent(depth);
  if (node.children.length === 0) {
    lines.push(`${prefix}${formatYamlKey(node.key)}: {}`);
    return;
  }
  lines.push(`${prefix}${formatYamlKey(node.key)}:`);
  emitBodyNodes(node.children, lines, depth + 1);
}

/** Emit a tabular array as a YAML sequence of mappings. */
function emitTabularArray(node: TabularArrayNode, lines: string[], depth: number): void {
  const prefix = indent(depth);
  const items = tabularToArray(node);
  if (items.length === 0) {
    lines.push(`${prefix}${formatYamlKey(node.key)}: []`);
    return;
  }
  lines.push(`${prefix}${formatYamlKey(node.key)}:`);
  for (const item of items) {
    emitYamlMapping(item, lines, depth + 1);
  }
}

/** Emit an inline array as a YAML flow sequence (e.g., key: [val1, val2]). */
function emitInlineArray(node: InlineArrayNode, lines: string[], depth: number): void {
  const prefix = indent(depth);
  const values = inlineToArray(node);
  const formatted = values.map((val) => formatYamlValue(val, true));
  lines.push(`${prefix}${formatYamlKey(node.key)}: [${formatted.join(', ')}]`);
}

/** Emit a list array as a YAML sequence of mappings. */
function emitListArray(node: ListArrayNode, lines: string[], depth: number): void {
  const prefix = indent(depth);
  const items = listToArray(node);
  if (items.length === 0) {
    lines.push(`${prefix}${formatYamlKey(node.key)}: []`);
    return;
  }
  lines.push(`${prefix}${formatYamlKey(node.key)}:`);
  for (const item of items) {
    if (isPlainRecord(item) && Object.keys(item).length > 0) {
      emitYamlMapping(item, lines, depth + 1);
    } else {
      // Primitive, array or empty-object element (#59 list shapes).
      lines.push(`${indent(depth + 1)}- ${formatYamlValue(item)}`);
    }
  }
}

/**
 * Emit a JS object as a YAML mapping entry within a sequence.
 * The first key gets the `- ` prefix, subsequent keys are indented to align.
 */
function emitYamlMapping(obj: Record<string, unknown>, lines: string[], depth: number): void {
  const prefix = indent(depth);
  let first = true;
  for (const [k, val] of Object.entries(obj)) {
    const lead = first ? '- ' : '  ';
    lines.push(`${prefix}${lead}${formatYamlKey(k)}: ${formatYamlValue(val)}`);
    first = false;
  }
}

/**
 * Format a JS value for YAML output.
 * Numbers, booleans, and null are emitted bare; arrays and objects as flow
 * collections. Strings are quoted if they need YAML escaping, and inside a
 * flow collection also when they hold a flow indicator (`, [ ] { }`).
 */
function formatYamlValue(value: unknown, inFlow = false): string {
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
    return inFlow && FLOW_INDICATOR.test(value) ? quoteYamlString(value) : formatYamlString(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => formatYamlValue(v, true)).join(', ')}]`;
  }
  if (isPlainRecord(value)) {
    const pairs = Object.entries(value).map(
      ([k, v]) => `${formatYamlKey(k, true)}: ${formatYamlValue(v, true)}`,
    );
    return `{${pairs.join(', ')}}`;
  }
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

/** Characters that end a plain scalar inside a flow collection. */
const FLOW_INDICATOR = /[,[\]{}]/;

/**
 * Format a mapping key. Quoted when it would need quoting as a value, or when
 * it holds any `:` (the reader splits a plain key at its first colon).
 */
function formatYamlKey(key: string, inFlow = false): string {
  if (needsYamlQuoting(key) || key.includes(':') || (inFlow && FLOW_INDICATOR.test(key))) {
    return quoteYamlString(key);
  }
  return key;
}

/** Check whether a string value needs YAML quoting. */
function needsYamlQuoting(value: string): boolean {
  if (value.length === 0) return true;
  if (value !== value.trim()) return true;
  if (hasControlChar(value)) return true;

  // Colon followed by space or at end
  if (/: /.test(value) || value.endsWith(':')) return true;

  // Hash/comment
  if (value.includes('#')) return true;

  // YAML special start characters
  if (/^[&*!|>'"%@`{[\-?:]/.test(value)) return true;

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

/** C0 controls and DEL; YAML double-quoted strings must escape them. */
function isControl(code: number): boolean {
  return code < 0x20 || code === 0x7f;
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) if (isControl(value.charCodeAt(i))) return true;
  return false;
}

/** Quote a string with double quotes for YAML, escaping special characters. */
function quoteYamlString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  let out = '';
  for (const ch of escaped) {
    const code = ch.charCodeAt(0);
    out += isControl(code) ? `\\x${code.toString(16).padStart(2, '0')}` : ch;
  }
  return `"${out}"`;
}

/** Generate an indentation string for the given depth. */
function indent(depth: number): string {
  return INDENT.repeat(depth);
}

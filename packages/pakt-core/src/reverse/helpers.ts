/**
 * @module reverse/helpers
 * Shared helper functions for converting PAKT AST body nodes to JavaScript
 * values. Used by all reverse pipeline modules (to-json, to-yaml, etc.).
 */

import type {
  BodyNode,
  ScalarNode,
  TabularArrayNode,
  InlineArrayNode,
  ListArrayNode,
  ListItemNode,
} from '../parser/ast.js';

/**
 * Convert a ScalarNode to its native JavaScript value.
 *
 * For string scalars with `quoted: true`, the value is always returned as a
 * string even if it looks like a number, boolean, or null. This preserves
 * type fidelity for lossless round-tripping.
 *
 * @param node - The scalar node to convert
 * @returns The native JS value (string, number, boolean, or null)
 *
 * @example
 * ```ts
 * scalarToJS({ type: 'scalar', scalarType: 'number', value: 42, raw: '42', position: pos });
 * // 42
 *
 * scalarToJS({ type: 'scalar', scalarType: 'string', value: '42', quoted: true, position: pos });
 * // '42' (stays string because quoted)
 * ```
 */
export function scalarToJS(node: ScalarNode): string | number | boolean | null {
  switch (node.scalarType) {
    case 'string':
      return node.value;
    case 'number':
      return node.value;
    case 'boolean':
      return node.value;
    case 'null':
      return null;
  }
}

/**
 * Convert a single BodyNode to its JavaScript value representation.
 *
 * @param node - The body node to convert
 * @returns A key-value tuple `[key, value]` for named nodes, or null for comments
 *
 * @example
 * ```ts
 * const [key, val] = nodeToEntry(keyValueNode);
 * // ['name', 'Sriinnu']
 * ```
 */
export function nodeToEntry(node: BodyNode): [string, unknown] | null {
  switch (node.type) {
    case 'keyValue':
      return [node.key, scalarToJS(node.value)];
    case 'object':
      return [node.key, bodyToObject(node.children)];
    case 'tabularArray':
      return [node.key, tabularToArray(node)];
    case 'inlineArray':
      return [node.key, inlineToArray(node)];
    case 'listArray':
      return [node.key, listToArray(node)];
    case 'comment':
      return null;
  }
}

/**
 * Recursively convert an array of BodyNode into a plain JavaScript object.
 * Comments are skipped.
 *
 * @param nodes - The body nodes to convert
 * @returns A record mapping keys to their JS values
 *
 * @example
 * ```ts
 * const obj = bodyToObject([
 *   { type: 'keyValue', key: 'name', value: stringScalar('Alice'), position: pos },
 *   { type: 'keyValue', key: 'age', value: numberScalar(30), position: pos },
 * ]);
 * // { name: 'Alice', age: 30 }
 * ```
 */
export function bodyToObject(nodes: BodyNode[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const node of nodes) {
    const entry = nodeToEntry(node);
    if (entry !== null) {
      const [key, value] = entry;
      result[key] = value;
    }
  }
  return result;
}

/**
 * Convert a TabularArrayNode to an array of objects.
 * Each row becomes an object with field names as keys.
 *
 * @param node - The tabular array node
 * @returns An array of objects
 *
 * @example
 * ```ts
 * tabularToArray(tabNode);
 * // [{ id: 1, name: 'VAAYU', status: 'active' }, ...]
 * ```
 */
export function tabularToArray(node: TabularArrayNode): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const row of node.rows) {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < node.fields.length; i++) {
      const field = node.fields[i];
      const cell = row.values[i];
      if (field !== undefined && cell !== undefined) {
        obj[field] = scalarToJS(cell);
      }
    }
    result.push(obj);
  }
  return result;
}

/**
 * Convert an InlineArrayNode to a JavaScript array of primitives.
 *
 * @param node - The inline array node
 * @returns An array of scalar JS values
 *
 * @example
 * ```ts
 * inlineToArray(inlineNode);
 * // ['React', 'TypeScript', 'Rust']
 * ```
 */
export function inlineToArray(node: InlineArrayNode): (string | number | boolean | null)[] {
  return node.values.map((v) => scalarToJS(v));
}

/**
 * Convert a ListArrayNode to a JavaScript array of objects.
 * Each list item's children are converted to an object.
 *
 * @param node - The list array node
 * @returns An array of objects
 *
 * @example
 * ```ts
 * listToArray(listNode);
 * // [{ type: 'deploy', success: true }, { type: 'alert', message: 'CPU spike' }]
 * ```
 */
export function listToArray(node: ListArrayNode): Record<string, unknown>[] {
  return node.items.map((item) => listItemToObject(item));
}

/**
 * Convert a single ListItemNode to a JavaScript object.
 *
 * @param item - The list item node
 * @returns An object representing the list item
 */
export function listItemToObject(item: ListItemNode): Record<string, unknown> {
  return bodyToObject(item.children);
}

/**
 * Convert body nodes to a top-level JavaScript value.
 * Determines if the root should be a plain object or if a single array node
 * represents a bare array.
 *
 * @param nodes - The body nodes from the document
 * @returns The root JS value (object, array, or other)
 *
 * @example
 * ```ts
 * const value = bodyToValue(documentNode.body);
 * // { name: 'Alice', projects: [...] }
 * ```
 */
export function bodyToValue(nodes: BodyNode[]): unknown {
  // Filter out comments
  const dataNodes = nodes.filter((n) => n.type !== 'comment');

  // If empty, return empty object
  if (dataNodes.length === 0) {
    return {};
  }

  // Special case: unwrap _root wrapper for root-level arrays
  if (dataNodes.length === 1) {
    const first = dataNodes[0]!;
    if (
      (first.type === 'tabularArray' ||
        first.type === 'inlineArray' ||
        first.type === 'listArray') &&
      (first as TabularArrayNode | InlineArrayNode | ListArrayNode).key === '_root'
    ) {
      const entry = nodeToEntry(first);
      if (entry) return entry[1];
    }
  }

  // All data nodes produce key-value entries -> root is an object
  return bodyToObject(nodes);
}

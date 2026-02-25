/**
 * @module layers/L1-decompress
 * L1 Structural Decompression: converts a PAKT AST body back into a
 * plain JavaScript object, array, or primitive.
 *
 * This is the inverse of {@link compressL1} — it reconstructs the
 * original data structure from its PAKT AST representation.
 *
 * @example
 * ```ts
 * import { decompressL1 } from './L1-decompress.js';
 * import { compressL1 } from './L1-compress.js';
 *
 * const original = { name: 'Sriinnu', age: 28 };
 * const doc = compressL1(original, 'json');
 * const restored = decompressL1(doc.body);
 * // restored deep-equals original
 * ```
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

// ---------------------------------------------------------------------------
// Scalar value extraction
// ---------------------------------------------------------------------------

/**
 * Extract the JavaScript primitive value from a {@link ScalarNode}.
 *
 * - `StringScalar` (quoted or not) returns the string `.value`
 * - `NumberScalar` returns the numeric `.value`
 * - `BooleanScalar` returns the boolean `.value`
 * - `NullScalar` returns `null`
 *
 * @param node - Any scalar AST node
 * @returns The corresponding JS primitive
 *
 * @example
 * ```ts
 * scalarToValue({ scalarType: 'number', value: 42, raw: '42', ... }); // 42
 * scalarToValue({ scalarType: 'string', value: 'hi', quoted: true, ... }); // 'hi'
 * scalarToValue({ scalarType: 'null', value: null, ... }); // null
 * ```
 */
export function scalarToValue(node: ScalarNode): string | number | boolean | null {
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

// ---------------------------------------------------------------------------
// Node decompression
// ---------------------------------------------------------------------------

/**
 * Decompress a {@link TabularArrayNode} into an array of uniform objects.
 *
 * @param node - The tabular array node
 * @returns An array of plain JS objects
 *
 * @example
 * ```ts
 * // TabularArrayNode { fields: ['id','name'], rows: [[1,'Alice'],[2,'Bob']] }
 * decompressTabular(node); // [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]
 * ```
 */
function decompressTabular(node: TabularArrayNode): Array<Record<string, unknown>> {
  return node.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < node.fields.length; i++) {
      const field = node.fields[i];
      const scalar = row.values[i];
      if (field !== undefined && scalar !== undefined) {
        obj[field] = scalarToValue(scalar);
      }
    }
    return obj;
  });
}

/**
 * Decompress an {@link InlineArrayNode} into an array of primitives.
 *
 * @param node - The inline array node
 * @returns An array of JS primitives
 *
 * @example
 * ```ts
 * // InlineArrayNode { values: [ScalarNode('React'), ScalarNode('Rust')] }
 * decompressInline(node); // ['React', 'Rust']
 * ```
 */
function decompressInline(node: InlineArrayNode): unknown[] {
  return node.values.map(scalarToValue);
}

/**
 * Decompress a {@link ListArrayNode} into an array of objects or mixed values.
 *
 * @param node - The list array node
 * @returns An array of plain JS values
 *
 * @example
 * ```ts
 * // ListArrayNode with items containing KeyValueNodes
 * decompressList(node); // [{ type: 'deploy', success: true }, ...]
 * ```
 */
function decompressList(node: ListArrayNode): unknown[] {
  return node.items.map((item) => {
    // Each list item's children form an object
    return bodyToValue(item.children);
  });
}

// ---------------------------------------------------------------------------
// Body-to-value conversion (recursive)
// ---------------------------------------------------------------------------

/**
 * Convert an array of body nodes into a plain JS object by mapping
 * each node to a key-value pair in the result.
 *
 * @param body - An array of PAKT body nodes
 * @returns A plain JS object
 *
 * @example
 * ```ts
 * // [KeyValueNode('name', 'Sriinnu'), ObjectNode('address', [...])]
 * bodyToValue(body); // { name: 'Sriinnu', address: { city: '...' } }
 * ```
 */
function bodyToValue(body: BodyNode[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const node of body) {
    switch (node.type) {
      case 'keyValue':
        result[(node as KeyValueNode).key] = scalarToValue((node as KeyValueNode).value);
        break;

      case 'object': {
        const objNode = node as ObjectNode;
        if (objNode.children.length === 0) {
          result[objNode.key] = {};
        } else {
          result[objNode.key] = bodyToValue(objNode.children);
        }
        break;
      }

      case 'tabularArray':
        result[(node as TabularArrayNode).key] = decompressTabular(node as TabularArrayNode);
        break;

      case 'inlineArray':
        result[(node as InlineArrayNode).key] = decompressInline(node as InlineArrayNode);
        break;

      case 'listArray':
        result[(node as ListArrayNode).key] = decompressList(node as ListArrayNode);
        break;

      case 'comment':
        // Comments are ignored during decompression
        break;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * L1 Structural Decompression — converts the body nodes from a PAKT AST
 * back into a plain JavaScript value.
 *
 * This is the inverse of {@link compressL1}. Together they satisfy:
 * ```
 * decompressL1(compressL1(data, fmt).body) deep-equals data
 * ```
 *
 * @param body - The body nodes from a {@link DocumentNode}
 * @returns The reconstructed JavaScript value (object, array, or primitive)
 *
 * @example
 * ```ts
 * import { decompressL1 } from './L1-decompress.js';
 *
 * // From an object document
 * const obj = decompressL1(doc.body);
 * // { name: 'Sriinnu', age: 28, active: true }
 *
 * // From a root-array document (key is '_root')
 * const arr = decompressL1(doc.body);
 * // { _root: [1, 2, 3] }  — caller unwraps via _root
 * ```
 */
export function decompressL1(body: BodyNode[]): unknown {
  if (body.length === 0) {
    return {};
  }

  // Special case: if the only node is a root-array wrapper, unwrap it
  if (body.length === 1) {
    const first = body[0]!;

    // Root array wrappers
    if (
      (first.type === 'tabularArray' ||
        first.type === 'inlineArray' ||
        first.type === 'listArray') &&
      (first as TabularArrayNode | InlineArrayNode | ListArrayNode).key === '_root'
    ) {
      switch (first.type) {
        case 'tabularArray':
          return decompressTabular(first as TabularArrayNode);
        case 'inlineArray':
          return decompressInline(first as InlineArrayNode);
        case 'listArray':
          return decompressList(first as ListArrayNode);
      }
    }

    // Root primitive wrapper
    if (first.type === 'keyValue' && (first as KeyValueNode).key === '_value') {
      return scalarToValue((first as KeyValueNode).value);
    }
  }

  // Default: treat body as an object
  return bodyToValue(body);
}

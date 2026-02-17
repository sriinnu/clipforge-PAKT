/**
 * @module layers/L1-compress
 * L1 Structural Compression: converts parsed JavaScript data (from JSON,
 * YAML, CSV) into a PAKT AST ({@link DocumentNode}).
 *
 * This is the first compression layer — it transforms the *shape* of the
 * data into PAKT's more compact syntax while preserving every value.
 *
 * @example
 * ```ts
 * import { compressL1 } from './L1-compress.js';
 * const doc = compressL1({ name: 'Sriinnu', age: 28 }, 'json');
 * // doc.body => [KeyValueNode('name', 'Sriinnu'), KeyValueNode('age', 28)]
 * ```
 */

import type {
  DocumentNode,
  BodyNode,
  KeyValueNode,
  ObjectNode,
  TabularArrayNode,
  TabularRowNode,
  InlineArrayNode,
  ListArrayNode,
  ListItemNode,
  ScalarNode,
  SourcePosition,
  FromHeaderNode,
} from '../parser/ast.js';
import { createPosition } from '../parser/ast.js';
import type { PaktFormat } from '../types.js';

// ---------------------------------------------------------------------------
// Synthetic position — we are building from data, not parsing source text
// ---------------------------------------------------------------------------

const POS: SourcePosition = createPosition(0, 0, 0);

// ---------------------------------------------------------------------------
// Scalar helpers
// ---------------------------------------------------------------------------

/**
 * Characters / patterns that force a string value to be quoted so the
 * PAKT parser can round-trip it without loss.
 */
const NEEDS_QUOTE_RE = /[:\|]|^\$|^%|^\s|\s$/;

/**
 * Strings whose unquoted form would be misread as another scalar type.
 */
function looksLikeNonString(v: string): boolean {
  if (v === 'null' || v === 'true' || v === 'false') return true;
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v);
}

/**
 * Does the string contain characters that need escape sequences inside
 * a quoted PAKT string?
 */
function needsEscape(v: string): boolean {
  return v.includes('\n') || v.includes('\t') || v.includes('"') || v.includes('\\');
}

/**
 * Convert an arbitrary JS value into its PAKT scalar representation.
 *
 * @param v - Any scalar JS value
 * @returns A fully typed {@link ScalarNode}
 *
 * @example
 * ```ts
 * toScalar(42);       // NumberScalar { value: 42, raw: '42' }
 * toScalar('hello');  // StringScalar { value: 'hello', quoted: false }
 * toScalar('true');   // StringScalar { value: 'true', quoted: true }
 * ```
 */
export function toScalar(v: unknown): ScalarNode {
  if (v === null) {
    return { type: 'scalar', scalarType: 'null', value: null, position: POS };
  }
  if (typeof v === 'boolean') {
    return { type: 'scalar', scalarType: 'boolean', value: v, position: POS };
  }
  if (typeof v === 'number') {
    return {
      type: 'scalar',
      scalarType: 'number',
      value: v,
      raw: String(v),
      position: POS,
    };
  }

  // Everything else is coerced to string
  const s = String(v);

  const mustQuote =
    looksLikeNonString(s) ||
    NEEDS_QUOTE_RE.test(s) ||
    needsEscape(s) ||
    s.includes(','); // commas need quoting for inline-array safety

  return {
    type: 'scalar',
    scalarType: 'string',
    value: s,
    quoted: mustQuote,
    position: POS,
  };
}

// ---------------------------------------------------------------------------
// Array classification helpers
// ---------------------------------------------------------------------------

function isPrimitive(v: unknown): boolean {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Check whether every element of `arr` is an object that shares the
 * *exact* same set of keys (same count, same names) AND every value
 * in those objects is a scalar (no nested objects/arrays).
 */
function isTabular(arr: unknown[]): arr is Array<Record<string, unknown>> {
  if (arr.length === 0) return false;
  const first = arr[0];
  if (!isPlainObject(first)) return false;

  const keys = Object.keys(first);
  if (keys.length === 0) return false;

  // First object values must all be scalars
  for (const k of keys) {
    if (!isPrimitive(first[k])) return false;
  }

  for (let i = 1; i < arr.length; i++) {
    const obj = arr[i];
    if (!isPlainObject(obj)) return false;
    const objKeys = Object.keys(obj);
    if (objKeys.length !== keys.length) return false;
    for (const k of keys) {
      if (!(k in obj)) return false;
      if (!isPrimitive(obj[k])) return false;
    }
  }
  return true;
}

function allPrimitives(arr: unknown[]): boolean {
  return arr.every(isPrimitive);
}

// ---------------------------------------------------------------------------
// Node builders
// ---------------------------------------------------------------------------

function buildKeyValue(key: string, value: unknown): KeyValueNode {
  return { type: 'keyValue', key, value: toScalar(value), position: POS };
}

function buildObjectNode(key: string, data: Record<string, unknown>): ObjectNode {
  return {
    type: 'object',
    key,
    children: buildBody(data),
    position: POS,
  };
}

function buildTabularArray(
  key: string,
  arr: Array<Record<string, unknown>>,
): TabularArrayNode {
  const fields = Object.keys(arr[0]!);
  const rows: TabularRowNode[] = arr.map((obj) => ({
    type: 'tabularRow' as const,
    values: fields.map((f) => toScalar(obj[f])),
    position: POS,
  }));
  return {
    type: 'tabularArray',
    key,
    count: arr.length,
    fields,
    rows,
    position: POS,
  };
}

function buildInlineArray(key: string, arr: unknown[]): InlineArrayNode {
  return {
    type: 'inlineArray',
    key,
    count: arr.length,
    values: arr.map(toScalar),
    position: POS,
  };
}

function buildListArray(key: string, arr: unknown[]): ListArrayNode {
  const items: ListItemNode[] = arr.map((item) => {
    if (isPlainObject(item)) {
      return {
        type: 'listItem' as const,
        children: buildBody(item),
        position: POS,
      };
    }
    // Primitive wrapped in a synthetic key-value — shouldn't normally
    // happen for a proper ListArray, but handle it for safety.
    return {
      type: 'listItem' as const,
      children: [buildKeyValue('value', item)],
      position: POS,
    };
  });
  return {
    type: 'listArray',
    key,
    count: arr.length,
    items,
    position: POS,
  };
}

// ---------------------------------------------------------------------------
// Array dispatch: decide which array node to use
// ---------------------------------------------------------------------------

function buildArrayNode(key: string, arr: unknown[]): BodyNode {
  if (arr.length === 0) {
    return buildInlineArray(key, []);
  }
  if (allPrimitives(arr)) {
    return buildInlineArray(key, arr);
  }
  if (isTabular(arr)) {
    return buildTabularArray(key, arr);
  }
  return buildListArray(key, arr);
}

// ---------------------------------------------------------------------------
// Body builder — converts an object's entries into body nodes
// ---------------------------------------------------------------------------

/**
 * Recursively converts a plain JavaScript object into an array of
 * PAKT body nodes.
 *
 * @param data - A plain JS object
 * @returns An array of {@link BodyNode} entries
 *
 * @example
 * ```ts
 * buildBody({ name: 'Sriinnu', address: { city: 'Hyderabad' } });
 * // [KeyValueNode('name', ...), ObjectNode('address', [KeyValueNode('city', ...)])]
 * ```
 */
export function buildBody(data: Record<string, unknown>): BodyNode[] {
  const body: BodyNode[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      body.push(buildArrayNode(key, value));
    } else if (isPlainObject(value)) {
      if (Object.keys(value).length === 0) {
        body.push({ type: 'object', key, children: [], position: POS } satisfies ObjectNode);
      } else {
        body.push(buildObjectNode(key, value));
      }
    } else {
      body.push(buildKeyValue(key, value));
    }
  }

  return body;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * L1 Structural Compression — converts a JavaScript value (parsed from
 * JSON, YAML, or CSV) into a PAKT AST {@link DocumentNode}.
 *
 * The resulting AST preserves every data value and can be losslessly
 * converted back via {@link decompressL1}.
 *
 * @param data - The parsed JavaScript value (object, array, or primitive)
 * @param fromFormat - The source format to record in the `@from` header
 * @returns A complete {@link DocumentNode}
 *
 * @example
 * ```ts
 * import { compressL1 } from './L1-compress.js';
 *
 * // Object input
 * const doc = compressL1({ name: 'Sriinnu', age: 28 }, 'json');
 * console.log(doc.headers[0]); // { headerType: 'from', value: 'json' }
 *
 * // Array input — root is a tabular array
 * const doc2 = compressL1([{ id: 1 }, { id: 2 }], 'json');
 * console.log(doc2.body[0].type); // 'tabularArray'
 * ```
 */
export function compressL1(data: unknown, fromFormat: PaktFormat): DocumentNode {
  const fromHeader: FromHeaderNode = {
    type: 'header',
    headerType: 'from',
    value: fromFormat,
    position: POS,
  };

  // --- Root is a plain object ---
  if (isPlainObject(data)) {
    return {
      type: 'document',
      headers: [fromHeader],
      dictionary: null,
      body: buildBody(data),
      position: POS,
    };
  }

  // --- Root is an array ---
  if (Array.isArray(data)) {
    const rootKey = '_root';
    const node = buildArrayNode(rootKey, data);
    return {
      type: 'document',
      headers: [fromHeader],
      dictionary: null,
      body: [node],
      position: POS,
    };
  }

  // --- Root is a primitive ---
  const kv: KeyValueNode = {
    type: 'keyValue',
    key: '_value',
    value: toScalar(data),
    position: POS,
  };
  return {
    type: 'document',
    headers: [fromHeader],
    dictionary: null,
    body: [kv],
    position: POS,
  };
}

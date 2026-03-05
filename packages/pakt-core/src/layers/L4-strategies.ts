/**
 * @module layers/L4-strategies
 * Individual AST-level compression strategies for L4 semantic compression.
 *
 * Each strategy mutates (or replaces) AST nodes to reduce the serialized
 * token count. Strategies are applied progressively, stopping once the
 * output fits within the caller-supplied token budget.
 *
 * Strategies in application order:
 * - **A -- Value truncation**: shorten long string scalars
 * - **B -- Array truncation**: summarise large arrays
 * - **C -- Field dropping**: prune low-informational fields from objects
 * - **D -- Redundancy collapse**: deduplicate consecutive identical items
 */

import type {
  BodyNode,
  DocumentNode,
  InlineArrayNode,
  KeyValueNode,
  ListArrayNode,
  ListItemNode,
  ObjectNode,
  ScalarNode,
  SourcePosition,
  StringScalar,
  TabularArrayNode,
} from '../parser/ast.js';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** Default position for synthetic nodes. */
const POS: SourcePosition = { line: 0, column: 0, offset: 0 };
/** Threshold above which string values are truncated (Strategy A). */
const LONG_STRING_THRESHOLD = 50;
/** Characters to keep when truncating a long string. */
const TRUNCATED_KEEP = 40;
/** Maximum array items before truncation kicks in (Strategy B). */
const LARGE_ARRAY_THRESHOLD = 10;
/** Items to keep at the start of a truncated array. */
const ARRAY_KEEP_HEAD = 3;
/** Items to keep at the end of a truncated array. */
const ARRAY_KEEP_TAIL = 2;
/** Maximum object fields before field dropping kicks in (Strategy C). */
const MANY_FIELDS_THRESHOLD = 8;
/** Maximum fraction of fields to drop (Strategy C). */
const FIELD_DROP_RATIO = 0.3;

// ---------------------------------------------------------------------------
// Helpers — synthetic node factories
// ---------------------------------------------------------------------------

/** Create a summary scalar node with the given text. */
function summaryScalar(text: string): StringScalar {
  return { type: 'scalar', scalarType: 'string', value: text, quoted: false, position: POS };
}

/** Create a key-value node with a summary scalar. */
function summaryKv(key: string, value: string): KeyValueNode {
  return { type: 'keyValue', key, value: summaryScalar(value), position: POS };
}

// ---------------------------------------------------------------------------
// Helpers — AST walker
// ---------------------------------------------------------------------------

/**
 * Collect all string scalar nodes from a document body (depth-first).
 * @param body - The body nodes to walk
 * @returns Array of mutable string scalar references
 */
function collectStringScalars(body: BodyNode[]): StringScalar[] {
  const result: StringScalar[] = [];
  function walk(nodes: BodyNode[]): void {
    for (const node of nodes) {
      switch (node.type) {
        case 'keyValue':
          if (node.value.scalarType === 'string') result.push(node.value);
          break;
        case 'object':
          walk(node.children);
          break;
        case 'inlineArray':
          for (const v of node.values) {
            if (v.scalarType === 'string') result.push(v);
          }
          break;
        case 'tabularArray':
          for (const row of node.rows) {
            for (const v of row.values) {
              if (v.scalarType === 'string') result.push(v);
            }
          }
          break;
        case 'listArray':
          for (const item of node.items) walk(item.children);
          break;
        case 'comment':
          break;
      }
    }
  }
  walk(body);
  return result;
}

// ---------------------------------------------------------------------------
// Strategy A — Value truncation
// ---------------------------------------------------------------------------

/**
 * Truncate long string values (>50 chars) to 40 chars + "...".
 * Processes longest values first. Mutates scalar nodes in-place.
 * @param doc - The document AST to transform
 * @returns The same document reference (mutated in-place)
 */
export function strategyValueTruncation(doc: DocumentNode): DocumentNode {
  const long = collectStringScalars(doc.body)
    .filter((s) => s.value.length > LONG_STRING_THRESHOLD)
    .sort((a, b) => b.value.length - a.value.length);
  for (const scalar of long) {
    scalar.value = `${scalar.value.slice(0, TRUNCATED_KEEP)}...`;
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Strategy B — Array truncation
// ---------------------------------------------------------------------------

/**
 * For large arrays (>10 items), keep first 3 + last 2 items and
 * replace the middle with a summary node: "... (N more items)".
 * Handles inline arrays, tabular arrays, and list arrays.
 * @param doc - The document AST to transform
 * @returns The same document reference (mutated in-place)
 */
export function strategyArrayTruncation(doc: DocumentNode): DocumentNode {
  walkBodyForArrays(doc.body);
  return doc;
}

/** Recursively walk body nodes and truncate large arrays. */
function walkBodyForArrays(nodes: BodyNode[]): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'object':
        walkBodyForArrays(node.children);
        break;
      case 'inlineArray':
        truncateInlineArray(node);
        break;
      case 'tabularArray':
        truncateTabularArray(node);
        break;
      case 'listArray':
        truncateListArray(node);
        break;
      default:
        break;
    }
  }
}

/** Truncate an inline array's values in-place. */
function truncateInlineArray(node: InlineArrayNode): void {
  if (node.values.length <= LARGE_ARRAY_THRESHOLD) return;
  const total = node.values.length;
  const middle = total - ARRAY_KEEP_HEAD - ARRAY_KEEP_TAIL;
  const head = node.values.slice(0, ARRAY_KEEP_HEAD);
  const tail = node.values.slice(total - ARRAY_KEEP_TAIL);
  node.values = [...head, summaryScalar(`... (${middle} more items)`), ...tail];
  node.count = node.values.length;
}

/** Truncate a tabular array's rows in-place. */
function truncateTabularArray(node: TabularArrayNode): void {
  if (node.rows.length <= LARGE_ARRAY_THRESHOLD) return;
  const total = node.rows.length;
  const middle = total - ARRAY_KEEP_HEAD - ARRAY_KEEP_TAIL;
  const head = node.rows.slice(0, ARRAY_KEEP_HEAD);
  const tail = node.rows.slice(total - ARRAY_KEEP_TAIL);
  // Summary row with placeholder padded to field count
  const summaryValues: ScalarNode[] = [summaryScalar(`... (${middle} more items)`)];
  while (summaryValues.length < node.fields.length) summaryValues.push(summaryScalar(''));
  const summaryRow = { type: 'tabularRow' as const, values: summaryValues, position: POS };
  node.rows = [...head, summaryRow, ...tail];
  node.count = node.rows.length;
}

/** Truncate a list array's items in-place. */
function truncateListArray(node: ListArrayNode): void {
  if (node.items.length <= LARGE_ARRAY_THRESHOLD) return;
  const total = node.items.length;
  const middle = total - ARRAY_KEEP_HEAD - ARRAY_KEEP_TAIL;
  const head = node.items.slice(0, ARRAY_KEEP_HEAD);
  const tail = node.items.slice(total - ARRAY_KEEP_TAIL);
  const summaryItem: ListItemNode = {
    type: 'listItem',
    children: [summaryKv('summary', `... (${middle} more items)`)],
    position: POS,
  };
  node.items = [...head, summaryItem, ...tail];
  node.count = node.items.length;
}

// ---------------------------------------------------------------------------
// Strategy C — Field dropping
// ---------------------------------------------------------------------------

/**
 * For objects with many fields (>8), drop the least-informative fields.
 * "Least informative" = fields with null, empty string, or boolean values.
 * Drops at most 30% of fields.
 * @param doc - The document AST to transform
 * @returns The same document reference (mutated in-place)
 */
export function strategyFieldDropping(doc: DocumentNode): DocumentNode {
  walkBodyForFieldDrop(doc.body);
  return doc;
}

/** Check whether a body node is "low informational" (null, empty, boolean). */
function isLowInfo(node: BodyNode): boolean {
  if (node.type !== 'keyValue') return false;
  const v = node.value;
  return (
    v.scalarType === 'null' ||
    v.scalarType === 'boolean' ||
    (v.scalarType === 'string' && v.value === '')
  );
}

/** Walk body nodes and drop low-info fields from large objects. */
function walkBodyForFieldDrop(nodes: BodyNode[]): void {
  for (const node of nodes) {
    if (node.type === 'object') {
      dropFieldsFromObject(node);
      walkBodyForFieldDrop(node.children);
    }
    if (node.type === 'listArray') {
      for (const item of node.items) walkBodyForFieldDrop(item.children);
    }
  }
}

/** Drop low-info fields from an object node (in-place). */
function dropFieldsFromObject(obj: ObjectNode): void {
  if (obj.children.length <= MANY_FIELDS_THRESHOLD) return;
  const maxDrop = Math.floor(obj.children.length * FIELD_DROP_RATIO);
  let dropped = 0;
  obj.children = obj.children.filter((child) => {
    if (dropped >= maxDrop) return true;
    if (isLowInfo(child)) {
      dropped++;
      return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Strategy D — Redundancy collapse
// ---------------------------------------------------------------------------

/**
 * If consecutive list array items have identical structure (same keys),
 * keep first + count and replace repeated items with "... (N identical)".
 * @param doc - The document AST to transform
 * @returns The same document reference (mutated in-place)
 */
export function strategyRedundancyCollapse(doc: DocumentNode): DocumentNode {
  walkBodyForRedundancy(doc.body);
  return doc;
}

/** Walk body nodes and collapse consecutive identical list items. */
function walkBodyForRedundancy(nodes: BodyNode[]): void {
  for (const node of nodes) {
    if (node.type === 'object') walkBodyForRedundancy(node.children);
    if (node.type === 'listArray') collapseListArray(node);
  }
}

/** Extract the key signature of a list item (sorted key names). */
function itemSignature(item: ListItemNode): string {
  return item.children
    .filter((c): c is KeyValueNode | ObjectNode => c.type === 'keyValue' || c.type === 'object')
    .map((c) => c.key)
    .sort()
    .join(',');
}

/** Collapse consecutive identical-structure items in a list array. */
function collapseListArray(node: ListArrayNode): void {
  if (node.items.length < 3) return;
  const newItems: ListItemNode[] = [];
  let i = 0;
  while (i < node.items.length) {
    const current = node.items[i]!;
    const sig = itemSignature(current);
    let runLength = 1;
    // Count consecutive items with the same signature
    while (i + runLength < node.items.length && itemSignature(node.items[i + runLength]!) === sig) {
      runLength++;
    }
    if (runLength >= 3) {
      newItems.push(current);
      const summaryItem: ListItemNode = {
        type: 'listItem',
        children: [summaryKv('summary', `... (${runLength - 1} identical)`)],
        position: POS,
      };
      newItems.push(summaryItem);
      i += runLength;
    } else {
      for (let j = 0; j < runLength; j++) newItems.push(node.items[i + j]!);
      i += runLength;
    }
  }
  node.items = newItems;
  node.count = newItems.length;
}

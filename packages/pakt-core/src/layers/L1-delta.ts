/**
 * @module layers/L1-delta
 * Delta encoding for tabular arrays — inspired by DeltaKV (arXiv:2602.08005).
 *
 * Replaces repeated adjacent values in tabular rows with `~` sentinels.
 * Row 0 is the reference frame; row N stores only fields that differ from
 * row N-1. Decompression replaces `~` with the previous row's value.
 *
 * This runs as a post-pass on L1 structural compression, operating on
 * {@link TabularArrayNode}s in the AST. It does NOT modify objects,
 * inline arrays, or list arrays.
 *
 * @see docs/articles/delta-encoding-for-homogeneous-arrays.md
 *
 * @example
 * ```ts
 * import { applyDeltaEncoding, revertDeltaEncoding } from './L1-delta.js';
 *
 * // Compress: replace repeated values with ~
 * const encoded = applyDeltaEncoding(doc);
 *
 * // Decompress: restore ~ sentinels to real values
 * const decoded = revertDeltaEncoding(doc);
 * ```
 */

import { createPosition } from '../parser/ast-helpers.js';
import type {
  BodyNode,
  DocumentNode,
  HeaderNode,
  ScalarNode,
  SourcePosition,
  TabularArrayNode,
  TabularRowNode,
} from '../parser/ast.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sentinel value that replaces unchanged fields in delta-encoded rows. */
export const DELTA_SENTINEL = '~';

/** Minimum rows for delta encoding to activate (below this, overhead > savings). */
export const MIN_DELTA_ROWS = 3;

/**
 * Minimum ratio of delta-replaceable fields to total fields for encoding
 * to be worthwhile. Below this threshold, the `@compress delta` header
 * costs more tokens than the `~` sentinels save.
 */
export const MIN_DELTA_RATIO = 0.3;

/**
 * Maximum recursion depth for delta encode/decode body traversal.
 * Prevents stack overflow on adversarially deep ASTs.
 */
export const MAX_DELTA_DEPTH = 64;

/** Header value that signals delta encoding is active. */
const DELTA_HEADER_VALUE = 'delta';

/** Synthetic position for generated AST nodes. */
const POS: SourcePosition = createPosition(0, 0, 0);

// ---------------------------------------------------------------------------
// Scalar comparison
// ---------------------------------------------------------------------------

/**
 * Compare two scalar nodes for value equality. Two scalars are equal if
 * they have the same type and the same value.
 *
 * @param a - First scalar node
 * @param b - Second scalar node
 * @returns True if both scalars represent the same value
 */
function scalarsEqual(a: ScalarNode, b: ScalarNode): boolean {
  if (a.scalarType !== b.scalarType) return false;
  return a.value === b.value;
}

/**
 * Shared frozen sentinel node — avoids allocating a new object per cell.
 * Safe to share because sentinel nodes are never mutated after creation.
 */
const FROZEN_SENTINEL: ScalarNode = Object.freeze({
  type: 'scalar',
  scalarType: 'string',
  value: DELTA_SENTINEL,
  quoted: false,
  position: POS,
}) as ScalarNode;

/**
 * Return the shared `~` sentinel scalar node. Uses a single frozen
 * instance to avoid per-cell allocations in large tables.
 */
function makeSentinel(): ScalarNode {
  return FROZEN_SENTINEL;
}

/**
 * Check if a scalar node is a `~` sentinel (used during decompression).
 *
 * @param node - Scalar node to check
 * @returns True if the node represents the delta sentinel
 */
export function isDeltaSentinel(node: ScalarNode): boolean {
  /* Sentinels are always unquoted. Real `~` values in user data are force-quoted
     by toScalar() (see NEEDS_QUOTE_RE in L1-compress.ts), so quoted === true
     means it's a real value, not a sentinel. */
  return node.scalarType === 'string' && node.value === DELTA_SENTINEL && node.quoted === false;
}

// ---------------------------------------------------------------------------
// Delta analysis
// ---------------------------------------------------------------------------

/**
 * Analyze a tabular array to determine if delta encoding is beneficial.
 * Returns the ratio of fields that can be replaced with `~` sentinels.
 *
 * @param node - Tabular array node to analyze
 * @returns Delta ratio (0.0 = no repetition, 1.0 = all fields repeated)
 *
 * @example
 * ```ts
 * const ratio = computeDeltaRatio(tabularNode);
 * // ratio = 0.6 means 60% of non-first-row fields are repeated
 * ```
 */
export function computeDeltaRatio(node: TabularArrayNode): number {
  if (node.rows.length < MIN_DELTA_ROWS) return 0;

  const fieldCount = node.fields.length;
  /* Total non-header cells that could potentially be delta-encoded */
  const totalCells = (node.rows.length - 1) * fieldCount;
  if (totalCells === 0) return 0;

  let deltaCount = 0;
  for (let r = 1; r < node.rows.length; r++) {
    const prevRow = node.rows[r - 1]!;
    const currRow = node.rows[r]!;
    for (let f = 0; f < fieldCount; f++) {
      const prev = prevRow.values[f];
      const curr = currRow.values[f];
      if (prev && curr && scalarsEqual(prev, curr)) {
        deltaCount++;
      }
    }
  }

  return deltaCount / totalCells;
}

// ---------------------------------------------------------------------------
// Delta encoding (compression)
// ---------------------------------------------------------------------------

/**
 * Apply delta encoding to a single tabular array node. Replaces field
 * values that match the previous row with `~` sentinel nodes.
 *
 * Row 0 is always preserved in full as the reference frame.
 *
 * Uses a single-pass approach: builds encoded rows optimistically while
 * counting deltas, then checks the ratio after the pass. If the ratio
 * is below {@link MIN_DELTA_RATIO}, discards the work and returns the
 * original node. This avoids the O(2*R*F) double traversal of computing
 * the ratio first and then encoding separately.
 *
 * @param node - Original tabular array node
 * @returns New tabular array with delta-encoded rows, or the original
 *          node unchanged if delta encoding is not beneficial
 */
function deltaEncodeTabular(node: TabularArrayNode): TabularArrayNode {
  if (node.rows.length < MIN_DELTA_ROWS) return node;

  const fieldCount = node.fields.length;
  const totalCells = (node.rows.length - 1) * fieldCount;
  if (totalCells === 0) return node;

  /* Single pass: encode optimistically while counting deltas */
  const newRows: TabularRowNode[] = [node.rows[0]!]; // row 0 = reference
  let deltaCount = 0;

  for (let r = 1; r < node.rows.length; r++) {
    const prevRow = node.rows[r - 1]!;
    const currRow = node.rows[r]!;
    const newValues: ScalarNode[] = [];

    for (let f = 0; f < fieldCount; f++) {
      const prev = prevRow.values[f];
      const curr = currRow.values[f];
      /* Replace with sentinel if value unchanged from previous row */
      if (prev && curr && scalarsEqual(prev, curr)) {
        newValues.push(makeSentinel());
        deltaCount++;
      } else if (curr) {
        newValues.push(curr);
      } else if (prev) {
        /* Ragged row — field missing in current row, carry forward */
        newValues.push(prev);
      }
      /* else: both undefined on a ragged row — skip (field count mismatch) */
    }

    newRows.push({ type: 'tabularRow', values: newValues, position: POS });
  }

  /* Check ratio after the pass — discard work if not worthwhile */
  if (deltaCount / totalCells < MIN_DELTA_RATIO) return node;

  return { ...node, rows: newRows };
}

/**
 * Walk the AST body and apply delta encoding to all eligible tabular arrays.
 *
 * @param body - Document body nodes
 * @returns New body with delta-encoded tabular arrays
 */
function deltaEncodeBody(body: BodyNode[], depth = 0): { body: BodyNode[]; applied: boolean } {
  if (depth > MAX_DELTA_DEPTH) return { body, applied: false };

  let applied = false;
  const newBody = body.map((node): BodyNode => {
    if (node.type === 'tabularArray') {
      const encoded = deltaEncodeTabular(node);
      if (encoded !== node) applied = true;
      return encoded;
    }
    /* Recurse into nested objects to find tabular arrays inside */
    if (node.type === 'object') {
      const result = deltaEncodeBody(node.children, depth + 1);
      if (result.applied) applied = true;
      return { ...node, children: result.body };
    }
    /* Recurse into list array items */
    if (node.type === 'listArray') {
      const newItems = node.items.map((item) => {
        const result = deltaEncodeBody(item.children, depth + 1);
        if (result.applied) applied = true;
        return { ...item, children: result.body };
      });
      return { ...node, items: newItems };
    }
    return node;
  });

  return { body: newBody, applied };
}

// ---------------------------------------------------------------------------
// Public API: encode
// ---------------------------------------------------------------------------

/**
 * Apply delta encoding to all eligible tabular arrays in a PAKT document.
 * Adds a `@compress delta` header when at least one array was encoded.
 *
 * @param doc - Original PAKT document AST
 * @returns New document with delta-encoded tabular arrays and header
 *
 * @example
 * ```ts
 * const encoded = applyDeltaEncoding(doc);
 * // encoded.headers includes { headerType: 'compress', value: 'delta' }
 * ```
 */
export function applyDeltaEncoding(doc: DocumentNode): DocumentNode {
  const { body, applied } = deltaEncodeBody(doc.body);
  if (!applied) return doc;

  /* Add @compress delta header if not already present */
  const hasHeader = doc.headers.some(
    (h) => h.headerType === 'compress' && h.value === DELTA_HEADER_VALUE,
  );
  const headers: HeaderNode[] = hasHeader
    ? doc.headers
    : [
        ...doc.headers,
        { type: 'header', headerType: 'compress', value: DELTA_HEADER_VALUE, position: POS },
      ];

  return { ...doc, headers, body };
}

// ---------------------------------------------------------------------------
// Delta decoding (decompression)
// ---------------------------------------------------------------------------

/**
 * Revert delta encoding on a single tabular array. Replaces `~` sentinel
 * nodes with the value from the previous row, walking forward from row 0.
 *
 * @param node - Delta-encoded tabular array node
 * @returns Tabular array with all sentinels resolved to real values
 */
function deltaDecodeTabular(node: TabularArrayNode): TabularArrayNode {
  if (node.rows.length < 2) return node;

  const fieldCount = node.fields.length;
  const newRows: TabularRowNode[] = [node.rows[0]!]; // row 0 is always full

  for (let r = 1; r < node.rows.length; r++) {
    const prevRow = newRows[r - 1]!; // use already-decoded previous row
    const currRow = node.rows[r]!;
    const newValues: ScalarNode[] = [];

    for (let f = 0; f < fieldCount; f++) {
      const curr = currRow.values[f];
      const prev = prevRow.values[f];
      /* Resolve sentinel: copy value from previous (already decoded) row */
      if (curr && isDeltaSentinel(curr) && prev) {
        newValues.push(prev);
      } else if (curr) {
        newValues.push(curr);
      } else if (prev) {
        /* Ragged row — field missing in current row, carry forward */
        newValues.push(prev);
      }
      /* else: both undefined on a ragged row — skip (field count mismatch) */
    }

    newRows.push({ type: 'tabularRow', values: newValues, position: POS });
  }

  return { ...node, rows: newRows };
}

/**
 * Walk the AST body and revert delta encoding on all tabular arrays.
 *
 * @param body - Document body nodes (potentially delta-encoded)
 * @returns Body with all delta sentinels resolved
 */
function deltaDecodeBody(body: BodyNode[], depth = 0): BodyNode[] {
  if (depth > MAX_DELTA_DEPTH) return body;

  return body.map((node): BodyNode => {
    if (node.type === 'tabularArray') return deltaDecodeTabular(node);
    if (node.type === 'object') {
      return { ...node, children: deltaDecodeBody(node.children, depth + 1) };
    }
    if (node.type === 'listArray') {
      const newItems = node.items.map((item) => ({
        ...item,
        children: deltaDecodeBody(item.children, depth + 1),
      }));
      return { ...node, items: newItems };
    }
    return node;
  });
}

// ---------------------------------------------------------------------------
// Public API: decode
// ---------------------------------------------------------------------------

/**
 * Revert delta encoding on a PAKT document. Resolves all `~` sentinels
 * back to their real values by walking rows forward from the reference frame.
 *
 * Safe to call on documents that were not delta-encoded — returns them
 * unchanged (no `@compress delta` header means no-op).
 *
 * @param doc - Potentially delta-encoded PAKT document AST
 * @returns Document with all sentinels resolved and `@compress delta` header removed
 *
 * @example
 * ```ts
 * const decoded = revertDeltaEncoding(encoded);
 * // All ~ sentinels replaced with real values
 * ```
 */
export function revertDeltaEncoding(doc: DocumentNode): DocumentNode {
  const hasDelta = doc.headers.some(
    (h) => h.headerType === 'compress' && h.value === DELTA_HEADER_VALUE,
  );
  if (!hasDelta) return doc;

  const body = deltaDecodeBody(doc.body);
  /* Remove the @compress delta header after decoding */
  const headers = doc.headers.filter(
    (h) => !(h.headerType === 'compress' && h.value === DELTA_HEADER_VALUE),
  );

  return { ...doc, headers, body };
}

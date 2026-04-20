/**
 * @module layers/L1-delta
 * Delta encoding orchestrator for tabular arrays — inspired by DeltaKV
 * (arXiv:2602.08005).
 *
 * Two flavours of delta encoding are combined here:
 *
 * 1. **Exact** (`~` sentinel) — replace a cell that equals the previous
 *    row's value in the same column with a bare `~`. Implemented in
 *    {@link L1-delta-exact}.
 * 2. **Numeric** (`+N` / `-N` sentinel) — for monotonic-ish integer
 *    columns, replace a cell with the signed difference from the
 *    previous row (e.g. timestamps, sequential IDs). Implemented in
 *    {@link L1-delta-numeric}.
 *
 * Both variants share the same `@compress delta` document header so a
 * single decode pass can handle either form. The encode order is
 * numeric-first, then exact, so columns that qualify for both (every
 * diff is zero) are left to the cheaper `~` encoder.
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
 * const encoded = applyDeltaEncoding(doc);
 * const decoded = revertDeltaEncoding(encoded);
 * ```
 */

import { createPosition } from '../parser/ast-helpers.js';
import type { BodyNode, DocumentNode, HeaderNode, SourcePosition } from '../parser/ast.js';
import {
  DELTA_SENTINEL,
  MIN_DELTA_RATIO,
  MIN_DELTA_ROWS,
  computeDeltaRatio,
  deltaDecodeTabularExact,
  deltaEncodeTabularExact,
  isDeltaSentinel,
} from './L1-delta-exact.js';
import {
  isNumericDeltaSentinel,
  needsNumericDeltaQuote,
  numericDeltaDecodeTabular,
  numericDeltaEncodeTabular,
} from './L1-delta-numeric.js';

// ---------------------------------------------------------------------------
// Re-exports — preserve the module's historical public surface
// ---------------------------------------------------------------------------

export { DELTA_SENTINEL, MIN_DELTA_RATIO, MIN_DELTA_ROWS, computeDeltaRatio, isDeltaSentinel };
export { isNumericDeltaSentinel, needsNumericDeltaQuote };

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
// Encode: body traversal
// ---------------------------------------------------------------------------

/**
 * Walk the AST body and apply delta encoding (numeric + exact) to all
 * eligible tabular arrays.
 *
 * @param body - Document body nodes
 * @param depth - Current recursion depth (internal)
 * @returns New body with delta-encoded tabular arrays
 */
function deltaEncodeBody(body: BodyNode[], depth = 0): { body: BodyNode[]; applied: boolean } {
  if (depth > MAX_DELTA_DEPTH) return { body, applied: false };

  let applied = false;
  const newBody = body.map((node): BodyNode => {
    if (node.type === 'tabularArray') {
      /* Numeric first so all-zero-delta columns fall through to the
         cheaper `~` encoder. */
      const numericEncoded = numericDeltaEncodeTabular(node);
      const fullyEncoded = deltaEncodeTabularExact(numericEncoded);
      if (fullyEncoded !== node) applied = true;
      return fullyEncoded;
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
// Decode: body traversal
// ---------------------------------------------------------------------------

/**
 * Walk the AST body and revert delta encoding on all tabular arrays.
 *
 * Decode order matches encode order in reverse: numeric sentinels first
 * (they were encoded on top of the raw values), then the exact `~`
 * sentinels. In practice the two sentinel families live on disjoint
 * columns so the order is defensive rather than load-bearing.
 *
 * @param body - Document body nodes (potentially delta-encoded)
 * @returns Body with all delta sentinels resolved
 */
function deltaDecodeBody(body: BodyNode[], depth = 0): { body: BodyNode[]; complete: boolean } {
  if (depth > MAX_DELTA_DEPTH) return { body, complete: false };

  let complete = true;
  const decodedBody = body.map((node): BodyNode => {
    if (node.type === 'tabularArray') {
      const numeric = numericDeltaDecodeTabular(node);
      if (!numeric.resolvedAllSentinels) complete = false;
      const exact = deltaDecodeTabularExact(numeric.node);
      if (!exact.resolvedAllSentinels) complete = false;
      return exact.node;
    }
    if (node.type === 'object') {
      const result = deltaDecodeBody(node.children, depth + 1);
      if (!result.complete) complete = false;
      return { ...node, children: result.body };
    }
    if (node.type === 'listArray') {
      const newItems = node.items.map((item) => {
        const result = deltaDecodeBody(item.children, depth + 1);
        if (!result.complete) complete = false;
        return { ...item, children: result.body };
      });
      return { ...node, items: newItems };
    }
    return node;
  });

  return { body: decodedBody, complete };
}

// ---------------------------------------------------------------------------
// Public API: decode
// ---------------------------------------------------------------------------

/**
 * Revert delta encoding on a PAKT document. Resolves all `~` and `+N`/`-N`
 * sentinels back to their real values by walking rows forward from the
 * reference frame.
 *
 * Safe to call on documents that were not delta-encoded — returns them
 * unchanged (no `@compress delta` header means no-op).
 *
 * @param doc - Potentially delta-encoded PAKT document AST
 * @returns Document with all sentinels resolved and header removed
 */
export function revertDeltaEncoding(doc: DocumentNode): DocumentNode {
  const hasDelta = doc.headers.some(
    (h) => h.headerType === 'compress' && h.value === DELTA_HEADER_VALUE,
  );
  if (!hasDelta) return doc;

  const { body, complete } = deltaDecodeBody(doc.body);
  const headers = complete
    ? doc.headers.filter((h) => !(h.headerType === 'compress' && h.value === DELTA_HEADER_VALUE))
    : doc.headers;

  return { ...doc, headers, body };
}

/**
 * @module layers/L1-delta-exact
 * Exact-match (`~` sentinel) delta encoding for tabular arrays.
 *
 * This module implements the original delta encoding: a tabular cell whose
 * value equals the previous row's value in the same column is replaced
 * with a bare `~` sentinel. Row 0 is the reference frame.
 *
 * Split from {@link L1-delta} so the file stays under the 400-line limit
 * once numeric-delta support was added. See {@link L1-delta-numeric} for
 * the `+N`/`-N` variant.
 *
 * @see docs/articles/delta-encoding-for-homogeneous-arrays.md
 */

import { createPosition } from '../parser/ast-helpers.js';
import type {
  ScalarNode,
  SourcePosition,
  TabularArrayNode,
  TabularRowNode,
} from '../parser/ast.js';
import { isNumericDeltaSentinel } from './L1-delta-numeric.js';

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
// Delta ratio analysis
// ---------------------------------------------------------------------------

/**
 * Analyze a tabular array to determine if delta encoding is beneficial.
 * Returns the ratio of fields that can be replaced with `~` sentinels.
 *
 * @param node - Tabular array node to analyze
 * @returns Delta ratio (0.0 = no repetition, 1.0 = all fields repeated)
 */
export function computeDeltaRatio(node: TabularArrayNode): number {
  if (node.rows.length < MIN_DELTA_ROWS) return 0;

  const fieldCount = node.fields.length;
  /* Total non-header cells that could potentially be delta-encoded */
  const totalCells = (node.rows.length - 1) * fieldCount;
  if (totalCells === 0) return 0;

  let deltaCount = 0;
  for (let r = 1; r < node.rows.length; r++) {
    const prevRow = node.rows[r - 1];
    const currRow = node.rows[r];
    if (!prevRow || !currRow) continue;
    for (let f = 0; f < fieldCount; f++) {
      const prev = prevRow.values[f];
      const curr = currRow.values[f];
      if (
        prev &&
        curr &&
        !isNumericDeltaSentinel(curr) &&
        !isNumericDeltaSentinel(prev) &&
        scalarsEqual(prev, curr)
      ) {
        deltaCount++;
      }
    }
  }

  return deltaCount / totalCells;
}

// ---------------------------------------------------------------------------
// Exact (~) delta encoding
// ---------------------------------------------------------------------------

/**
 * Apply exact-match delta encoding to a single tabular array node.
 * Replaces field values that match the previous row with `~` sentinel nodes.
 *
 * Row 0 is always preserved in full as the reference frame.
 *
 * Uses a single-pass approach: builds encoded rows optimistically while
 * counting deltas, then checks the ratio after the pass. If the ratio
 * is below {@link MIN_DELTA_RATIO}, discards the work and returns the
 * original node.
 *
 * @param node - Original (possibly already numeric-delta-encoded) tabular array
 * @returns Tabular array with exact deltas replaced, or original if not beneficial
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: delta encoding traverses rows with format-specific branches
export function deltaEncodeTabularExact(node: TabularArrayNode): TabularArrayNode {
  if (node.rows.length < MIN_DELTA_ROWS) return node;

  const fieldCount = node.fields.length;
  const totalCells = (node.rows.length - 1) * fieldCount;
  if (totalCells === 0) return node;
  const firstRow = node.rows[0];
  if (!firstRow) return node;

  /* Single pass: encode optimistically while counting deltas */
  const newRows: TabularRowNode[] = [firstRow]; // row 0 = reference
  let deltaCount = 0;

  for (let r = 1; r < node.rows.length; r++) {
    const prevRow = node.rows[r - 1];
    const currRow = node.rows[r];
    if (!prevRow || !currRow) continue;
    const newValues: ScalarNode[] = [];

    for (let f = 0; f < fieldCount; f++) {
      const prev = prevRow.values[f];
      const curr = currRow.values[f];
      /* Replace with sentinel if value unchanged from previous row.
         Skip numeric-delta sentinels: two adjacent `+1` cells are NOT a
         repeat — they are independent per-row deltas that must stay
         distinct so numeric decode can reconstruct the absolute values. */
      if (
        prev &&
        curr &&
        !isNumericDeltaSentinel(curr) &&
        !isNumericDeltaSentinel(prev) &&
        scalarsEqual(prev, curr)
      ) {
        newValues.push(makeSentinel());
        deltaCount++;
      } else if (curr) {
        newValues.push(curr);
      } else if (prev) {
        /* Preserve historical carry-forward semantics for ragged rows. */
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

// ---------------------------------------------------------------------------
// Exact (~) delta decoding
// ---------------------------------------------------------------------------

/**
 * Revert exact-match delta encoding on a single tabular array.
 * Replaces `~` sentinel nodes with the value from the previous row,
 * walking forward from row 0.
 *
 * @param node - Tabular array possibly containing `~` sentinels
 * @returns Result with fully decoded rows and a flag indicating whether
 *          every sentinel was resolved (used by the orchestrator to decide
 *          whether to drop the `@compress delta` header).
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: delta decoding resolves sentinels across rows with type-aware logic
export function deltaDecodeTabularExact(node: TabularArrayNode): {
  node: TabularArrayNode;
  resolvedAllSentinels: boolean;
} {
  if (node.rows.length < 2) return { node, resolvedAllSentinels: true };

  const fieldCount = node.fields.length;
  const firstRow = node.rows[0];
  if (!firstRow) return { node, resolvedAllSentinels: true };
  const newRows: TabularRowNode[] = [firstRow]; // row 0 is always full
  let resolvedAllSentinels = true;

  for (let r = 1; r < node.rows.length; r++) {
    const prevRow = newRows[r - 1]; // use already-decoded previous row
    const currRow = node.rows[r];
    if (!prevRow || !currRow) continue;
    const newValues: ScalarNode[] = [];

    for (let f = 0; f < fieldCount; f++) {
      const curr = currRow.values[f];
      const prev = prevRow.values[f];
      /* Resolve sentinel: copy value from previous (already decoded) row */
      if (curr && isDeltaSentinel(curr) && prev) {
        newValues.push(prev);
      } else if (curr && isDeltaSentinel(curr)) {
        resolvedAllSentinels = false;
        newValues.push(curr);
      } else if (curr) {
        newValues.push(curr);
      } else if (prev) {
        /* Preserve historical carry-forward semantics for ragged rows. */
        newValues.push(prev);
      }
      /* else: both undefined on a ragged row — skip (field count mismatch) */
    }

    newRows.push({ type: 'tabularRow', values: newValues, position: POS });
  }

  return { node: { ...node, rows: newRows }, resolvedAllSentinels };
}

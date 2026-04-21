/**
 * @module layers/L1-delta-numeric
 * Numeric delta encoding (`+N` / `-N` sentinels) for tabular arrays.
 *
 * For monotonic-ish integer columns we can store per-row differences
 * instead of absolute values:
 *
 *   [1700000000, 1700000060, 1700000120] → [1700000000, +60, +60]
 *   [1001, 1002, 1003, 1004]             → [1001, +1, +1, +1]
 *
 * The first row keeps its absolute value; subsequent rows store the
 * signed difference from the previous (already-absolute) row encoded as
 * a string scalar beginning with `+` or `-`.
 *
 * Design decisions (documented here to avoid rediscovery):
 *
 * 1. **Integers only.** Float deltas accumulate rounding errors across
 *    rows; a small bug in the reverse path would silently corrupt data.
 *    Floats are explicitly skipped at column-eligibility time.
 * 2. **Per-column gate.** A column is encoded only when doing so saves
 *    at least {@link NUMERIC_DELTA_MIN_SAVINGS_RATIO} tokens vs. the
 *    original column (rough heuristic: sum of string-length diffs).
 *    This avoids regressing on columns with large, non-repeating diffs.
 * 3. **Disjoint from `~`.** Columns where every delta is zero are left
 *    alone so the exact-delta pass can replace them with `~` (smaller).
 * 4. **Collision safety.** Real user string values `"+5"` / `"-5"` must
 *    be force-quoted on re-encode so they are not mistaken for numeric
 *    sentinels. {@link isNumericDeltaSentinel} checks `quoted === false`.
 *
 * @see L1-delta-exact (the `~` counterpart)
 */

import { createPosition } from '../parser/ast-helpers.js';
import type {
  ScalarNode,
  SourcePosition,
  StringScalar,
  TabularArrayNode,
  TabularRowNode,
} from '../parser/ast.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum rows needed before numeric-delta encoding is even considered. */
export const NUMERIC_DELTA_MIN_ROWS = 3;

/**
 * Minimum fractional token savings for a column to qualify for numeric
 * delta encoding. A column is only rewritten when the encoded form is
 * at least this much shorter than the original (character-count proxy
 * for tokens).
 */
export const NUMERIC_DELTA_MIN_SAVINGS_RATIO = 0.2;

/** Matches a bare numeric-delta sentinel (e.g. `+60`, `-1`). N must be > 0. */
const NUMERIC_SENTINEL_RE = /^[+-][1-9]\d*$/;

/** Synthetic position for generated AST nodes. */
const POS: SourcePosition = createPosition(0, 0, 0);

// ---------------------------------------------------------------------------
// Sentinel utilities
// ---------------------------------------------------------------------------

/**
 * Check if a scalar node represents a numeric-delta sentinel.
 *
 * A sentinel is an unquoted string matching `/^[+-][1-9]\d*$/`. Real
 * user string values that happen to look the same must be force-quoted
 * (see {@link needsNumericDeltaQuote}).
 *
 * @param node - Scalar node to inspect
 * @returns True if this is an unquoted `+N` / `-N` sentinel string
 */
export function isNumericDeltaSentinel(node: ScalarNode): node is StringScalar {
  return (
    node.scalarType === 'string' && node.quoted === false && NUMERIC_SENTINEL_RE.test(node.value)
  );
}

/**
 * Whether a user-supplied string looks identical to a numeric-delta
 * sentinel and therefore needs force-quoting to avoid collisions.
 *
 * @param value - Raw string value
 * @returns True if the value would be misread as `+N`/`-N` unquoted
 */
export function needsNumericDeltaQuote(value: string): boolean {
  return NUMERIC_SENTINEL_RE.test(value);
}

/**
 * Build a `+N` / `-N` sentinel scalar node for a given signed delta.
 * The delta must be a non-zero integer.
 */
function makeNumericSentinel(delta: number): ScalarNode {
  const sign = delta > 0 ? '+' : '-';
  const mag = Math.abs(delta).toString();
  return {
    type: 'scalar',
    scalarType: 'string',
    value: `${sign}${mag}`,
    quoted: false,
    position: POS,
  };
}

// ---------------------------------------------------------------------------
// Column eligibility
// ---------------------------------------------------------------------------

/**
 * Extract the integer values from a column or return null if the column
 * is not a pure integer column (has floats, strings, nulls, booleans, or
 * any missing cells).
 *
 * @param node - Tabular array
 * @param fieldIndex - Column index to inspect
 * @returns Array of integers, or null if ineligible
 */
function extractIntegerColumn(node: TabularArrayNode, fieldIndex: number): number[] | null {
  const ints: number[] = [];
  for (const row of node.rows) {
    const cell = row.values[fieldIndex];
    if (!cell) return null;
    if (cell.scalarType !== 'number') return null;
    if (!Number.isInteger(cell.value)) return null;
    /* JS Number.isInteger accepts ±2^53 - 1; deltas beyond MAX_SAFE_INTEGER
       would round-trip incorrectly. Bail out defensively. */
    if (!Number.isSafeInteger(cell.value)) return null;
    ints.push(cell.value);
  }
  return ints;
}

/**
 * Estimate token savings for rewriting a column as numeric deltas.
 * Uses character count as a rough proxy — good enough for the >=20%
 * threshold decision.
 *
 * Returns 0 if all deltas are zero (let exact `~` encoder handle it)
 * or if the encoded form is not at least
 * {@link NUMERIC_DELTA_MIN_SAVINGS_RATIO} shorter than the original.
 *
 * @param ints - Integer column values (row 0 is the reference)
 * @returns Savings ratio in [0, 1]; 0 means "skip this column"
 */
function computeNumericSavings(ints: number[]): number {
  if (ints.length < NUMERIC_DELTA_MIN_ROWS) return 0;

  let originalLen = 0;
  let encodedLen = 0;
  let anyNonZeroDelta = false;

  for (let i = 0; i < ints.length; i++) {
    const n = ints[i] as number;
    const origLen = n.toString().length;
    originalLen += origLen;
    if (i === 0) {
      encodedLen += origLen; // row 0 keeps its absolute value
      continue;
    }
    const prev = ints[i - 1] as number;
    const delta = n - prev;
    if (delta !== 0) anyNonZeroDelta = true;
    /* Sentinel length: sign (1) + magnitude digits; zero-delta falls back
       to a hypothetical `~` (1 char) but we skip such columns entirely. */
    const sentinelLen = delta === 0 ? 1 : 1 + Math.abs(delta).toString().length;
    encodedLen += sentinelLen;
  }

  if (!anyNonZeroDelta) return 0; // hand to the exact `~` encoder
  if (originalLen === 0) return 0;

  const savings = (originalLen - encodedLen) / originalLen;
  return savings >= NUMERIC_DELTA_MIN_SAVINGS_RATIO ? savings : 0;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/**
 * Attempt to numeric-delta-encode one tabular array. Each column is
 * evaluated independently; only qualifying integer columns are rewritten.
 *
 * @param node - Tabular array to encode
 * @returns Rewritten node (or original reference if nothing changed)
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: numeric delta encoding evaluates each column independently with eligibility + savings gates
export function numericDeltaEncodeTabular(node: TabularArrayNode): TabularArrayNode {
  if (node.rows.length < NUMERIC_DELTA_MIN_ROWS) return node;

  const fieldCount = node.fields.length;
  if (fieldCount === 0) return node;

  /* Per-column: figure out which are eligible, prep replacement values */
  const encodedColumns = new Map<number, ScalarNode[]>();

  for (let f = 0; f < fieldCount; f++) {
    const ints = extractIntegerColumn(node, f);
    if (!ints) continue;
    if (computeNumericSavings(ints) === 0) continue;

    /* Build the replacement column: row 0 = absolute, rest = sentinels */
    const encoded: ScalarNode[] = [];
    for (let r = 0; r < ints.length; r++) {
      const origRow = node.rows[r];
      const origCell = origRow?.values[f];
      if (!origCell) return node;

      if (r === 0) {
        encoded.push(origCell);
      } else {
        const delta = (ints[r] as number) - (ints[r - 1] as number);
        if (delta === 0) {
          /*
           * Preserve exact repeats as their original numeric cell instead of
           * emitting a numeric sentinel. This avoids generating an invalid
           * `-0` sentinel and lets the exact-delta (`~`) layer compress
           * repeats if applicable.
           */
          encoded.push(origCell);
        } else {
          encoded.push(makeNumericSentinel(delta));
        }
      }
    }
    encodedColumns.set(f, encoded);
  }

  if (encodedColumns.size === 0) return node;

  /* Rebuild rows, swapping cells in encoded columns only */
  const newRows: TabularRowNode[] = node.rows.map((row, rIdx) => {
    const newValues = row.values.map((cell, fIdx) => {
      const enc = encodedColumns.get(fIdx);
      if (!enc) return cell;
      return enc[rIdx] ?? cell;
    });
    return { type: 'tabularRow', values: newValues, position: row.position ?? POS };
  });

  return { ...node, rows: newRows };
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/**
 * Parse a numeric-delta sentinel string (e.g. `+60`, `-1`) to its signed
 * integer value. Caller must have verified the shape via
 * {@link isNumericDeltaSentinel}.
 */
function parseSentinel(value: string): number {
  /* parseInt would accept `+60` but we want to be explicit about base */
  const sign = value.startsWith('-') ? -1 : 1;
  const mag = Number.parseInt(value.slice(1), 10);
  return sign * mag;
}

/**
 * Revert numeric-delta encoding on one tabular array. Walks each column
 * forward from row 0, resolving any `+N`/`-N` sentinels by adding the
 * signed delta to the previously resolved absolute value in that column.
 *
 * @param node - Tabular array possibly containing numeric sentinels
 * @returns Result with decoded rows and a flag indicating full resolution
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: numeric decoding resolves per-column sentinel chains
export function numericDeltaDecodeTabular(node: TabularArrayNode): {
  node: TabularArrayNode;
  resolvedAllSentinels: boolean;
} {
  if (node.rows.length < 2) return { node, resolvedAllSentinels: true };

  const fieldCount = node.fields.length;
  const firstRow = node.rows[0];
  if (!firstRow) return { node, resolvedAllSentinels: true };

  /* Clone rows up-front; we will mutate `newRows[r].values[f]` in place.
     Each row object is fresh so we are not touching the input. */
  const newRows: TabularRowNode[] = node.rows.map((row) => ({
    type: 'tabularRow',
    values: [...row.values],
    position: row.position ?? POS,
  }));

  let resolvedAll = true;

  for (let f = 0; f < fieldCount; f++) {
    /* Determine the reference absolute value for this column. */
    const refCell = newRows[0]?.values[f];
    if (!refCell) continue;
    /* If row 0 isn't a concrete integer for this column, we can't decode
       subsequent sentinels — they must not exist in a valid document, but
       bail gracefully just in case. */
    let runningValue: number | null =
      refCell.scalarType === 'number' && Number.isFinite(refCell.value) ? refCell.value : null;

    for (let r = 1; r < newRows.length; r++) {
      const row = newRows[r];
      if (!row) continue;
      const cell = row.values[f];
      if (!cell) continue;
      if (isNumericDeltaSentinel(cell)) {
        if (runningValue === null) {
          resolvedAll = false;
          continue;
        }
        runningValue += parseSentinel(cell.value);
        row.values[f] = {
          type: 'scalar',
          scalarType: 'number',
          value: runningValue,
          raw: runningValue.toString(),
          position: cell.position ?? POS,
        };
      } else if (cell.scalarType === 'number' && Number.isFinite(cell.value)) {
        /* Concrete cell — reset the running reference for future sentinels */
        runningValue = cell.value;
      }
      /* Other types (e.g. an exact `~` sentinel, which shouldn't happen on
         a numeric-encoded column) are left alone. */
    }
  }

  return { node: { ...node, rows: newRows }, resolvedAllSentinels: resolvedAll };
}

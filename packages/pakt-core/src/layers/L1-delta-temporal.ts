/**
 * @module layers/L1-delta-temporal
 * Temporal delta encoding (`T+N` / `T-N` sentinels) for tabular columns
 * of ISO-8601 date-time strings.
 *
 * API responses and log dumps routinely pin a `createdAt` / `timestamp`
 * column whose values march forward by a few seconds or minutes per
 * row. A typical 20-character ISO string becomes a 4-character delta:
 *
 *   ["2026-04-21T15:00:00Z",
 *    "2026-04-21T15:01:00Z",  →  ["2026-04-21T15:00:00Z", "T+60", "T+60"]
 *    "2026-04-21T15:02:00Z"]
 *
 * The first row keeps its absolute value (and doubles as the format
 * template — UTC Z vs fixed offset vs no-TZ); later rows store the
 * signed delta **in whole seconds** from the previous row.
 *
 * Design decisions:
 *
 * 1. **Seconds-only.** Fractional-second columns are skipped entirely.
 *    Re-emitting sub-second precision through integer deltas is a
 *    silent-loss trap we want to avoid; users with millisecond columns
 *    can rely on numeric (`+N`) delta over their raw epoch-ms values.
 * 2. **Uniform format across rows.** A column qualifies only when every
 *    cell shares the same ISO shape (same timezone discriminator, same
 *    lack/presence of millisecond component). Mixed columns fall
 *    through untouched.
 * 3. **`T+N` / `T-N` sentinel chosen for disjointness.**
 *    - `+N`  / `-N`  — numeric delta sentinel (integer columns)
 *    - `~`           — exact-repeat sentinel
 *    - `T+N` / `T-N` — temporal delta sentinel (ISO-string columns)
 *    Regexes don't overlap, so a single cell is unambiguously one kind.
 * 4. **Savings gate.** Applied only when the rewritten column is at
 *    least {@link TEMPORAL_DELTA_MIN_SAVINGS_RATIO} shorter than the
 *    original (character-count proxy for tokens). Otherwise the column
 *    is left alone.
 *
 * @see L1-delta-numeric  — the integer counterpart
 * @see L1-delta-exact    — the exact-repeat counterpart
 * @see L1-delta          — the orchestrator wiring all three together
 */

import { createPosition } from '../parser/ast-helpers.js';
import type {
  ScalarNode,
  SourcePosition,
  TabularArrayNode,
  TabularRowNode,
} from '../parser/ast.js';
import { type ColumnShape, type ParsedISO, formatEpochToISO, parseISO } from './iso-format.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum rows needed before temporal-delta encoding is considered. */
export const TEMPORAL_DELTA_MIN_ROWS = 3;

/**
 * Minimum fractional token savings for a column to qualify. A column is
 * only rewritten when the encoded form is at least this much shorter
 * than the original (character-count proxy for tokens).
 */
export const TEMPORAL_DELTA_MIN_SAVINGS_RATIO = 0.2;

/** Matches a bare temporal-delta sentinel: `T+60`, `T-1`, `T+0` etc. */
const TEMPORAL_SENTINEL_RE = /^T[+-](?:0|[1-9]\d*)$/;

/** Synthetic position for generated AST nodes. */
const POS: SourcePosition = createPosition(0, 0, 0);

// ---------------------------------------------------------------------------
// Sentinel utilities
// ---------------------------------------------------------------------------

/**
 * Check if a scalar node is an unquoted temporal-delta sentinel.
 *
 * Intentionally a plain boolean — *not* a type predicate. The decoder's
 * else-branch needs to reason about `cell.scalarType === 'string'` for
 * concrete ISO values, which TypeScript would incorrectly rule out if
 * the positive branch narrowed away every `StringScalar`.
 *
 * @param node - Scalar node to inspect
 * @returns True if the node is `T+N` / `T-N` unquoted
 */
export function isTemporalDeltaSentinel(node: ScalarNode): boolean {
  return (
    node.scalarType === 'string' && node.quoted === false && TEMPORAL_SENTINEL_RE.test(node.value)
  );
}

/**
 * Whether a user-supplied string looks identical to a temporal-delta
 * sentinel and therefore needs force-quoting to avoid collisions.
 *
 * @param value - Raw string value
 * @returns True if the value would be misread as `T+N`/`T-N` unquoted
 */
export function needsTemporalDeltaQuote(value: string): boolean {
  return TEMPORAL_SENTINEL_RE.test(value);
}

/**
 * Build a `T+N` / `T-N` sentinel scalar node for a given signed
 * second-delta. The delta must be a non-zero integer (callers should
 * fall through to the exact-`~` encoder for zero deltas).
 */
function makeTemporalSentinel(deltaSeconds: number): ScalarNode {
  const sign = deltaSeconds > 0 ? '+' : '-';
  const mag = Math.abs(deltaSeconds).toString();
  return {
    type: 'scalar',
    scalarType: 'string',
    value: `T${sign}${mag}`,
    quoted: false,
    position: POS,
  };
}

// ---------------------------------------------------------------------------
// Column extraction
// ---------------------------------------------------------------------------

/**
 * Extract + parse the ISO values for a single column. Returns null if
 * any cell fails to parse or the shape drifts across rows.
 */
function extractISOColumn(
  node: TabularArrayNode,
  fieldIndex: number,
): { values: ParsedISO[]; raw: string[] } | null {
  const values: ParsedISO[] = [];
  const raw: string[] = [];
  let shape: ColumnShape | null = null;

  for (const row of node.rows) {
    const cell = row.values[fieldIndex];
    if (!cell) return null;
    if (cell.scalarType !== 'string') return null;
    const parsed = parseISO(cell.value);
    if (!parsed) return null;
    if (shape === null) shape = parsed.shape;
    else if (shape.tz !== parsed.shape.tz || shape.hasFrac !== parsed.shape.hasFrac) return null;
    values.push(parsed);
    raw.push(cell.value);
  }

  return { values, raw };
}

// ---------------------------------------------------------------------------
// Savings estimate
// ---------------------------------------------------------------------------

/**
 * Estimate token savings for rewriting an ISO column as temporal deltas.
 * Returns 0 when the rewrite isn't worth the header cost or when every
 * delta would be zero (let exact `~` handle it).
 */
function computeTemporalSavings(values: ParsedISO[], raw: string[]): number {
  if (values.length < TEMPORAL_DELTA_MIN_ROWS) return 0;

  let originalLen = 0;
  let encodedLen = 0;
  let anyNonZeroDelta = false;

  for (let i = 0; i < values.length; i++) {
    const rawRow = raw[i] ?? '';
    originalLen += rawRow.length;

    if (i === 0) {
      encodedLen += rawRow.length; // keeps the absolute ISO value
      continue;
    }
    const prev = values[i - 1];
    const curr = values[i];
    if (!prev || !curr) return 0;
    const delta = curr.epochSec - prev.epochSec;
    if (delta !== 0) anyNonZeroDelta = true;
    /* Sentinel length: `T` + sign + magnitude digits. */
    const sentLen = delta === 0 ? 1 : 2 + Math.abs(delta).toString().length;
    encodedLen += sentLen;
  }

  if (!anyNonZeroDelta) return 0;
  if (originalLen === 0) return 0;
  const ratio = (originalLen - encodedLen) / originalLen;
  return ratio >= TEMPORAL_DELTA_MIN_SAVINGS_RATIO ? ratio : 0;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/**
 * Attempt to temporal-delta-encode one tabular array. Each column is
 * evaluated independently; only qualifying ISO-datetime columns are
 * rewritten.
 *
 * @param node - Tabular array to encode
 * @returns Rewritten node (or original reference if nothing qualified)
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: per-column eligibility + savings gate mirrors L1-delta-numeric
export function temporalDeltaEncodeTabular(node: TabularArrayNode): TabularArrayNode {
  if (node.rows.length < TEMPORAL_DELTA_MIN_ROWS) return node;

  const fieldCount = node.fields.length;
  if (fieldCount === 0) return node;

  const encodedColumns = new Map<number, ScalarNode[]>();

  for (let f = 0; f < fieldCount; f++) {
    const column = extractISOColumn(node, f);
    if (!column) continue;
    if (computeTemporalSavings(column.values, column.raw) === 0) continue;

    const encoded: ScalarNode[] = [];
    for (let r = 0; r < column.values.length; r++) {
      const origRow = node.rows[r];
      const origCell = origRow?.values[f];
      if (!origCell) return node;

      if (r === 0) {
        encoded.push(origCell);
        continue;
      }
      const prev = column.values[r - 1];
      const curr = column.values[r];
      if (!prev || !curr) return node;
      const delta = curr.epochSec - prev.epochSec;
      if (delta === 0) {
        /* Zero delta = exact repeat; leave cell alone so the exact-`~`
           pass can claim it with a shorter sentinel. */
        encoded.push(origCell);
      } else {
        encoded.push(makeTemporalSentinel(delta));
      }
    }
    encodedColumns.set(f, encoded);
  }

  if (encodedColumns.size === 0) return node;

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

/** Parse a `T+60` / `T-1` sentinel string to its signed integer value. */
function parseSentinel(value: string): number {
  const sign = value.charAt(1) === '-' ? -1 : 1;
  const mag = Number.parseInt(value.slice(2), 10);
  return sign * mag;
}

/**
 * Revert temporal-delta encoding on one tabular array. Walks each
 * column forward from row 0, resolving `T+N`/`T-N` sentinels by adding
 * the signed delta to the previously resolved absolute epoch and
 * re-formatting via the row-0 template.
 *
 * @param node - Tabular array possibly containing temporal sentinels
 * @returns Result with decoded rows and a resolution flag
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: sentinel chains per column mirror numeric decoder
export function temporalDeltaDecodeTabular(node: TabularArrayNode): {
  node: TabularArrayNode;
  resolvedAllSentinels: boolean;
} {
  if (node.rows.length < 2) return { node, resolvedAllSentinels: true };

  const fieldCount = node.fields.length;
  const firstRow = node.rows[0];
  if (!firstRow) return { node, resolvedAllSentinels: true };

  const newRows: TabularRowNode[] = node.rows.map((row) => ({
    type: 'tabularRow',
    values: [...row.values],
    position: row.position ?? POS,
  }));

  let resolvedAll = true;

  for (let f = 0; f < fieldCount; f++) {
    const refCell = newRows[0]?.values[f];
    if (!refCell) continue;
    /* Row 0 must be a parseable ISO string for any temporal sentinel in
       this column to resolve. If not, we leave sentinels as-is and
       signal incomplete resolution. */
    let templateValue: string | null =
      refCell.scalarType === 'string' ? refCell.value : null;
    const parsedRef = templateValue ? parseISO(templateValue) : null;
    let runningEpoch: number | null = parsedRef?.epochSec ?? null;

    for (let r = 1; r < newRows.length; r++) {
      const row = newRows[r];
      if (!row) continue;
      const cell = row.values[f];
      if (!cell) continue;
      if (cell.scalarType !== 'string') continue;
      if (isTemporalDeltaSentinel(cell)) {
        if (runningEpoch === null || templateValue === null) {
          resolvedAll = false;
          continue;
        }
        runningEpoch += parseSentinel(cell.value);
        const iso = formatEpochToISO(runningEpoch, templateValue);
        row.values[f] = {
          type: 'scalar',
          scalarType: 'string',
          value: iso,
          quoted: cell.quoted,
          position: cell.position ?? POS,
        };
      } else {
        /* Concrete cell — reset the running reference so subsequent
           sentinels resolve against this row's value. */
        const reparsed = parseISO(cell.value);
        if (reparsed) {
          runningEpoch = reparsed.epochSec;
          templateValue = cell.value;
        }
      }
    }
  }

  return { node: { ...node, rows: newRows }, resolvedAllSentinels: resolvedAll };
}

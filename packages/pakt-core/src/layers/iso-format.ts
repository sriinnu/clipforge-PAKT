/**
 * @module layers/iso-format
 * ISO-8601 date-time parsing and formatting helpers shared by the
 * temporal-delta encoder.
 *
 * Isolated in its own module so {@link L1-delta-temporal} can stay under
 * the 400-line cap without inlining the regex + `Date.parse` plumbing.
 * The helpers here are pure: no AST types, no side effects, just
 * `string ⇄ epoch-second` round-trips that preserve the original ISO
 * display shape (UTC `Z`, fixed offset, or no-TZ).
 *
 * @see L1-delta-temporal — the only current consumer
 */

// ---------------------------------------------------------------------------
// Regex + shape types
// ---------------------------------------------------------------------------

/**
 * Matches an ISO-8601 date-time scalar we are willing to delta-encode.
 *
 * Accepts:
 *   - `YYYY-MM-DDTHH:MM:SS` (no TZ)
 *   - `YYYY-MM-DDTHH:MM:SSZ`
 *   - `YYYY-MM-DDTHH:MM:SS+HH:MM` / `-HH:MM`
 *   - optional fractional seconds `.s{1,9}`
 *
 * The `T` separator is required — date-only strings are excluded
 * intentionally (different unit; would conflict with seconds delta).
 */
export const ISO_DT_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Describes the common shape all cells in a column share. If any two
 * cells disagree on `hasFrac` / `tz`, the column is disqualified.
 */
export interface ColumnShape {
  hasFrac: boolean;
  /** `'Z'`, `'none'`, or a fixed offset like `'+02:00'`. */
  tz: string;
}

/**
 * Parsed view of a single ISO-8601 scalar. Returns null when the value
 * isn't parseable, has fractional seconds (skipped), or yields a
 * non-finite epoch.
 */
export interface ParsedISO {
  /** Seconds since Unix epoch. */
  epochSec: number;
  /** Shape descriptor used for column-level uniformity checks. */
  shape: ColumnShape;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse an ISO-8601 date-time string into epoch seconds + shape.
 *
 * Returns `null` when:
 *   - the string doesn't match {@link ISO_DT_RE},
 *   - it carries a fractional-second component (we skip those to avoid
 *     silent millisecond loss through integer deltas), or
 *   - `Date.parse` yields `NaN`.
 *
 * Missing TZ is treated as UTC for delta purposes; the column-uniformity
 * check upstream ensures all rows agree, so any sign error would apply
 * symmetrically and cancel inside deltas.
 *
 * @param value - Raw ISO datetime string
 * @returns Parsed epoch + shape, or `null` when ineligible
 */
export function parseISO(value: string): ParsedISO | null {
  const m = ISO_DT_RE.exec(value);
  if (!m) return null;

  const [, y, mo, d, h, mi, s, frac, tz] = m;
  if (frac) return null;

  const tzForParse = tz ?? 'Z';
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${tzForParse}`;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;

  return {
    epochSec: Math.floor(ms / 1000),
    shape: { hasFrac: false, tz: tz ?? 'none' },
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Re-emit `epochSec` using the same ISO shape as `templateValue`. The
 * template is the row-0 absolute ISO value for the column — its TZ
 * suffix (or absence) is preserved so round-trips are literal.
 *
 * - Template `Z`          → `YYYY-MM-DDTHH:MM:SSZ`
 * - Template no-TZ        → `YYYY-MM-DDTHH:MM:SS`
 * - Template `+HH:MM`     → wall-clock at that offset + suffix
 *
 * @param epochSec - Target moment, in whole seconds since Unix epoch
 * @param templateValue - Row-0 ISO string this column was anchored on
 * @returns ISO string sharing the template's display shape
 */
export function formatEpochToISO(epochSec: number, templateValue: string): string {
  const templateMatch = ISO_DT_RE.exec(templateValue);
  const templateTz = templateMatch?.[8]; // Z | +HH:MM | undefined

  /* Emit in UTC then re-apply the original TZ suffix. When the template
     had a fixed offset we need to display the same wall-clock as
     (epoch + offset) — not just the UTC time. */
  if (!templateTz || templateTz === 'Z') {
    const date = new Date(epochSec * 1000);
    const iso = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
    return templateTz === 'Z' ? iso : iso.slice(0, -1);
  }

  const sign = templateTz.charAt(0) === '-' ? -1 : 1;
  const [offH, offM] = templateTz.slice(1).split(':').map((n) => Number.parseInt(n, 10));
  const offsetMin = sign * ((offH ?? 0) * 60 + (offM ?? 0));
  const shifted = new Date((epochSec + offsetMin * 60) * 1000);
  const iso = shifted.toISOString().replace(/\.\d{3}Z$/, '');
  return `${iso}${templateTz}`;
}

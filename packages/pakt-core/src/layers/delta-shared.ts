/**
 * @module layers/delta-shared
 * Helpers shared by the numeric (`+N` / `-N`) and temporal (`T+N` /
 * `T-N`) delta codecs.
 *
 * Kept deliberately tiny: only logic that is behaviourally identical
 * between the two codecs lives here. Anything shape-specific (sentinel
 * regexes, node factories, savings gates) stays in its own module so
 * each codec remains independently readable.
 *
 * @see L1-delta-numeric  — `+N` / `-N` integer-column codec
 * @see L1-delta-temporal — `T+N` / `T-N` ISO-datetime codec
 */

/**
 * Parse the signed integer payload of a delta sentinel string.
 *
 * Both sentinel shapes share the `sign + magnitude` tail; `signIndex`
 * locates the sign character so one parser serves both:
 *
 * - numeric  `+60` / `-1`   → `signIndex = 0`
 * - temporal `T+60` / `T-1` → `signIndex = 1`
 *
 * Callers must validate the sentinel shape first (via
 * `isNumericDeltaSentinel` / `isTemporalDeltaSentinel`); no validation
 * happens here.
 *
 * @param value     - Sentinel string, e.g. `+60` or `T-1`
 * @param signIndex - Index of the `+` / `-` sign character in `value`
 * @returns Signed integer delta
 */
export function parseDeltaSentinel(value: string, signIndex: number): number {
  /* parseInt would accept a leading `+` but we stay explicit about both
     the sign handling and the base. */
  const sign = value.charAt(signIndex) === '-' ? -1 : 1;
  const mag = Number.parseInt(value.slice(signIndex + 1), 10);
  return sign * mag;
}

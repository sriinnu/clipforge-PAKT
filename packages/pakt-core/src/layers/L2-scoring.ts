/**
 * @module layers/L2-scoring
 * Token estimation, alias generation, and threshold constants for L2 dictionary.
 *
 * Centralizes the information-theoretic primitives used by candidate detection
 * and the greedy selection pass. All thresholds derive from the break-even
 * formula: `min_occ = ceil((tokens + 3) / (tokens - 1))`.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of aliases ($a-$z, $aa-$az). */
export const MAX_ALIASES = 52;

/** Default minimum net token savings to justify an alias. */
export const DEFAULT_MIN_SAVINGS = 3;

/** Minimum occurrences for exact-match dedup. */
export const MIN_OCCURRENCES = 3;

/** Minimum string length for exact-match dedup. */
export const MIN_VALUE_LENGTH = 2;

/** Minimum shared prefix length to consider for aliasing. */
export const MIN_PREFIX_LENGTH = 8;

/** Minimum values sharing a prefix to justify an alias. */
export const MIN_PREFIX_OCCURRENCES = 3;

/** Minimum shared suffix length to consider for aliasing. */
export const MIN_SUFFIX_LENGTH = 6;

/** Minimum values sharing a suffix to justify an alias. */
export const MIN_SUFFIX_OCCURRENCES = 3;

/**
 * Default window sizes for substring detection, checked longest-to-shortest.
 * Skipping intermediate sizes keeps complexity manageable while catching the
 * most impactful patterns (BPE-style heuristic). Used as the fallback when
 * no value sample is available; otherwise prefer
 * {@link computeAdaptiveWindowSizes}.
 */
export const SUBSTRING_WINDOW_SIZES = [32, 24, 20, 16, 12, 10, 8, 6];

/**
 * Below this share of values being "short" (< 12 chars) the adaptive ladder
 * leaves the small-window tail alone. Above it, an extra `5`-char window is
 * appended so dense short-string corpora (slugs, country codes, status
 * tokens) get a chance to dedupe.
 */
const SHORT_VALUE_THRESHOLD_LEN = 12;
const SHORT_VALUE_RATIO_TRIGGER = 0.5;

/**
 * Extended windows added when the input contains genuinely long strings
 * (URLs, paths, log lines). These catch repeats that the 32-cap ladder
 * would otherwise split into unrelated chunks.
 */
const EXTRA_LONG_WINDOWS = [64, 48, 40] as const;

/**
 * Pick a substring-mining window ladder tuned to the value corpus.
 *
 * Three adaptations vs. the static {@link SUBSTRING_WINDOW_SIZES}:
 *
 * 1. **Cap by max length** — windows wider than the longest value cannot
 *    match anything, so they're dropped (saves a small constant per value
 *    inside the mining loop).
 * 2. **Extend upward** — windows from {@link EXTRA_LONG_WINDOWS} (40/48/64)
 *    are added whenever the longest value reaches their size, catching
 *    long URL paths or log-line prefixes that a 32-char cap would miss.
 * 3. **Extend downward** — when more than half the values are shorter
 *    than 12 chars, append a 5-char window. Length-5 substrings still
 *    clear the savings break-even (`subTok=2`, `dictCost=5`, `minOcc=5`)
 *    but the default ladder floors at 6, so dense short-string corpora
 *    miss legitimate repeats today.
 *
 * The returned ladder is sorted descending and de-duplicated. Returns the
 * default ladder when `values` is empty so the call site never has to
 * branch on edge cases.
 *
 * @param values - String values about to be mined for substrings.
 * @returns Window-size ladder, longest first.
 */
export function computeAdaptiveWindowSizes(values: readonly string[]): number[] {
  if (values.length === 0) return [...SUBSTRING_WINDOW_SIZES];

  // Single pass to gather corpus shape — avoids two scans for large inputs.
  let maxLen = 0;
  let shortCount = 0;
  for (const v of values) {
    if (v.length > maxLen) maxLen = v.length;
    if (v.length < SHORT_VALUE_THRESHOLD_LEN) shortCount++;
  }

  // Nothing useful can be mined if the longest value is below the smallest
  // viable window — return an empty ladder so callers skip the loop entirely.
  const minWindow = SUBSTRING_WINDOW_SIZES[SUBSTRING_WINDOW_SIZES.length - 1];
  if (maxLen < minWindow) return [];

  const sizes = new Set<number>();

  // 1. Long-value extensions, included whenever the corpus actually has a
  // value long enough to host them. (40 needs maxLen >= 40, etc.)
  for (const w of EXTRA_LONG_WINDOWS) {
    if (w <= maxLen) sizes.add(w);
  }

  // 2. Default ladder, capped by maxLen.
  for (const w of SUBSTRING_WINDOW_SIZES) {
    if (w <= maxLen) sizes.add(w);
  }

  // 3. Short-value-heavy corpus → add a 5-char window.
  const shortRatio = shortCount / values.length;
  if (shortRatio > SHORT_VALUE_RATIO_TRIGGER && maxLen >= 5) {
    sizes.add(5);
  }

  // Largest first so the dominance pass in mining works without re-sorting.
  return [...sizes].sort((a, b) => b - a);
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Estimate BPE token count via heuristic: `ceil(length / 4)`.
 * Fast approximation that avoids importing a full tokenizer.
 * @param value - String to estimate
 * @returns Estimated token count (>= 1)
 * @example
 * ```ts
 * estimateTokens('Engineering'); // 3
 * estimateTokens('ab');          // 1
 * ```
 */
export function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

// ---------------------------------------------------------------------------
// Alias generation
// ---------------------------------------------------------------------------

/**
 * Generate alias string for index 0..51.
 * 0-25 => `$a`-`$z`, 26-51 => `$aa`-`$az`.
 * @param index - Alias index (0-based)
 * @returns Alias string (e.g. `$a`, `$z`, `$aa`)
 * @example
 * ```ts
 * aliasForIndex(0);  // '$a'
 * aliasForIndex(25); // '$z'
 * aliasForIndex(26); // '$aa'
 * ```
 */
export function aliasForIndex(index: number): string {
  if (index < 26) return `$${String.fromCharCode(97 + index)}`;
  return `$a${String.fromCharCode(97 + (index - 26))}`;
}

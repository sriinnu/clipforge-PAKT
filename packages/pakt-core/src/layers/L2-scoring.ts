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
 * Window sizes for substring detection. Checked from longest to shortest.
 * Skipping intermediate sizes keeps complexity manageable while catching
 * the most impactful patterns (BPE-style heuristic).
 */
export const SUBSTRING_WINDOW_SIZES = [32, 24, 20, 16, 12, 10, 8, 6];

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

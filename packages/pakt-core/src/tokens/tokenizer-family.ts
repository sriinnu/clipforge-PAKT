/**
 * @module tokens/tokenizer-family
 * Tokenizer-family awareness for L3 optimization.
 *
 * Different model families use different BPE encodings with different merge
 * rules. Token counts — and therefore L3's compression gating decisions —
 * depend on the exact encoding of the downstream consumer. This module
 * maps a model identifier to its tokenizer family so that {@link countTokens}
 * and L3 can route to the correct encoding.
 *
 * Supported families:
 * - `o200k_base` — GPT-4o family (exact).
 * - `cl100k_base` — GPT-4 / GPT-3.5 (exact). Also used as an approximation
 *   for Claude and Llama because their tokenizers are not publicly shipped
 *   in `gpt-tokenizer`. Claude's tokenizer is Anthropic-proprietary; Llama
 *   uses a separate 128k SentencePiece vocab. See README for caveats.
 *
 * @example
 * ```ts
 * import { getTokenizerFamily } from '@sriinnu/pakt';
 *
 * getTokenizerFamily('gpt-4o');        // 'o200k_base'
 * getTokenizerFamily('gpt-4');         // 'cl100k_base'
 * getTokenizerFamily('claude-sonnet'); // 'cl100k_base' (approximate)
 * getTokenizerFamily('unknown-xyz');   // 'cl100k_base' (fallback)
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Supported tokenizer encoding families.
 *
 * - `o200k_base` — OpenAI's 200k vocabulary (GPT-4o, GPT-4o-mini).
 * - `cl100k_base` — OpenAI's 100k vocabulary (GPT-4, GPT-3.5, turbo).
 *   Also the best available approximation for Claude and Llama in this
 *   library because exact vocabularies are not publicly shipped.
 */
export type TokenizerFamily = 'o200k_base' | 'cl100k_base';

/**
 * Metadata describing how a model maps to a tokenizer family.
 */
export interface TokenizerFamilyInfo {
  /** The BPE family the model uses (or is approximated by). */
  family: TokenizerFamily;
  /**
   * `true` when the family is the model's exact tokenizer.
   * `false` when we are approximating (Claude, Llama, unknown models).
   */
  exact: boolean;
  /**
   * Human-readable caveat for approximate mappings.
   * Undefined when `exact === true`.
   */
  approximationNote?: string;
}

// ---------------------------------------------------------------------------
// Lookup data
// ---------------------------------------------------------------------------

/**
 * Exact model -> family mappings. Matched by case-insensitive prefix so that
 * specific revisions like `gpt-4o-2024-08-06` resolve correctly.
 *
 * Order matters: longer prefixes must come before shorter ones to avoid
 * `gpt-4` capturing `gpt-4o`.
 */
const EXACT_PREFIXES: ReadonlyArray<[string, TokenizerFamily]> = [
  ['gpt-4o', 'o200k_base'],
  ['gpt-4.1', 'o200k_base'],
  ['o1', 'o200k_base'],
  ['o3', 'o200k_base'],
  ['o4', 'o200k_base'],
  ['chatgpt-4o', 'o200k_base'],
  ['gpt-4', 'cl100k_base'],
  ['gpt-3.5', 'cl100k_base'],
];

/**
 * Model prefixes that we approximate as cl100k_base, with a human-readable
 * caveat. Exact tokenizers are not publicly available.
 */
const APPROXIMATE_PREFIXES: ReadonlyArray<[string, string]> = [
  [
    'claude-',
    "Claude's tokenizer is proprietary to Anthropic and not publicly shipped. " +
      'Counts use cl100k_base as a close approximation — expect small drift.',
  ],
  [
    'llama-',
    'Llama uses a 128k SentencePiece vocab that gpt-tokenizer does not ship. ' +
      'Counts use cl100k_base as an approximation — expect small drift.',
  ],
];

/** Default family when the model is unknown to every other mapping. */
const FALLBACK_FAMILY: TokenizerFamily = 'cl100k_base';

/** Caveat emitted when falling back for an unknown model name. */
const FALLBACK_NOTE =
  'Unknown model. Falling back to cl100k_base for token counting — ' +
  'register a custom TokenCounter for exact counts.';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a model identifier to its tokenizer family.
 *
 * Thin wrapper around {@link getTokenizerFamilyInfo} for callers that only
 * need the family name (e.g., L3 merge routing, token counter selection).
 *
 * @param model - Model identifier. Matching is case-insensitive and by prefix.
 * @returns The family name. Falls back to `cl100k_base` when unknown.
 *
 * @example
 * ```ts
 * getTokenizerFamily('gpt-4o-mini');     // 'o200k_base'
 * getTokenizerFamily('GPT-4');           // 'cl100k_base'
 * getTokenizerFamily('claude-opus');     // 'cl100k_base' (approximate)
 * getTokenizerFamily('totally-unknown'); // 'cl100k_base' (fallback)
 * ```
 */
export function getTokenizerFamily(model: string | undefined | null): TokenizerFamily {
  return getTokenizerFamilyInfo(model).family;
}

/**
 * Resolve a model identifier to full tokenizer-family info, including whether
 * the mapping is exact or approximate.
 *
 * Downstream tools (playgrounds, cost estimators) can surface the
 * `approximationNote` to users so they understand when counts may drift.
 *
 * @param model - Model identifier. Matching is case-insensitive and by prefix.
 * @returns Family info with `{ family, exact, approximationNote? }`.
 *
 * @example
 * ```ts
 * const info = getTokenizerFamilyInfo('claude-sonnet');
 * // { family: 'cl100k_base', exact: false, approximationNote: '...' }
 *
 * if (!info.exact) console.warn(info.approximationNote);
 * ```
 */
export function getTokenizerFamilyInfo(model: string | undefined | null): TokenizerFamilyInfo {
  const normalized = (model ?? '').toLowerCase().trim();

  // 1. Exact family match via prefix.
  for (const [prefix, family] of EXACT_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return { family, exact: true };
    }
  }

  // 2. Approximate family — Claude, Llama.
  for (const [prefix, note] of APPROXIMATE_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return {
        family: 'cl100k_base',
        exact: false,
        approximationNote: note,
      };
    }
  }

  // 3. Unknown model. Fall back to cl100k_base; flag as approximate so
  //    callers can warn users that the count might not match their provider.
  return {
    family: FALLBACK_FAMILY,
    exact: false,
    approximationNote: FALLBACK_NOTE,
  };
}

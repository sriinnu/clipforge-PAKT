/**
 * @module tokens/gpt-counter
 * Default GPT BPE token counter implementation with tokenizer-family
 * awareness.
 *
 * This is a leaf module: both `counter.ts` and `registry.ts` can import
 * from here without creating circular dependencies. We load both the
 * cl100k_base (GPT-4 / GPT-3.5) and o200k_base (GPT-4o family) encodings
 * from `gpt-tokenizer`, and route to the correct one based on the
 * model's {@link TokenizerFamily}.
 *
 * @example
 * ```ts
 * import { GptTokenCounter } from '@sriinnu/pakt';
 *
 * new GptTokenCounter('gpt-4o').count('Hello');        // uses o200k_base
 * new GptTokenCounter('gpt-4').count('Hello');         // uses cl100k_base
 * new GptTokenCounter('claude-sonnet').count('Hello'); // cl100k_base (approx)
 * ```
 */

// Two encodings loaded as separate subpath imports. `gpt-tokenizer` ships
// both BPE tables; see node_modules/gpt-tokenizer/esm/encoding/ for the
// available vocabularies. We intentionally only depend on the existing
// `gpt-tokenizer` package — no new runtime deps.
import { encode as encodeCl100k } from 'gpt-tokenizer/encoding/cl100k_base';
import { encode as encodeO200k } from 'gpt-tokenizer/encoding/o200k_base';

import { getTokenizerFamily, type TokenizerFamily } from './tokenizer-family.js';
import type { TokenCounter } from './types.js';

// ---------------------------------------------------------------------------
// Encoder dispatch
// ---------------------------------------------------------------------------

/**
 * Map a tokenizer family to its `encode` function from `gpt-tokenizer`.
 * Kept as a lookup so additional families (future o200k successors, etc.)
 * can slot in without branching logic at the call site.
 */
const ENCODERS: Record<TokenizerFamily, (text: string) => number[]> = {
  o200k_base: encodeO200k,
  cl100k_base: encodeCl100k,
};

// ---------------------------------------------------------------------------
// GptTokenCounter class
// ---------------------------------------------------------------------------

/**
 * Default token counter backed by `gpt-tokenizer`.
 *
 * Picks the correct BPE encoding based on the model's tokenizer family:
 * - `gpt-4o`, `gpt-4o-mini`, `o1`, `o3`, `o4` -> `o200k_base`
 * - `gpt-4`, `gpt-3.5` -> `cl100k_base`
 * - `claude-*`, `llama-*`, unknown models -> `cl100k_base` (approximate)
 *
 * See {@link getTokenizerFamily} for the full mapping.
 *
 * @example
 * ```ts
 * const counter = new GptTokenCounter('gpt-4o');
 * counter.count('Hello, world!'); // counted via o200k_base
 * counter.family;                 // 'o200k_base'
 * ```
 */
export class GptTokenCounter implements TokenCounter {
  /** The model identifier this counter was created for. */
  readonly model: string;

  /** The resolved tokenizer family used for this counter's encoding. */
  readonly family: TokenizerFamily;

  /**
   * Create a new GPT BPE token counter.
   *
   * @param model - Model identifier (e.g., `'gpt-4o'`). The tokenizer
   *   family is resolved via {@link getTokenizerFamily}; unknown models
   *   fall back to `cl100k_base`.
   */
  constructor(model: string) {
    this.model = model;
    this.family = getTokenizerFamily(model);
  }

  /**
   * Count tokens in the given text using the counter's tokenizer family.
   * @param text - The text to tokenize.
   * @returns The number of tokens.
   */
  count(text: string): number {
    if (text === '') {
      return 0;
    }
    // Dispatch to the correct encoder for this family. Guaranteed to be
    // populated for every TokenizerFamily value.
    const encode = ENCODERS[this.family];
    return encode(text).length;
  }
}

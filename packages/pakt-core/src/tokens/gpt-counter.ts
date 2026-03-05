/**
 * @module tokens/gpt-counter
 * Default GPT BPE token counter implementation.
 *
 * This is a leaf module with no internal dependencies — both
 * `counter.ts` and `registry.ts` can safely import from here
 * without creating circular dependency chains.
 */

import { encode } from 'gpt-tokenizer';

import type { TokenCounter } from './types.js';

// ---------------------------------------------------------------------------
// GptTokenCounter class
// ---------------------------------------------------------------------------

/**
 * Default token counter backed by the `gpt-tokenizer` library.
 *
 * Uses the cl100k_base encoding, which is compatible with GPT-4 and
 * GPT-4o. Other model families (Claude, Llama, etc.) should register
 * their own {@link TokenCounter} via the registry for accurate counts.
 *
 * @example
 * ```ts
 * import { GptTokenCounter } from '@sriinnu/pakt';
 *
 * const counter = new GptTokenCounter('gpt-4o');
 * console.log(counter.count('Hello, world!')); // 4
 * ```
 */
export class GptTokenCounter implements TokenCounter {
  /** The model identifier this counter was created for. */
  readonly model: string;

  /**
   * Create a new GPT BPE token counter.
   * @param model - Model identifier (e.g., 'gpt-4o'). Used for labelling
   *   only — the underlying encoding is always cl100k_base.
   */
  constructor(model: string) {
    this.model = model;
  }

  /**
   * Count tokens in the given text using GPT BPE (cl100k_base).
   * @param text - The text to tokenize.
   * @returns The number of tokens.
   */
  count(text: string): number {
    if (text === '') {
      return 0;
    }
    const tokens = encode(text);
    return tokens.length;
  }
}

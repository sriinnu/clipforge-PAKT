/**
 * @module tokens/counter
 * Token counting utilities using the gpt-tokenizer library.
 * Uses cl100k_base encoding by default, which is compatible with
 * GPT-4, GPT-4o, and close enough for Claude models.
 */

import { encode } from 'gpt-tokenizer';

/**
 * Count the number of tokens in a text string.
 * Uses the cl100k_base tokenizer (GPT-4, GPT-4o, Claude-compatible).
 *
 * The `model` parameter is accepted for API compatibility but the
 * gpt-tokenizer library uses cl100k_base by default, which is close
 * enough for all major models (GPT-4o, Claude Sonnet/Opus/Haiku).
 *
 * @param text - The text string to tokenize and count.
 * @param model - Optional model name for API compatibility (currently unused).
 * @returns The number of tokens in the text.
 *
 * @example
 * ```ts
 * import { countTokens } from '@sriinnu/pakt';
 *
 * const tokens = countTokens('Hello, world!');
 * console.log(tokens); // 4
 *
 * // Model parameter accepted but uses cl100k_base for all
 * const tokens2 = countTokens('Hello, world!', 'gpt-4o');
 * console.log(tokens2); // 4
 * ```
 */
export function countTokens(text: string, _model?: string): number {
  if (text === '') {
    return 0;
  }
  const tokens = encode(text);
  return tokens.length;
}

/**
 * @module tokens/types
 * Pluggable tokenizer interface definitions.
 *
 * These types allow consumers to provide custom token-counting backends
 * (e.g., Claude's tokenizer, Llama's tokenizer) instead of relying
 * solely on the default GPT BPE implementation.
 *
 * @example
 * ```ts
 * import type { TokenCounter, TokenCounterFactory } from '@sriinnu/pakt';
 *
 * const myCounter: TokenCounter = {
 *   model: 'claude-sonnet',
 *   count: (text) => myClaudeTokenize(text).length,
 * };
 * ```
 */

// ---------------------------------------------------------------------------
// TokenCounter interface
// ---------------------------------------------------------------------------

/**
 * Interface for pluggable token counting backends.
 *
 * Implement this interface to provide accurate token counts for a
 * specific model's tokenizer. The default fallback uses `gpt-tokenizer`
 * (cl100k_base / GPT BPE), which may over- or under-count tokens for
 * non-OpenAI models.
 *
 * @example
 * ```ts
 * import type { TokenCounter } from '@sriinnu/pakt';
 *
 * class ClaudeTokenCounter implements TokenCounter {
 *   model = 'claude-sonnet';
 *   count(text: string): number {
 *     return claudeTokenize(text).length;
 *   }
 * }
 * ```
 */
export interface TokenCounter {
  /** Count tokens in the given text. */
  count(text: string): number;
  /** Identifier for this counter (e.g., 'gpt-4o', 'claude-sonnet'). */
  model: string;
}

// ---------------------------------------------------------------------------
// TokenCounterFactory type
// ---------------------------------------------------------------------------

/**
 * Factory function that creates a {@link TokenCounter} for a given model.
 *
 * Return `null` if the factory does not handle the requested model.
 * The registry will try each registered factory in order (most recently
 * registered first) and fall back to the GPT default if none match.
 *
 * @param model - The model identifier to create a counter for.
 * @returns A `TokenCounter` if this factory handles the model, or `null`.
 *
 * @example
 * ```ts
 * import type { TokenCounterFactory } from '@sriinnu/pakt';
 *
 * const claudeFactory: TokenCounterFactory = (model) => {
 *   if (model.startsWith('claude-')) {
 *     return { model, count: (text) => claudeTokenize(text).length };
 *   }
 *   return null; // not our model
 * };
 * ```
 */
export type TokenCounterFactory = (model: string) => TokenCounter | null;

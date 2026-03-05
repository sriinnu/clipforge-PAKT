/**
 * @module tokens/counter
 * Token counting utilities with pluggable backend support.
 *
 * The public {@link countTokens} function is the main entry point. It
 * delegates to the {@link getTokenCounter} registry, which falls back to
 * the built-in {@link GptTokenCounter} (cl100k_base / GPT BPE) when no
 * custom counter is registered for the requested model.
 *
 * @example
 * ```ts
 * import { countTokens } from '@sriinnu/pakt';
 *
 * const tokens = countTokens('Hello, world!');
 * console.log(tokens); // 4
 * ```
 */

import { getTokenCounter } from './registry.js';

// ---------------------------------------------------------------------------
// Re-export GptTokenCounter for convenience
// ---------------------------------------------------------------------------

export { GptTokenCounter } from './gpt-counter.js';

// ---------------------------------------------------------------------------
// Public API — backwards-compatible countTokens function
// ---------------------------------------------------------------------------

/**
 * Count the number of tokens in a text string.
 *
 * Delegates to the token counter registry. If a custom counter is
 * registered for the given model, it will be used. Otherwise, the
 * default GPT BPE counter (cl100k_base) is used as a fallback.
 *
 * @param text - The text string to tokenize and count.
 * @param model - Optional model name. When provided, the registry will
 *   look for a matching custom counter before falling back to GPT BPE.
 * @returns The number of tokens in the text.
 *
 * @example
 * ```ts
 * import { countTokens } from '@sriinnu/pakt';
 *
 * const tokens = countTokens('Hello, world!');
 * console.log(tokens); // 4
 *
 * // With a model hint (uses registered counter or falls back to GPT BPE)
 * const tokens2 = countTokens('Hello, world!', 'claude-sonnet');
 * ```
 */
export function countTokens(text: string, model?: string): number {
  const counter = getTokenCounter(model ?? 'gpt-4o');
  return counter.count(text);
}

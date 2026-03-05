/**
 * @module tokens/registry
 * Token counter registry — manages pluggable tokenizer backends.
 *
 * Custom token counters can be registered via {@link registerTokenCounter}.
 * When {@link getTokenCounter} is called, the registry checks each
 * registered factory (most-recently-registered first). If none match,
 * the default {@link GptTokenCounter} fallback is used.
 *
 * @example
 * ```ts
 * import { registerTokenCounter, getTokenCounter } from '@sriinnu/pakt';
 *
 * // Register a Claude tokenizer
 * registerTokenCounter((model) => {
 *   if (model.startsWith('claude-')) {
 *     return { model, count: (text) => myClaudeTokenize(text).length };
 *   }
 *   return null;
 * });
 *
 * // Now getTokenCounter('claude-sonnet') returns the custom counter
 * const counter = getTokenCounter('claude-sonnet');
 * ```
 */

import { GptTokenCounter } from './gpt-counter.js';
import type { TokenCounter, TokenCounterFactory } from './types.js';

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/**
 * Registered factories, ordered most-recently-registered first.
 * Checked in order by {@link getTokenCounter}; first non-null wins.
 */
let factories: TokenCounterFactory[] = [];

// ---------------------------------------------------------------------------
// registerTokenCounter
// ---------------------------------------------------------------------------

/**
 * Register a custom {@link TokenCounterFactory}.
 *
 * Factories are checked in reverse registration order (most recent first).
 * A factory should return a {@link TokenCounter} if it handles the
 * requested model, or `null` to pass through to the next factory.
 *
 * @param factory - A factory function that creates counters for specific models.
 *
 * @example
 * ```ts
 * import { registerTokenCounter } from '@sriinnu/pakt';
 *
 * registerTokenCounter((model) => {
 *   if (model.startsWith('claude-')) {
 *     return { model, count: (text) => claudeEncode(text).length };
 *   }
 *   return null;
 * });
 * ```
 */
export function registerTokenCounter(factory: TokenCounterFactory): void {
  factories.unshift(factory);
}

// ---------------------------------------------------------------------------
// getTokenCounter
// ---------------------------------------------------------------------------

/**
 * Get a {@link TokenCounter} for the specified model.
 *
 * Walks through registered factories (most-recently-registered first).
 * Returns the first non-null counter, or falls back to
 * {@link GptTokenCounter} (cl100k_base / GPT BPE) if no factory matches.
 *
 * @param model - The model identifier (e.g., 'gpt-4o', 'claude-sonnet').
 * @returns A `TokenCounter` for the model.
 *
 * @example
 * ```ts
 * import { getTokenCounter } from '@sriinnu/pakt';
 *
 * const counter = getTokenCounter('gpt-4o');
 * console.log(counter.count('Hello, world!')); // 4
 * ```
 */
export function getTokenCounter(model: string): TokenCounter {
  for (const factory of factories) {
    const counter = factory(model);
    if (counter !== null) {
      return counter;
    }
  }

  // Fallback: GPT BPE (cl100k_base)
  return new GptTokenCounter(model);
}

// ---------------------------------------------------------------------------
// resetTokenCounterRegistry
// ---------------------------------------------------------------------------

/**
 * Reset the token counter registry to its default state.
 *
 * Removes all custom factories. After calling this, {@link getTokenCounter}
 * will only return the default {@link GptTokenCounter} fallback.
 *
 * Intended primarily for testing — clears side-effects between test runs.
 *
 * @example
 * ```ts
 * import { resetTokenCounterRegistry, getTokenCounter } from '@sriinnu/pakt';
 *
 * resetTokenCounterRegistry();
 * const counter = getTokenCounter('claude-sonnet');
 * // counter is GptTokenCounter (fallback)
 * ```
 */
export function resetTokenCounterRegistry(): void {
  factories = [];
}

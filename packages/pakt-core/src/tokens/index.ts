/**
 * @module tokens
 * Token counting, savings comparison, and pluggable tokenizer registry.
 *
 * @example
 * ```ts
 * import {
 *   countTokens,
 *   compareSavings,
 *   registerTokenCounter,
 *   getTokenCounter,
 * } from '@sriinnu/pakt';
 *
 * // Register a custom tokenizer for Claude models
 * registerTokenCounter((model) => {
 *   if (model.startsWith('claude-')) {
 *     return { model, count: (text) => myClaudeTokenize(text).length };
 *   }
 *   return null;
 * });
 *
 * const tokens = countTokens('Hello, world!', 'claude-sonnet');
 * const report = compareSavings(original, compressed, 'gpt-4o');
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { TokenCounter, TokenCounterFactory } from './types.js';

// ---------------------------------------------------------------------------
// Counter
// ---------------------------------------------------------------------------

export { countTokens, GptTokenCounter } from './counter.js';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export {
  registerTokenCounter,
  getTokenCounter,
  resetTokenCounterRegistry,
} from './registry.js';

// ---------------------------------------------------------------------------
// Savings
// ---------------------------------------------------------------------------

export { compareSavings } from './savings.js';

// ---------------------------------------------------------------------------
// Tokenizer family (L3-aware routing)
// ---------------------------------------------------------------------------

export { getTokenizerFamily, getTokenizerFamilyInfo } from './tokenizer-family.js';
export type { TokenizerFamily, TokenizerFamilyInfo } from './tokenizer-family.js';

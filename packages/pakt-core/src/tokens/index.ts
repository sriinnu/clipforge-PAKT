/**
 * @module tokens
 * Token counting and savings comparison utilities.
 *
 * @example
 * ```ts
 * import { countTokens, compareSavings } from '@yugenlab/pakt';
 *
 * const tokens = countTokens('Hello, world!');
 * const report = compareSavings(original, compressed, 'gpt-4o');
 * ```
 */

export { countTokens } from './counter.js';
export { compareSavings } from './savings.js';

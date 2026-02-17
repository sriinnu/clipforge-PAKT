/**
 * @module tokens/savings
 * Savings comparison report — compares token counts between original
 * and compressed text, with optional cost estimates based on model pricing.
 */

import type { SavingsReport } from '../types.js';
import { MODEL_PRICING } from '../types.js';
import { countTokens } from './counter.js';

/**
 * Compare token counts between original and compressed text.
 * Returns a detailed savings report with cost estimates.
 *
 * Looks up the model in {@link MODEL_PRICING} to calculate cost savings.
 * If the model is unknown, `costSaved` will be `undefined`.
 *
 * @param original - The original (uncompressed) text.
 * @param compressed - The compressed text (e.g., PAKT output).
 * @param model - The model name for pricing lookup. Defaults to `'gpt-4o'`.
 * @returns A {@link SavingsReport} with token counts, percentages, and cost estimates.
 *
 * @example
 * ```ts
 * import { compareSavings } from '@yugenlab/pakt';
 *
 * const report = compareSavings(
 *   '{"users": [{"name": "Alice", "role": "dev"}]}',
 *   '@from json\nusers[1]{name|role}:\nAlice|dev',
 * );
 * console.log(`Saved ${report.savedPercent}% tokens`);
 * if (report.costSaved) {
 *   console.log(`Input cost saved: $${report.costSaved.input.toFixed(6)}`);
 * }
 * ```
 */
export function compareSavings(
  original: string,
  compressed: string,
  model?: string,
): SavingsReport {
  const resolvedModel = model ?? 'gpt-4o';

  const originalTokens = countTokens(original);
  const compressedTokens = countTokens(compressed);
  const savedTokens = originalTokens - compressedTokens;

  const savedPercent =
    originalTokens === 0
      ? 0
      : Math.round((savedTokens / originalTokens) * 100);

  const pricing = MODEL_PRICING[resolvedModel];

  const costSaved = pricing
    ? {
        input: (savedTokens / 1_000_000) * pricing.inputPerMTok,
        output: (savedTokens / 1_000_000) * pricing.outputPerMTok,
        currency: 'USD',
      }
    : undefined;

  return {
    originalTokens,
    compressedTokens,
    savedTokens,
    savedPercent,
    model: resolvedModel,
    costSaved,
  };
}

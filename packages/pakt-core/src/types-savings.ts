/**
 * @module types-savings
 * Token savings + model-pricing types for cost reporting.
 *
 * Split out of `types.ts` to keep the canonical types module under the
 * 400-line cap. Re-exported from `types.ts` so existing
 * `from './types.js'` imports continue to work.
 */

/**
 * Token count and savings report for cost estimation.
 * @example
 * ```ts
 * const report: SavingsReport = {
 *   originalTokens: 500, compressedTokens: 280,
 *   savedTokens: 220, savedPercent: 44, model: 'gpt-4o',
 *   costSaved: { input: 0.00055, output: 0.0022, currency: 'USD' },
 * };
 * ```
 */
export interface SavingsReport {
  originalTokens: number;
  compressedTokens: number;
  savedTokens: number;
  /** Savings as percentage (0-100) */
  savedPercent: number;
  /** Model used for token counting */
  model: string;
  /** Estimated cost savings (present when model pricing is known) */
  costSaved?: { input: number; output: number; currency: string };
}

/**
 * Model pricing for cost estimates.
 * @example
 * ```ts
 * const p: ModelPricing = { model: 'gpt-4o', inputPerMTok: 2.5, outputPerMTok: 10 };
 * ```
 */
export interface ModelPricing {
  model: string;
  /** Cost per million input tokens in USD */
  inputPerMTok: number;
  /** Cost per million output tokens in USD */
  outputPerMTok: number;
}

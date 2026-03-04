/**
 * @module constants
 * Shared constants for the PAKT library — model pricing, default options,
 * and default layer configurations. Types live in {@link module:types}.
 */

import type { ModelPricing, PaktLayers, PaktOptions } from './types.js';

// ---------------------------------------------------------------------------
// Model pricing
// ---------------------------------------------------------------------------

/**
 * Known model pricings (as of Feb 2026).
 * @example
 * ```ts
 * import { MODEL_PRICING } from '@sriinnu/pakt';
 * console.log(MODEL_PRICING['gpt-4o'].inputPerMTok); // 2.5
 * ```
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet': { model: 'claude-sonnet', inputPerMTok: 3, outputPerMTok: 15 },
  'claude-opus': { model: 'claude-opus', inputPerMTok: 15, outputPerMTok: 75 },
  'claude-haiku': { model: 'claude-haiku', inputPerMTok: 0.8, outputPerMTok: 4 },
  'gpt-4o': { model: 'gpt-4o', inputPerMTok: 2.5, outputPerMTok: 10 },
  'gpt-4o-mini': { model: 'gpt-4o-mini', inputPerMTok: 0.15, outputPerMTok: 0.6 },
};

// ---------------------------------------------------------------------------
// Default options
// ---------------------------------------------------------------------------

/**
 * Default PAKT options. L1+L2 enabled, L3+L4 disabled.
 * @example
 * ```ts
 * import { DEFAULT_OPTIONS } from '@sriinnu/pakt';
 * console.log(DEFAULT_OPTIONS.dictMinSavings); // 3
 * ```
 */
export const DEFAULT_OPTIONS: Required<PaktOptions> = {
  layers: {
    structural: true,
    dictionary: true,
    tokenizerAware: false,
    semantic: false,
  },
  fromFormat: 'json',
  targetModel: 'gpt-4o',
  dictMinSavings: 3,
  semanticBudget: 0,
};

// ---------------------------------------------------------------------------
// Default layers
// ---------------------------------------------------------------------------

/**
 * Default layers configuration (convenience constant).
 * @example
 * ```ts
 * import { DEFAULT_LAYERS } from '@sriinnu/pakt';
 * const myLayers = { ...DEFAULT_LAYERS, tokenizerAware: true };
 * ```
 */
export const DEFAULT_LAYERS: PaktLayers = {
  structural: true,
  dictionary: true,
  tokenizerAware: false,
  semantic: false,
};

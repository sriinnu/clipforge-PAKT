/**
 * @module tokens/model-profiles
 * Per-model tokenizer profiles for accurate token counting.
 *
 * Maps model identifiers to their BPE encoding. When a model uses
 * `o200k_base` (GPT-4o family) instead of `cl100k_base` (GPT-4),
 * this ensures PAKT's savings calculations are accurate for that model.
 *
 * Also provides a built-in factory that auto-registers o200k_base
 * support for GPT-4o models, so users don't need to set up custom counters.
 */

import { encode as encodeO200k } from 'gpt-tokenizer/encoding/o200k_base';

import type { TokenCounter, TokenCounterFactory } from './types.js';

// ---------------------------------------------------------------------------
// Model → encoding mapping
// ---------------------------------------------------------------------------

/** Supported BPE encoding identifiers. */
export type BpeEncoding = 'cl100k_base' | 'o200k_base';

/** Model-to-encoding mapping for known models. */
const MODEL_ENCODING: Record<string, BpeEncoding> = {
  // GPT-4o family → o200k_base
  'gpt-4o': 'o200k_base',
  'gpt-4o-mini': 'o200k_base',
  // GPT-4 family → cl100k_base (default, handled by fallback)
  'gpt-4': 'cl100k_base',
  'gpt-4-turbo': 'cl100k_base',
  // Claude models → use cl100k_base as best approximation
  // (Claude's actual tokenizer isn't publicly available, but cl100k
  // is a reasonable proxy for savings estimation)
  'claude-sonnet': 'cl100k_base',
  'claude-opus': 'cl100k_base',
  'claude-haiku': 'cl100k_base',
};

/**
 * Look up the BPE encoding for a model identifier.
 *
 * @param model - Model identifier (e.g., 'gpt-4o', 'claude-sonnet')
 * @returns The BPE encoding, or undefined if the model isn't in the map
 */
export function getModelEncoding(model: string): BpeEncoding | undefined {
  return MODEL_ENCODING[model];
}

// ---------------------------------------------------------------------------
// O200k token counter
// ---------------------------------------------------------------------------

/**
 * Token counter using the o200k_base BPE encoding (GPT-4o family).
 *
 * GPT-4o uses a 200K-vocabulary encoding that tokenizes differently
 * than cl100k_base. Using the correct encoding ensures savings
 * percentages are accurate when targeting GPT-4o.
 */
export class O200kTokenCounter implements TokenCounter {
  readonly model: string;

  constructor(model: string) {
    this.model = model;
  }

  count(text: string): number {
    if (text === '') return 0;
    return encodeO200k(text).length;
  }
}

// ---------------------------------------------------------------------------
// Built-in factory
// ---------------------------------------------------------------------------

/**
 * Factory that creates o200k_base counters for GPT-4o family models.
 * Returns null for all other models (falls through to default cl100k).
 */
export const o200kFactory: TokenCounterFactory = (model: string): TokenCounter | null => {
  const encoding = MODEL_ENCODING[model];
  if (encoding === 'o200k_base') {
    return new O200kTokenCounter(model);
  }
  return null;
};

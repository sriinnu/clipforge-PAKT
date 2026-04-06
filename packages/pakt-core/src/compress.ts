/**
 * @module compress
 * PAKT compression pipeline entry point.
 *
 * This module exports the primary {@link compress} function that runs
 * input text through the PAKT compression pipeline:
 * L1 (structural) -> L2 (dictionary) -> L3 (tokenizer, optional) -> L4 (semantic, optional)
 */

import {
  applyDictionaryLayer,
  applySemanticLayer,
  applyTokenizerLayer,
  buildCompressedResult,
  buildPipelineSetup,
  buildUnchangedResult,
  injectEnvelopePreamble,
  tryCompressSpecialFormats,
} from './compress-helpers.js';
import { DEFAULT_OPTIONS } from './constants.js';
import { parseInput } from './format-parsers/index.js';
import { applyDeltaEncoding, compressL1, compressText } from './layers/index.js';
import { serialize } from './serializer/index.js';
import { countTokens } from './tokens/index.js';
import type { PaktOptions, PaktResult } from './types.js';

// ---------------------------------------------------------------------------
// Main compress function
// ---------------------------------------------------------------------------

/**
 * Compress input text into PAKT format.
 *
 * Runs the input through the PAKT compression pipeline. By default,
 * only L1 (structural) and L2 (dictionary) are enabled. L3 (tokenizer)
 * and L4 (semantic) require explicit opt-in via the `layers` option.
 *
 * The pipeline stages:
 * 1. **L1 -- Structural**: Detects the input format, parses it, and
 *    converts to PAKT syntax (stripping braces, quotes, whitespace).
 * 2. **L2 -- Dictionary**: Finds repeated n-grams and replaces them
 *    with short aliases (`$a`, `$b`, ...) in a `@dict` header.
 * 3. **L3 -- Tokenizer-Aware** *(gated)*: Re-encodes delimiters to
 *    minimize token count for the target model's tokenizer.
 * 4. **L4 -- Semantic** *(opt-in)*: Lossy compression via
 *    summarization. Flags the output as non-reversible.
 *
 * @param input - The text to compress (JSON, YAML, CSV, Markdown, or plain text)
 * @param options - Compression options (layers, target model, etc.)
 * @returns Compression result with PAKT string and savings metadata.
 *   On error, returns the original input with 0% savings (graceful degradation).
 *
 * @example
 * ```ts
 * import { compress } from '@sriinnu/pakt';
 *
 * const json = '{"users": [{"name": "Alice", "role": "dev"}, {"name": "Bob", "role": "dev"}]}';
 * const result = compress(json);
 *
 * console.log(result.compressed);
 * // @from json
 * // @dict
 * //   $a: dev
 * // @end
 * // users [2]{name|role}:
 * //   Alice|$a
 * //   Bob|$a
 *
 * console.log(result.savings.totalPercent); // ~45
 * ```
 *
 * @example
 * ```ts
 * // With custom options
 * import { compress } from '@sriinnu/pakt';
 *
 * const csv = 'name,role\nAlice,dev\nBob,dev';
 * const result = compress(csv, {
 *   fromFormat: 'csv',
 *   layers: { structural: true, dictionary: true },
 *   dictMinSavings: 2,
 * });
 * ```
 */
export function compress(input: string, options?: Partial<PaktOptions>): PaktResult {
  const targetModel = options?.targetModel ?? DEFAULT_OPTIONS.targetModel;

  // 0. Early return for empty / whitespace-only input — no valid structure to compress
  if (!input || input.trim().length === 0) {
    return buildUnchangedResult(input ?? '', countTokens(input ?? '', targetModel), 'text');
  }

  // Graceful degradation: wrap the entire pipeline in try-catch so that
  // on ANY error we return the original input with 0% savings instead of crashing.
  try {
    return compressPipeline(input, options, targetModel);
  } catch {
    // Structural pipeline failed (e.g., misdetected format). Try text compression as fallback.
    const originalTokens = countTokens(input, targetModel);
    const textFallback = tryTextCompression(input, options?.fromFormat ?? 'text', originalTokens);
    if (textFallback) return textFallback;

    return buildUnchangedResult(input, originalTokens, options?.fromFormat ?? 'text');
  }
}

// ---------------------------------------------------------------------------
// Internal pipeline (wrapped by compress() for error handling)
// ---------------------------------------------------------------------------

/**
 * Core compression pipeline extracted for try-catch wrapping.
 * @param input - Raw input text
 * @param options - Compression options
 * @param targetModel - Target model for token counting
 * @returns Compression result
 */
/**
 * Try text-level dictionary compression as a fallback when structural
 * compression didn't save tokens. Works on any format.
 */
function tryTextCompression(
  input: string,
  detectedFormat: PaktResult['detectedFormat'],
  originalTokens: number,
): PaktResult | null {
  const fmt = detectedFormat === 'markdown' ? 'markdown' : 'text';
  const textResult = compressText(input, fmt);
  if (!textResult) return null;

  const savedTokens = textResult.originalTokens - textResult.compressedTokens;
  return {
    compressed: textResult.compressed,
    originalTokens: textResult.originalTokens,
    compressedTokens: textResult.compressedTokens,
    savings: {
      totalPercent: originalTokens > 0 ? Math.round((savedTokens / originalTokens) * 100) : 0,
      totalTokens: savedTokens,
      byLayer: { structural: 0, dictionary: savedTokens, tokenizer: 0, semantic: 0 },
    },
    reversible: true,
    detectedFormat,
    dictionary: [],
  };
}

function compressPipeline(
  input: string,
  options: Partial<PaktOptions> | undefined,
  targetModel: string,
): PaktResult {
  const setup = buildPipelineSetup(input, options, targetModel);
  if (!setup.layers.structural) {
    return buildUnchangedResult(input, setup.originalTokens, setup.detectedFormat);
  }

  const passthrough = tryCompressSpecialFormats(input, options, targetModel, setup.detectedFormat);
  if (passthrough) return passthrough;

  const data = parseInput(setup.bodyInput, setup.detectedFormat);
  let doc = compressL1(data, setup.detectedFormat);
  doc = injectEnvelopePreamble(doc, setup.envelopePreamble);
  /* Delta encoding post-pass: replace repeated adjacent tabular values with ~ */
  doc = applyDeltaEncoding(doc);

  const afterL1 = serialize(doc);
  const l1Tokens = countTokens(afterL1, targetModel);
  const dictionaryLayer = applyDictionaryLayer(
    doc,
    setup.layers.dictionary,
    setup.dictMinSavings,
    l1Tokens,
    targetModel,
  );
  const tokenizerLayer = applyTokenizerLayer(
    dictionaryLayer.doc,
    setup.layers.tokenizerAware,
    targetModel,
  );
  const semanticLayer = applySemanticLayer(
    tokenizerLayer.doc,
    tokenizerLayer.compressed,
    setup.layers.semantic,
    options?.semanticBudget ?? 0,
    targetModel,
  );

  const compressedTokens = countTokens(semanticLayer.compressed, targetModel);

  // If structural compression didn't help, try text compression as fallback
  if (compressedTokens >= setup.originalTokens) {
    const textFallback = tryTextCompression(input, setup.detectedFormat, setup.originalTokens);
    if (textFallback) return textFallback;
  }

  return buildCompressedResult(
    semanticLayer.doc,
    semanticLayer.compressed,
    setup.originalTokens,
    compressedTokens,
    setup.detectedFormat,
    {
      structural: setup.originalTokens - l1Tokens,
      dictionary: dictionaryLayer.saved,
      tokenizer: tokenizerLayer.saved,
      semantic: semanticLayer.saved,
    },
    semanticLayer.reversible,
  );
}

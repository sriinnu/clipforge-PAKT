/**
 * @module compress
 * PAKT compression pipeline entry point.
 *
 * This module exports the primary {@link compress} function that runs
 * input text through the PAKT compression pipeline:
 * L1 (structural) -> L2 (dictionary) -> L3 (tokenizer, optional) -> L4 (semantic, optional)
 */

import { detect } from './detect.js';
import { parseInput } from './format-parsers/index.js';
import {
  applyL3Transforms,
  applyL4Transforms,
  compressL1,
  compressL2,
  compressL3,
  compressL4,
  extractDictEntries,
  revertL3,
} from './layers/index.js';
import { compressMixed } from './mixed/index.js';
import type { CommentNode } from './parser/ast.js';
import { serialize } from './serializer/index.js';
import { countTokens } from './tokens/index.js';
import type { PaktFormat, PaktLayers, PaktOptions, PaktResult } from './types.js';
import { DEFAULT_LAYERS, DEFAULT_OPTIONS } from './constants.js';

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

/**
 * Merge user-supplied partial layers with defaults.
 * @param partial - User-supplied layer overrides
 * @returns Complete PaktLayers with defaults applied
 */
function mergeLayers(partial?: Partial<PaktLayers>): PaktLayers {
  if (!partial) return { ...DEFAULT_LAYERS };
  return {
    structural: partial.structural ?? DEFAULT_LAYERS.structural,
    dictionary: partial.dictionary ?? DEFAULT_LAYERS.dictionary,
    tokenizerAware: partial.tokenizerAware ?? DEFAULT_LAYERS.tokenizerAware,
    semantic: partial.semantic ?? DEFAULT_LAYERS.semantic,
  };
}

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
    const tokens = countTokens(input ?? '', targetModel);
    return {
      compressed: input ?? '',
      originalTokens: tokens,
      compressedTokens: tokens,
      savings: {
        totalPercent: 0,
        totalTokens: 0,
        byLayer: { structural: 0, dictionary: 0, tokenizer: 0, semantic: 0 },
      },
      reversible: true,
      detectedFormat: 'text',
      dictionary: [],
    };
  }

  // Graceful degradation: wrap the entire pipeline in try-catch so that
  // on ANY error we return the original input with 0% savings instead of crashing.
  try {
    return compressPipeline(input, options, targetModel);
  } catch {
    const tokens = countTokens(input, targetModel);
    return {
      compressed: input,
      originalTokens: tokens,
      compressedTokens: tokens,
      savings: {
        totalPercent: 0,
        totalTokens: 0,
        byLayer: { structural: 0, dictionary: 0, tokenizer: 0, semantic: 0 },
      },
      reversible: true,
      detectedFormat: options?.fromFormat ?? 'text',
      dictionary: [],
    };
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
function compressPipeline(
  input: string,
  options: Partial<PaktOptions> | undefined,
  targetModel: string,
): PaktResult {
  // 1. Merge options with defaults
  const layers = mergeLayers(options?.layers);
  const fromFormat = options?.fromFormat;
  const dictMinSavings = options?.dictMinSavings ?? DEFAULT_OPTIONS.dictMinSavings;

  // 2. Detect format (use user-specified if provided, else auto-detect)
  const detection = detect(input);
  const detectedFormat: PaktFormat = fromFormat ?? detection.format;

  // 2b. Handle envelope (e.g. HTTP headers wrapping a JSON body)
  //     Strip the preamble so we only compress the body.
  let bodyInput = input;
  const envelopePreamble = detection.envelope?.preamble;
  if (detection.envelope) {
    bodyInput = input.slice(detection.envelope.bodyOffset).trim();
  }

  // 3. Handle formats with no structural compression benefit
  //    PAKT: already compressed. Text/Markdown: try mixed-content compression.
  if (detectedFormat === 'text' || detectedFormat === 'markdown' || detectedFormat === 'pakt') {
    // For text/markdown, try mixed-content compression to find embedded blocks
    if (detectedFormat !== 'pakt') {
      const mixedResult = compressMixed(input, options);
      if (mixedResult.blocks.length > 0 && mixedResult.savings.totalPercent > 0) {
        return {
          compressed: mixedResult.compressed,
          originalTokens: mixedResult.originalTokens,
          compressedTokens: mixedResult.compressedTokens,
          savings: mixedResult.savings,
          reversible: mixedResult.reversible,
          detectedFormat,
          dictionary: [],
        };
      }
    }

    // No mixed blocks found or no savings — return as-is
    const tokens = countTokens(input, targetModel);
    return {
      compressed: input,
      originalTokens: tokens,
      compressedTokens: tokens,
      savings: {
        totalPercent: 0,
        totalTokens: 0,
        byLayer: { structural: 0, dictionary: 0, tokenizer: 0, semantic: 0 },
      },
      reversible: true,
      detectedFormat,
      dictionary: [],
    };
  }

  // 4. Parse the raw input into a JS value (body only, envelope stripped)
  const data = parseInput(bodyInput, detectedFormat);

  // 5. Count original tokens
  const originalTokens = countTokens(input, targetModel);

  // 6. Run L1 structural compression
  let doc = compressL1(data, detectedFormat);

  // 6b. Inject envelope preamble as comment nodes (preserves HTTP headers etc.)
  if (envelopePreamble && envelopePreamble.length > 0) {
    const pos = { line: 0, column: 0, offset: 0 };
    const envelopeComments: CommentNode[] = [
      { type: 'comment', text: '@envelope http', inline: false, position: pos },
      ...envelopePreamble.map((line) => ({
        type: 'comment' as const,
        text: line,
        inline: false,
        position: pos,
      })),
    ];
    doc = { ...doc, body: [...envelopeComments, ...doc.body] };
  }

  // Measure tokens after L1 to track per-layer savings
  const afterL1 = serialize(doc);
  const l1Tokens = countTokens(afterL1, targetModel);
  const structuralSaved = originalTokens - l1Tokens;

  // 7. Run L2 dictionary deduplication (if enabled)
  //    L2 uses heuristic token estimates during candidate selection, which
  //    may overestimate savings. We verify with actual token counts and
  //    revert if L2 made the output worse (e.g., dict overhead > savings).
  let dictionarySaved = 0;
  if (layers.dictionary) {
    const l1Doc = doc;
    doc = compressL2(doc, dictMinSavings);
    const afterL2 = serialize(doc);
    const l2Tokens = countTokens(afterL2, targetModel);
    dictionarySaved = l1Tokens - l2Tokens;
    if (dictionarySaved <= 0) {
      doc = l1Doc;
      dictionarySaved = 0;
    }
  }

  // 8. Run L3 tokenizer optimization (if enabled)
  //    Adds @target header to AST, then applies text-level transforms
  //    (1-space indent, strip trailing zeros) after serialization.
  if (layers.tokenizerAware) {
    doc = compressL3(doc);
  }

  // 9. Serialize the final AST
  let compressed = serialize(doc);

  // 9b. Apply L3 text transforms and verify savings
  let tokenizerSaved = 0;
  if (layers.tokenizerAware) {
    const preL3Tokens = countTokens(compressed, targetModel);
    const l3Text = applyL3Transforms(compressed);
    const l3Tokens = countTokens(l3Text, targetModel);
    tokenizerSaved = preL3Tokens - l3Tokens;
    if (tokenizerSaved > 0) {
      compressed = l3Text;
    } else {
      // Safety revert: L3 made things worse, remove @target header
      doc = revertL3(doc);
      compressed = serialize(doc);
      tokenizerSaved = 0;
    }
  }

  // 10. L4 semantic compression (opt-in, lossy)
  //     Applies budget-aware AST transforms + text-level transforms.
  //     Sets reversible = false when L4 actually modifies the output.
  let semanticSaved = 0;
  let isReversible = true;
  if (layers.semantic && (options?.semanticBudget ?? 0) > 0) {
    const semanticBudget = options!.semanticBudget!;
    const preSemanticText = compressed;
    const preSemanticTokens = countTokens(preSemanticText, targetModel);

    // 10a. AST-level L4 compression
    doc = compressL4(doc, semanticBudget);
    compressed = serialize(doc);

    // 10b. Text-level L4 transforms
    compressed = applyL4Transforms(compressed, semanticBudget);

    const postSemanticTokens = countTokens(compressed, targetModel);
    semanticSaved = preSemanticTokens - postSemanticTokens;

    // Mark as non-reversible if L4 made any changes
    if (semanticSaved > 0) {
      isReversible = false;
    } else {
      semanticSaved = 0;
    }
  }

  // 11. Count final tokens
  const compressedTokens = countTokens(compressed, targetModel);

  // 12. Compute total savings
  const totalTokens = originalTokens - compressedTokens;
  const totalPercent = originalTokens > 0 ? Math.round((totalTokens / originalTokens) * 100) : 0;

  // 13. Extract dictionary entries and return result
  const dictionary = extractDictEntries(doc);

  return {
    compressed,
    originalTokens,
    compressedTokens,
    savings: {
      totalPercent,
      totalTokens,
      byLayer: {
        structural: Math.max(0, structuralSaved),
        dictionary: Math.max(0, dictionarySaved),
        tokenizer: Math.max(0, tokenizerSaved),
        semantic: Math.max(0, semanticSaved),
      },
    },
    reversible: isReversible,
    detectedFormat,
    dictionary,
  };
}

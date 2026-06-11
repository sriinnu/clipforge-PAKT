import { DEFAULT_LAYERS, DEFAULT_OPTIONS } from './constants.js';
import { detect } from './detect.js';
import { compressText } from './layers/compress-text.js';
import {
  applyL3Transforms,
  applyL4Transforms,
  applyL5Transforms,
  applyPIILayer,
  compressL2,
  compressL3,
  compressL4,
  extractDictEntries,
  markL5,
  revertL3,
} from './layers/index.js';
import { applyMetatokenCompression } from './layers/L3-5-metatoken.js';
import { compressMixed } from './mixed/index.js';
import type { CommentNode } from './parser/ast.js';
import { serialize } from './serializer/index.js';
import { countTokens } from './tokens/index.js';
import type { PIIKind, PaktFormat, PaktLayers, PaktOptions, PaktResult } from './types.js';

type PaktDocument = Parameters<typeof extractDictEntries>[0];

interface PipelineSetup {
  bodyInput: string;
  detectedFormat: PaktFormat;
  dictMinSavings: number;
  envelopePreamble?: string[];
  layers: PaktLayers;
  originalTokens: number;
}

interface LayerApplication {
  compressed: string;
  doc: PaktDocument;
  saved: number;
}

interface SemanticApplication extends LayerApplication {
  reversible: boolean;
}

/**
 * Merge a partial {@link PaktLayers} bag with the library defaults.
 *
 * Each missing key falls back to {@link DEFAULT_LAYERS} so callers can
 * pass `{ semantic: true }` and still get the L1–L3 defaults filled in.
 *
 * @param partial - User-supplied layer toggles (any subset)
 * @returns Fully-populated {@link PaktLayers} record
 */
export function mergeLayers(partial?: Partial<PaktLayers>): PaktLayers {
  if (!partial) return { ...DEFAULT_LAYERS };
  return {
    structural: partial.structural ?? DEFAULT_LAYERS.structural,
    dictionary: partial.dictionary ?? DEFAULT_LAYERS.dictionary,
    tokenizerAware: partial.tokenizerAware ?? DEFAULT_LAYERS.tokenizerAware,
    semantic: partial.semantic ?? DEFAULT_LAYERS.semantic,
    contentAware: partial.contentAware ?? DEFAULT_LAYERS.contentAware,
    metatoken: partial.metatoken ?? DEFAULT_LAYERS.metatoken,
  };
}

/**
 * Resolve everything the {@link compress} pipeline needs before it
 * starts touching the AST: which body to feed in (after stripping any
 * envelope preamble), the detected format, the merged layer toggles,
 * the dictionary minimum-savings threshold, and the original token
 * count for downstream savings math.
 *
 * @param input       - Raw user input
 * @param options     - Caller-supplied {@link PaktOptions} subset
 * @param targetModel - Tokenizer-family hint for `originalTokens`
 * @returns Pipeline setup descriptor
 */
export function buildPipelineSetup(
  input: string,
  options: Partial<PaktOptions> | undefined,
  targetModel: string,
): PipelineSetup {
  const detection = detect(input);
  return {
    bodyInput: detection.envelope ? input.slice(detection.envelope.bodyOffset).trim() : input,
    detectedFormat: options?.fromFormat ?? detection.format,
    dictMinSavings: options?.dictMinSavings ?? DEFAULT_OPTIONS.dictMinSavings,
    envelopePreamble: detection.envelope?.preamble,
    layers: mergeLayers(options?.layers),
    originalTokens: countTokens(input, targetModel),
  };
}

/**
 * Fast path for inputs the structural compressor can’t profitably
 * touch. Handles three cases:
 *   - already-compressed PAKT (returned as-is),
 *   - text/markdown with embedded structured blocks (compressed via
 *     {@link compressMixed}),
 *   - text/markdown that benefits from L2 phrase aliasing only.
 *
 * Returns `null` when the format is something the main pipeline
 * (JSON / YAML / CSV) should handle.
 *
 * @param input          - Raw user input
 * @param options        - Caller options (forwarded to mixed compressor)
 * @param targetModel    - Tokenizer-family hint
 * @param detectedFormat - Pre-resolved format from `buildPipelineSetup`
 * @returns A {@link PaktResult} for special formats, or `null`
 */
export function tryCompressSpecialFormats(
  input: string,
  options: Partial<PaktOptions> | undefined,
  targetModel: string,
  detectedFormat: PaktFormat,
): PaktResult | null {
  if (detectedFormat === 'pakt') {
    return buildUnchangedResult(input, countTokens(input, targetModel), detectedFormat);
  }

  if (detectedFormat !== 'text' && detectedFormat !== 'markdown') {
    return null;
  }

  // First try: compress embedded structured blocks (JSON/CSV/YAML within text)
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

  // Second try: dictionary compression on the text itself (repeated phrases → aliases)
  const fmt = detectedFormat === 'markdown' ? 'markdown' : 'text';
  const textResult = compressText(input, fmt);
  if (textResult) {
    const savedTokens = textResult.originalTokens - textResult.compressedTokens;
    const savingsPercent =
      textResult.originalTokens > 0
        ? Math.round((savedTokens / textResult.originalTokens) * 100)
        : 0;
    return {
      compressed: textResult.compressed,
      originalTokens: textResult.originalTokens,
      compressedTokens: textResult.compressedTokens,
      savings: {
        totalPercent: savingsPercent,
        totalTokens: savedTokens,
        byLayer: {
          structural: 0,
          dictionary: savedTokens,
          tokenizer: 0,
          semantic: 0,
          content: 0,
        },
      },
      reversible: true,
      detectedFormat,
      dictionary: [],
    };
  }

  return buildUnchangedResult(input, countTokens(input, targetModel), detectedFormat);
}

/**
 * Re-attach the original envelope preamble (e.g. HTTP request line
 * + headers) at the top of the document as comment nodes so the
 * decompressor can faithfully reconstruct the wrapper.
 *
 * No-op when the input had no envelope.
 *
 * @param doc              - Compressed PAKT document
 * @param envelopePreamble - Lines captured by `detect()` before the body
 * @returns A new document with envelope comments prepended
 */
export function injectEnvelopePreamble(
  doc: PaktDocument,
  envelopePreamble: string[] | undefined,
): PaktDocument {
  if (!envelopePreamble || envelopePreamble.length === 0) {
    return doc;
  }

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
  return { ...doc, body: [...envelopeComments, ...doc.body] };
}

/**
 * Apply the L2 dictionary layer if it is enabled and pays off.
 *
 * Falls back to the original document (zero savings) when the
 * dictionary either makes the output longer or does not clear the
 * `dictMinSavings` token threshold.
 *
 * @param doc            - L1 document
 * @param enabled        - Whether the dictionary layer is on
 * @param dictMinSavings - Minimum tokens saved to keep the dictionary
 * @param l1Tokens       - Token count after L1 (for delta math)
 * @param targetModel    - Tokenizer-family hint
 * @returns Layer application with possibly-mutated doc + saved tokens
 */
export function applyDictionaryLayer(
  doc: PaktDocument,
  enabled: boolean,
  dictMinSavings: number,
  l1Tokens: number,
  targetModel: string,
  seedAliases?: Set<string>,
): LayerApplication {
  if (!enabled) {
    return { compressed: serialize(doc), doc, saved: 0 };
  }

  const l2Doc = compressL2(doc, dictMinSavings, seedAliases);
  const afterL2 = serialize(l2Doc);
  const saved = l1Tokens - countTokens(afterL2, targetModel);
  if (saved <= 0) {
    return { compressed: serialize(doc), doc, saved: 0 };
  }

  return { compressed: afterL2, doc: l2Doc, saved };
}

/**
 * Apply the L3 tokenizer-aware layer if it is enabled and pays off.
 *
 * Reverts to the input doc when the L3 transforms increase token
 * count under the active tokenizer family.
 *
 * @param doc         - Document after L2 (or L1 if L2 was off)
 * @param enabled     - Whether the tokenizer layer is on
 * @param targetModel - Tokenizer-family hint
 * @returns Layer application with possibly-mutated doc + saved tokens
 */
export function applyTokenizerLayer(
  doc: PaktDocument,
  enabled: boolean,
  targetModel: string,
): LayerApplication {
  if (!enabled) {
    return { compressed: serialize(doc), doc, saved: 0 };
  }

  const l3Doc = compressL3(doc);
  const serialized = serialize(l3Doc);
  const transformed = applyL3Transforms(serialized);
  const saved = countTokens(serialized, targetModel) - countTokens(transformed, targetModel);

  if (saved <= 0) {
    const revertedDoc = revertL3(l3Doc);
    return { compressed: serialize(revertedDoc), doc: revertedDoc, saved: 0 };
  }

  return { compressed: transformed, doc: l3Doc, saved };
}

/**
 * Apply the L3.5 meta-token layer (opt-in, off by default).
 *
 * Operates on the serialized PAKT string after L2/L3. Finds recurring
 * BPE token n-grams that cross word boundaries, appends aliases to the
 * existing @dict block (append-only for cache stability), and rewrites
 * occurrences in the body with `${letter}` inline aliases the existing
 * decompressor handles. Requires L2 dictionary to be active (needs a
 * @dict block in the output). Lossless and reversible.
 *
 * @param compressed - Serialized PAKT after L2/L3
 * @param enabled - Whether the metatoken layer is on
 * @param targetModel - Tokenizer-family hint for real token counting
 * @returns Layer application — doc reference is unchanged (text-level op),
 *   saved contains real token delta
 */
export function applyMetatokenLayer(
  doc: PaktDocument,
  compressed: string,
  enabled: boolean,
  targetModel: string,
): LayerApplication {
  if (!enabled) {
    return { compressed, doc, saved: 0 };
  }

  const result = applyMetatokenCompression(compressed, targetModel);
  if (result.savedTokens <= 0) {
    return { compressed, doc, saved: 0 };
  }

  // L3.5 is a string-level transform: the doc reference stays the same
  // (the @dict block in the serialized string is updated, but we don't
  // need to re-parse the doc for decompression — aliases live in the text).
  return { compressed: result.pakt, doc, saved: result.savedTokens };
}

/**
 * Apply the lossy L4 semantic layer if it is enabled and there is a
 * positive token budget.
 *
 * Sets `reversible = false` only when the layer actually mutates
 * output — a no-op call leaves the result reversible.
 *
 * @param doc            - Document after L3
 * @param compressed     - Serialized output after L3
 * @param enabled        - Whether the semantic layer is on
 * @param semanticBudget - Token budget for L4 (must be > 0 to apply)
 * @param targetModel    - Tokenizer-family hint
 * @returns Semantic application carrying a `reversible` flag
 */
export function applySemanticLayer(
  doc: PaktDocument,
  compressed: string,
  enabled: boolean,
  semanticBudget: number,
  targetModel: string,
): SemanticApplication {
  if (!enabled || semanticBudget <= 0) {
    return { compressed, doc, reversible: true, saved: 0 };
  }

  const l4Doc = compressL4(doc, semanticBudget);
  const serialized = serialize(l4Doc);
  const transformed = applyL4Transforms(serialized, semanticBudget);
  const saved = countTokens(compressed, targetModel) - countTokens(transformed, targetModel);

  if (saved <= 0) {
    return { compressed, doc, reversible: true, saved: 0 };
  }

  return { compressed: transformed, doc: l4Doc, reversible: false, saved };
}

/**
 * Describes the outcome of the L4-PII post-pass so the caller can
 * splice PII metadata (counts, mapping) into the final {@link PaktResult}
 * without the pipeline having to track it itself.
 */
export interface PIIPostPassResult {
  /** Possibly annotated / redacted PAKT string. */
  compressed: string;
  /** Whether any PII was found and the string was mutated (headers / redactions). */
  applied: boolean;
  /** True only when redact mode actually substituted values. */
  lossy: boolean;
  /** Per-kind counts; empty when nothing was detected. */
  counts: Partial<Record<PIIKind, number>>;
  /** Placeholder → original map (redact + reversible mode only). */
  mapping?: Record<string, string>;
}

/**
 * Run the L4-PII scan / redact post-pass on a fully-compressed PAKT
 * string. This is a string-only pass that lives after structural /
 * dictionary / tokenizer / semantic layers — it operates on the final
 * output so it can catch PII embedded anywhere in the document,
 * including inside dictionary expansions.
 *
 * @param compressed - Serialized PAKT after all earlier layers
 * @param options    - PAKT options bag ({@link PaktOptions})
 * @returns PII post-pass result including possibly annotated text
 */
export function applyPIIPostPass(
  compressed: string,
  options: Partial<PaktOptions> | undefined,
): PIIPostPassResult {
  const mode = options?.piiMode ?? 'off';
  if (mode === 'off') {
    return { compressed, applied: false, lossy: false, counts: {} };
  }
  const layerResult = applyPIILayer(compressed, {
    mode,
    kinds: options?.piiKinds,
    reversible: options?.piiReversible === true,
  });
  const result: PIIPostPassResult = {
    compressed: layerResult.text,
    applied: layerResult.applied,
    lossy: layerResult.lossy,
    counts: layerResult.counts,
  };
  if (layerResult.mapping) result.mapping = layerResult.mapping;
  return result;
}

/**
 * Apply the L5 content-aware layer if enabled and it pays off.
 * Operates on the serialized PAKT text and rewrites content-level
 * patterns (abbreviations, common-token substitutions) under a
 * `@compress content` header so the decompressor can reverse them.
 */
export function applyContentLayer(
  doc: PaktDocument,
  compressed: string,
  enabled: boolean,
  targetModel: string,
): SemanticApplication {
  if (!enabled) {
    return { compressed, doc, reversible: true, saved: 0 };
  }

  const l5Doc = markL5(doc);
  const transformed = applyL5Transforms(compressed);
  const withHeader = injectCompressContentHeader(transformed);
  const saved = countTokens(compressed, targetModel) - countTokens(withHeader, targetModel);

  if (saved <= 0) {
    return { compressed, doc, reversible: true, saved: 0 };
  }

  return { compressed: withHeader, doc: l5Doc, reversible: false, saved };
}

/**
 * Inject `@compress content` header into serialized PAKT text after
 * the last existing `@` header line so it appears in the header block,
 * not in the body.
 */
export function injectCompressContentHeader(text: string): string {
  const HEADER = '@compress content';
  if (/^@compress\s+content\s*$/m.test(text)) return text;

  const lines = text.split('\n');
  let lastHeaderIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith('@')) {
      lastHeaderIdx = i;
    } else if (lines[i]!.trim() !== '') {
      break;
    }
  }
  const insertIdx = lastHeaderIdx >= 0 ? lastHeaderIdx + 1 : 0;
  lines.splice(insertIdx, 0, HEADER);
  return lines.join('\n');
}

/**
 * Assemble the final {@link PaktResult} from the pipeline's outputs.
 *
 * Computes the headline savings percent, normalises the per-layer
 * savings to non-negative integers, and pulls the dictionary entries
 * off the final document so consumers can inspect them.
 */
export function buildCompressedResult(
  doc: PaktDocument,
  compressed: string,
  originalTokens: number,
  compressedTokens: number,
  detectedFormat: PaktFormat,
  layerSavings: PaktResult['savings']['byLayer'],
  reversible: boolean,
): PaktResult {
  const totalTokens = originalTokens - compressedTokens;
  const totalPercent = originalTokens > 0 ? Math.round((totalTokens / originalTokens) * 100) : 0;

  return {
    compressed,
    originalTokens,
    compressedTokens,
    savings: {
      totalPercent,
      totalTokens,
      byLayer: normalizeLayerSavings(layerSavings),
    },
    reversible,
    detectedFormat,
    dictionary: extractDictEntries(doc),
  };
}

/**
 * Build the no-op {@link PaktResult} returned when the pipeline
 * decides not to touch the input (already-compressed PAKT, opted-out
 * formats, or zero-savings outcomes).
 *
 * @param input          - The original input to echo back
 * @param tokens         - Token count of the input
 * @param detectedFormat - Detected format for the result
 * @returns A {@link PaktResult} with `savings = 0` and `reversible = true`
 */
export function buildUnchangedResult(
  input: string,
  tokens: number,
  detectedFormat: PaktFormat,
): PaktResult {
  return {
    compressed: input,
    originalTokens: tokens,
    compressedTokens: tokens,
    savings: {
      totalPercent: 0,
      totalTokens: 0,
      byLayer: { structural: 0, dictionary: 0, tokenizer: 0, semantic: 0, content: 0 },
    },
    reversible: true,
    detectedFormat,
    dictionary: [],
  };
}

function normalizeLayerSavings(
  layerSavings: PaktResult['savings']['byLayer'],
): PaktResult['savings']['byLayer'] {
  return {
    structural: Math.max(0, layerSavings.structural),
    dictionary: Math.max(0, layerSavings.dictionary),
    tokenizer: Math.max(0, layerSavings.tokenizer),
    semantic: Math.max(0, layerSavings.semantic),
    content: Math.max(0, layerSavings.content),
  };
}

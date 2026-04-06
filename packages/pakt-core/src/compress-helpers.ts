import { DEFAULT_LAYERS, DEFAULT_OPTIONS } from './constants.js';
import { detect } from './detect.js';
import { compressText } from './layers/compress-text.js';
import {
  applyL3Transforms,
  applyL4Transforms,
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

export function mergeLayers(partial?: Partial<PaktLayers>): PaktLayers {
  if (!partial) return { ...DEFAULT_LAYERS };
  return {
    structural: partial.structural ?? DEFAULT_LAYERS.structural,
    dictionary: partial.dictionary ?? DEFAULT_LAYERS.dictionary,
    tokenizerAware: partial.tokenizerAware ?? DEFAULT_LAYERS.tokenizerAware,
    semantic: partial.semantic ?? DEFAULT_LAYERS.semantic,
  };
}

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
        },
      },
      reversible: true,
      detectedFormat,
      dictionary: [],
    };
  }

  return buildUnchangedResult(input, countTokens(input, targetModel), detectedFormat);
}

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

export function applyDictionaryLayer(
  doc: PaktDocument,
  enabled: boolean,
  dictMinSavings: number,
  l1Tokens: number,
  targetModel: string,
): LayerApplication {
  if (!enabled) {
    return { compressed: serialize(doc), doc, saved: 0 };
  }

  const l2Doc = compressL2(doc, dictMinSavings);
  const afterL2 = serialize(l2Doc);
  const saved = l1Tokens - countTokens(afterL2, targetModel);
  if (saved <= 0) {
    return { compressed: serialize(doc), doc, saved: 0 };
  }

  return { compressed: afterL2, doc: l2Doc, saved };
}

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
      byLayer: { structural: 0, dictionary: 0, tokenizer: 0, semantic: 0 },
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
  };
}

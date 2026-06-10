/**
 * @module mcp/contract-insight
 * Contract definitions for the inspection-oriented PAKT MCP tools
 * (`pakt_inspect`, `pakt_explain`). Split out of `contract.ts` to keep
 * every contract module under the per-file line cap; `contract.ts`
 * re-exports these so existing imports keep working.
 */

import type * as z from 'zod/v4';
import { PAKT_FORMAT_VALUES } from '../formats.js';
import { RECOMMENDED_ACTION_VALUES, defineToolContract } from './contract-builder.js';

export const PAKT_INSPECT_CONTRACT = defineToolContract({
  name: 'pakt_inspect',
  description: [
    'Inspect text before using PAKT.',
    'Detects the format, counts tokens, estimates compression savings,',
    'and recommends whether to compress, decompress, or leave the content as-is.',
  ].join(' '),
  inputFields: {
    text: {
      type: 'string',
      description: 'The text to inspect.',
      minLength: 1,
      minLengthMessage: 'text must be a non-empty string',
    },
    model: {
      type: 'string',
      description: 'Optional model identifier used for token counting.',
      minLength: 1,
      required: false,
    },
    semanticBudget: {
      type: 'number',
      description: 'Optional positive token budget to estimate lossy L4 compression.',
      integer: true,
      positive: true,
      positiveMessage: 'semanticBudget must be a positive integer',
      required: false,
    },
  },
  outputFields: {
    detectedFormat: {
      type: 'string',
      description: 'Detected format for the inspected input.',
      enum: PAKT_FORMAT_VALUES,
    },
    confidence: {
      type: 'number',
      description: 'Confidence from the format detector.',
    },
    reason: {
      type: 'string',
      description: 'Human-readable detection reason.',
    },
    inputTokens: {
      type: 'number',
      description: 'Token count for the current input.',
    },
    recommendedAction: {
      type: 'string',
      description: 'Suggested next action for an MCP client.',
      enum: RECOMMENDED_ACTION_VALUES,
    },
    estimatedOutputTokens: {
      type: 'number',
      description: 'Token count after estimated compression, when relevant.',
      required: false,
    },
    estimatedSavings: {
      type: 'number',
      description: 'Estimated savings percentage after compression, when relevant.',
      required: false,
    },
    estimatedSavedTokens: {
      type: 'number',
      description: 'Estimated absolute tokens saved, when relevant.',
      required: false,
    },
    reversible: {
      type: 'boolean',
      description: 'Reversibility of the current or estimated representation.',
      required: false,
    },
    originalFormat: {
      type: 'string',
      description: 'Original structured format declared by PAKT, when inspecting PAKT input.',
      enum: PAKT_FORMAT_VALUES,
      required: false,
    },
    wasLossy: {
      type: 'boolean',
      description: 'Whether the inspected PAKT payload is lossy, when known.',
      required: false,
    },
  },
});

export const PAKT_EXPLAIN_CONTRACT = defineToolContract({
  name: 'pakt_explain',
  description: [
    'Compress text and return a detailed educational explanation of WHY it compressed the way it did.',
    'Shows per-layer savings breakdown, structural analysis, dictionary analysis,',
    'and human-readable recommendations. Useful for understanding and trusting PAKT output.',
  ].join(' '),
  inputFields: {
    text: {
      type: 'string',
      description:
        'The text content to compress and explain (JSON, YAML, CSV, Markdown, or mixed).',
      minLength: 1,
      minLengthMessage: 'text must be a non-empty string',
    },
    model: {
      type: 'string',
      description: 'Optional model identifier used for token counting.',
      minLength: 1,
      required: false,
    },
  },
  outputFields: {
    detectedFormat: {
      type: 'string',
      description: 'The detected input format.',
      enum: PAKT_FORMAT_VALUES,
    },
    savings: {
      type: 'number',
      description: 'Overall savings percentage (0-100).',
    },
    savedTokens: {
      type: 'number',
      description: 'Absolute tokens saved by compression.',
    },
    layerBreakdown: {
      type: 'string',
      description:
        'JSON array of per-layer breakdown objects with layer name, tokens saved, and human-readable explanation.',
    },
    structuralAnalysis: {
      type: 'string',
      description:
        'JSON object with structural analysis: totalKeys, uniqueKeys, keyRepetitionRatio, arrayCount, tabularArrays, nestingDepth, structuralOverhead.',
    },
    dictionaryAnalysis: {
      type: 'string',
      description:
        'JSON object with dictionary analysis: candidatesFound, aliasesCreated, topPatterns with value, occurrences, tokensSaved, and type.',
    },
    recommendation: {
      type: 'string',
      description:
        'Human-readable recommendation about the compression results and potential improvements.',
    },
  },
});

export type PaktInspectArgsFromContract = z.infer<typeof PAKT_INSPECT_CONTRACT.inputSchema>;
export type PaktInspectResultFromContract = z.infer<typeof PAKT_INSPECT_CONTRACT.outputSchema>;
export type PaktExplainArgsFromContract = z.infer<typeof PAKT_EXPLAIN_CONTRACT.inputSchema>;
export type PaktExplainResultFromContract = z.infer<typeof PAKT_EXPLAIN_CONTRACT.outputSchema>;

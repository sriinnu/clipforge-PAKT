/**
 * @module mcp/contract
 * Canonical MCP tool contract definitions for PAKT.
 *
 * This is the single source of truth for tool names, descriptions, field
 * metadata, and SDK validation schemas. Public JSON-style tool definitions,
 * TypeScript types, and SDK registration all derive from these contracts.
 *
 * The schema-construction primitives (FieldSpec, defineToolContract, etc.)
 * live in `contract-builder.ts`. This file only owns the four PAKT tool
 * definitions and the inferred type aliases.
 */

import type * as z from 'zod/v4';
import { PAKT_FORMAT_VALUES } from '../formats.js';
import {
  AUTO_ACTION_VALUES,
  PII_MODE_VALUES,
  RECOMMENDED_ACTION_VALUES,
  defineToolContract,
} from './contract-builder.js';

export type { PaktMcpContract } from './contract-builder.js';

export const PAKT_COMPRESS_CONTRACT = defineToolContract({
  name: 'pakt_compress',
  description: [
    'Compress text into PAKT format for LLM token optimization.',
    'Supports JSON, YAML, CSV, Markdown, and mixed content.',
    'Returns the compressed string and savings percentage.',
    'Use the optional `format` parameter to skip auto-detection.',
    'Use `semanticBudget` to opt into lossy L4 semantic compression.',
    'Use `piiMode` to flag or redact sensitive strings in the output.',
  ].join(' '),
  inputFields: {
    text: {
      type: 'string',
      description: 'The text content to compress (JSON, YAML, CSV, Markdown, or mixed).',
      minLength: 1,
      minLengthMessage: 'text must be a non-empty string',
    },
    format: {
      type: 'string',
      description: 'Optional format hint. Valid values: json, yaml, csv, markdown, text, pakt.',
      enum: PAKT_FORMAT_VALUES,
      required: false,
    },
    semanticBudget: {
      type: 'number',
      description: 'Optional positive token budget for opt-in lossy L4 semantic compression.',
      integer: true,
      positive: true,
      positiveMessage: 'semanticBudget must be a positive integer',
      required: false,
    },
    piiMode: {
      type: 'string',
      description:
        'PII strategy: off (default), flag (inject @warning pii header), or redact (replace values with placeholders; marks result non-reversible).',
      enum: PII_MODE_VALUES,
      required: false,
    },
    piiKinds: {
      type: 'string',
      description:
        'Optional comma-separated PII kinds to scan for. Valid: email,phone,ipv4,ipv6,jwt,aws-access-key,aws-secret-key,credit-card,ssn. Omit to scan all.',
      required: false,
    },
    piiReversible: {
      type: 'boolean',
      description:
        'When true and piiMode is redact, return a placeholder → original mapping in piiMapping.',
      required: false,
    },
  },
  outputFields: {
    compressed: {
      type: 'string',
      description: 'The compressed PAKT string.',
    },
    savings: {
      type: 'number',
      description: 'Savings percentage (0-100).',
    },
    format: {
      type: 'string',
      description: 'The detected or specified input format.',
      enum: PAKT_FORMAT_VALUES,
    },
    originalTokens: {
      type: 'number',
      description: 'Token count for the original input.',
    },
    compressedTokens: {
      type: 'number',
      description: 'Token count for the compressed output.',
    },
    savedTokens: {
      type: 'number',
      description: 'Absolute tokens saved.',
    },
    reversible: {
      type: 'boolean',
      description: 'Whether the compressed representation preserves all information.',
    },
    piiCounts: {
      type: 'string',
      description:
        'JSON object string: per-kind match counts when PII was detected; omitted otherwise.',
      required: false,
    },
    piiMapping: {
      type: 'string',
      description:
        'JSON object string: placeholder → original mapping for reversible redact mode; omitted otherwise.',
      required: false,
    },
  },
});

export const PAKT_AUTO_CONTRACT = defineToolContract({
  name: 'pakt_auto',
  description: [
    'Compress data to save tokens in conversation context. Use this tool for ANY structured data',
    '(JSON, YAML, CSV) or text blocks over 50 tokens before including them in responses.',
    'Each compression saves tokens on every subsequent turn because the compact form stays in context.',
    'If input is already PAKT-compressed, decompresses it. Inputs under 50 tokens are returned unchanged.',
    'Supports all formats: JSON, YAML, CSV, Markdown, logs, config files, API responses, plain text.',
  ].join(' '),
  inputFields: {
    text: {
      type: 'string',
      description: 'The text to process. PAKT input is decompressed; raw input is compressed.',
      minLength: 1,
      minLengthMessage: 'text must be a non-empty string',
    },
    semanticBudget: {
      type: 'number',
      description: 'Optional positive token budget for opt-in lossy L4 semantic compression.',
      integer: true,
      positive: true,
      positiveMessage: 'semanticBudget must be a positive integer',
      required: false,
    },
    piiMode: {
      type: 'string',
      description:
        'PII strategy applied to compressed output: off (default), flag, or redact. Ignored when decompressing.',
      enum: PII_MODE_VALUES,
      required: false,
    },
    piiKinds: {
      type: 'string',
      description:
        'Optional comma-separated PII kinds. Valid: email,phone,ipv4,ipv6,jwt,aws-access-key,aws-secret-key,credit-card,ssn.',
      required: false,
    },
    piiReversible: {
      type: 'boolean',
      description:
        'When true and piiMode is redact, return a placeholder → original mapping in piiMapping.',
      required: false,
    },
  },
  outputFields: {
    result: {
      type: 'string',
      description: 'The processed text (compressed PAKT or decompressed original).',
    },
    action: {
      type: 'string',
      description: 'Whether the input was compressed or decompressed.',
      enum: AUTO_ACTION_VALUES,
    },
    savings: {
      type: 'number',
      description: 'Savings percentage (only present when action is compressed).',
      required: false,
    },
    detectedFormat: {
      type: 'string',
      description: 'Detected format before the action was applied.',
      enum: PAKT_FORMAT_VALUES,
    },
    originalFormat: {
      type: 'string',
      description: 'Original structured format declared by PAKT, when decompressing.',
      enum: PAKT_FORMAT_VALUES,
      required: false,
    },
    inputTokens: {
      type: 'number',
      description: 'Token count of the input before processing.',
      required: false,
    },
    outputTokens: {
      type: 'number',
      description: 'Token count of the output after processing.',
      required: false,
    },
    savedTokens: {
      type: 'number',
      description: 'Absolute tokens saved.',
      required: false,
    },
    reversible: {
      type: 'boolean',
      description: 'Whether the resulting content is reversible without information loss.',
      required: false,
    },
    wasLossy: {
      type: 'boolean',
      description: 'Whether decompressed PAKT carried lossy L4 content.',
      required: false,
    },
    dedupHit: {
      type: 'boolean',
      description:
        'True when the result was served from the dedup cache (no re-compression needed).',
      required: false,
    },
    belowThreshold: {
      type: 'boolean',
      description:
        'True when the input was below the minimum token threshold and returned unchanged.',
      required: false,
    },
    piiCounts: {
      type: 'string',
      description:
        'JSON object string: per-kind match counts when PII was detected; omitted otherwise.',
      required: false,
    },
    piiMapping: {
      type: 'string',
      description:
        'JSON object string: placeholder → original mapping for reversible redact mode; omitted otherwise.',
      required: false,
    },
  },
});

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

export const PAKT_STATS_CONTRACT = defineToolContract({
  name: 'pakt_stats',
  description: [
    'Return session-level compression statistics including compounding context savings.',
    'Shows total calls, token savings, format breakdown, cost estimates,',
    'dedup cache efficiency, and cumulative tokens saved across conversation turns.',
  ].join(' '),
  inputFields: {
    model: {
      type: 'string',
      description: 'Optional model identifier for cost estimation (default: gpt-4o).',
      minLength: 1,
      required: false,
    },
    scope: {
      type: 'string',
      description:
        'Stats scope: "session" (current process, fast, default) or "all" (persistent stats across all agents, reads disk).',
      enum: ['session', 'all'] as const,
      required: false,
    },
  },
  outputFields: {
    sessionDuration: {
      type: 'string',
      description: 'Human-readable session duration (e.g., "14m 32s").',
    },
    totalCalls: {
      type: 'number',
      description: 'Total number of tool calls in this session.',
    },
    totalInputTokens: {
      type: 'number',
      description: 'Total input tokens processed across all calls.',
    },
    totalOutputTokens: {
      type: 'number',
      description: 'Total output tokens produced across all calls.',
    },
    totalSavedTokens: {
      type: 'number',
      description: 'Total tokens saved across all calls.',
    },
    overallSavingsPercent: {
      type: 'number',
      description: 'Weighted overall savings percentage (0-100).',
    },
    callsByAction: {
      type: 'string',
      description: 'JSON object: { compress, decompress, inspect } call counts.',
    },
    byFormat: {
      type: 'string',
      description: 'JSON object: per-format breakdown with calls, tokens, and savings.',
    },
    topFormat: {
      type: 'string',
      description:
        'JSON object string: format with most calls and its avg savings; omitted when unavailable.',
      required: false,
    },
    estimatedCostSaved: {
      type: 'string',
      description:
        'JSON object string: { input, output, currency } cost savings estimate; omitted when unavailable.',
      required: false,
    },
    lastCallAt: {
      type: 'string',
      description:
        'ISO 8601 timestamp string of the most recent tool call; omitted when unavailable.',
      required: false,
    },
    latencyMs: {
      type: 'string',
      description:
        'JSON object string: { p50, p95, p99, avg, samples } latency percentiles in ms; omitted when no calls carry timing.',
      required: false,
    },
    lossy: {
      type: 'string',
      description:
        'JSON object string: { count, inputTokens } accounting for non-reversible (L4 semantic / PII redact) calls.',
      required: false,
    },
    dedupHits: {
      type: 'number',
      description: 'Total dedup cache hits (compression pipeline runs avoided).',
      required: false,
    },
    dedupEntries: {
      type: 'number',
      description: 'Total entries in the dedup cache.',
      required: false,
    },
    totalCompoundingSavings: {
      type: 'number',
      description:
        'Estimated total tokens saved by serving cached results instead of recompressing.',
      required: false,
    },
    rollingDictSize: {
      type: 'number',
      description: 'Number of entries in the rolling dictionary (cross-turn alias reuse).',
      required: false,
    },
    rollingDictReuses: {
      type: 'number',
      description: 'Total times a seeded alias was reused across conversation turns.',
      required: false,
    },
    rollingDictSavings: {
      type: 'number',
      description: 'Estimated tokens saved by rolling dictionary seeding vs re-discovery.',
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

export const PAKT_SAVINGS_CONTRACT = defineToolContract({
  name: 'pakt_savings',
  description: [
    'Quick human-friendly savings summary with dollar amounts.',
    'Returns a concise report like "You\'ve saved 1.3M tokens ($19.50) across 47 sessions."',
    'Supports scope: "session" (current), "all" (all agents, all time).',
  ].join(' '),
  inputFields: {
    model: {
      type: 'string',
      description: 'Model identifier for cost estimation (default: gpt-4o).',
      minLength: 1,
      required: false,
    },
    scope: {
      type: 'string',
      description: 'Stats scope: "session" (current, default) or "all" (all agents, reads disk).',
      enum: ['session', 'all'] as const,
      required: false,
    },
  },
  outputFields: {
    summary: {
      type: 'string',
      description: 'Human-readable savings summary in one sentence.',
    },
    totalSavedTokens: {
      type: 'number',
      description: 'Total tokens saved.',
    },
    totalCalls: {
      type: 'number',
      description: 'Total compression calls.',
    },
    estimatedCostSaved: {
      type: 'string',
      description: 'Formatted dollar amount saved (e.g. "$3.90").',
    },
    avgSavingsPercent: {
      type: 'number',
      description: 'Average savings percentage across all calls.',
    },
    topFormat: {
      type: 'string',
      description: 'The format that saved the most tokens.',
      required: false,
    },
  },
});

export const PAKT_DASHBOARD_CONTRACT = defineToolContract({
  name: 'pakt_dashboard',
  description: [
    'Rich project-level compression dashboard with trends and per-format breakdown.',
    'Shows daily savings, format-level performance, best wins, rolling dictionary stats,',
    'and dedup cache efficiency. Use for understanding compression patterns over time.',
  ].join(' '),
  inputFields: {
    model: {
      type: 'string',
      description: 'Model identifier for cost estimation (default: gpt-4o).',
      minLength: 1,
      required: false,
    },
    scope: {
      type: 'string',
      description: 'Stats scope: "session" (current, default) or "all" (all agents, reads disk).',
      enum: ['session', 'all'] as const,
      required: false,
    },
  },
  outputFields: {
    summary: {
      type: 'string',
      description: 'One-line savings headline.',
    },
    totalSavedTokens: {
      type: 'number',
      description: 'Total tokens saved.',
    },
    totalCalls: {
      type: 'number',
      description: 'Total compression calls.',
    },
    avgSavingsPercent: {
      type: 'number',
      description: 'Weighted average savings percentage.',
    },
    estimatedCostSaved: {
      type: 'string',
      description: 'JSON object string with input/output cost breakdown.',
      required: false,
    },
    formatBreakdown: {
      type: 'string',
      description: 'JSON object string: per-format stats with calls, tokens saved, avg savings.',
    },
    topFormat: {
      type: 'string',
      description: 'JSON object string: best-performing format with stats.',
      required: false,
    },
    sessionDuration: {
      type: 'string',
      description: 'Human-readable session duration.',
    },
    dedupEfficiency: {
      type: 'string',
      description: 'JSON object string: cache hits, entries, hit rate, compounding savings.',
      required: false,
    },
    rollingDictStats: {
      type: 'string',
      description: 'JSON object string: rolling dictionary size, reuses, estimated savings.',
      required: false,
    },
    latencyMs: {
      type: 'string',
      description:
        'JSON object string: { p50, p95, p99, avg, samples } latency percentiles in ms; omitted when no calls carry timing.',
      required: false,
    },
    lossy: {
      type: 'string',
      description:
        'JSON object string: { count, inputTokens } accounting for non-reversible compression calls; omitted when zero.',
      required: false,
    },
  },
});

export const PAKT_MCP_CONTRACTS = [
  PAKT_COMPRESS_CONTRACT,
  PAKT_AUTO_CONTRACT,
  PAKT_INSPECT_CONTRACT,
  PAKT_STATS_CONTRACT,
  PAKT_EXPLAIN_CONTRACT,
  PAKT_SAVINGS_CONTRACT,
  PAKT_DASHBOARD_CONTRACT,
] as const;

export type PaktContractToolName = (typeof PAKT_MCP_CONTRACTS)[number]['name'];
export type PaktCompressArgsFromContract = z.infer<typeof PAKT_COMPRESS_CONTRACT.inputSchema>;
export type PaktCompressResultFromContract = z.infer<typeof PAKT_COMPRESS_CONTRACT.outputSchema>;
export type PaktAutoArgsFromContract = z.infer<typeof PAKT_AUTO_CONTRACT.inputSchema>;
export type PaktAutoResultFromContract = z.infer<typeof PAKT_AUTO_CONTRACT.outputSchema>;
export type PaktInspectArgsFromContract = z.infer<typeof PAKT_INSPECT_CONTRACT.inputSchema>;
export type PaktInspectResultFromContract = z.infer<typeof PAKT_INSPECT_CONTRACT.outputSchema>;
export type PaktStatsArgsFromContract = z.infer<typeof PAKT_STATS_CONTRACT.inputSchema>;
export type PaktStatsResultFromContract = z.infer<typeof PAKT_STATS_CONTRACT.outputSchema>;
export type PaktExplainArgsFromContract = z.infer<typeof PAKT_EXPLAIN_CONTRACT.inputSchema>;
export type PaktExplainResultFromContract = z.infer<typeof PAKT_EXPLAIN_CONTRACT.outputSchema>;
export type PaktSavingsArgsFromContract = z.infer<typeof PAKT_SAVINGS_CONTRACT.inputSchema>;
export type PaktSavingsResultFromContract = z.infer<typeof PAKT_SAVINGS_CONTRACT.outputSchema>;
export type PaktDashboardArgsFromContract = z.infer<typeof PAKT_DASHBOARD_CONTRACT.inputSchema>;
export type PaktDashboardResultFromContract = z.infer<typeof PAKT_DASHBOARD_CONTRACT.outputSchema>;

/**
 * @module mcp/contract
 * Canonical MCP tool contract definitions for PAKT.
 *
 * This is the single source of truth for tool names, descriptions, field
 * metadata, and SDK validation schemas. Public JSON-style tool definitions,
 * TypeScript types, and SDK registration all derive from these contracts.
 *
 * The schema-construction primitives (FieldSpec, defineToolContract, etc.)
 * live in `contract-builder.ts`. The inspect/explain contracts live in
 * `contract-insight.ts` and the stats/savings/dashboard contracts in
 * `contract-stats.ts`; all are re-exported here so this module stays the
 * single import surface for contracts.
 */

import type * as z from 'zod/v4';
import { PAKT_FORMAT_VALUES } from '../formats.js';
import {
  AUTO_ACTION_VALUES,
  CACHE_TARGET_VALUES,
  DICT_PLACEMENT_VALUES,
  PII_MODE_VALUES,
  defineToolContract,
} from './contract-builder.js';
import { PAKT_EXPLAIN_CONTRACT, PAKT_INSPECT_CONTRACT } from './contract-insight.js';
import {
  PAKT_DASHBOARD_CONTRACT,
  PAKT_SAVINGS_CONTRACT,
  PAKT_STATS_CONTRACT,
} from './contract-stats.js';

export type { PaktMcpContract } from './contract-builder.js';
export {
  PAKT_EXPLAIN_CONTRACT,
  PAKT_INSPECT_CONTRACT,
} from './contract-insight.js';
export type {
  PaktExplainArgsFromContract,
  PaktExplainResultFromContract,
  PaktInspectArgsFromContract,
  PaktInspectResultFromContract,
} from './contract-insight.js';
export {
  PAKT_DASHBOARD_CONTRACT,
  PAKT_SAVINGS_CONTRACT,
  PAKT_STATS_CONTRACT,
} from './contract-stats.js';
export type {
  PaktDashboardArgsFromContract,
  PaktDashboardResultFromContract,
  PaktSavingsArgsFromContract,
  PaktSavingsResultFromContract,
  PaktStatsArgsFromContract,
  PaktStatsResultFromContract,
} from './contract-stats.js';

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
    statelessDict: {
      type: 'boolean',
      description:
        'Opt out of the per-session rolling dictionary. By default (false), structured inputs (JSON/YAML/CSV) share one dictionary across all pakt_compress and pakt_auto calls in this server process: aliases discovered in earlier turns stay pinned to the same $a, $b, ... slots and the @dict block grows append-only, keeping the output prefix byte-stable so provider prompt caches (Anthropic cache_control, OpenAI prefix cache) hit across turns. Set true for fully stateless per-call compression (no cross-turn alias reuse). Ignored when piiMode is active (redacted values never seed the session dictionary).',
      required: false,
    },
    dictPlacement: {
      type: 'string',
      description:
        'Where the dictionary lives: inline (default — @dict block at the top of `compressed`) or system (the @dict block is removed from the body and returned separately in `dictBlock` so it can be pinned into a cached system prompt; decompress with the dict option). Applies to structured and plain-text inputs; mixed-content blocks keep inline dictionaries.',
      enum: DICT_PLACEMENT_VALUES,
      required: false,
    },
    cacheTarget: {
      type: 'string',
      description:
        'Target LLM provider for prompt-cache hints. When set, a `@cache prefix-end` directive is emitted after the @dict block (a no-op header stripped on decompression) and `cacheByteOffset` reports where to place the provider cache_control breakpoint. With dictPlacement system the directive moves into `dictBlock` and no offset is returned — cache the whole dict block instead.',
      enum: CACHE_TARGET_VALUES,
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
    dictBlock: {
      type: 'string',
      description:
        'Standalone @dict ... @end block (plus @cache directive when emitted), present only when dictPlacement is system and a dictionary was emitted. Pin it into the system prompt; pass it back via decompress dict option.',
      required: false,
    },
    cacheByteOffset: {
      type: 'number',
      description:
        'Byte offset in `compressed` where the cacheable prefix ends (right after the @cache prefix-end directive). Present only when cacheTarget is set and the directive was emitted inline.',
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

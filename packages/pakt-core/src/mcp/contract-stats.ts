/**
 * @module mcp/contract-stats
 * Contract definitions for the statistics-oriented PAKT MCP tools
 * (`pakt_stats`, `pakt_savings`, `pakt_dashboard`). Split out of
 * `contract.ts` to keep every contract module under the per-file line
 * cap; `contract.ts` re-exports these so existing imports keep working.
 */

import type * as z from 'zod/v4';
import { defineToolContract } from './contract-builder.js';

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

export type PaktStatsArgsFromContract = z.infer<typeof PAKT_STATS_CONTRACT.inputSchema>;
export type PaktStatsResultFromContract = z.infer<typeof PAKT_STATS_CONTRACT.outputSchema>;
export type PaktSavingsArgsFromContract = z.infer<typeof PAKT_SAVINGS_CONTRACT.inputSchema>;
export type PaktSavingsResultFromContract = z.infer<typeof PAKT_SAVINGS_CONTRACT.outputSchema>;
export type PaktDashboardArgsFromContract = z.infer<typeof PAKT_DASHBOARD_CONTRACT.inputSchema>;
export type PaktDashboardResultFromContract = z.infer<typeof PAKT_DASHBOARD_CONTRACT.outputSchema>;

/**
 * @module mcp/handler-inspect-stats
 * Implementations of the `pakt_inspect` and `pakt_stats` MCP tools.
 *
 * Split out of `handler.ts` to keep each module under the 400-line cap.
 * Both handlers are read-only / estimation-only and don't touch the
 * dedup metadata cache that the auto handler maintains.
 */

import { compress } from '../compress.js';
import { decompress } from '../decompress.js';
import { detect } from '../detect.js';
import { compressMixed } from '../mixed/index.js';
import { readAllRecords } from '../stats/persister.js';
import { countTokens } from '../tokens/index.js';
import { validate } from '../utils/validate.js';
import { dedupCache } from './dedup-cache.js';
import {
  assertNonEmptyString,
  buildCompressionOptions,
  summarizeValidationFailure,
  validateSemanticBudget,
} from './handler-validation.js';
import { SessionStats, type SessionStatsResult, getSessionStats } from './session-stats.js';
import type {
  PaktInspectArgs,
  PaktInspectResult,
  PaktStatsArgs,
  PaktStatsResult,
} from './types.js';

// ---------------------------------------------------------------------------
// pakt_inspect
// ---------------------------------------------------------------------------

/**
 * Handle a `pakt_inspect` tool call.
 *
 * For PAKT input: validates and reports reversibility / lossiness without
 * decompressing the payload (we still call `decompress` to learn lossiness
 * and original format — cheap relative to the inspect contract).
 *
 * For non-PAKT input: runs the appropriate compression pipeline as a dry
 * run to estimate token savings, returning the better of compress vs.
 * leave-as-is as the recommendation.
 */
export function handleInspect(args: PaktInspectArgs): PaktInspectResult {
  assertNonEmptyString(args.text, 'text');
  const semanticBudget = validateSemanticBudget(args.semanticBudget);
  const model = typeof args.model === 'string' && args.model.length > 0 ? args.model : 'gpt-4o';
  const detected = detect(args.text);
  const inputTokens = countTokens(args.text, model);

  if (detected.format === 'pakt') {
    const validation = validate(args.text);
    if (!validation.valid) {
      return {
        detectedFormat: 'pakt',
        confidence: detected.confidence,
        reason: `${detected.reason}; invalid PAKT: ${summarizeValidationFailure(validation)}`,
        inputTokens,
        recommendedAction: 'leave-as-is',
        reversible: false,
      };
    }

    const result = decompress(args.text);
    return {
      detectedFormat: 'pakt',
      confidence: detected.confidence,
      reason: detected.reason,
      inputTokens,
      recommendedAction: 'decompress',
      reversible: !result.wasLossy,
      originalFormat: result.originalFormat,
      wasLossy: result.wasLossy,
    };
  }

  const compressionOptions = buildCompressionOptions(undefined, semanticBudget);
  const estimate =
    detected.format === 'json' || detected.format === 'yaml' || detected.format === 'csv'
      ? compress(args.text, { ...compressionOptions, fromFormat: detected.format })
      : compressMixed(args.text, compressionOptions);

  const estimatedOutputTokens = countTokens(estimate.compressed, model);
  const estimatedSavedTokens = inputTokens - estimatedOutputTokens;
  const estimatedSavings =
    inputTokens > 0 ? Math.round((estimatedSavedTokens / inputTokens) * 100) : 0;

  return {
    detectedFormat: detected.format,
    confidence: detected.confidence,
    reason: detected.reason,
    inputTokens,
    recommendedAction: estimatedSavedTokens > 0 ? 'compress' : 'leave-as-is',
    estimatedOutputTokens,
    estimatedSavings,
    estimatedSavedTokens,
    reversible: estimate.reversible,
  };
}

// ---------------------------------------------------------------------------
// pakt_stats
// ---------------------------------------------------------------------------

/** Aggregate persisted records into a fresh {@link SessionStats} snapshot. */
function aggregatePersistedStats(model: string): SessionStatsResult {
  const records = readAllRecords();
  const tempStats = new SessionStats();
  for (const record of records) {
    tempStats.record(record);
  }
  return tempStats.getStats(model);
}

/**
 * Build the dedup cache fields appended to session-scoped stats responses.
 * Returns an empty object for `'all'` scope since disk reads have no cache data.
 */
function dedupFields(scope: 'session' | 'all'): {
  dedupHits?: number;
  dedupEntries?: number;
  totalCompoundingSavings?: number;
} {
  if (scope !== 'session') return {};
  const ds = dedupCache.getStats();
  return {
    dedupHits: ds.totalHits,
    dedupEntries: ds.size,
    totalCompoundingSavings: dedupCache.totalCompoundingSavings(),
  };
}

/**
 * Return session-level compression statistics.
 *
 * Nested objects (callsByAction, byFormat, topFormat, estimatedCostSaved)
 * are serialized as JSON strings to conform to the flat contract schema.
 *
 * When `scope` is `'all'`, reads persistent stats from disk (all agents).
 * Default scope is `'session'` (fast, in-memory only).
 */
export function handleStats(args: PaktStatsArgs): PaktStatsResult {
  const model = typeof args.model === 'string' && args.model.length > 0 ? args.model : 'gpt-4o';
  const scope: 'session' | 'all' = args.scope === 'all' ? 'all' : 'session';

  const raw: SessionStatsResult =
    scope === 'all' ? aggregatePersistedStats(model) : getSessionStats(model);

  return {
    sessionDuration: raw.sessionDuration,
    totalCalls: raw.totalCalls,
    totalInputTokens: raw.totalInputTokens,
    totalOutputTokens: raw.totalOutputTokens,
    totalSavedTokens: raw.totalSavedTokens,
    overallSavingsPercent: raw.overallSavingsPercent,
    callsByAction: JSON.stringify(raw.callsByAction),
    byFormat: JSON.stringify(raw.byFormat),
    topFormat: raw.topFormat ? JSON.stringify(raw.topFormat) : undefined,
    estimatedCostSaved: raw.estimatedCostSaved ? JSON.stringify(raw.estimatedCostSaved) : undefined,
    lastCallAt: raw.lastCallAt ?? undefined,
    ...dedupFields(scope),
  } as PaktStatsResult;
}

/**
 * @module mcp/handler-explain-savings-dashboard
 * Handlers for the explain / savings / dashboard MCP tools.
 *
 * Split out from `handler.ts` to keep each file under the 400-line cap.
 * The handlers operate on already-validated args; lower-level validation
 * helpers live in `handler-validation.ts`.
 */

import { compress } from '../compress.js';
import { estimateCompressibility } from '../compressibility.js';
import { detect } from '../detect.js';
import {
  analyzeDictionary,
  analyzeStructure,
  buildLayerBreakdown,
  generateRecommendation,
} from '../explain.js';
import { dedupCache } from './dedup-cache.js';
import { PaktToolInputError, assertNonEmptyString } from './handler-validation.js';
import { rollingDict } from './rolling-dict.js';
import {
  SessionStats,
  type SessionStatsResult,
  getSessionStats,
} from './session-stats.js';
import { readAllRecords } from '../stats/persister.js';
import type {
  PaktDashboardArgs,
  PaktDashboardResult,
  PaktExplainArgs,
  PaktExplainResult,
  PaktSavingsArgs,
  PaktSavingsResult,
} from './types.js';

const MAX_EXPLAIN_INPUT_SIZE = 1024 * 1024;

/**
 * Handle a `pakt_explain` tool call.
 *
 * Compresses the input once and feeds the result through the analysis
 * helpers in `explain.ts` to build a detailed educational breakdown of
 * the compression layers, dictionary, and a recommendation.
 */
export function handleExplain(args: PaktExplainArgs): PaktExplainResult {
  assertNonEmptyString(args.text, 'text');
  if (args.text.length > MAX_EXPLAIN_INPUT_SIZE) {
    throw new PaktToolInputError(
      `Input exceeds maximum size of ${MAX_EXPLAIN_INPUT_SIZE} bytes. Consider splitting large payloads.`,
    );
  }

  const detected = detect(args.text);
  const detectedFormat = detected.format;

  const options =
    detectedFormat !== 'pakt' && detectedFormat !== 'text' && detectedFormat !== 'markdown'
      ? { fromFormat: detectedFormat }
      : undefined;
  const compressResult = compress(args.text, options);

  const compressibility = estimateCompressibility(args.text);

  const structural = analyzeStructure(
    args.text,
    compressResult.detectedFormat,
    compressResult.originalTokens,
    compressResult.savings.byLayer.structural,
  );
  const dictionary = analyzeDictionary(compressResult.dictionary);
  const layerBreakdown = buildLayerBreakdown(compressResult, structural, dictionary);
  const recommendation = generateRecommendation(compressResult, compressibility);

  return {
    detectedFormat: compressResult.detectedFormat,
    savings: compressResult.savings.totalPercent,
    savedTokens: compressResult.savings.totalTokens,
    layerBreakdown: JSON.stringify(layerBreakdown),
    structuralAnalysis: JSON.stringify(structural),
    dictionaryAnalysis: JSON.stringify(dictionary),
    recommendation,
  };
}

/** Format a token count as a human-readable string (e.g. "1.3M", "42K", "500"). */
function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

function loadStats(model: string, scope: 'session' | 'all'): SessionStatsResult {
  if (scope === 'all') {
    const records = readAllRecords();
    const tempStats = new SessionStats();
    for (const record of records) {
      tempStats.record(record);
    }
    return tempStats.getStats(model);
  }
  return getSessionStats(model);
}

/**
 * Handle a `pakt_savings` tool call.
 *
 * Returns a concise, human-friendly savings summary with dollar amounts.
 */
export function handleSavings(args: PaktSavingsArgs): PaktSavingsResult {
  const model = typeof args.model === 'string' && args.model.length > 0 ? args.model : 'gpt-4o';
  const scope = args.scope === 'all' ? 'all' : 'session';
  const raw = loadStats(model, scope);

  const costStr = raw.estimatedCostSaved
    ? `$${(raw.estimatedCostSaved.input + raw.estimatedCostSaved.output).toFixed(2)}`
    : '$0.00';

  const summary =
    raw.totalCalls === 0
      ? 'No compression calls yet this session.'
      : `You've saved ${formatTokenCount(raw.totalSavedTokens)} tokens (${costStr}) across ${String(raw.totalCalls)} calls at ${String(raw.overallSavingsPercent)}% average savings.`;

  return {
    summary,
    totalSavedTokens: raw.totalSavedTokens,
    totalCalls: raw.totalCalls,
    estimatedCostSaved: costStr,
    avgSavingsPercent: raw.overallSavingsPercent,
    topFormat: raw.topFormat ? raw.topFormat.format : undefined,
  };
}

/**
 * Handle a `pakt_dashboard` tool call.
 *
 * Returns a rich view with per-format breakdown, dedup efficiency,
 * rolling dictionary stats, and trend data.
 */
export function handleDashboard(args: PaktDashboardArgs): PaktDashboardResult {
  const model = typeof args.model === 'string' && args.model.length > 0 ? args.model : 'gpt-4o';
  const scope = args.scope === 'all' ? 'all' : 'session';
  const raw = loadStats(model, scope);

  const costStr = raw.estimatedCostSaved
    ? `$${(raw.estimatedCostSaved.input + raw.estimatedCostSaved.output).toFixed(2)}`
    : '$0.00';

  const summary =
    raw.totalCalls === 0
      ? 'No compression calls yet.'
      : `${formatTokenCount(raw.totalSavedTokens)} tokens saved (${costStr}) | ${String(raw.totalCalls)} calls | ${String(raw.overallSavingsPercent)}% avg`;

  const result: PaktDashboardResult = {
    summary,
    totalSavedTokens: raw.totalSavedTokens,
    totalCalls: raw.totalCalls,
    avgSavingsPercent: raw.overallSavingsPercent,
    estimatedCostSaved: raw.estimatedCostSaved ? JSON.stringify(raw.estimatedCostSaved) : undefined,
    formatBreakdown: JSON.stringify(raw.byFormat),
    topFormat: raw.topFormat ? JSON.stringify(raw.topFormat) : undefined,
    sessionDuration: raw.sessionDuration,
    latencyMs: raw.latencyMs ? JSON.stringify(raw.latencyMs) : undefined,
    lossy: raw.lossy.count > 0 ? JSON.stringify(raw.lossy) : undefined,
  };

  if (scope === 'session') {
    const ds = dedupCache.getStats();
    result.dedupEfficiency = JSON.stringify({
      hits: ds.totalHits,
      entries: ds.size,
      hitRate: ds.hitRate,
      compoundingSavings: dedupCache.totalCompoundingSavings(),
    });

    const rd = rollingDict.getStats();
    result.rollingDictStats = JSON.stringify({
      size: rd.size,
      reuses: rd.totalReuses,
      estimatedSavings: rd.estimatedSeedSavings,
      currentTurn: rd.currentTurn,
    });
  }

  return result;
}

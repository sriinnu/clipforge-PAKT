/**
 * @module mcp/session-stats
 * In-memory session-level stats accumulator for PAKT MCP tool calls.
 *
 * Tracks compression operations, token savings, format breakdown,
 * and cost estimates across the lifetime of a single MCP server process.
 * The singleton {@link sessionStats} is shared by all tool handlers.
 */

import { MODEL_PRICING } from '../constants.js';
import { appendRecord } from '../stats/persister.js';
import type { PaktFormat } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single recorded tool call for stats tracking. */
export interface CallRecord {
  /** What the tool did. */
  action: 'compress' | 'decompress' | 'inspect';
  /** Detected or declared format of the input. */
  format: PaktFormat;
  /** Token count of the input. */
  inputTokens: number;
  /** Token count of the output (or estimated output for inspect). */
  outputTokens: number;
  /** Tokens saved (inputTokens - outputTokens). */
  savedTokens: number;
  /** Savings as a percentage (0-100). */
  savingsPercent: number;
  /** Whether the operation was lossless. */
  reversible: boolean;
  /** Unix timestamp (Date.now()). */
  timestamp: number;
}

/** Per-format breakdown entry in session stats. */
export interface FormatStats {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  savedTokens: number;
  avgSavingsPercent: number;
}

/** The full session stats result returned by pakt_stats. */
export interface SessionStatsResult {
  /** Human-readable session duration (e.g., "14m 32s"). */
  sessionDuration: string;
  /** Total number of recorded tool calls. */
  totalCalls: number;
  /** Breakdown by action type. */
  callsByAction: { compress: number; decompress: number; inspect: number };
  /** Sum of all input tokens processed. */
  totalInputTokens: number;
  /** Sum of all output tokens produced. */
  totalOutputTokens: number;
  /** Total tokens saved across all calls. */
  totalSavedTokens: number;
  /** Weighted overall savings percentage (0-100). */
  overallSavingsPercent: number;
  /** Per-format breakdown (only formats that were actually seen). */
  byFormat: Record<string, FormatStats>;
  /** The format with the most calls, or null if no calls. */
  topFormat: { format: string; calls: number; avgSavingsPercent: number } | null;
  /** Estimated cost saved based on model pricing, or null if model unknown. */
  estimatedCostSaved: { input: number; output: number; currency: string } | null;
  /** ISO timestamp of the most recent call, or null. */
  lastCallAt: string | null;
}

// ---------------------------------------------------------------------------
// Duration formatter
// ---------------------------------------------------------------------------

/** Formats a millisecond duration into a human-readable string. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${String(totalSeconds)}s`;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return seconds > 0
      ? `${String(hours)}h ${String(minutes)}m ${String(seconds)}s`
      : `${String(hours)}h ${String(minutes)}m`;
  }
  return seconds > 0 ? `${String(minutes)}m ${String(seconds)}s` : `${String(minutes)}m`;
}

// ---------------------------------------------------------------------------
// SessionStats class
// ---------------------------------------------------------------------------

/** In-memory accumulator for session-level PAKT stats. */
export class SessionStats {
  private records: CallRecord[] = [];
  private startedAt: number = Date.now();

  /** Append a call record. */
  record(entry: CallRecord): void {
    this.records.push(entry);
  }

  /** Compute aggregate stats for the session. */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: stats aggregation computes per-format and per-action breakdowns in a single pass
  getStats(model?: string): SessionStatsResult {
    const resolvedModel = model ?? 'gpt-4o';
    const now = Date.now();

    // Empty session fast path
    if (this.records.length === 0) {
      return {
        sessionDuration: formatDuration(now - this.startedAt),
        totalCalls: 0,
        callsByAction: { compress: 0, decompress: 0, inspect: 0 },
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalSavedTokens: 0,
        overallSavingsPercent: 0,
        byFormat: {},
        topFormat: null,
        estimatedCostSaved: null,
        lastCallAt: null,
      };
    }

    // Accumulate in a single pass
    const callsByAction = { compress: 0, decompress: 0, inspect: 0 };
    const formatAccum: Record<
      string,
      { calls: number; inputTokens: number; outputTokens: number; savedTokens: number }
    > = {};

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalSavedTokens = 0;

    for (const rec of this.records) {
      callsByAction[rec.action]++;
      totalInputTokens += rec.inputTokens;
      totalOutputTokens += rec.outputTokens;
      totalSavedTokens += rec.savedTokens;

      const fmt = formatAccum[rec.format];
      if (fmt) {
        fmt.calls++;
        fmt.inputTokens += rec.inputTokens;
        fmt.outputTokens += rec.outputTokens;
        fmt.savedTokens += rec.savedTokens;
      } else {
        formatAccum[rec.format] = {
          calls: 1,
          inputTokens: rec.inputTokens,
          outputTokens: rec.outputTokens,
          savedTokens: rec.savedTokens,
        };
      }
    }

    // Build byFormat with weighted avgSavingsPercent
    const byFormat: Record<string, FormatStats> = {};
    let topEntry: { format: string; calls: number; avgSavingsPercent: number } | null = null;

    for (const [format, acc] of Object.entries(formatAccum)) {
      const avgSavingsPercent =
        acc.inputTokens > 0 ? Math.round((acc.savedTokens / acc.inputTokens) * 100) : 0;

      byFormat[format] = {
        calls: acc.calls,
        inputTokens: acc.inputTokens,
        outputTokens: acc.outputTokens,
        savedTokens: acc.savedTokens,
        avgSavingsPercent,
      };

      if (
        !topEntry ||
        acc.calls > topEntry.calls ||
        (acc.calls === topEntry.calls && avgSavingsPercent > topEntry.avgSavingsPercent)
      ) {
        topEntry = { format, calls: acc.calls, avgSavingsPercent };
      }
    }

    // Cost estimation
    const pricing = MODEL_PRICING[resolvedModel];
    const estimatedCostSaved = pricing
      ? {
          input: (totalSavedTokens / 1_000_000) * pricing.inputPerMTok,
          output: (totalSavedTokens / 1_000_000) * pricing.outputPerMTok,
          currency: 'USD',
        }
      : null;

    const lastRecord = this.records[this.records.length - 1];

    return {
      sessionDuration: formatDuration(now - this.startedAt),
      totalCalls: this.records.length,
      callsByAction,
      totalInputTokens,
      totalOutputTokens,
      totalSavedTokens,
      overallSavingsPercent:
        totalInputTokens > 0 ? Math.round((totalSavedTokens / totalInputTokens) * 100) : 0,
      byFormat,
      topFormat: topEntry,
      estimatedCostSaved,
      lastCallAt: lastRecord ? new Date(lastRecord.timestamp).toISOString() : null,
    };
  }

  /** Clear all records and reset the session timer. */
  reset(): void {
    this.records = [];
    this.startedAt = Date.now();
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton and convenience helpers
// ---------------------------------------------------------------------------

/** Shared singleton for the current server process. */
export const sessionStats = new SessionStats();

/** Current session ID for file persistence (set by cli-serve on startup). */
let currentSessionId: string | undefined;

/** Set the session ID for file persistence. */
export function setSessionId(id: string): void {
  currentSessionId = id;
}

/** Get the current session ID (undefined if not in MCP server mode). */
export function getSessionId(): string | undefined {
  return currentSessionId;
}

/** Record a tool call (in-memory + file persistence if sessionId is set). */
export function recordCall(entry: CallRecord): void {
  sessionStats.record(entry);

  if (currentSessionId) {
    try {
      appendRecord(currentSessionId, entry);
    } catch {
      // Graceful degradation — never crash over stats persistence
    }
  }
}

/** Get aggregate session stats. */
export function getSessionStats(model?: string): SessionStatsResult {
  return sessionStats.getStats(model);
}

/** Reset all session stats. */
export function resetSessionStats(): void {
  sessionStats.reset();
}

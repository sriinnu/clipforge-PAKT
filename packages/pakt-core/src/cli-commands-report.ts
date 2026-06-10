/**
 * @module cli-commands-report
 * The `report` subcommand for the PAKT CLI.
 *
 * Split out of `cli-commands.ts` to keep that module under the per-file
 * line cap; re-exported from there so existing imports keep working.
 */

import type { ParsedArgs } from './cli-commands-shared.js';
import { MODEL_PRICING } from './constants.js';
import {
  SessionStats,
  type CallRecord,
  type SessionStatsResult,
} from './mcp/session-stats.js';
import { readAllRecords } from './stats/persister.js';

/**
 * Format a token count as a human-readable string (e.g. "1.3M", "42K", "500").
 * Used by the report command for compact display.
 */
function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

/**
 * Calculate estimated cost saved from token savings at a given model's pricing.
 *
 * @param savedTokens - Total tokens saved
 * @param model - Model identifier for pricing lookup
 * @returns Formatted dollar string (e.g. "$19.50")
 */
function formatCostSaved(savedTokens: number, model: string): string {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return '$0.00';
  const cost = (savedTokens / 1_000_000) * (pricing.inputPerMTok + pricing.outputPerMTok);
  return `$${cost.toFixed(2)}`;
}

/**
 * Aggregate records into SessionStats and return the result.
 *
 * @param records - Array of call records to aggregate
 * @param model - Model identifier for cost estimation
 * @returns Session stats result, or null if no records
 */
function aggregateRecords(records: CallRecord[], model: string): SessionStatsResult | null {
  if (records.length === 0) return null;
  const tempStats = new SessionStats();
  for (const record of records) {
    tempStats.record(record);
  }
  return tempStats.getStats(model);
}

/**
 * Map internal format identifiers to human-friendly labels.
 *
 * @param fmt - Internal format string (e.g., 'json', 'yaml', 'csv')
 * @returns Human-readable format label (e.g., 'JSON', 'YAML', 'CSV')
 */
function formatFormatLabel(fmt: string): string {
  const labels: Record<string, string> = {
    json: 'JSON',
    yaml: 'YAML',
    csv: 'CSV',
    markdown: 'Markdown',
    text: 'Mixed content',
    pakt: 'PAKT',
  };
  return labels[fmt] ?? fmt;
}

/**
 * Handle the `report` subcommand.
 *
 * Generates a human-readable savings report with lifetime, weekly, and daily
 * breakdowns, per-format analysis, and efficiency metrics.
 *
 * @param args - Parsed CLI arguments (--model flag).
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: linear report rendering with per-section guards
export function cmdReport(args: ParsedArgs): void {
  const model = args.options.get('model') ?? 'gpt-4o';

  // Read all records for each time window
  const allRecords = readAllRecords();
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  const weekRecords = readAllRecords({ since: weekAgo });
  const todayRecords = readAllRecords({ since: todayMs });

  if (allRecords.length === 0) {
    process.stdout.write('No stats recorded yet.\n');
    process.stdout.write('Run pakt compress or use the MCP server to start tracking.\n');
    return;
  }

  // Aggregate each time window
  const lifetime = aggregateRecords(allRecords, model);
  const weekly = aggregateRecords(weekRecords, model);
  const daily = aggregateRecords(todayRecords, model);

  const w = (s: string) => process.stdout.write(s);
  const BAR = '═'; // ═

  w('\n');
  w('  PAKT Savings Report\n');
  w(`  ${BAR.repeat(43)}\n`);
  w('\n');

  // Lifetime
  if (lifetime) {
    w(`  Lifetime:  ${formatTokenCount(lifetime.totalSavedTokens)} tokens saved (${formatCostSaved(lifetime.totalSavedTokens, model)})\n`);
  } else {
    w('  Lifetime:  0 tokens saved ($0.00)\n');
  }

  // This week
  if (weekly && weekly.totalCalls > 0) {
    w(`  This week: ${formatTokenCount(weekly.totalSavedTokens)} tokens saved (${formatCostSaved(weekly.totalSavedTokens, model)})\n`);
  } else {
    w('  This week: 0 tokens saved ($0.00)\n');
  }

  // Today
  if (daily && daily.totalCalls > 0) {
    w(`  Today:     ${formatTokenCount(daily.totalSavedTokens)} tokens saved (${formatCostSaved(daily.totalSavedTokens, model)})\n`);
  } else {
    w('  Today:     0 tokens saved ($0.00)\n');
  }

  // By Format breakdown (using lifetime stats)
  if (lifetime) {
    const formats = Object.entries(lifetime.byFormat);
    if (formats.length > 0) {
      w('\n');
      w('  By Format:\n');
      // Sort by calls descending for most-used first
      const sorted = formats.sort((a, b) => b[1].calls - a[1].calls);
      for (const [fmt, fmtStats] of sorted) {
        const label = formatFormatLabel(fmt);
        w(`    ${label.padEnd(16)} ${String(fmtStats.avgSavingsPercent).padStart(3)}% avg savings (${String(fmtStats.calls)} calls)\n`);
      }
    }
  }

  // Efficiency metrics (from lifetime)
  if (lifetime && lifetime.totalCalls > 0) {
    // Count calls that actually saved tokens vs those that didn't
    let callsSaved = 0;
    let callsSkipped = 0;
    let bestSavingsPercent = 0;
    let bestFormat = '';
    let bestInputTokens = 0;
    let bestOutputTokens = 0;

    for (const record of allRecords) {
      if (record.savedTokens > 0) {
        callsSaved++;
        if (record.savingsPercent > bestSavingsPercent) {
          bestSavingsPercent = record.savingsPercent;
          bestFormat = record.format;
          bestInputTokens = record.inputTokens;
          bestOutputTokens = record.outputTokens;
        }
      } else {
        callsSkipped++;
      }
    }

    w('\n');
    w('  Efficiency:\n');
    const total = callsSaved + callsSkipped;
    const savedPct = total > 0 ? Math.round((callsSaved / total) * 100) : 0;
    const skippedPct = total > 0 ? Math.round((callsSkipped / total) * 100) : 0;
    w(`    Calls that saved tokens: ${String(callsSaved)}/${String(total)} (${String(savedPct)}%)\n`);
    w(`    Calls skipped (would expand): ${String(callsSkipped)}/${String(total)} (${String(skippedPct)}%)\n`);

    if (bestSavingsPercent > 0) {
      w(`    Best compression: ${String(bestSavingsPercent)}% (${bestFormat}, ${String(bestInputTokens)}→${String(bestOutputTokens)} tokens)\n`);
    }
  }

  w(`  ${BAR.repeat(43)}\n`);
  w('\n');
}

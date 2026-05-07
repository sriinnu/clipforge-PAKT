/**
 * @module cli-commands-stats
 * Implementation of the `pakt stats` CLI subcommand.
 *
 * Split out of `cli-commands.ts` so the main module stays under the
 * 400-line cap. Two operating modes:
 *
 *  - **single-shot** (file arg or piped stdin): compress one input and
 *    print stats for it
 *  - **persistent** (no file + interactive terminal): aggregate persisted
 *    records from `~/.pakt/stats/` across all agents/sessions
 */

import type { ParsedArgs } from './cli-commands-shared.js';
import { compress, detect } from './index.js';
import {
  SessionStats,
  type SessionStatsResult,
  getSessionStats,
  recordCall,
  resetSessionStats,
} from './mcp/session-stats.js';
import { compressMixed } from './mixed/index.js';
import { compactSessions, getActiveSessions, readAllRecords, resetAll } from './stats/persister.js';

// ---------------------------------------------------------------------------
// Cost / format helpers shared by both modes
// ---------------------------------------------------------------------------

/** Print the `Cost saved (input/output)` lines when present on a stats result. */
function printCostSaved(stats: SessionStatsResult): void {
  if (!stats.estimatedCostSaved) return;
  process.stdout.write(
    `Cost saved (input):  $${stats.estimatedCostSaved.input.toFixed(6)} ${stats.estimatedCostSaved.currency}\n`,
  );
  process.stdout.write(
    `Cost saved (output): $${stats.estimatedCostSaved.output.toFixed(6)} ${stats.estimatedCostSaved.currency}\n`,
  );
}

// ---------------------------------------------------------------------------
// Single-shot mode
// ---------------------------------------------------------------------------

/** Compress one input and print its stats. */
function cmdStatsSingleShot(
  args: ParsedArgs,
  readInput: (file: string | undefined) => string,
  model: string,
): void {
  const input = readInput(args.file);

  resetSessionStats();

  const detected = detect(input);
  const startedAt = Date.now();
  const result =
    detected.format === 'json' || detected.format === 'yaml' || detected.format === 'csv'
      ? compress(input, { fromFormat: detected.format })
      : compressMixed(input);
  const durationMs = Date.now() - startedAt;

  const inputTokens = result.originalTokens;
  const outputTokens = result.compressedTokens;
  const savedTokens = inputTokens - outputTokens;

  recordCall({
    action: 'compress',
    format: detected.format,
    inputTokens,
    outputTokens,
    savedTokens,
    savingsPercent: inputTokens > 0 ? Math.round((savedTokens / inputTokens) * 100) : 0,
    reversible: result.reversible,
    timestamp: Date.now(),
    durationMs,
  });

  const stats = getSessionStats(model);

  process.stdout.write(`Format:            ${detected.format}\n`);
  process.stdout.write(`Model:             ${model}\n`);
  process.stdout.write(`Input tokens:      ${String(stats.totalInputTokens)}\n`);
  process.stdout.write(`Output tokens:     ${String(stats.totalOutputTokens)}\n`);
  process.stdout.write(`Saved tokens:      ${String(stats.totalSavedTokens)}\n`);
  process.stdout.write(`Savings:           ${String(stats.overallSavingsPercent)}%\n`);
  process.stdout.write(`Reversible:        ${String(result.reversible)}\n`);

  printCostSaved(stats);
}

// ---------------------------------------------------------------------------
// Persistent mode
// ---------------------------------------------------------------------------

/** Resolve `--today` / `--week` flags to a `since` timestamp + label. */
function resolveTimeRange(flags: Set<string>): { since: number | undefined; label: string } {
  if (flags.has('today')) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { since: d.getTime(), label: 'today' };
  }
  if (flags.has('week')) {
    return { since: Date.now() - 7 * 24 * 60 * 60 * 1000, label: 'last 7 days' };
  }
  return { since: undefined, label: 'all time' };
}

/** Print the aggregate stats report to stdout. */
function printStatsReport(
  stats: SessionStatsResult,
  meta: { scope: string; model: string; agent?: string },
): void {
  const activeSessions = getActiveSessions();
  const agentLabel = meta.agent ? ` (agent: ${meta.agent})` : '';
  const activeLabel = activeSessions.length > 0 ? ` (${String(activeSessions.length)} active)` : '';

  process.stdout.write(`Scope:             ${meta.scope}${agentLabel}${activeLabel}\n`);
  process.stdout.write(`Model:             ${meta.model}\n`);
  process.stdout.write(`Total calls:       ${String(stats.totalCalls)}\n`);
  process.stdout.write(`Input tokens:      ${String(stats.totalInputTokens)}\n`);
  process.stdout.write(`Output tokens:     ${String(stats.totalOutputTokens)}\n`);
  process.stdout.write(`Saved tokens:      ${String(stats.totalSavedTokens)}\n`);
  process.stdout.write(`Savings:           ${String(stats.overallSavingsPercent)}%\n`);

  printCostSaved(stats);

  const formats = Object.entries(stats.byFormat);
  if (formats.length > 1) {
    process.stdout.write('\nBy format:\n');
    for (const [fmt, fmtStats] of formats.sort((a, b) => b[1].calls - a[1].calls)) {
      process.stdout.write(
        `  ${fmt.padEnd(12)} ${String(fmtStats.calls).padStart(5)} calls   ${String(fmtStats.avgSavingsPercent)}% avg\n`,
      );
    }
  }

  if (!meta.agent && activeSessions.length > 1) {
    process.stdout.write('\nActive agents:\n');
    for (const sess of activeSessions) {
      process.stdout.write(
        `  ${sess.agent.padEnd(16)} ${String(sess.recordCount).padStart(5)} calls   pid ${String(sess.pid)}\n`,
      );
    }
  }
}

/** Persistent stats: read from ~/.pakt/stats/ and aggregate. */
function cmdStatsPersistent(args: ParsedArgs, model: string): void {
  if (args.flags.has('reset')) {
    resetAll();
    process.stderr.write('Stats cleared.\n');
    return;
  }

  if (args.flags.has('compact')) {
    const result = compactSessions();
    process.stderr.write(
      `Compacted ${String(result.compacted)} sessions into ${String(result.archived)} archive entries.\n`,
    );
    return;
  }

  const { since, label } = resolveTimeRange(args.flags);
  const agent = args.options.get('agent');
  const activeOnly = args.flags.has('active');
  const records = readAllRecords({ since, agent, activeOnly });

  if (records.length === 0) {
    process.stdout.write('No stats recorded yet.\n');
    if (!activeOnly) {
      process.stdout.write('Run pakt compress or use the MCP server to start tracking.\n');
    }
    return;
  }

  const tempStats = new SessionStats();
  for (const record of records) {
    tempStats.record(record);
  }

  printStatsReport(tempStats.getStats(model), { scope: label, model, agent });
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Handle the `stats` subcommand.
 *
 * Two modes:
 * - **Single-shot** (file arg or piped stdin): compresses input and shows stats.
 * - **Persistent** (no file, interactive terminal): reads from `~/.pakt/stats/`
 *   and aggregates across all agents and sessions.
 *
 * @param args - Parsed CLI arguments (file, --model, --today, --week, etc.)
 * @param readInput - Function that resolves a file path or stdin to a string
 */
export function cmdStats(args: ParsedArgs, readInput: (file: string | undefined) => string): void {
  const model = args.options.get('model') ?? 'gpt-4o';

  // Persistent mode: no file and stdin is a TTY
  if (!args.file && process.stdin.isTTY) {
    cmdStatsPersistent(args, model);
    return;
  }

  cmdStatsSingleShot(args, readInput, model);
}

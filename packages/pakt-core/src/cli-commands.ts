/**
 * @module cli-commands
 * Subcommand handler functions for the PAKT CLI.
 *
 * Each exported function maps to a named CLI subcommand and is responsible
 * for reading input, invoking the appropriate PAKT API, and writing results
 * to stdout/stderr. Error propagation is handled by the caller in `cli.ts`.
 *
 * Shared types/helpers live in `cli-commands-shared.ts`. The `stats`
 * subcommand lives in `cli-commands-stats.ts`. Both are re-exported from
 * here so existing `from './cli-commands.js'` imports keep working.
 */

import {
  type ParsedArgs,
  assertValidPaktInput,
  buildCompressionOptions,
  parseFormat,
  parseSemanticBudget,
} from './cli-commands-shared.js';
import { MODEL_PRICING } from './constants.js';
import { compareSavings, compress, countTokens, decompress, detect } from './index.js';
import { handlePaktTool } from './mcp/index.js';
import type { PaktInspectResult } from './mcp/index.js';
import {
  SessionStats,
  type CallRecord,
  type SessionStatsResult,
} from './mcp/session-stats.js';
import { compressMixed } from './mixed/index.js';
import { readAllRecords } from './stats/persister.js';

// Re-export the shared surface so `cli.ts` can import everything from here.
export { type ParsedArgs, FORMAT_MAP, parseFormat } from './cli-commands-shared.js';
export { cmdStats } from './cli-commands-stats.js';

// ---------------------------------------------------------------------------
// Subcommand: compress
// ---------------------------------------------------------------------------

/**
 * Handle the `compress` subcommand.
 *
 * Reads input from a file or stdin, compresses it, and writes PAKT output to
 * stdout. Compression statistics are written to stderr.
 *
 * @param args - Parsed CLI arguments (file, --from, --layers flags)
 * @param readInput - Function that resolves a file path or stdin to a string
 * @param parseLayers - Function that converts a layer string to PaktLayers
 */
export function cmdCompress(
  args: ParsedArgs,
  readInput: (file: string | undefined) => string,
  parseLayers: (s: string) => Parameters<typeof compress>[1]['layers'],
): void {
  const input = readInput(args.file);
  const options = buildCompressionOptions(args, parseLayers);

  const result = compress(input, options);

  process.stdout.write(result.compressed);
  if (!result.compressed.endsWith('\n')) {
    process.stdout.write('\n');
  }

  process.stderr.write(
    `Compressed: ${String(result.originalTokens)} tokens → ${String(result.compressedTokens)} tokens (${String(result.savings.totalPercent)}% savings)\n`,
  );
}

// ---------------------------------------------------------------------------
// Subcommand: decompress
// ---------------------------------------------------------------------------

/**
 * Handle the `decompress` subcommand.
 *
 * Reads PAKT input and writes the decompressed text to stdout.
 *
 * @param args - Parsed CLI arguments (file, --to flag)
 * @param readInput - Function that resolves a file path or stdin to a string
 */
export function cmdDecompress(
  args: ParsedArgs,
  readInput: (file: string | undefined) => string,
): void {
  const input = readInput(args.file);

  const toOpt = args.options.get('to');
  const outputFormat = toOpt ? parseFormat(toOpt, '--to') : undefined;

  assertValidPaktInput(input);
  const result = decompress(input, outputFormat);

  process.stdout.write(result.text);
  if (!result.text.endsWith('\n')) {
    process.stdout.write('\n');
  }
}

// ---------------------------------------------------------------------------
// Subcommand: detect
// ---------------------------------------------------------------------------

/**
 * Handle the `detect` subcommand.
 *
 * Reads input and writes the detected format, confidence, and reason to stdout.
 *
 * @param args - Parsed CLI arguments (file)
 * @param readInput - Function that resolves a file path or stdin to a string
 */
export function cmdDetect(args: ParsedArgs, readInput: (file: string | undefined) => string): void {
  const input = readInput(args.file);
  const result = detect(input);

  process.stdout.write(`Format:     ${result.format}\n`);
  process.stdout.write(`Confidence: ${String(Math.round(result.confidence * 100))}%\n`);
  process.stdout.write(`Reason:     ${result.reason}\n`);
}

// ---------------------------------------------------------------------------
// Subcommand: inspect
// ---------------------------------------------------------------------------

/**
 * Handle the `inspect` subcommand.
 *
 * Reads input and reports whether the payload should be compressed,
 * decompressed, or left as-is.
 */
export function cmdInspect(
  args: ParsedArgs,
  readInput: (file: string | undefined) => string,
): void {
  const input = readInput(args.file);
  const model = args.options.get('model') ?? 'gpt-4o';
  const semanticBudget = parseSemanticBudget(args.options.get('semantic-budget'));
  const result = handlePaktTool('pakt_inspect', {
    text: input,
    model,
    ...(semanticBudget !== undefined ? { semanticBudget } : {}),
  }) as PaktInspectResult;

  process.stdout.write(`Format:               ${result.detectedFormat}\n`);
  process.stdout.write(`Confidence:           ${String(Math.round(result.confidence * 100))}%\n`);
  process.stdout.write(`Reason:               ${result.reason}\n`);
  process.stdout.write(`Input tokens:         ${String(result.inputTokens)}\n`);
  process.stdout.write(`Recommended action:   ${result.recommendedAction}\n`);

  if (result.estimatedOutputTokens !== undefined) {
    process.stdout.write(`Estimated output:     ${String(result.estimatedOutputTokens)} tokens\n`);
  }
  if (result.estimatedSavings !== undefined) {
    process.stdout.write(`Estimated savings:    ${String(result.estimatedSavings)}%\n`);
  }
  if (result.estimatedSavedTokens !== undefined) {
    process.stdout.write(`Estimated saved:      ${String(result.estimatedSavedTokens)} tokens\n`);
  }
  if (result.originalFormat !== undefined) {
    process.stdout.write(`Original format:      ${result.originalFormat}\n`);
  }
  if (result.reversible !== undefined) {
    process.stdout.write(`Reversible:           ${result.reversible ? 'yes' : 'no'}\n`);
  }
  if (result.wasLossy !== undefined) {
    process.stdout.write(`Lossy payload:        ${result.wasLossy ? 'yes' : 'no'}\n`);
  }
}

// ---------------------------------------------------------------------------
// Subcommand: tokens
// ---------------------------------------------------------------------------

/**
 * Handle the `tokens` subcommand.
 *
 * Reads input and writes the token count for the specified model to stdout.
 *
 * @param args - Parsed CLI arguments (file, --model flag)
 * @param readInput - Function that resolves a file path or stdin to a string
 */
export function cmdTokens(args: ParsedArgs, readInput: (file: string | undefined) => string): void {
  const input = readInput(args.file);
  const model = args.options.get('model') ?? 'gpt-4o';
  const tokens = countTokens(input, model);

  process.stdout.write(`${String(tokens)}\n`);
}

// ---------------------------------------------------------------------------
// Subcommand: savings
// ---------------------------------------------------------------------------

/**
 * Handle the `savings` subcommand.
 *
 * Compresses the input and writes a full savings report (tokens + cost) to stdout.
 *
 * @param args - Parsed CLI arguments (file, --model flag)
 * @param readInput - Function that resolves a file path or stdin to a string
 */
export function cmdSavings(
  args: ParsedArgs,
  readInput: (file: string | undefined) => string,
): void {
  const input = readInput(args.file);
  const model = args.options.get('model') ?? 'gpt-4o';

  const result = compress(input);
  const report = compareSavings(input, result.compressed, model);

  process.stdout.write(`Model:             ${report.model}\n`);
  process.stdout.write(`Original tokens:   ${String(report.originalTokens)}\n`);
  process.stdout.write(`Compressed tokens: ${String(report.compressedTokens)}\n`);
  process.stdout.write(`Saved tokens:      ${String(report.savedTokens)}\n`);
  process.stdout.write(`Savings:           ${String(report.savedPercent)}%\n`);

  if (report.costSaved) {
    process.stdout.write(
      `Cost saved (input):  $${report.costSaved.input.toFixed(6)} ${report.costSaved.currency}\n`,
    );
    process.stdout.write(
      `Cost saved (output): $${report.costSaved.output.toFixed(6)} ${report.costSaved.currency}\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// Subcommand: auto
// ---------------------------------------------------------------------------

/**
 * Handle the `auto` subcommand.
 *
 * Detects whether input is already PAKT or raw structured data and routes:
 * - PAKT input → {@link decompress} → human-readable text on stdout.
 * - Raw input → {@link compressMixed} → PAKT output on stdout.
 *
 * Savings metadata goes to stderr so piping stdout to another tool is clean.
 *
 * @param args - Parsed CLI arguments (file, --from, --to flags)
 * @param readInput - Function that resolves a file path or stdin to a string
 * @param parseLayers - Function that converts a layer string to PaktLayers
 */
export function cmdAuto(
  args: ParsedArgs,
  readInput: (file: string | undefined) => string,
  parseLayers: (s: string) => Parameters<typeof compress>[1]['layers'],
): void {
  const input = readInput(args.file);

  const fromOpt = args.options.get('from');
  const toOpt = args.options.get('to');
  const compressionOptions = buildCompressionOptions(args, parseLayers);

  // Use --from to override detection when the caller knows the format
  const detected = detect(input);
  const effectiveFormat = fromOpt ? parseFormat(fromOpt, '--from') : detected.format;

  if (effectiveFormat === 'pakt') {
    // Input is already PAKT — decompress it
    const outputFormat = toOpt ? parseFormat(toOpt, '--to') : undefined;
    assertValidPaktInput(input);
    const result = decompress(input, outputFormat);

    process.stdout.write(result.text);
    if (!result.text.endsWith('\n')) {
      process.stdout.write('\n');
    }

    process.stderr.write('\x1b[90m# Decompressed PAKT input\x1b[0m\n');
    return;
  }

  // Raw input — compress directly for structured formats, mixed pipeline otherwise.
  const result =
    effectiveFormat === 'json' || effectiveFormat === 'yaml' || effectiveFormat === 'csv'
      ? compress(input, { ...compressionOptions, fromFormat: effectiveFormat })
      : compressMixed(input, compressionOptions);

  process.stdout.write(result.compressed);
  if (!result.compressed.endsWith('\n')) {
    process.stdout.write('\n');
  }

  const saved = result.originalTokens - result.compressedTokens;
  process.stderr.write(
    `\x1b[90m# Saved ${String(result.savings.totalPercent)}% (${String(result.originalTokens)}→${String(result.compressedTokens)} tokens, −${String(saved)})\x1b[0m\n`,
  );
}

// ---------------------------------------------------------------------------
// Subcommand: report
// ---------------------------------------------------------------------------

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
function aggregateRecords(
  records: CallRecord[],
  model: string,
): SessionStatsResult | null {
  if (records.length === 0) return null;
  const tempStats = new SessionStats();
  for (const record of records) {
    tempStats.record(record);
  }
  return tempStats.getStats(model);
}

/**
 * Handle the `report` subcommand.
 *
 * Generates a human-readable savings report with lifetime, weekly, and daily
 * breakdowns, per-format analysis, and efficiency metrics.
 *
 * @param args - Parsed CLI arguments (--model flag).
 */
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
  const BAR = '\u2550'; // ═

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
      w(`    Best compression: ${String(bestSavingsPercent)}% (${bestFormat}, ${String(bestInputTokens)}\u2192${String(bestOutputTokens)} tokens)\n`);
    }
  }

  w(`  ${BAR.repeat(43)}\n`);
  w('\n');
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

/**
 * @module cli-commands
 * Subcommand handler functions for the PAKT CLI.
 *
 * Each exported function maps to a named CLI subcommand and is responsible
 * for reading input, invoking the appropriate PAKT API, and writing results
 * to stdout/stderr. Error propagation is handled by the caller in cli.ts.
 */

import { compareSavings, compress, countTokens, decompress, detect } from './index.js';
import { handlePaktTool } from './mcp/index.js';
import type { PaktInspectResult } from './mcp/index.js';
import {
  SessionStats,
  type SessionStatsResult,
  getSessionStats,
  recordCall,
  resetSessionStats,
} from './mcp/session-stats.js';
import { compressMixed } from './mixed/index.js';
import { compactSessions, getActiveSessions, readAllRecords, resetAll } from './stats/persister.js';
import type { PIIKind, PIIMode, PaktFormat, PaktOptions } from './types.js';
import { validate } from './utils/validate.js';

// ---------------------------------------------------------------------------
// Internal types (re-used from cli.ts via import)
// ---------------------------------------------------------------------------

/**
 * Parsed CLI arguments produced by `parseArgs` in cli.ts.
 * Imported as a structural type to avoid circular deps.
 */
export interface ParsedArgs {
  /** The subcommand name (e.g., 'compress', 'decompress', 'auto'). */
  command: string | undefined;
  /** Optional file path positional argument. */
  file: string | undefined;
  /** Named options parsed from `--key value` pairs. */
  options: Map<string, string>;
  /** Boolean flags parsed from standalone `--flag` arguments. */
  flags: Set<string>;
}

// ---------------------------------------------------------------------------
// Format + Layer helpers (shared with cli.ts via import)
// ---------------------------------------------------------------------------

/**
 * Maps CLI format strings to canonical PaktFormat values.
 * Exported so cli.ts can use the same map for the `auto` command's detection.
 */
export const FORMAT_MAP: Record<string, PaktFormat> = {
  json: 'json',
  yaml: 'yaml',
  csv: 'csv',
  md: 'markdown',
  markdown: 'markdown',
  text: 'text',
};

/**
 * Resolve a user-supplied format string to a PaktFormat.
 * Throws with a clear message if the value is unrecognised.
 *
 * @param value - The raw string the user passed (e.g., "json", "md").
 * @param optionName - The flag name to include in the error message (e.g., "--from").
 * @returns The canonical PaktFormat.
 */
export function parseFormat(value: string, optionName: string): PaktFormat {
  const mapped = FORMAT_MAP[value.toLowerCase()];
  if (!mapped) {
    const valid = Object.keys(FORMAT_MAP).join(', ');
    throw new Error(`Invalid ${optionName} format: "${value}". Valid formats: ${valid}`);
  }
  return mapped;
}

/**
 * Parse and validate the optional `--semantic-budget` flag.
 *
 * @param value - Raw CLI value from `--semantic-budget`
 * @returns Parsed positive integer budget, or undefined if not provided
 */
function parseSemanticBudget(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `Invalid --semantic-budget value: "${value}". Expected a positive integer token budget.`,
    );
  }

  const budget = Number.parseInt(trimmed, 10);
  if (budget <= 0) {
    throw new Error(
      `Invalid --semantic-budget value: "${value}". Expected a positive integer token budget.`,
    );
  }
  return budget;
}

const VALID_PII_MODES: readonly PIIMode[] = ['off', 'flag', 'redact'];
const VALID_PII_KINDS: readonly PIIKind[] = [
  'email',
  'phone',
  'ipv4',
  'ipv6',
  'jwt',
  'aws-access-key',
  'aws-secret-key',
  'credit-card',
  'ssn',
];

/**
 * Parse the optional `--pii-mode` flag. Accepts `off`, `flag`, or
 * `redact`; throws on anything else so typos don't silently leak PII.
 */
function parsePIIMode(value: string | undefined): PIIMode | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!VALID_PII_MODES.includes(normalized as PIIMode)) {
    throw new Error(
      `Invalid --pii-mode value: "${value}". Valid modes: ${VALID_PII_MODES.join(', ')}.`,
    );
  }
  return normalized as PIIMode;
}

/**
 * Parse the optional `--pii-kinds` flag (comma-separated). Unknown kinds
 * are rejected up front so the CLI never pretends to filter for a kind
 * the detector doesn't know about.
 */
function parsePIIKinds(value: string | undefined): PIIKind[] | undefined {
  if (value === undefined) return undefined;
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return undefined;
  for (const p of parts) {
    if (!VALID_PII_KINDS.includes(p as PIIKind)) {
      throw new Error(
        `Invalid --pii-kinds value: "${p}". Valid kinds: ${VALID_PII_KINDS.join(', ')}.`,
      );
    }
  }
  return parts as PIIKind[];
}

function assertValidPaktInput(input: string): void {
  const validation = validate(input);
  if (!validation.valid) {
    const message = validation.errors[0]?.message ?? 'validation failed';
    throw new Error(`Input looks like PAKT but failed validation: ${message}`);
  }
}

/**
 * Resolve shared compression flags into `compress()` / `compressMixed()` options.
 *
 * `--semantic-budget` is an explicit request for L4, so the helper auto-enables
 * the semantic layer. Conversely, enabling layer 4 without a budget is rejected
 * up front instead of silently no-oping.
 *
 * @param args - Parsed CLI arguments
 * @param parseLayers - Optional layer parser for commands that support `--layers`
 * @returns Resolved compression options
 */
function buildCompressionOptions(
  args: ParsedArgs,
  parseLayers?: (s: string) => Parameters<typeof compress>[1]['layers'],
): Partial<PaktOptions> {
  const fromOpt = args.options.get('from');
  const layersOpt = args.options.get('layers');
  const semanticBudget = parseSemanticBudget(args.options.get('semantic-budget'));
  const piiMode = parsePIIMode(args.options.get('pii-mode'));
  const piiKinds = parsePIIKinds(args.options.get('pii-kinds'));

  const options: Partial<PaktOptions> = {};

  if (fromOpt) {
    options.fromFormat = parseFormat(fromOpt, '--from');
  }

  if (layersOpt) {
    if (!parseLayers) {
      throw new Error('--layers is not available for this command');
    }
    options.layers = parseLayers(layersOpt);
  }

  if (semanticBudget !== undefined) {
    options.semanticBudget = semanticBudget;
    options.layers = {
      ...options.layers,
      semantic: true,
    };
  }

  if (options.layers?.semantic && semanticBudget === undefined) {
    throw new Error('Layer 4 semantic compression requires --semantic-budget <positive integer>.');
  }

  if (piiMode !== undefined) {
    options.piiMode = piiMode;
  }
  if (piiKinds !== undefined) {
    options.piiKinds = piiKinds;
  }
  if (args.flags.has('pii-reversible')) {
    options.piiReversible = true;
  }

  return options;
}

// ---------------------------------------------------------------------------
// Subcommand: compress
// ---------------------------------------------------------------------------

/**
 * Handle the `compress` subcommand.
 *
 * Reads input from a file or stdin, compresses it, and writes PAKT output to
 * stdout. Compression statistics are written to stderr.
 *
 * @param args - Parsed CLI arguments (file, --from, --layers flags).
 * @param readInput - Function that resolves a file path or stdin to a string.
 * @param parseLayers - Function that converts a layer string to PaktLayers.
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
 * @param args - Parsed CLI arguments (file, --to flag).
 * @param readInput - Function that resolves a file path or stdin to a string.
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
 * @param args - Parsed CLI arguments (file).
 * @param readInput - Function that resolves a file path or stdin to a string.
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
 * @param args - Parsed CLI arguments (file, --model flag).
 * @param readInput - Function that resolves a file path or stdin to a string.
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
 * @param args - Parsed CLI arguments (file, --model flag).
 * @param readInput - Function that resolves a file path or stdin to a string.
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
 * @param args - Parsed CLI arguments (file, --from, --to flags).
 * @param readInput - Function that resolves a file path or stdin to a string.
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
  } else {
    // Raw input — compress directly for structured formats, mixed pipeline otherwise.
    const result =
      effectiveFormat === 'json' || effectiveFormat === 'yaml' || effectiveFormat === 'csv'
        ? compress(input, {
            ...compressionOptions,
            fromFormat: effectiveFormat,
          })
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
}

// ---------------------------------------------------------------------------
// Subcommand: stats
// ---------------------------------------------------------------------------

/**
 * Handle the `stats` subcommand.
 *
 * Two modes:
 * - **Single-shot** (file arg or piped stdin): compresses input and shows stats.
 * - **Persistent** (no file, interactive terminal): reads from `~/.pakt/stats/`
 *   and aggregates across all agents and sessions.
 *
 * @param args - Parsed CLI arguments (file, --model, --today, --week, etc.).
 * @param readInput - Function that resolves a file path or stdin to a string.
 */
export function cmdStats(args: ParsedArgs, readInput: (file: string | undefined) => string): void {
  const model = args.options.get('model') ?? 'gpt-4o';

  // Persistent mode: no file and stdin is a TTY
  if (!args.file && process.stdin.isTTY) {
    cmdStatsPersistent(args, model);
    return;
  }

  // Single-shot mode: compress a file/stdin and report
  cmdStatsSingleShot(args, readInput, model);
}

/** Single-shot stats: compress one input and show the report. */
function cmdStatsSingleShot(
  args: ParsedArgs,
  readInput: (file: string | undefined) => string,
  model: string,
): void {
  const input = readInput(args.file);

  resetSessionStats();

  const detected = detect(input);
  const result =
    detected.format === 'json' || detected.format === 'yaml' || detected.format === 'csv'
      ? compress(input, { fromFormat: detected.format })
      : compressMixed(input);

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
  });

  const stats = getSessionStats(model);

  process.stdout.write(`Format:            ${detected.format}\n`);
  process.stdout.write(`Model:             ${model}\n`);
  process.stdout.write(`Input tokens:      ${String(stats.totalInputTokens)}\n`);
  process.stdout.write(`Output tokens:     ${String(stats.totalOutputTokens)}\n`);
  process.stdout.write(`Saved tokens:      ${String(stats.totalSavedTokens)}\n`);
  process.stdout.write(`Savings:           ${String(stats.overallSavingsPercent)}%\n`);
  process.stdout.write(`Reversible:        ${String(result.reversible)}\n`);

  if (stats.estimatedCostSaved) {
    process.stdout.write(
      `Cost saved (input):  $${stats.estimatedCostSaved.input.toFixed(6)} ${stats.estimatedCostSaved.currency}\n`,
    );
    process.stdout.write(
      `Cost saved (output): $${stats.estimatedCostSaved.output.toFixed(6)} ${stats.estimatedCostSaved.currency}\n`,
    );
  }
}

/** Resolve time-range flags to a `since` timestamp. */
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

  if (stats.estimatedCostSaved) {
    process.stdout.write(
      `Cost saved (input):  $${stats.estimatedCostSaved.input.toFixed(6)} ${stats.estimatedCostSaved.currency}\n`,
    );
    process.stdout.write(
      `Cost saved (output): $${stats.estimatedCostSaved.output.toFixed(6)} ${stats.estimatedCostSaved.currency}\n`,
    );
  }

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

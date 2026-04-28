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
import { compareSavings, compress, countTokens, decompress, detect } from './index.js';
import { handlePaktTool } from './mcp/index.js';
import type { PaktInspectResult } from './mcp/index.js';
import { compressMixed } from './mixed/index.js';

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

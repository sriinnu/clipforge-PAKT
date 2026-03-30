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
import { compressMixed } from './mixed/index.js';
import type { PaktFormat, PaktOptions } from './types.js';
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

  process.stdout.write(`Model:            ${report.model}\n`);
  process.stdout.write(`Original tokens:  ${String(report.originalTokens)}\n`);
  process.stdout.write(`Compressed tokens: ${String(report.compressedTokens)}\n`);
  process.stdout.write(`Saved tokens:     ${String(report.savedTokens)}\n`);
  process.stdout.write(`Savings:          ${String(report.savedPercent)}%\n`);

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

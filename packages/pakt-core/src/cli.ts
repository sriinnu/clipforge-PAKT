#!/usr/bin/env node

/**
 * PAKT CLI — command-line interface for PAKT compression.
 *
 * Provides shell access to the PAKT compression engine for
 * compressing, decompressing, and analyzing files.
 *
 * Usage:
 *   pakt compress [file] [--from json|yaml|csv|md|text] [--layers 1,2]
 *   pakt decompress [file] [--to json|yaml|csv|md|text]
 *   pakt detect [file]
 *   pakt tokens [file] [--model gpt-4o|claude-sonnet|...]
 *   pakt savings [file] [--model gpt-4o|claude-sonnet|...]
 *   pakt --version
 *   pakt --help
 */

import { readFileSync } from 'node:fs';
import { VERSION, compareSavings, compress, countTokens, decompress, detect } from './index.js';
import type { PaktFormat, PaktLayers } from './types.js';

// ---------------------------------------------------------------------------
// Format mapping
// ---------------------------------------------------------------------------

const FORMAT_MAP: Record<string, PaktFormat> = {
  json: 'json',
  yaml: 'yaml',
  csv: 'csv',
  md: 'markdown',
  markdown: 'markdown',
  text: 'text',
};

// ---------------------------------------------------------------------------
// Layer number mapping
// ---------------------------------------------------------------------------

const LAYER_MAP: Record<number, keyof PaktLayers> = {
  1: 'structural',
  2: 'dictionary',
  3: 'tokenizerAware',
  4: 'semantic',
};

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const HELP = `pakt v${VERSION} — PAKT compression engine CLI

Usage:
  pakt compress [file] [options]    Compress input to PAKT format
  pakt decompress [file] [options]  Decompress PAKT back to original format
  pakt detect [file]                Detect input format
  pakt tokens [file] [options]      Count tokens in input
  pakt savings [file] [options]     Show compression savings report
  pakt --version                    Print version
  pakt --help                       Show this help

Options:
  --from <format>    Force input format (json|yaml|csv|md|text)
  --to <format>      Output format for decompress (json|yaml|csv|md|text)
  --layers <list>    Compression layers to enable (comma-separated: 1,2,3,4)
  --model <model>    Model for token counting (gpt-4o|claude-sonnet|claude-opus|claude-haiku|gpt-4o-mini)

Input:
  If no file argument is given, reads from stdin (pipe mode).

Examples:
  pakt compress data.json
  pakt compress data.json --layers 1,2
  cat data.json | pakt compress --from json
  pakt decompress compressed.pakt --to json
  pakt detect mystery-file.txt
  pakt tokens data.json --model claude-sonnet
  pakt savings data.json --model gpt-4o
`;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  command: string | undefined;
  file: string | undefined;
  options: Map<string, string>;
  flags: Set<string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: undefined,
    file: undefined,
    options: new Map(),
    flags: new Set(),
  };

  let i = 0;

  // First positional arg is the subcommand
  if (i < argv.length) {
    const first = argv[i]!;
    if (!first.startsWith('--')) {
      result.command = first;
      i++;
    }
  }

  // Second positional arg (if not starting with --) is the file path
  if (i < argv.length) {
    const second = argv[i]!;
    if (!second.startsWith('--')) {
      result.file = second;
      i++;
    }
  }

  // Parse remaining --key value pairs and --flag switches
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        result.options.set(key, next);
        i += 2;
      } else {
        result.flags.add(key);
        i++;
      }
    } else {
      // Unexpected positional arg — skip
      i++;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Input reading
// ---------------------------------------------------------------------------

function readInput(file: string | undefined): string {
  if (file) {
    return readFileSync(file, 'utf8');
  }

  // Check if stdin is a TTY — if it is, there is nothing to read
  if (process.stdin.isTTY) {
    throw new Error(
      'No input file specified and stdin is a terminal. Provide a file or pipe input.',
    );
  }

  return readFileSync(0, 'utf8');
}

// ---------------------------------------------------------------------------
// Layer parsing
// ---------------------------------------------------------------------------

function parseLayers(layerStr: string): Partial<PaktLayers> {
  const layers: PaktLayers = {
    structural: false,
    dictionary: false,
    tokenizerAware: false,
    semantic: false,
  };

  const parts = layerStr.split(',');
  for (const part of parts) {
    const num = Number.parseInt(part.trim(), 10);
    if (Number.isNaN(num)) {
      throw new Error(`Invalid layer number: "${part.trim()}". Expected 1, 2, 3, or 4.`);
    }
    const key = LAYER_MAP[num];
    if (!key) {
      throw new Error(
        `Unknown layer: ${String(num)}. Valid layers: 1 (structural), 2 (dictionary), 3 (tokenizer), 4 (semantic).`,
      );
    }
    layers[key] = true;
  }

  return layers;
}

// ---------------------------------------------------------------------------
// Format parsing
// ---------------------------------------------------------------------------

function parseFormat(value: string, optionName: string): PaktFormat {
  const mapped = FORMAT_MAP[value.toLowerCase()];
  if (!mapped) {
    const valid = Object.keys(FORMAT_MAP).join(', ');
    throw new Error(`Invalid ${optionName} format: "${value}". Valid formats: ${valid}`);
  }
  return mapped;
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

function cmdCompress(args: ParsedArgs): void {
  const input = readInput(args.file);

  const fromOpt = args.options.get('from');
  const layersOpt = args.options.get('layers');

  const options: Parameters<typeof compress>[1] = {};

  if (fromOpt) {
    options.fromFormat = parseFormat(fromOpt, '--from');
  }

  if (layersOpt) {
    options.layers = parseLayers(layersOpt);
  }

  const result = compress(input, options);

  process.stdout.write(result.compressed);
  if (!result.compressed.endsWith('\n')) {
    process.stdout.write('\n');
  }

  process.stderr.write(
    `Compressed: ${String(result.originalTokens)} tokens \u2192 ${String(result.compressedTokens)} tokens (${String(result.savings.totalPercent)}% savings)\n`,
  );
}

function cmdDecompress(args: ParsedArgs): void {
  const input = readInput(args.file);

  const toOpt = args.options.get('to');
  const outputFormat = toOpt ? parseFormat(toOpt, '--to') : undefined;

  const result = decompress(input, outputFormat);

  process.stdout.write(result.text);
  if (!result.text.endsWith('\n')) {
    process.stdout.write('\n');
  }
}

function cmdDetect(args: ParsedArgs): void {
  const input = readInput(args.file);
  const result = detect(input);

  process.stdout.write(`Format:     ${result.format}\n`);
  process.stdout.write(`Confidence: ${String(Math.round(result.confidence * 100))}%\n`);
  process.stdout.write(`Reason:     ${result.reason}\n`);
}

function cmdTokens(args: ParsedArgs): void {
  const input = readInput(args.file);
  const model = args.options.get('model') ?? 'gpt-4o';
  const tokens = countTokens(input, model);

  process.stdout.write(`${String(tokens)}\n`);
}

function cmdSavings(args: ParsedArgs): void {
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
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  // Handle --version flag (can appear as command or flag)
  if (args.flags.has('version') || args.command === '--version') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  // Handle --help flag or no args
  if (args.flags.has('help') || args.command === '--help' || !args.command) {
    process.stdout.write(HELP);
    return;
  }

  // Route to subcommand
  switch (args.command) {
    case 'compress':
      cmdCompress(args);
      break;
    case 'decompress':
      cmdDecompress(args);
      break;
    case 'detect':
      cmdDetect(args);
      break;
    case 'tokens':
      cmdTokens(args);
      break;
    case 'savings':
      cmdSavings(args);
      break;
    default:
      process.stderr.write(`Unknown command: "${args.command}"\n\n`);
      process.stdout.write(HELP);
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Entry point with error handling
// ---------------------------------------------------------------------------

try {
  main();
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

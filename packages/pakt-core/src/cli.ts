#!/usr/bin/env node

/**
 * PAKT CLI — command-line interface for PAKT compression.
 *
 * Provides shell access to the PAKT compression engine for
 * compressing, decompressing, and analyzing files.
 *
 * Usage:
 *   pakt compress [file] [--from json|yaml|csv|md|text] [--layers 1,2,3,4] [--semantic-budget 120]
 *   pakt decompress [file] [--to json|yaml|csv|md|text]
 *   pakt detect [file]
 *   pakt inspect [file] [--model gpt-4o|claude-sonnet|...] [--semantic-budget 120]
 *   pakt tokens [file] [--model gpt-4o|claude-sonnet|...]
 *   pakt savings [file] [--model gpt-4o|claude-sonnet|...]
 *   pakt stats [file] [--model gpt-4o|...] [--today|--week] [--agent <name>]
 *   pakt serve --stdio [--agent-name <name>]
 *   pakt --version
 *   pakt --help
 */

import { readFileSync } from 'node:fs';
import {
  type ParsedArgs,
  cmdAuto,
  cmdCompress,
  cmdDecompress,
  cmdDetect,
  cmdInspect,
  cmdSavings,
  cmdStats,
  cmdTokens,
} from './cli-commands.js';
import { startServe } from './cli-serve.js';
import { VERSION } from './index.js';
import type { PaktLayers } from './types.js';

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
  pakt auto [file] [options]        Auto-detect and compress or decompress
  pakt serve --stdio [--agent-name <name>]
                                    Start MCP server over stdio
  pakt detect [file]                Detect input format
  pakt inspect [file] [options]     Inspect whether to compress, decompress, or leave as-is
  pakt tokens [file] [options]      Count tokens in input
  pakt savings [file] [options]     Show compression savings report
  pakt stats                        Show persistent stats (all agents, all time)
  pakt stats [file]                 Single-shot stats report for a file
  pakt stats --today|--week         Filter by time range
  pakt stats --agent <name>         Filter by agent name
  pakt stats --active               Only running agents
  pakt stats --compact              Compact old sessions into archive
  pakt stats --reset                Clear all stats
  pakt --version                    Print version
  pakt --help                       Show this help

Options:
  --from <format>    Force input format (json|yaml|csv|md|text)
  --to <format>      Output format for decompress (json|yaml|csv|md|text)
  --layers <list>    Compression layers to enable (comma-separated: 1,2,3,4)
  --semantic-budget <tokens>
                     Enable L4 semantic compression with a positive token budget
  --pii-mode <mode>  PII strategy: off (default) | flag (headers only) | redact (mutates)
  --pii-kinds <list> Restrict scan to comma-separated kinds (email,phone,ipv4,ipv6,jwt,
                     aws-access-key,aws-secret-key,credit-card,ssn)
  --pii-reversible   Emit a placeholder→value mapping when --pii-mode redact
  --model <model>    Model for token counting (gpt-4o|claude-sonnet|claude-opus|claude-haiku|gpt-4o-mini)
  --agent-name <name>
                     Name this agent session (used with serve)

Input:
  If no file argument is given, reads from stdin (pipe mode).

Examples:
  pakt compress data.json
  pakt compress data.json --layers 1,2
  pakt compress data.json --semantic-budget 120
  cat data.json | pakt compress --from json
  pakt decompress compressed.pakt --to json
  pakt detect mystery-file.txt
  pakt inspect data.json --model gpt-4o
  pakt tokens data.json --model claude-sonnet
  pakt savings data.json --model gpt-4o
  cat data.json | pakt auto
  printf '%s\n' '@from json' 'name: Alice' | pakt auto
`;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse `process.argv`-style argument arrays into a structured object.
 *
 * Positional convention: `[subcommand] [file] [--key value | --flag ...]`
 *
 * @param argv - Raw argument strings (typically `process.argv.slice(2)`).
 * @returns Structured parsed arguments.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: simple positional + flag parser, splitting would add indirection without clarity
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
    const first = argv[i];
    if (first && !first.startsWith('--')) {
      result.command = first;
      i++;
    }
  }

  // Second positional arg (if not starting with --) is the file path
  if (i < argv.length) {
    const second = argv[i];
    if (second && !second.startsWith('--')) {
      result.file = second;
      i++;
    }
  }

  // Parse remaining --key value pairs and --flag switches
  while (i < argv.length) {
    const arg = argv[i];
    if (!arg) break;
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

/**
 * Read input from a file path or stdin.
 * Throws if stdin is a TTY and no file is provided.
 *
 * @param file - Optional file path; if omitted reads from stdin fd 0.
 * @returns The file/stdin contents as a UTF-8 string.
 */
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

/**
 * Parse a comma-separated layer string (e.g., "1,2,4") into a partial PaktLayers object.
 * Throws with a descriptive message if any layer number is invalid.
 *
 * @param layerStr - Comma-separated layer numbers from the --layers flag.
 * @returns Partial PaktLayers with the specified layers set to true.
 */
function parseLayers(layerStr: string): Partial<PaktLayers> {
  const layers: PaktLayers = {
    structural: false,
    dictionary: false,
    tokenizerAware: false,
    semantic: false,
  };

  const parts = layerStr.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`Invalid layer number: "${part.trim()}". Expected 1, 2, 3, or 4.`);
    }
    const num = Number.parseInt(trimmed, 10);
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
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
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
      cmdCompress(args, readInput, parseLayers);
      break;
    case 'decompress':
      cmdDecompress(args, readInput);
      break;
    case 'auto':
      cmdAuto(args, readInput, parseLayers);
      break;
    case 'serve':
      await startServe(args.options.get('agent-name'));
      return; // serve keeps the stdio transport open
    case 'detect':
      cmdDetect(args, readInput);
      break;
    case 'inspect':
      cmdInspect(args, readInput);
      break;
    case 'tokens':
      cmdTokens(args, readInput);
      break;
    case 'savings':
      cmdSavings(args, readInput);
      break;
    case 'stats':
      cmdStats(args, readInput);
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

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});

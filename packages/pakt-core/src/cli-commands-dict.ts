/**
 * @module cli-commands-dict
 * CLI plumbing for the dictionary-as-system-prompt feature:
 *
 * - `pakt compress --dict-placement system --dict-out <file>` — the
 *   `@dict` block is written to `<file>` while the dict-free body goes
 *   to stdout.
 * - `pakt decompress --dict <file-or-string>` — merges the external
 *   dictionary back before alias expansion.
 *
 * Split out of `cli-commands.ts` to keep that module under the per-file
 * line cap.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { ParsedArgs } from './cli-commands-shared.js';
import type { DictPlacement, PaktResult } from './types.js';

/**
 * Parse the `--dict-placement` flag. Accepts `inline` or `system`;
 * throws on anything else. When `system` is requested, `--dict-out`
 * must also be provided so the dictionary block is never silently lost.
 *
 * @param args - Parsed CLI arguments
 * @returns The placement, or `undefined` when the flag was omitted
 */
export function parseDictPlacement(args: ParsedArgs): DictPlacement | undefined {
  const value = args.options.get('dict-placement');
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized !== 'inline' && normalized !== 'system') {
    throw new Error(
      `Invalid --dict-placement value: "${value}". Valid placements: inline, system.`,
    );
  }
  if (normalized === 'system' && !args.options.get('dict-out')) {
    throw new Error(
      '--dict-placement system requires --dict-out <file> so the dictionary block is not lost.',
    );
  }
  return normalized;
}

/**
 * Persist the `dictBlock` of a compression result to the `--dict-out`
 * file and note the write on stderr. No-op when the result carries no
 * dict block (e.g. nothing was worth aliasing) or the flag is absent.
 *
 * @param result - Finished compression result
 * @param args - Parsed CLI arguments (`--dict-out` option)
 */
export function writeDictBlock(result: PaktResult, args: ParsedArgs): void {
  const outPath = args.options.get('dict-out');
  if (!outPath) return;
  if (result.dictBlock === undefined) {
    process.stderr.write('No dictionary block emitted — nothing written to --dict-out.\n');
    return;
  }
  writeFileSync(outPath, `${result.dictBlock}\n`, 'utf8');
  process.stderr.write(`Dictionary block written to ${outPath}\n`);
}

/**
 * Resolve the `--dict` argument for decompression: when the value names
 * an existing file it is read as UTF-8, otherwise it is treated as a
 * literal dictionary block string.
 *
 * @param args - Parsed CLI arguments (`--dict` option)
 * @returns The dictionary block contents, or `undefined` when omitted
 */
export function resolveExternalDict(args: ParsedArgs): string | undefined {
  const value = args.options.get('dict');
  if (value === undefined) return undefined;
  if (existsSync(value)) {
    return readFileSync(value, 'utf8');
  }
  return value;
}

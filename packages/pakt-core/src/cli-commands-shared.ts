/**
 * @module cli-commands-shared
 * Shared types, format helpers, and option-parsing primitives for the
 * PAKT CLI subcommand handlers.
 *
 * Split out of `cli-commands.ts` so each handler module can stay focused
 * on its own subcommand and we keep every file under the 400-line cap.
 */

import type { compress } from './index.js';
import type { PIIKind, PIIMode, PaktFormat, PaktOptions } from './types.js';
import { validate } from './utils/validate.js';

// ---------------------------------------------------------------------------
// Parsed CLI args (consumed by every subcommand)
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
// Format helpers
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
 * Resolve a user-supplied format string to a {@link PaktFormat}.
 * Throws with a clear message if the value is unrecognised.
 *
 * @param value - The raw string the user passed (e.g., "json", "md").
 * @param optionName - The flag name to include in the error message (e.g., "--from").
 */
export function parseFormat(value: string, optionName: string): PaktFormat {
  const mapped = FORMAT_MAP[value.toLowerCase()];
  if (!mapped) {
    const valid = Object.keys(FORMAT_MAP).join(', ');
    throw new Error(`Invalid ${optionName} format: "${value}". Valid formats: ${valid}`);
  }
  return mapped;
}

// ---------------------------------------------------------------------------
// Numeric / PII flag parsing
// ---------------------------------------------------------------------------

/** Parse `--semantic-budget` into a positive integer; `undefined` when omitted. */
export function parseSemanticBudget(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;

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
export function parsePIIMode(value: string | undefined): PIIMode | undefined {
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
export function parsePIIKinds(value: string | undefined): PIIKind[] | undefined {
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

// ---------------------------------------------------------------------------
// PAKT input validation
// ---------------------------------------------------------------------------

/**
 * Verify a candidate PAKT string actually validates; surface the first
 * error message in a CLI-friendly form when not.
 */
export function assertValidPaktInput(input: string): void {
  const validation = validate(input);
  if (!validation.valid) {
    const message = validation.errors[0]?.message ?? 'validation failed';
    throw new Error(`Input looks like PAKT but failed validation: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Compression option assembly
// ---------------------------------------------------------------------------

/** Layer parser callback shape used by the compress / auto subcommands. */
type LayerParser = (s: string) => Parameters<typeof compress>[1]['layers'];

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
export function buildCompressionOptions(
  args: ParsedArgs,
  parseLayers?: LayerParser,
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
    options.layers = { ...options.layers, semantic: true };
  }

  if (options.layers?.semantic && semanticBudget === undefined) {
    throw new Error('Layer 4 semantic compression requires --semantic-budget <positive integer>.');
  }

  if (piiMode !== undefined) options.piiMode = piiMode;
  if (piiKinds !== undefined) options.piiKinds = piiKinds;
  if (args.flags.has('pii-reversible')) options.piiReversible = true;

  return options;
}

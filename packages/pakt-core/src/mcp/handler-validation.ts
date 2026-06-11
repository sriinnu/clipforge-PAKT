/**
 * @module mcp/handler-validation
 * Input validation, PII helpers, and shared option-building used across all
 * PAKT MCP tool handlers.
 *
 * Split out of `handler.ts` to keep each handler module under the 400-line
 * cap. The `PaktToolInputError` class lives here as the single throw site
 * for user-fixable input problems.
 */

import { PAKT_FORMAT_VALUES, isPaktFormat } from '../formats.js';
import type {
  CacheTarget,
  DictPlacement,
  PIIKind,
  PIIMode,
  PaktFormat,
  PaktOptions,
  PaktResult,
} from '../types.js';
import type { validate } from '../utils/validate.js';
import { CACHE_TARGET_VALUES, DICT_PLACEMENT_VALUES } from './contract-builder.js';

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/** Error raised for user-fixable tool input problems. */
export class PaktToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaktToolInputError';
  }
}

// ---------------------------------------------------------------------------
// Primitive validators
// ---------------------------------------------------------------------------

/**
 * Assert that a value is a non-empty string.
 * @throws {@link PaktToolInputError} if the value isn't a non-empty string.
 */
export function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PaktToolInputError(`${name} must be a non-empty string`);
  }
}

/**
 * Validate and narrow an optional `format` argument to {@link PaktFormat}.
 * Returns `undefined` when omitted.
 */
export function validateFormat(value: unknown): PaktFormat | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new PaktToolInputError(`format must be a string, got ${typeof value}`);
  }
  if (!isPaktFormat(value)) {
    const valid = PAKT_FORMAT_VALUES.join(', ');
    throw new PaktToolInputError(`Invalid format "${value}". Valid formats: ${valid}`);
  }
  return value;
}

/**
 * Validate the optional `semanticBudget` argument (positive integer).
 * Returns `undefined` when omitted.
 */
export function validateSemanticBudget(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new PaktToolInputError('semanticBudget must be a positive integer');
  }
  return value;
}

/**
 * Validate the optional `dictPlacement` argument (`inline` | `system`).
 * Returns `undefined` when omitted; throws on unknown values.
 */
export function validateDictPlacement(value: unknown): DictPlacement | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !DICT_PLACEMENT_VALUES.includes(value as DictPlacement)) {
    throw new PaktToolInputError(
      `dictPlacement must be one of: ${DICT_PLACEMENT_VALUES.join(', ')}`,
    );
  }
  return value as DictPlacement;
}

/**
 * Validate the optional `cacheTarget` argument (provider id for
 * cache_control breakpoint hints). Returns `undefined` when omitted;
 * throws on unknown providers.
 */
export function validateCacheTarget(value: unknown): CacheTarget | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !CACHE_TARGET_VALUES.includes(value as CacheTarget)) {
    throw new PaktToolInputError(`cacheTarget must be one of: ${CACHE_TARGET_VALUES.join(', ')}`);
  }
  return value as CacheTarget;
}

// ---------------------------------------------------------------------------
// PII validators
// ---------------------------------------------------------------------------

const MCP_VALID_PII_MODES: readonly PIIMode[] = ['off', 'flag', 'redact'];
const MCP_VALID_PII_KINDS: readonly PIIKind[] = [
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
 * Validate the optional `piiMode` argument from an MCP tool call.
 * Returns `undefined` when omitted; throws on unknown modes.
 */
export function validatePIIMode(value: unknown): PIIMode | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !MCP_VALID_PII_MODES.includes(value as PIIMode)) {
    throw new PaktToolInputError(`piiMode must be one of: ${MCP_VALID_PII_MODES.join(', ')}`);
  }
  return value as PIIMode;
}

/**
 * Validate the optional `piiKinds` argument (comma-separated string) and
 * turn it into an array of kinds. Throws if any entry is unknown so a
 * typo doesn't silently widen the scan.
 */
export function validatePIIKinds(value: unknown): PIIKind[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new PaktToolInputError('piiKinds must be a comma-separated string');
  }
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return undefined;
  for (const p of parts) {
    if (!MCP_VALID_PII_KINDS.includes(p as PIIKind)) {
      throw new PaktToolInputError(
        `piiKinds entry "${p}" is invalid. Valid: ${MCP_VALID_PII_KINDS.join(', ')}`,
      );
    }
  }
  return parts as PIIKind[];
}

/**
 * Pull the first error/warning message off a {@link validate} result for use
 * in user-facing error strings. Falls back to a caller-provided string.
 */
export function summarizeValidationFailure(
  validation: ReturnType<typeof validate>,
  fallback = 'validation failed',
): string {
  const primaryError = validation.errors[0]?.message;
  if (primaryError) return primaryError;
  const primaryWarning = validation.warnings[0]?.message;
  if (primaryWarning) return primaryWarning;
  return fallback;
}

// ---------------------------------------------------------------------------
// Option building / PII extraction
// ---------------------------------------------------------------------------

/** PII-related inputs already validated from an MCP tool call. */
export interface PIIInputs {
  mode: PIIMode | undefined;
  kinds: PIIKind[] | undefined;
  reversible: boolean | undefined;
}

/**
 * Build shared compression options for MCP tool handlers.
 *
 * @param format - Optional format hint (skipped when `'pakt'`)
 * @param semanticBudget - Optional positive L4 budget
 * @param pii - Optional PII inputs (already validated)
 * @returns {@link PaktOptions} subset to pass into the core engine
 */
export function buildCompressionOptions(
  format: PaktFormat | undefined,
  semanticBudget: number | undefined,
  pii?: PIIInputs,
): Partial<PaktOptions> {
  const options: Partial<PaktOptions> = {};

  if (format && format !== 'pakt') {
    options.fromFormat = format;
  }

  if (semanticBudget !== undefined) {
    options.semanticBudget = semanticBudget;
    options.layers = { semantic: true };
  }

  if (pii?.mode !== undefined) options.piiMode = pii.mode;
  if (pii?.kinds !== undefined) options.piiKinds = pii.kinds;
  if (pii?.reversible === true) options.piiReversible = true;

  return options;
}

/**
 * Extract PII metadata (`piiCounts`, `piiMapping`) from a completed
 * {@link PaktResult} as contract-shaped JSON strings. Returns an empty
 * object when the compress call didn't touch PII so callers can spread
 * the result without conditional bookkeeping.
 */
export function extractPIIFields(result: PaktResult): {
  piiCounts?: string;
  piiMapping?: string;
} {
  const out: { piiCounts?: string; piiMapping?: string } = {};
  if (result.piiCounts && Object.keys(result.piiCounts).length > 0) {
    out.piiCounts = JSON.stringify(result.piiCounts);
  }
  if (result.piiMapping && Object.keys(result.piiMapping).length > 0) {
    out.piiMapping = JSON.stringify(result.piiMapping);
  }
  return out;
}

/**
 * Pull and validate PII inputs from a raw MCP tool args object.
 * Centralizes the cast + validation so each handler has one call.
 */
export function extractPIIInputs(args: Record<string, unknown>): PIIInputs {
  return {
    mode: validatePIIMode(args.piiMode),
    kinds: validatePIIKinds(args.piiKinds),
    reversible: args.piiReversible === true,
  };
}

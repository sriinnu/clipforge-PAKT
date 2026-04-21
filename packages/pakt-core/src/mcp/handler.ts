/**
 * @module mcp/handler
 * MCP tool handler for PAKT compression tools.
 *
 * Provides {@link handlePaktTool}, the main dispatch function that routes
 * incoming MCP tool calls to the appropriate pakt-core functions. This
 * handler validates arguments, calls the compression/decompression pipeline,
 * and returns strongly-typed results.
 *
 * @example
 * ```ts
 * import { handlePaktTool } from '@sriinnu/pakt';
 *
 * // Handle a pakt_compress call
 * const result = handlePaktTool('pakt_compress', {
 *   text: '{"users": [{"name": "Alice"}]}',
 *   format: 'json',
 * });
 * console.log(result.compressed); // PAKT output
 * console.log(result.savings);    // e.g. 35
 * ```
 */

import { createHash } from 'node:crypto';
import { compress } from '../compress.js';
import { decompress } from '../decompress.js';
import { detect } from '../detect.js';
import { PAKT_FORMAT_VALUES, isPaktFormat } from '../formats.js';
import { compressMixed } from '../mixed/index.js';
import { readAllRecords } from '../stats/persister.js';
import { countTokens } from '../tokens/index.js';
import type { PIIKind, PIIMode, PaktFormat, PaktOptions, PaktResult } from '../types.js';
import { validate } from '../utils/validate.js';
import { dedupCache } from './dedup-cache.js';
import { SessionStats, type SessionStatsResult, getSessionStats } from './session-stats.js';
import type {
  PaktAutoArgs,
  PaktAutoResult,
  PaktCompressArgs,
  PaktCompressResult,
  PaktInspectArgs,
  PaktInspectResult,
  PaktStatsArgs,
  PaktStatsResult,
  PaktToolName,
  PaktToolResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Error raised for user-fixable tool input problems. */
export class PaktToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaktToolInputError';
  }
}

/**
 * Validate that a value is a non-empty string.
 * @param value - The value to check
 * @param name - Parameter name for error messages
 * @throws Error if value is not a non-empty string
 */
function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PaktToolInputError(`${name} must be a non-empty string`);
  }
}

/**
 * Validate and narrow a format string to PaktFormat.
 * @param value - The format string to validate
 * @returns The validated PaktFormat, or undefined if not provided
 * @throws Error if value is provided but not a valid format
 */
function validateFormat(value: unknown): PaktFormat | undefined {
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
 * Validate and narrow an optional semantic token budget.
 * @param value - Untrusted input value
 * @returns Positive integer budget, or undefined when not provided
 * @throws Error if value is present but invalid
 */
function validateSemanticBudget(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new PaktToolInputError('semanticBudget must be a positive integer');
  }
  return value;
}

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
function validatePIIMode(value: unknown): PIIMode | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !MCP_VALID_PII_MODES.includes(value as PIIMode)) {
    throw new PaktToolInputError(
      `piiMode must be one of: ${MCP_VALID_PII_MODES.join(', ')}`,
    );
  }
  return value as PIIMode;
}

/**
 * Validate the optional `piiKinds` argument (comma-separated string) and
 * turn it into an array of kinds. Throws if any entry is unknown so a
 * typo doesn't silently widen the scan.
 */
function validatePIIKinds(value: unknown): PIIKind[] | undefined {
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

function summarizeValidationFailure(
  validation: ReturnType<typeof validate>,
  fallback = 'validation failed',
): string {
  const primaryError = validation.errors[0]?.message;
  if (primaryError) {
    return primaryError;
  }
  const primaryWarning = validation.warnings[0]?.message;
  if (primaryWarning) {
    return primaryWarning;
  }
  return fallback;
}

/** PII-related inputs already validated from an MCP tool call. */
interface PIIInputs {
  mode: PIIMode | undefined;
  kinds: PIIKind[] | undefined;
  reversible: boolean | undefined;
}

/**
 * Build shared compression options for MCP tool handlers.
 * @param format - Optional format hint
 * @param semanticBudget - Optional positive L4 budget
 * @param pii - Optional PII inputs (already validated by the caller)
 * @returns Compression options passed into the core engine
 */
function buildCompressionOptions(
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
 * object when the compress call didn't touch PII, so callers can spread
 * the result into their response without conditional bookkeeping.
 */
function extractPIIFields(
  result: PaktResult,
): { piiCounts?: string; piiMapping?: string } {
  const out: { piiCounts?: string; piiMapping?: string } = {};
  if (result.piiCounts && Object.keys(result.piiCounts).length > 0) {
    out.piiCounts = JSON.stringify(result.piiCounts);
  }
  if (result.piiMapping && Object.keys(result.piiMapping).length > 0) {
    out.piiMapping = JSON.stringify(result.piiMapping);
  }
  return out;
}

function toCompressResult(
  compressed: string,
  savings: number,
  format: PaktFormat,
  originalTokens: number,
  compressedTokens: number,
  reversible: boolean,
  piiFields: { piiCounts?: string; piiMapping?: string } = {},
): PaktCompressResult {
  const base: PaktCompressResult = {
    compressed,
    savings,
    format,
    originalTokens,
    compressedTokens,
    savedTokens: originalTokens - compressedTokens,
    reversible,
  };
  if (piiFields.piiCounts !== undefined) base.piiCounts = piiFields.piiCounts;
  if (piiFields.piiMapping !== undefined) base.piiMapping = piiFields.piiMapping;
  return base;
}

function inspectPassthroughPakt(
  text: string,
): Pick<PaktCompressResult, 'originalTokens' | 'compressedTokens' | 'savedTokens' | 'reversible'> {
  const validation = validate(text);
  if (!validation.valid) {
    throw new PaktToolInputError(
      `Input looks like PAKT but failed validation: ${summarizeValidationFailure(validation)}`,
    );
  }

  const tokens = countTokens(text);
  const reversible = !decompress(text).wasLossy;
  return {
    originalTokens: tokens,
    compressedTokens: tokens,
    savedTokens: 0,
    reversible,
  };
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

/**
 * Handle a `pakt_compress` tool call.
 */
/** Maximum input size for explicit compression (1MB). */
const MAX_COMPRESS_INPUT_SIZE = 1024 * 1024;

function handleCompress(args: PaktCompressArgs): PaktCompressResult {
  assertNonEmptyString(args.text, 'text');
  if (args.text.length > MAX_COMPRESS_INPUT_SIZE) {
    throw new PaktToolInputError(
      `Input exceeds maximum size of ${MAX_COMPRESS_INPUT_SIZE} bytes. Consider splitting large payloads.`,
    );
  }
  const format = validateFormat(args.format);
  const semanticBudget = validateSemanticBudget(args.semanticBudget);
  const piiInputs: PIIInputs = {
    mode: validatePIIMode((args as { piiMode?: unknown }).piiMode),
    kinds: validatePIIKinds((args as { piiKinds?: unknown }).piiKinds),
    reversible: (args as { piiReversible?: unknown }).piiReversible === true,
  };
  const options = buildCompressionOptions(format, semanticBudget, piiInputs);

  if (format) {
    if (format === 'pakt') {
      const passthrough = inspectPassthroughPakt(args.text);
      return {
        compressed: args.text,
        savings: 0,
        format: 'pakt',
        ...passthrough,
      };
    }

    const result = compress(args.text, options);
    return toCompressResult(
      result.compressed,
      result.savings.totalPercent,
      result.detectedFormat,
      result.originalTokens,
      result.compressedTokens,
      result.reversible,
      extractPIIFields(result),
    );
  }

  const detected = detect(args.text);

  if (detected.format === 'pakt') {
    const passthrough = inspectPassthroughPakt(args.text);
    return {
      compressed: args.text,
      savings: 0,
      format: 'pakt',
      ...passthrough,
    };
  }

  if (detected.format === 'json' || detected.format === 'yaml' || detected.format === 'csv') {
    const result = compress(args.text, {
      ...options,
      fromFormat: detected.format,
    });
    return toCompressResult(
      result.compressed,
      result.savings.totalPercent,
      result.detectedFormat,
      result.originalTokens,
      result.compressedTokens,
      result.reversible,
      extractPIIFields(result),
    );
  }

  /* mixed-content path: compressMixed wraps compress() internally, so
     PII options threaded through `options` reach the inner pipeline and
     any counts/mapping show up on the mixed result. */
  const mixedResult = compressMixed(args.text, options);
  return toCompressResult(
    mixedResult.compressed,
    mixedResult.savings.totalPercent,
    detected.format,
    mixedResult.originalTokens,
    mixedResult.compressedTokens,
    mixedResult.reversible,
    extractPIIFields(mixedResult as unknown as PaktResult),
  );
}

/** Minimum input tokens to attempt compression. Below this, overhead exceeds savings. */
const MIN_COMPRESSION_THRESHOLD = 50;

/** Maximum input size in bytes. Larger inputs skip compression to avoid CPU DoS. */
const MAX_AUTO_INPUT_SIZE = 512 * 1024;

/** Metadata stored alongside dedup cache entries for stats reporting. */
interface DedupMeta {
  savedTokens: number;
  inputTokens: number;
  outputTokens: number;
  format: string;
  reversible: boolean;
  savingsPercent: number;
}

/** Maps content hash → compression metadata for dedup cache hits. Capped at 500 entries. */
const dedupMetadata = new Map<string, DedupMeta>();
const METADATA_CAP = 500;

/** Evict oldest metadata entries when over cap. */
function trimMetadata(): void {
  while (dedupMetadata.size > METADATA_CAP) {
    const oldest = dedupMetadata.keys().next().value;
    if (oldest === undefined) break;
    dedupMetadata.delete(oldest);
  }
}

/**
 * Handle a `pakt_auto` tool call.
 *
 * Every call increments the turn counter for compounding savings tracking.
 * Compression path: threshold check → dedup cache → pipeline → cache store.
 */
function handleAuto(args: PaktAutoArgs): PaktAutoResult {
  assertNonEmptyString(args.text, 'text');
  const semanticBudget = validateSemanticBudget(args.semanticBudget);
  const piiInputs: PIIInputs = {
    mode: validatePIIMode((args as { piiMode?: unknown }).piiMode),
    kinds: validatePIIKinds((args as { piiKinds?: unknown }).piiKinds),
    reversible: (args as { piiReversible?: unknown }).piiReversible === true,
  };

  const detected = detect(args.text);

  // --- Decompression path (unchanged) ---
  if (detected.format === 'pakt') {
    const validation = validate(args.text);
    if (!validation.valid) {
      throw new PaktToolInputError(
        `Input looks like PAKT but failed validation: ${summarizeValidationFailure(validation)}`,
      );
    }

    const result = decompress(args.text);
    const decompInputTokens = countTokens(args.text);
    const decompOutputTokens = countTokens(result.text);
    return {
      result: result.text,
      action: 'decompressed',
      detectedFormat: 'pakt',
      originalFormat: result.originalFormat,
      reversible: !result.wasLossy,
      wasLossy: result.wasLossy,
      inputTokens: decompInputTokens,
      outputTokens: decompOutputTokens,
      savedTokens: decompInputTokens - decompOutputTokens,
    };
  }

  // --- Compression path ---

  // Size cap: skip very large inputs to prevent CPU DoS from sliding window
  if (args.text.length > MAX_AUTO_INPUT_SIZE) {
    const inputTokens = countTokens(args.text);
    return {
      result: args.text,
      action: 'compressed',
      savings: 0,
      detectedFormat: detected.format,
      inputTokens,
      outputTokens: inputTokens,
      savedTokens: 0,
      reversible: true,
      belowThreshold: true,
    };
  }

  // Threshold: skip tiny inputs where overhead exceeds savings
  const inputTokens = countTokens(args.text);
  if (inputTokens < MIN_COMPRESSION_THRESHOLD) {
    return {
      result: args.text,
      action: 'compressed',
      savings: 0,
      detectedFormat: detected.format,
      inputTokens,
      outputTokens: inputTokens,
      savedTokens: 0,
      reversible: true,
      belowThreshold: true,
    };
  }

  // Dedup: return cached result if we've seen this exact input before.
  // Skip the cache entirely when PII options are active — cached results
  // wouldn't carry the requested counts/mapping, so we always re-scan.
  const hash = createHash('sha256').update(args.text).digest('hex');
  const piiActive = piiInputs.mode !== undefined && piiInputs.mode !== 'off';
  if (!piiActive) {
    const cachedCompressed = dedupCache.get(hash);
    const cachedMeta = dedupMetadata.get(hash);
    if (cachedCompressed && cachedMeta) {
      return {
        result: cachedCompressed,
        action: 'compressed',
        savings: cachedMeta.savingsPercent,
        detectedFormat: cachedMeta.format as PaktFormat,
        inputTokens: cachedMeta.inputTokens,
        outputTokens: cachedMeta.outputTokens,
        savedTokens: cachedMeta.savedTokens,
        reversible: cachedMeta.reversible,
        dedupHit: true,
      };
    }
  }

  // Run the compression pipeline.
  // When PII is active on mixed content, route through compress() — it
  // scans the full document via the post-pass, whereas compressMixed
  // only compresses embedded structured blocks and would leave prose
  // PII untouched.
  const compressionOptions = buildCompressionOptions(undefined, semanticBudget, piiInputs);
  const isStructured =
    detected.format === 'json' || detected.format === 'yaml' || detected.format === 'csv';
  const compressResult =
    isStructured || piiActive
      ? compress(args.text, { ...compressionOptions, fromFormat: detected.format })
      : compressMixed(args.text, compressionOptions);

  const savedTokens = compressResult.originalTokens - compressResult.compressedTokens;

  /* Dedup cache key is the input hash; when PII options differ across
     calls for the same input the cached entry would be stale. Skip the
     cache whenever PII is active so mode changes always re-scan. */
  const skipDedup = piiInputs.mode !== undefined && piiInputs.mode !== 'off';
  if (!skipDedup) {
    dedupCache.set(hash, compressResult.compressed);
    dedupMetadata.set(hash, {
      savedTokens,
      inputTokens: compressResult.originalTokens,
      outputTokens: compressResult.compressedTokens,
      format: detected.format,
      reversible: compressResult.reversible,
      savingsPercent: compressResult.savings.totalPercent,
    });
    trimMetadata();
  }

  const piiFields = extractPIIFields(compressResult as unknown as PaktResult);
  const autoResult: PaktAutoResult = {
    result: compressResult.compressed,
    action: 'compressed',
    savings: compressResult.savings.totalPercent,
    detectedFormat: detected.format,
    inputTokens: compressResult.originalTokens,
    outputTokens: compressResult.compressedTokens,
    savedTokens,
    reversible: compressResult.reversible,
  };
  if (piiFields.piiCounts !== undefined) autoResult.piiCounts = piiFields.piiCounts;
  if (piiFields.piiMapping !== undefined) autoResult.piiMapping = piiFields.piiMapping;
  return autoResult;
}

/**
 * Handle a `pakt_inspect` tool call.
 */
function handleInspect(args: PaktInspectArgs): PaktInspectResult {
  assertNonEmptyString(args.text, 'text');
  const semanticBudget = validateSemanticBudget(args.semanticBudget);
  const model = typeof args.model === 'string' && args.model.length > 0 ? args.model : 'gpt-4o';
  const detected = detect(args.text);
  const inputTokens = countTokens(args.text, model);

  if (detected.format === 'pakt') {
    const validation = validate(args.text);
    if (!validation.valid) {
      return {
        detectedFormat: 'pakt',
        confidence: detected.confidence,
        reason: `${detected.reason}; invalid PAKT: ${summarizeValidationFailure(validation)}`,
        inputTokens,
        recommendedAction: 'leave-as-is',
        reversible: false,
      };
    }

    const result = decompress(args.text);
    return {
      detectedFormat: 'pakt',
      confidence: detected.confidence,
      reason: detected.reason,
      inputTokens,
      recommendedAction: 'decompress',
      reversible: !result.wasLossy,
      originalFormat: result.originalFormat,
      wasLossy: result.wasLossy,
    };
  }

  const compressionOptions = buildCompressionOptions(undefined, semanticBudget);
  const estimate =
    detected.format === 'json' || detected.format === 'yaml' || detected.format === 'csv'
      ? compress(args.text, {
          ...compressionOptions,
          fromFormat: detected.format,
        })
      : compressMixed(args.text, compressionOptions);
  const estimatedOutputTokens = countTokens(estimate.compressed, model);
  const estimatedSavedTokens = inputTokens - estimatedOutputTokens;
  const estimatedSavings =
    inputTokens > 0 ? Math.round((estimatedSavedTokens / inputTokens) * 100) : 0;

  return {
    detectedFormat: detected.format,
    confidence: detected.confidence,
    reason: detected.reason,
    inputTokens,
    recommendedAction: estimatedSavedTokens > 0 ? 'compress' : 'leave-as-is',
    estimatedOutputTokens,
    estimatedSavings,
    estimatedSavedTokens,
    reversible: estimate.reversible,
  };
}

// ---------------------------------------------------------------------------
// Stats handler
// ---------------------------------------------------------------------------

/**
 * Return session-level compression statistics.
 *
 * Nested objects (callsByAction, byFormat, topFormat, estimatedCostSaved)
 * are serialized as JSON strings to conform to the flat contract schema.
 *
 * When `scope` is `'all'`, reads persistent stats from disk (all agents).
 * Default scope is `'session'` (fast, in-memory only).
 */
function handleStats(args: PaktStatsArgs): PaktStatsResult {
  const model = typeof args.model === 'string' && args.model.length > 0 ? args.model : 'gpt-4o';
  const scope = args.scope === 'all' ? 'all' : 'session';

  let raw: SessionStatsResult;
  if (scope === 'all') {
    // Read all persistent records and aggregate
    const records = readAllRecords();
    const tempStats = new SessionStats();
    for (const record of records) {
      tempStats.record(record);
    }
    raw = tempStats.getStats(model);
  } else {
    raw = getSessionStats(model);
  }

  return {
    sessionDuration: raw.sessionDuration,
    totalCalls: raw.totalCalls,
    totalInputTokens: raw.totalInputTokens,
    totalOutputTokens: raw.totalOutputTokens,
    totalSavedTokens: raw.totalSavedTokens,
    overallSavingsPercent: raw.overallSavingsPercent,
    callsByAction: JSON.stringify(raw.callsByAction),
    byFormat: JSON.stringify(raw.byFormat),
    topFormat: raw.topFormat ? JSON.stringify(raw.topFormat) : undefined,
    estimatedCostSaved: raw.estimatedCostSaved ? JSON.stringify(raw.estimatedCostSaved) : undefined,
    lastCallAt: raw.lastCallAt ?? undefined,
    // Dedup and compounding (session scope only — disk reads don't have cache data)
    ...(scope === 'session'
      ? (() => {
          const ds = dedupCache.getStats();
          return {
            dedupHits: ds.totalHits,
            dedupEntries: ds.size,
            totalCompoundingSavings: dedupCache.totalCompoundingSavings(),
          };
        })()
      : {}),
  } as PaktStatsResult;
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatch an MCP tool call to the appropriate PAKT handler.
 */
export function handlePaktTool(name: PaktToolName, args: Record<string, unknown>): PaktToolResult {
  switch (name) {
    case 'pakt_compress':
      return handleCompress(args as unknown as PaktCompressArgs);
    case 'pakt_auto':
      return handleAuto(args as unknown as PaktAutoArgs);
    case 'pakt_inspect':
      return handleInspect(args as unknown as PaktInspectArgs);
    case 'pakt_stats':
      return handleStats(args as unknown as PaktStatsArgs);
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown PAKT MCP tool: "${String(_exhaustive)}"`);
    }
  }
}

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

import { compress } from '../compress.js';
import { decompress } from '../decompress.js';
import { detect } from '../detect.js';
import { compressMixed } from '../mixed/index.js';
import { countTokens } from '../tokens/index.js';
import type { PaktFormat, PaktOptions } from '../types.js';
import { validate } from '../utils/validate.js';
import type {
  PaktAutoArgs,
  PaktAutoResult,
  PaktCompressArgs,
  PaktCompressResult,
  PaktInspectArgs,
  PaktInspectResult,
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
 * Valid format values for the `format` parameter.
 * Includes 'pakt' so that callers explicitly passing format:'pakt' get a
 * passthrough result rather than a misleading "Invalid format" error.
 */
const VALID_FORMATS = new Set<PaktFormat>(['json', 'yaml', 'csv', 'markdown', 'text', 'pakt']);

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
  if (!VALID_FORMATS.has(value as PaktFormat)) {
    const valid = Array.from(VALID_FORMATS).join(', ');
    throw new PaktToolInputError(`Invalid format "${value}". Valid formats: ${valid}`);
  }
  return value as PaktFormat;
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

/**
 * Build shared compression options for MCP tool handlers.
 * @param format - Optional format hint
 * @param semanticBudget - Optional positive L4 budget
 * @returns Compression options passed into the core engine
 */
function buildCompressionOptions(
  format: PaktFormat | undefined,
  semanticBudget: number | undefined,
): Partial<PaktOptions> {
  const options: Partial<PaktOptions> = {};

  if (format && format !== 'pakt') {
    options.fromFormat = format;
  }

  if (semanticBudget !== undefined) {
    options.semanticBudget = semanticBudget;
    options.layers = { semantic: true };
  }

  return options;
}

function toCompressResult(
  compressed: string,
  savings: number,
  format: PaktFormat,
  originalTokens: number,
  compressedTokens: number,
  reversible: boolean,
): PaktCompressResult {
  return {
    compressed,
    savings,
    format,
    originalTokens,
    compressedTokens,
    savedTokens: originalTokens - compressedTokens,
    reversible,
  };
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
function handleCompress(args: PaktCompressArgs): PaktCompressResult {
  assertNonEmptyString(args.text, 'text');
  const format = validateFormat(args.format);
  const semanticBudget = validateSemanticBudget(args.semanticBudget);
  const options = buildCompressionOptions(format, semanticBudget);

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
    );
  }

  const mixedResult = compressMixed(args.text, options);
  return toCompressResult(
    mixedResult.compressed,
    mixedResult.savings.totalPercent,
    detected.format,
    mixedResult.originalTokens,
    mixedResult.compressedTokens,
    mixedResult.reversible,
  );
}

/**
 * Handle a `pakt_auto` tool call.
 */
function handleAuto(args: PaktAutoArgs): PaktAutoResult {
  assertNonEmptyString(args.text, 'text');
  const semanticBudget = validateSemanticBudget(args.semanticBudget);

  const detected = detect(args.text);

  if (detected.format === 'pakt') {
    const validation = validate(args.text);
    if (!validation.valid) {
      throw new PaktToolInputError(
        `Input looks like PAKT but failed validation: ${summarizeValidationFailure(validation)}`,
      );
    }

    const result = decompress(args.text);
    return {
      result: result.text,
      action: 'decompressed',
      detectedFormat: 'pakt',
      originalFormat: result.originalFormat,
      reversible: !result.wasLossy,
      wasLossy: result.wasLossy,
    };
  }

  const compressionOptions = buildCompressionOptions(undefined, semanticBudget);
  const compressResult =
    detected.format === 'json' || detected.format === 'yaml' || detected.format === 'csv'
      ? compress(args.text, {
          ...compressionOptions,
          fromFormat: detected.format,
        })
      : compressMixed(args.text, compressionOptions);
  return {
    result: compressResult.compressed,
    action: 'compressed',
    savings: compressResult.savings.totalPercent,
    detectedFormat: detected.format,
    inputTokens: compressResult.originalTokens,
    outputTokens: compressResult.compressedTokens,
    savedTokens: compressResult.originalTokens - compressResult.compressedTokens,
    reversible: compressResult.reversible,
  };
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
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown PAKT MCP tool: "${String(_exhaustive)}"`);
    }
  }
}

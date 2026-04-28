/**
 * @module mcp/handler-compress
 * Implementation of the `pakt_compress` MCP tool.
 *
 * Split out of `handler.ts` to keep the module under the 400-line cap.
 * Owns the explicit-compression code path: validates input, optionally
 * routes to mixed/structured pipelines based on the detected format, and
 * shapes the result into the contract response.
 */

import { compress } from '../compress.js';
import { decompress } from '../decompress.js';
import { detect } from '../detect.js';
import { compressMixed } from '../mixed/index.js';
import { countTokens } from '../tokens/index.js';
import type { PaktFormat, PaktResult } from '../types.js';
import { validate } from '../utils/validate.js';
import {
  PaktToolInputError,
  assertNonEmptyString,
  buildCompressionOptions,
  extractPIIFields,
  extractPIIInputs,
  summarizeValidationFailure,
  validateFormat,
  validateSemanticBudget,
} from './handler-validation.js';
import type { PaktCompressArgs, PaktCompressResult } from './types.js';

/** Maximum input size for explicit compression (1MB). */
const MAX_COMPRESS_INPUT_SIZE = 1024 * 1024;

/**
 * Shape a successful compression run into the {@link PaktCompressResult}
 * contract. PII fields are spread on only when present.
 */
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

/**
 * For inputs already in PAKT format: validate, count tokens, and report
 * reversibility without re-compressing. Throws {@link PaktToolInputError}
 * when the PAKT payload fails validation.
 */
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

/**
 * Build a PAKT-passthrough compress result. Used when the caller-declared
 * (or detected) format is `pakt` — we don't recompress, just verify.
 */
function paktPassthroughResult(text: string): PaktCompressResult {
  return {
    compressed: text,
    savings: 0,
    format: 'pakt',
    ...inspectPassthroughPakt(text),
  };
}

/**
 * Handle a `pakt_compress` tool call.
 *
 * Routing:
 *  - explicit `format`: trust it (PAKT → passthrough, others → core compress)
 *  - no format: detect, then PAKT → passthrough; structured → core compress;
 *    everything else → mixed-content pipeline
 *
 * @throws {@link PaktToolInputError} for validation failures
 */
export function handleCompress(args: PaktCompressArgs): PaktCompressResult {
  assertNonEmptyString(args.text, 'text');
  if (args.text.length > MAX_COMPRESS_INPUT_SIZE) {
    throw new PaktToolInputError(
      `Input exceeds maximum size of ${MAX_COMPRESS_INPUT_SIZE} bytes. Consider splitting large payloads.`,
    );
  }

  const format = validateFormat(args.format);
  const semanticBudget = validateSemanticBudget(args.semanticBudget);
  const piiInputs = extractPIIInputs(args as unknown as Record<string, unknown>);
  const options = buildCompressionOptions(format, semanticBudget, piiInputs);

  // --- explicit format path ---
  if (format) {
    if (format === 'pakt') return paktPassthroughResult(args.text);

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

  // --- detect-and-route path ---
  const detected = detect(args.text);
  if (detected.format === 'pakt') return paktPassthroughResult(args.text);

  if (detected.format === 'json' || detected.format === 'yaml' || detected.format === 'csv') {
    const result = compress(args.text, { ...options, fromFormat: detected.format });
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

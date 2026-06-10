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
import type { PaktFormat, PaktOptions, PaktResult } from '../types.js';
import { validate } from '../utils/validate.js';
import {
  PaktToolInputError,
  assertNonEmptyString,
  buildCompressionOptions,
  extractPIIFields,
  extractPIIInputs,
  summarizeValidationFailure,
  validateCacheTarget,
  validateDictPlacement,
  validateFormat,
  validateSemanticBudget,
} from './handler-validation.js';
import { rollingDict } from './rolling-dict.js';
import type { PaktCompressArgs, PaktCompressResult } from './types.js';

/** Maximum input size for explicit compression (1MB). */
const MAX_COMPRESS_INPUT_SIZE = 1024 * 1024;

/** Optional contract fields spread onto a compress result when present. */
interface CompressResultExtras {
  piiCounts?: string;
  piiMapping?: string;
  dictBlock?: string;
  cacheByteOffset?: number;
}

/**
 * Shape a successful compression run into the {@link PaktCompressResult}
 * contract. Optional fields (PII, dictBlock, cacheByteOffset) are spread
 * on only when present.
 */
function toCompressResult(
  compressed: string,
  savings: number,
  format: PaktFormat,
  originalTokens: number,
  compressedTokens: number,
  reversible: boolean,
  extras: CompressResultExtras = {},
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
  if (extras.piiCounts !== undefined) base.piiCounts = extras.piiCounts;
  if (extras.piiMapping !== undefined) base.piiMapping = extras.piiMapping;
  if (extras.dictBlock !== undefined) base.dictBlock = extras.dictBlock;
  if (extras.cacheByteOffset !== undefined) base.cacheByteOffset = extras.cacheByteOffset;
  return base;
}

/**
 * Collect the optional contract fields from a finished {@link PaktResult}:
 * PII metadata plus the cache-synergy extras (dictBlock from
 * `dictPlacement: 'system'`, cacheByteOffset from `cacheTarget`).
 */
function extractResultExtras(result: PaktResult): CompressResultExtras {
  const extras: CompressResultExtras = { ...extractPIIFields(result) };
  if (result.dictBlock !== undefined) extras.dictBlock = result.dictBlock;
  if (result.cacheBreakpoint) extras.cacheByteOffset = result.cacheBreakpoint.byteOffset;
  return extras;
}

/**
 * Run `compress()` on a structured payload (JSON/YAML/CSV) with optional
 * per-session rolling-dictionary seeding.
 *
 * When `useRolling` is true, expansions discovered in prior turns are
 * seeded into L2 (pinning them to their existing `$a`, `$b`, ... slots in
 * deterministic append-only order — see `RollingDictionary.seed`) and the
 * newly discovered entries are merged back afterwards. This keeps the
 * `@dict` prefix byte-stable across MCP calls, which is the precondition
 * for provider prompt-cache hits.
 */
function compressStructured(
  text: string,
  options: Partial<PaktOptions>,
  fromFormat: PaktFormat,
  useRolling: boolean,
): PaktResult {
  const seededExpansions = useRolling ? rollingDict.seed() : undefined;
  const result = compress(text, {
    ...options,
    fromFormat,
    ...(seededExpansions ? { seedAliases: seededExpansions } : {}),
  });
  if (seededExpansions) {
    rollingDict.update(result.dictionary, seededExpansions);
  }
  return result;
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
 * Structured inputs participate in the per-session rolling dictionary by
 * default (same process-level singleton `pakt_auto` uses), so the `@dict`
 * prefix stays byte-stable across turns. Opt out with `statelessDict`.
 * The rolling dictionary is skipped when PII handling is active —
 * redacted/flagged payloads must not seed cross-call state.
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
  const dictPlacement = validateDictPlacement(args.dictPlacement);
  const cacheTarget = validateCacheTarget(args.cacheTarget);

  const options = buildCompressionOptions(format, semanticBudget, piiInputs);
  if (dictPlacement !== undefined) options.dictPlacement = dictPlacement;
  if (cacheTarget !== undefined) options.target = cacheTarget;

  const piiActive = piiInputs.mode !== undefined && piiInputs.mode !== 'off';
  const useRolling = args.statelessDict !== true && !piiActive;

  // --- explicit format path ---
  if (format) {
    if (format === 'pakt') return paktPassthroughResult(args.text);

    const structured = format === 'json' || format === 'yaml' || format === 'csv';
    const result = structured
      ? compressStructured(args.text, options, format, useRolling)
      : compress(args.text, options);
    return toCompressResult(
      result.compressed,
      result.savings.totalPercent,
      result.detectedFormat,
      result.originalTokens,
      result.compressedTokens,
      result.reversible,
      extractResultExtras(result),
    );
  }

  // --- detect-and-route path ---
  const detected = detect(args.text);
  if (detected.format === 'pakt') return paktPassthroughResult(args.text);

  if (detected.format === 'json' || detected.format === 'yaml' || detected.format === 'csv') {
    const result = compressStructured(args.text, options, detected.format, useRolling);
    return toCompressResult(
      result.compressed,
      result.savings.totalPercent,
      result.detectedFormat,
      result.originalTokens,
      result.compressedTokens,
      result.reversible,
      extractResultExtras(result),
    );
  }

  /* mixed-content path: compressMixed wraps compress() internally, so
     PII options threaded through `options` reach the inner pipeline and
     any counts/mapping show up on the mixed result. The rolling dict and
     dictPlacement don't apply here — embedded blocks keep their own
     inline dictionaries. */
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

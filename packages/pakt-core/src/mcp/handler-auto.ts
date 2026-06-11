/**
 * @module mcp/handler-auto
 * Implementation of the `pakt_auto` MCP tool.
 *
 * Split out of `handler.ts` to keep each module under the 400-line cap.
 * Owns the auto-route code path: detect → decompress / passthrough /
 * dedup-cached compress / fresh compress. Manages a per-process metadata
 * cache that mirrors the dedup cache so cache hits can return savings
 * info without recomputing tokens.
 *
 * @internal Node.js only — imports `node:crypto` for content-addressed
 * cache keys. Browser bundles should use the public compression APIs
 * from `@sriinnu/pakt` and must not deep-import MCP internals.
 */

import { createHash } from 'node:crypto';
import { compress } from '../compress.js';
import { decompress } from '../decompress.js';
import { detect } from '../detect.js';
import { compressMixed } from '../mixed/index.js';
import { countTokens } from '../tokens/index.js';
import type { PaktFormat, PaktResult } from '../types.js';
import { validate } from '../utils/validate.js';
import { dedupCache } from './dedup-cache.js';
import {
  PaktToolInputError,
  assertNonEmptyString,
  buildCompressionOptions,
  extractPIIFields,
  extractPIIInputs,
  summarizeValidationFailure,
  validateSemanticBudget,
} from './handler-validation.js';
import { rollingDict } from './rolling-dict.js';
import type { PaktAutoArgs, PaktAutoResult } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum input tokens to attempt compression. Below this, overhead exceeds savings. */
const MIN_COMPRESSION_THRESHOLD = 50;

/** Maximum input size in bytes. Larger inputs skip compression to avoid CPU DoS. */
const MAX_AUTO_INPUT_SIZE = 512 * 1024;

/** Maximum dedup metadata entries kept in memory. Oldest are evicted. */
const METADATA_CAP = 500;

// ---------------------------------------------------------------------------
// Dedup metadata cache
// ---------------------------------------------------------------------------

/** Metadata stored alongside dedup cache entries for stats reporting. */
interface DedupMeta {
  savedTokens: number;
  inputTokens: number;
  outputTokens: number;
  format: string;
  reversible: boolean;
  savingsPercent: number;
}

/** Maps content hash → compression metadata for dedup cache hits. */
const dedupMetadata = new Map<string, DedupMeta>();

/** Evict oldest metadata entries when over cap. */
function trimMetadata(): void {
  while (dedupMetadata.size > METADATA_CAP) {
    const oldest = dedupMetadata.keys().next().value;
    if (oldest === undefined) break;
    dedupMetadata.delete(oldest);
  }
}

// ---------------------------------------------------------------------------
// Sub-paths
// ---------------------------------------------------------------------------

/** Decompress a verified PAKT input and shape the response. */
function handleDecompressPath(text: string): PaktAutoResult {
  const validation = validate(text);
  if (!validation.valid) {
    throw new PaktToolInputError(
      `Input looks like PAKT but failed validation: ${summarizeValidationFailure(validation)}`,
    );
  }

  const result = decompress(text);
  const decompInputTokens = countTokens(text);
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

/** Build the "below threshold / oversized" passthrough response. */
function passthroughResult(
  text: string,
  detectedFormat: PaktFormat,
  inputTokens: number,
): PaktAutoResult {
  return {
    result: text,
    action: 'compressed',
    savings: 0,
    detectedFormat,
    inputTokens,
    outputTokens: inputTokens,
    savedTokens: 0,
    reversible: true,
    belowThreshold: true,
  };
}

/**
 * Look up a dedup cache entry for `hash` and shape it into an auto result.
 * Returns `null` when there's no hit or the entry is missing metadata.
 */
function tryDedupHit(hash: string): PaktAutoResult | null {
  const cachedCompressed = dedupCache.get(hash);
  const cachedMeta = dedupMetadata.get(hash);
  if (!cachedCompressed || !cachedMeta) return null;
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

/** Persist a successful compression in the dedup cache + metadata map. */
function storeDedup(
  hash: string,
  result: {
    compressed: string;
    originalTokens: number;
    compressedTokens: number;
    reversible: boolean;
    savings: { totalPercent: number };
  },
  detectedFormat: PaktFormat,
  savedTokens: number,
): void {
  dedupCache.set(hash, result.compressed);
  dedupMetadata.set(hash, {
    savedTokens,
    inputTokens: result.originalTokens,
    outputTokens: result.compressedTokens,
    format: detectedFormat,
    reversible: result.reversible,
    savingsPercent: result.savings.totalPercent,
  });
  trimMetadata();
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Handle a `pakt_auto` tool call.
 *
 * Decompression path: if the input is a valid PAKT payload, decompress it.
 * Compression path: threshold check → dedup cache → pipeline → cache store.
 *
 * The dedup cache is bypassed whenever PII options are active, since
 * cached entries don't carry per-call PII counts/mapping.
 */
export function handleAuto(args: PaktAutoArgs): PaktAutoResult {
  assertNonEmptyString(args.text, 'text');
  const semanticBudget = validateSemanticBudget(args.semanticBudget);
  const piiInputs = extractPIIInputs(args as unknown as Record<string, unknown>);

  const detected = detect(args.text);

  // --- Decompression path ---
  if (detected.format === 'pakt') {
    return handleDecompressPath(args.text);
  }

  // --- Compression path ---

  // Size cap: skip very large inputs to prevent CPU DoS from sliding window
  if (args.text.length > MAX_AUTO_INPUT_SIZE) {
    return passthroughResult(args.text, detected.format, countTokens(args.text));
  }

  // Threshold: skip tiny inputs where overhead exceeds savings
  const inputTokens = countTokens(args.text);
  if (inputTokens < MIN_COMPRESSION_THRESHOLD) {
    return passthroughResult(args.text, detected.format, inputTokens);
  }

  // Dedup: return cached result if we've seen this exact input before.
  // Skip the cache entirely when PII options are active — cached results
  // wouldn't carry the requested counts/mapping, so we always re-scan.
  const hash = createHash('sha256').update(args.text).digest('hex');
  const piiActive = piiInputs.mode !== undefined && piiInputs.mode !== 'off';
  if (!piiActive) {
    const hit = tryDedupHit(hash);
    if (hit) return hit;
  }

  // Run the compression pipeline.
  // When PII is active on mixed content, route through compress() — it
  // scans the full document via the post-pass, whereas compressMixed
  // only compresses embedded structured blocks and would leave prose
  // PII untouched.
  const compressionOptions = buildCompressionOptions(undefined, semanticBudget, piiInputs);
  const isStructured =
    detected.format === 'json' || detected.format === 'yaml' || detected.format === 'csv';

  /* Cross-turn alias reuse: seed L2 with expansions discovered in prior
     turns, then merge new ones back. Skipped on the mixed-content path
     (compressMixed has a narrower options type) and when PII is active
     (placeholder values shouldn't pollute the rolling dictionary).
     Seed ordering is deterministic by discovery turn (see
     RollingDictionary.seed) so the resulting `@dict` prefix stays
     stable across turns — a precondition for hitting provider prompt
     caches (Anthropic cache_control, OpenAI prefix cache). */
  const useRolling = isStructured && !piiActive;
  const seededExpansions = useRolling ? rollingDict.seed() : undefined;

  const compressResult =
    isStructured || piiActive
      ? compress(args.text, {
          ...compressionOptions,
          fromFormat: detected.format,
          ...(seededExpansions ? { seedAliases: seededExpansions } : {}),
        })
      : compressMixed(args.text, compressionOptions);

  if (useRolling && seededExpansions && 'dictionary' in compressResult) {
    // piiSafe: true — useRolling is false when piiActive, so PII content never seeds here.
    rollingDict.update(compressResult.dictionary, seededExpansions, { piiSafe: true });
  }

  const savedTokens = compressResult.originalTokens - compressResult.compressedTokens;

  if (!piiActive) {
    storeDedup(hash, compressResult, detected.format, savedTokens);
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

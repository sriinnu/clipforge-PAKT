/**
 * @sriinnu/pakt — PAKT compression engine
 *
 * Lossless format conversion for LLM token optimization.
 * Compresses JSON, YAML, CSV, and Markdown into a compact
 * pipe-delimited format that uses 30-50% fewer tokens.
 *
 * @packageDocumentation
 *
 * @example
 * ```ts
 * import { compress, decompress, detect } from '@sriinnu/pakt';
 *
 * // Compress JSON to PAKT
 * const result = compress('{"users": [{"name": "Alice"}, {"name": "Bob"}]}');
 * console.log(result.compressed);
 * console.log(`Saved ${result.savings.totalPercent}% tokens`);
 *
 * // Decompress back to JSON
 * const original = decompress(result.compressed, 'json');
 * console.log(original.text);
 *
 * // Detect input format
 * const detected = detect('name,role\nAlice,dev');
 * console.log(detected.format); // 'csv'
 * ```
 */

/** Library version */
export const VERSION = '0.3.0';

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

export { compress } from './compress.js';
export { decompress } from './decompress.js';
export { detect } from './detect.js';
export { validate, repair } from './utils/validate.js';

// ---------------------------------------------------------------------------
// Async & batch API
// ---------------------------------------------------------------------------

export { compressAsync, decompressAsync } from './async.js';
export { compressBatch } from './batch.js';
export type { BatchOptions, BatchItemResult } from './batch.js';

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

export { prettyPrint } from './serializer/index.js';
export type { PrettyOptions } from './serializer/index.js';

// ---------------------------------------------------------------------------
// Layer functions (advanced)
// ---------------------------------------------------------------------------

export { compressL4, decompressL4, applyL4Transforms } from './layers/index.js';

// ---------------------------------------------------------------------------
// Mixed-content compression
// ---------------------------------------------------------------------------

export { compressMixed, decompressMixed, extractBlocks } from './mixed/index.js';
export type { MixedCompressResult, MixedBlockResult, ExtractedBlock } from './mixed/index.js';

// ---------------------------------------------------------------------------
// Token utilities
// ---------------------------------------------------------------------------

export { countTokens, compareSavings } from './tokens/index.js';

// ---------------------------------------------------------------------------
// Pluggable tokenizer
// ---------------------------------------------------------------------------

export { GptTokenCounter } from './tokens/index.js';
export {
  registerTokenCounter,
  getTokenCounter,
  resetTokenCounterRegistry,
} from './tokens/index.js';
export type { TokenCounter, TokenCounterFactory } from './tokens/index.js';

// ---------------------------------------------------------------------------
// Context Window Packer
// ---------------------------------------------------------------------------

export { pack } from './packer/index.js';
export type {
  PackerItem,
  PackerOptions,
  PackerResult,
  PackedItem,
  DroppedItem,
  PackerStats,
} from './packer/index.js';

// ---------------------------------------------------------------------------
// LLM Integration
// ---------------------------------------------------------------------------

export { PAKT_SYSTEM_PROMPT } from './prompt.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  PaktOptions,
  PaktResult,
  PaktFormat,
  PaktLayers,
  PaktSavings,
  DecompressResult,
  DetectionResult,
  DictEntry,
  SavingsReport,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ModelPricing,
  ParserMode,
  HeaderType,
  EnvelopeInfo,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Re-export constants from the dedicated constants module. */
export { DEFAULT_OPTIONS, DEFAULT_LAYERS, MODEL_PRICING } from './constants.js';

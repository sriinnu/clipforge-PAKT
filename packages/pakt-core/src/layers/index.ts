/**
 * @module layers
 * Barrel export for all PAKT compression layers.
 *
 * @example
 * ```ts
 * import { compressL1, decompressL1 } from './layers/index.js';
 * ```
 */

export { compressL1, decompressL1, toScalar, buildBody, scalarToValue } from './L1-structural.js';
export { compressL2, decompressL2, extractDictEntries } from './L2-dictionary.js';
export { compressL3, revertL3, applyL3Transforms, reverseL3Transforms } from './L3-tokenizer.js';
export { compressL4, decompressL4, applyL4Transforms } from './L4-semantic.js';
export {
  applyL5Transforms,
  reverseL5Transforms,
  markL5,
  hasL5Marker,
  expandWords,
  expandUrls,
} from './L5-content.js';
export { compressText } from './compress-text.js';
export type { TextCompressResult } from './compress-text.js';
export { decompressText } from './decompress-text.js';
/* Delta barrel: surface only what downstream consumers (src/index.ts,
   compress.ts, decompress.ts) actually pull through the barrel. Test
   suites and internal modules import from the delta sub-modules
   directly. Keeps the public surface scoped to what's advertised in
   the package root. */
export {
  applyDeltaEncoding,
  revertDeltaEncoding,
  isNumericDeltaSentinel,
  needsNumericDeltaQuote,
  isTemporalDeltaSentinel,
  needsTemporalDeltaQuote,
  DELTA_SENTINEL,
} from './L1-delta.js';
export {
  temporalDeltaEncodeTabular,
  temporalDeltaDecodeTabular,
} from './L1-delta-temporal.js';
export { applyPIILayer } from './L4-pii.js';
export type { L4PIIOptions, L4PIIResult, PIIMode } from './L4-pii.js';

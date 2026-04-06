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
export { compressText } from './compress-text.js';
export type { TextCompressResult } from './compress-text.js';
export { decompressText } from './decompress-text.js';
export {
  applyDeltaEncoding,
  revertDeltaEncoding,
  computeDeltaRatio,
  isDeltaSentinel,
  DELTA_SENTINEL,
  MIN_DELTA_ROWS,
  MIN_DELTA_RATIO,
} from './L1-delta.js';

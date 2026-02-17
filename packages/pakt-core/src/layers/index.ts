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

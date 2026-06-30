/**
 * @module meta
 * Lightweight, tokenizer-free metadata surface.
 *
 * Layer-profile constants, compressibility scoring, and tokenizer-family info —
 * none of which load the multi-megabyte BPE encoder. Import from
 * `@sriinnu/pakt/meta` in code paths that need this metadata without pulling the
 * tokenizer into the bundle (e.g. a browser UI's main thread, which can keep the
 * full engine in a web worker behind a dynamic `import('@sriinnu/pakt')`).
 *
 * Everything here is also re-exported from the package root; this entry exists
 * purely so bundlers can split the heavy engine out of the initial load.
 */

export {
  DEFAULT_SEMANTIC_BUDGET,
  PAKT_LAYER_PROFILES,
  createProfiledPaktOptions,
  getPaktLayerProfile,
} from './layer-profiles.js';
export type { PaktLayerProfile, PaktLayerProfileId } from './types.js';
export { estimateCompressibility } from './compressibility.js';
export type {
  CompressibilityBreakdown,
  CompressibilityLabel,
  CompressibilityResult,
} from './compressibility.js';
export { getTokenizerFamily, getTokenizerFamilyInfo } from './tokens/tokenizer-family.js';
export type { TokenizerFamily, TokenizerFamilyInfo } from './tokens/tokenizer-family.js';

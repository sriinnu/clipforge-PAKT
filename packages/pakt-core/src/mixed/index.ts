/**
 * @module mixed
 * Mixed-content PAKT compression and decompression.
 *
 * Provides functions to detect structured data blocks (JSON, YAML, CSV)
 * embedded within markdown or plain text, compress them individually,
 * and decompress them back to their original formats.
 *
 * @example
 * ```ts
 * import { compressMixed, decompressMixed, extractBlocks } from '@sriinnu/pakt';
 *
 * // Detect blocks in a mixed document
 * const blocks = extractBlocks(markdownDoc);
 *
 * // Compress structured blocks within mixed content
 * const result = compressMixed(markdownDoc);
 *
 * // Decompress back to original
 * const restored = decompressMixed(result.compressed);
 * ```
 */

export { extractBlocks } from './extractor.js';
export type { ExtractedBlock } from './extractor.js';

export { compressMixed } from './compress-mixed.js';
export type { MixedCompressResult, MixedBlockResult } from './compress-mixed.js';

export { decompressMixed } from './decompress-mixed.js';

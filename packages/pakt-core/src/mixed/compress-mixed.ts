/**
 * @module mixed/compress-mixed
 * Compresses mixed content by detecting structured blocks and compressing
 * each one individually while leaving prose/text untouched.
 *
 * Structured blocks (JSON, YAML, CSV) found within markdown or text are
 * wrapped in PAKT markers after compression so they can be identified
 * during decompression.
 */

import { compress } from '../compress.js';
import { DEFAULT_OPTIONS } from '../constants.js';
import { countTokens } from '../tokens/index.js';
import type { PaktFormat, PaktOptions, PaktSavings } from '../types.js';
import { extractBlocks } from './extractor.js';
import type { ExtractedBlock } from './extractor.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Per-block compression details within a mixed document. */
export interface MixedBlockResult {
  /** Format of the block (e.g., 'json', 'yaml', 'csv'). */
  format: PaktFormat;
  /** Token count of the original block content. */
  originalTokens: number;
  /** Token count of the compressed block content. */
  compressedTokens: number;
  /** Savings percentage for this individual block. */
  savingsPercent: number;
}

/** Result of compressing mixed content. */
export interface MixedCompressResult {
  /** The mixed text with structured blocks replaced by their PAKT versions. */
  compressed: string;
  /** Total original tokens across the entire document. */
  originalTokens: number;
  /** Total compressed tokens across the entire document. */
  compressedTokens: number;
  /** Aggregate savings info. */
  savings: PaktSavings;
  /** Per-block compression details. */
  blocks: MixedBlockResult[];
  /** Always true for mixed (L1+L2 are lossless). */
  reversible: boolean;
}

// ---------------------------------------------------------------------------
// PAKT marker format
// ---------------------------------------------------------------------------

/** Opening marker for a compressed PAKT block within mixed content. */
const PAKT_OPEN = (fmt: string, block: ExtractedBlock): string => {
  const meta = buildMarkerMeta(block);
  return meta === undefined
    ? `<!-- PAKT:${fmt} -->`
    : `<!-- PAKT:${fmt} ${JSON.stringify(meta)} -->`;
};

/** Closing marker for a compressed PAKT block within mixed content. */
const PAKT_CLOSE = '<!-- /PAKT -->';

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Compress mixed content by detecting and compressing embedded structured blocks.
 *
 * Text/prose between blocks is left untouched. Each structured block is
 * individually compressed with PAKT. Compressed blocks are wrapped in
 * HTML comment markers so they can be found during decompression:
 *
 * ```
 * <!-- PAKT:json -->
 * @from json
 * ...compressed...
 * <!-- /PAKT -->
 * ```
 *
 * Only replaces a block if compression actually saved tokens. If no blocks
 * are found or none save tokens, the original text is returned as-is.
 *
 * @param input - The mixed content text (markdown, text with embedded structures)
 * @param options - Optional PAKT compression options forwarded to each block
 * @returns Compression result with savings metadata and per-block details
 *
 * @example
 * ```ts
 * const doc = '# API Response\n```json\n{"users": [{"name": "Alice"}]}\n```\nEnd.';
 * const result = compressMixed(doc);
 * console.log(result.savings.totalPercent); // > 0
 * ```
 */
export function compressMixed(input: string, options?: Partial<PaktOptions>): MixedCompressResult {
  const targetModel = options?.targetModel ?? DEFAULT_OPTIONS.targetModel;
  const originalTokens = countTokens(input, targetModel);
  const blocks = extractBlocks(input);

  // No structured blocks found -- return passthrough
  if (blocks.length === 0) {
    return buildPassthrough(input, originalTokens);
  }

  // Compress each block and track results
  const blockResults: MixedBlockResult[] = [];
  const replacements: Array<{
    startOffset: number;
    endOffset: number;
    replacement: string;
  }> = [];

  for (const block of blocks) {
    const blockOpts: Partial<PaktOptions> = {
      ...options,
      fromFormat: block.format,
    };

    const result = compress(block.content, blockOpts);
    const blockOrigTokens = countTokens(block.content, targetModel);
    const blockCompTokens = countTokens(result.compressed, targetModel);

    // Only replace if compression actually saved tokens
    if (blockCompTokens < blockOrigTokens) {
      const wrapped = [PAKT_OPEN(block.format, block), result.compressed, PAKT_CLOSE].join('\n');

      replacements.push({
        startOffset: block.startOffset,
        endOffset: block.endOffset,
        replacement: wrapped,
      });

      blockResults.push({
        format: block.format,
        originalTokens: blockOrigTokens,
        compressedTokens: blockCompTokens,
        savingsPercent:
          blockOrigTokens > 0
            ? Math.round(((blockOrigTokens - blockCompTokens) / blockOrigTokens) * 100)
            : 0,
      });
    }
  }

  // No blocks had savings -- return passthrough
  if (replacements.length === 0) {
    return buildPassthrough(input, originalTokens);
  }

  // Reassemble the text with compressed blocks (work backwards to preserve offsets)
  let compressed = input;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    if (!r) continue;
    compressed = compressed.slice(0, r.startOffset) + r.replacement + compressed.slice(r.endOffset);
  }

  const compressedTokens = countTokens(compressed, targetModel);
  const totalTokensSaved = originalTokens - compressedTokens;
  const totalPercent =
    originalTokens > 0 ? Math.round((totalTokensSaved / originalTokens) * 100) : 0;

  return {
    compressed,
    originalTokens,
    compressedTokens,
    savings: {
      totalPercent,
      totalTokens: totalTokensSaved,
      byLayer: {
        structural: totalTokensSaved,
        dictionary: 0,
        tokenizer: 0,
        semantic: 0,
      },
    },
    blocks: blockResults,
    reversible: true,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a passthrough result with 0% savings.
 *
 * @param input - Original text
 * @param tokens - Token count of the original text
 * @returns MixedCompressResult with no savings
 */
function buildPassthrough(input: string, tokens: number): MixedCompressResult {
  return {
    compressed: input,
    originalTokens: tokens,
    compressedTokens: tokens,
    savings: {
      totalPercent: 0,
      totalTokens: 0,
      byLayer: { structural: 0, dictionary: 0, tokenizer: 0, semantic: 0 },
    },
    blocks: [],
    reversible: true,
  };
}

/**
 * Build optional wrapper metadata for a mixed-content block.
 *
 * Only wrappers that need reconstruction are encoded; inline replacements can
 * be restored directly from the decompressed body.
 */
function buildMarkerMeta(block: ExtractedBlock):
  | {
      wrapper: 'fence' | 'frontmatter';
      fence?: string;
      languageTag?: string;
      trailingNewline?: boolean;
    }
  | undefined {
  if (block.wrapper === 'fence') {
    return {
      wrapper: 'fence',
      fence: block.fence,
      languageTag: block.languageTag,
      trailingNewline: block.trailingNewline,
    };
  }

  if (block.wrapper === 'frontmatter') {
    return {
      wrapper: 'frontmatter',
      trailingNewline: block.trailingNewline,
    };
  }

  return undefined;
}

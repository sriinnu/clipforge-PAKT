/**
 * @module layers/compress-text
 * Word-boundary-aligned phrase compression for plain text.
 *
 * Detects repeated word n-grams (2-8 words) across the input, assigns
 * short `$a`-`$az` aliases, and produces a header block + compressed body.
 * Uses {@link estimateTokens} for fast candidate pre-screening and
 * {@link countTokens} for final savings validation.
 *
 * Public API: {@link compressText} — same contract as the structural
 * compression pipeline but operates on raw text instead of parsed AST.
 *
 * Internals are split for clarity & to keep each file under the 400-line cap:
 *  - `compress-text-preprocess.ts` — whitespace normalization + line dedup
 *  - `compress-text-phrases.ts`    — n-gram detection + alias assignment
 */

import { countTokens } from '../tokens/index.js';
import {
  type AliasEntry,
  applyAliases,
  buildCandidates,
  buildHeader,
  deduplicateCandidates,
  extractWords,
  findExistingAliases,
  tokenizeWords,
} from './compress-text-phrases.js';
import {
  type PreprocessResult,
  type WhitespaceMetadata,
  encodeWs,
  preprocess,
} from './compress-text-preprocess.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum input size (100 KB). Inputs beyond this are returned as-is. */
export const MAX_TEXT_INPUT_SIZE = 100 * 1024;

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * Result of plain-text compression.
 *
 * `null` is returned when compression yields no token savings.
 */
export interface TextCompressResult {
  /** The compressed text with alias header prepended. */
  compressed: string;
  /** Alias definitions mapping `alias -> phrase`. */
  aliases: AliasEntry[];
  /** Original token count. */
  originalTokens: number;
  /** Compressed token count. */
  compressedTokens: number;
}

// ---------------------------------------------------------------------------
// Header assembly
// ---------------------------------------------------------------------------

/**
 * Build the `@ws-trail` / `@ws-blanks` metadata lines for a {@link WhitespaceMetadata}.
 *
 * Returns an empty array when there's nothing to record.
 */
function buildWhitespaceMetaLines(wsMeta: WhitespaceMetadata | null): string[] {
  if (!wsMeta) return [];
  const lines: string[] = [];
  if (wsMeta.trailing.length > 0) {
    const encoded = wsMeta.trailing.map(([l, s]) => `${l}:${encodeWs(s)}`).join(',');
    lines.push(`@ws-trail ${encoded}`);
  }
  if (wsMeta.blankRuns.length > 0) {
    const encoded = wsMeta.blankRuns.map(([l, c]) => `${l}:${c}`).join(',');
    lines.push(`@ws-blanks ${encoded}`);
  }
  return lines;
}

/**
 * Run dictionary phrase compression on already-preprocessed text.
 *
 * Returns the original text and an empty alias list when no candidates
 * survive selection.
 */
function runDictionaryPass(text: string): { body: string; aliases: AliasEntry[] } {
  const allTokens = tokenizeWords(text);
  const words = extractWords(allTokens);
  if (words.length < 2) return { body: text, aliases: [] };

  const reserved = findExistingAliases(text);
  const raw = buildCandidates(text, words);
  if (raw.length === 0) return { body: text, aliases: [] };

  const deduped = deduplicateCandidates(raw);
  if (deduped.length === 0) return { body: text, aliases: [] };

  const result = applyAliases(text, deduped, reserved);
  if (result.aliases.length === 0) return { body: text, aliases: [] };

  return { body: result.text, aliases: result.aliases };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compress plain text by detecting and aliasing repeated word n-gram phrases.
 *
 * Algorithm:
 *  1. Pre-process: strip trailing whitespace, collapse blank runs, dedupe
 *     identical lines (recording metadata for lossless restore).
 *  2. Tokenize remaining text into words (preserving whitespace).
 *  3. For n-gram sizes 8 down to 2, extract all word n-grams and count.
 *  4. Score candidates by estimated token savings; keep score > 0.
 *  5. Deduplicate: longer phrases that contain shorter ones with `>=`
 *     occurrences dominate.
 *  6. Greedy selection: apply top candidates, skip colliding aliases.
 *  7. Final validation: use real tokenizer to confirm savings.
 *
 * Returns `null` when compression yields no token savings.
 *
 * @param input - Raw text to compress
 * @param format - Source format label (used in `@from` header)
 * @returns Compression result or `null` if no savings
 *
 * @example
 * ```ts
 * const result = compressText(longText, 'text');
 * if (result) {
 *   console.log(`Saved ${result.originalTokens - result.compressedTokens} tokens`);
 * }
 * ```
 */
export function compressText(input: string, format: string): TextCompressResult | null {
  // Guard: empty or oversized input.
  if (!input || input.length === 0 || input.length > MAX_TEXT_INPUT_SIZE) {
    return null;
  }

  const originalTokens = countTokens(input);
  const pp: PreprocessResult = preprocess(input);

  const metaLines = buildWhitespaceMetaLines(pp.wsMeta);
  const { body, aliases } = runDictionaryPass(pp.text);

  // Bail when none of the layers produced any change at all.
  const hasDict = aliases.length > 0;
  const hasMeta = metaLines.length > 0;
  const hasLineDedup = pp.lineMap !== null && pp.lineMap.size > 0;
  if (!hasDict && !hasMeta && !hasLineDedup) return null;

  // Assemble the compressed output.
  const headerParts: string[] = [`@from ${format}`];
  if (hasMeta) headerParts.push(...metaLines);
  if (hasDict) headerParts.push(buildHeader(aliases).trimEnd());
  const compressed = `${headerParts.join('\n')}\n${body}`;

  // Final validation with the real tokenizer — drop the result if it's a regression.
  const compressedTokens = countTokens(compressed);
  if (compressedTokens >= originalTokens) return null;

  return { compressed, aliases, originalTokens, compressedTokens };
}

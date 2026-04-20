/**
 * @module layers/L3-tokenizer
 * L3 tokenizer-aware compression layer.
 *
 * Applies text-level transforms to the serialized PAKT string to
 * minimize token count for LLM tokenizers. Benchmarked at ~2.5-3.6%
 * savings across cl100k_base (GPT-4) and o200k_base (GPT-4o).
 *
 * Transforms applied:
 * - 1-space indent (replaces 2-space): ~2.5% savings
 * - Strip trailing zeros from decimals: ~0.1% savings
 *
 * Tokenizer family awareness: the transforms themselves are family-
 * independent — they reshape whitespace that every BPE treats as a
 * standalone run of spaces. The *gating* (did L3 actually save tokens?)
 * happens in `compress-helpers.ts` via `countTokens(text, targetModel)`,
 * which routes to o200k_base or cl100k_base through
 * {@link getTokenizerFamily}. So L3 accepts the transform only when it
 * helps the target model's family.
 *
 * Signals optimization via `@target l3` header. On decompress,
 * the header triggers reversal of text transforms before parsing.
 */

import type { DocumentNode, HeaderNode } from '../parser/ast.js';

/** Header value that signals L3 optimization was applied. */
const L3_TARGET_VALUE = 'l3';

// ---------------------------------------------------------------------------
// AST-level operations (header management)
// ---------------------------------------------------------------------------

/**
 * Add `@target l3` header to the document AST.
 * Returns a new document; does not mutate the input.
 *
 * @param doc - The document to add the header to
 * @returns A new document with the `@target l3` header
 */
export function compressL3(doc: DocumentNode): DocumentNode {
  const header: HeaderNode = {
    type: 'header',
    headerType: 'target',
    value: L3_TARGET_VALUE,
    position: { line: 0, column: 0, offset: 0 },
  };
  return {
    ...doc,
    headers: [...doc.headers.filter((h) => h.headerType !== 'target'), header],
  };
}

/**
 * Remove `@target` header from the document AST.
 * Used when L3 safety revert is triggered (savings <= 0).
 *
 * @param doc - The document to remove the header from
 * @returns A new document without the `@target` header
 */
export function revertL3(doc: DocumentNode): DocumentNode {
  return {
    ...doc,
    headers: doc.headers.filter((h) => h.headerType !== 'target'),
  };
}

// ---------------------------------------------------------------------------
// Text-level transforms (applied after serialization)
// ---------------------------------------------------------------------------

/**
 * Apply L3 text-level transforms to a serialized PAKT string.
 * Call this AFTER `serialize()` produces the standard 2-space output.
 *
 * Transforms applied:
 * - 2-space indent -> 1-space indent (~2.5% token savings)
 *
 * Note: trailing-zeros stripping was benchmarked at ~0.1% savings but
 * risks mutating quoted string values (e.g. "362.0" -> "362"), so it
 * is intentionally omitted to guarantee lossless round-trips.
 *
 * @param text - Serialized PAKT string (output of serialize())
 * @returns Optimized PAKT string with reduced token count
 */
export function applyL3Transforms(text: string): string {
  return compressIndent(text);
}

/**
 * Check whether a raw PAKT string has the L3 optimization marker.
 *
 * @param text - Raw PAKT string
 * @returns True if `@target l3` header is present
 */
export function hasL3Marker(text: string): boolean {
  return /^@target\s+l3\s*$/m.test(text);
}

/**
 * Reverse L3 text transforms on a raw PAKT string before parsing.
 * If the `@target l3` header is absent, returns text unchanged.
 *
 * @param text - Raw PAKT string (possibly L3-optimized)
 * @returns PAKT string with standard 2-space indentation
 */
export function reverseL3Transforms(text: string): string {
  if (!hasL3Marker(text)) return text;
  return expandIndent(text);
}

// ---------------------------------------------------------------------------
// Transform implementations
// ---------------------------------------------------------------------------

/**
 * Replace 2-space indent levels with 1-space.
 * Each pair of leading spaces becomes a single space.
 * Non-indented lines (headers, blank lines) are unchanged.
 */
function compressIndent(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      let depth = 0;
      let i = 0;
      while (i + 1 < line.length && line[i] === ' ' && line[i + 1] === ' ') {
        depth++;
        i += 2;
      }
      if (depth === 0) return line;
      return ' '.repeat(depth) + line.slice(depth * 2);
    })
    .join('\n');
}

/**
 * Reverse 1-space indent back to 2-space indent.
 * Each leading space becomes two spaces (one indent level = 2 spaces).
 * Non-indented lines are unchanged.
 */
function expandIndent(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (line.length === 0 || line[0] !== ' ') return line;
      let spaces = 0;
      while (spaces < line.length && line[spaces] === ' ') spaces++;
      return '  '.repeat(spaces) + line.slice(spaces);
    })
    .join('\n');
}

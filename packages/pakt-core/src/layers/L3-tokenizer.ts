/**
 * @module layers/L3-tokenizer
 * L3 tokenizer-aware compression layer.
 *
 * Applies text-level transforms to the serialized PAKT string to
 * minimize token count for LLM tokenizers. Each transform is
 * independently measurable and revertible.
 *
 * Transforms applied (in order):
 * 1. Indent compression: 2-space → 1-space (~2.5% savings)
 * 2. Trailing whitespace removal: strip trailing spaces per line
 * 3. Blank line collapse: 2+ consecutive blank lines → 1
 * 4. Unicode normalization: fancy chars → ASCII equivalents
 * 5. Consecutive duplicate line collapse: repeated lines → line (×N)
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

/**
 * Marker prefix for the unicode normalization metadata comment.
 * Stores original unicode character positions so the reverse is lossless.
 */
const L3_UNICODE_META_PREFIX = '# @l3u ';

/**
 * Suffix used to mark duplicate line counts: ` (×N)`.
 * The × (multiplication sign, U+00D7) is chosen because it's unlikely
 * to appear naturally at the end of a PAKT data line.
 */
const DEDUP_PATTERN = / \(×(\d+)\)$/;

/**
 * Escape sequence for literal `(×` in original data to prevent
 * collision with the dedup notation.
 */
const DEDUP_ESCAPE = '(\\×';
const DEDUP_ESCAPE_PATTERN = /\(\\×/g;
const DEDUP_LITERAL_PATTERN = /\(×/g;

// ---------------------------------------------------------------------------
// Unicode mapping table
// ---------------------------------------------------------------------------

/**
 * Map of fancy unicode characters to their ASCII replacements.
 * Each entry: [unicode char, ASCII replacement, hex codepoint for metadata].
 */
const UNICODE_MAP: ReadonlyArray<readonly [string, string, string]> = [
  ['\u201C', '"', '201C'], // left double quotation mark
  ['\u201D', '"', '201D'], // right double quotation mark
  ['\u2018', "'", '2018'], // left single quotation mark
  ['\u2019', "'", '2019'], // right single quotation mark
  ['\u2014', '--', '2014'], // em dash
  ['\u2013', '-', '2013'], // en dash
  ['\u2026', '...', '2026'], // horizontal ellipsis
  ['\u00A0', ' ', '00A0'], // non-breaking space
] as const;

/**
 * Reverse lookup: hex codepoint → original unicode character.
 */
const HEX_TO_CHAR: ReadonlyMap<string, string> = new Map(
  UNICODE_MAP.map(([char, , hex]) => [hex, char]),
);

/**
 * Reverse lookup: hex codepoint → ASCII replacement string.
 * Used during reverse to know how many chars to skip at a position.
 */
const HEX_TO_ASCII: ReadonlyMap<string, string> = new Map(
  UNICODE_MAP.map(([, ascii, hex]) => [hex, ascii]),
);

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
// Public API: apply and reverse transforms
// ---------------------------------------------------------------------------

/**
 * Apply L3 text-level transforms to a serialized PAKT string.
 * Call this AFTER `serialize()` produces the standard 2-space output.
 *
 * Transforms are chained in order:
 * 1. Indent compression (2-space → 1-space)
 * 2. Trailing whitespace removal
 * 3. Blank line collapse (2+ → 1)
 * 4. Unicode normalization (fancy → ASCII + metadata)
 * 5. Consecutive duplicate line collapse
 *
 * @param text - Serialized PAKT string (output of serialize())
 * @returns Optimized PAKT string with reduced token count
 */
export function applyL3Transforms(text: string): string {
  let result = text;
  result = compressIndent(result);
  result = stripTrailingWhitespace(result);
  result = collapseBlankLines(result);
  result = normalizeUnicode(result);
  result = collapsDuplicateLines(result);
  return result;
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
 * Transforms are reversed in opposite order:
 * 1. Expand duplicate line notation (×N → repeated lines)
 * 2. Restore unicode characters from metadata
 * 3. Blank line collapse — no-op (serializer doesn't produce 2+ blanks)
 * 4. Trailing whitespace — no-op (serializer doesn't produce trailing spaces)
 * 5. Expand indent (1-space → 2-space)
 *
 * @param text - Raw PAKT string (possibly L3-optimized)
 * @returns PAKT string with standard 2-space indentation
 */
export function reverseL3Transforms(text: string): string {
  if (!hasL3Marker(text)) return text;
  let result = text;
  result = expandDuplicateLines(result);
  result = restoreUnicode(result);
  // Blank line collapse and trailing whitespace are no-ops on reverse:
  // the PAKT serializer never produces trailing whitespace or 2+ blank lines,
  // so those transforms only remove noise — nothing to restore.
  result = expandIndent(result);
  return result;
}

// ---------------------------------------------------------------------------
// Transform 1: Indent compression
// ---------------------------------------------------------------------------

/**
 * Replace 2-space indent levels with 1-space.
 * Each pair of leading spaces becomes a single space.
 * Non-indented lines (headers, blank lines) are unchanged.
 *
 * @param text - Input text with 2-space indentation
 * @returns Text with 1-space indentation
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
 *
 * @param text - Text with 1-space indentation
 * @returns Text with 2-space indentation
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

// ---------------------------------------------------------------------------
// Transform 2: Trailing whitespace removal
// ---------------------------------------------------------------------------

/**
 * Strip trailing spaces and tabs from each line.
 * These waste tokens for zero semantic value in PAKT output.
 * The reverse is a no-op because the PAKT serializer never
 * intentionally produces trailing whitespace.
 *
 * @param text - Input text
 * @returns Text with trailing whitespace removed from each line
 */
function stripTrailingWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n');
}

// ---------------------------------------------------------------------------
// Transform 3: Blank line collapse
// ---------------------------------------------------------------------------

/**
 * Collapse 2+ consecutive blank lines into a single blank line.
 * BPE tokenizers encode `\n\n\n` as multiple tokens vs `\n\n` as fewer.
 * The reverse is a no-op because the PAKT serializer produces at most
 * one blank line between sections.
 *
 * @param text - Input text
 * @returns Text with consecutive blank lines collapsed to one
 */
function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n');
}

// ---------------------------------------------------------------------------
// Transform 4: Unicode normalization
// ---------------------------------------------------------------------------

/** Position of a unicode replacement: line index, column, hex codepoint. */
interface UnicodeReplacement {
  /** 0-based line index */
  line: number;
  /** 0-based column in the modified line (position of the ASCII replacement) */
  col: number;
  /** 4-char hex codepoint (e.g. '201C') */
  hex: string;
}

/**
 * Replace fancy Unicode characters with ASCII equivalents and embed
 * a metadata comment so the reverse can restore them losslessly.
 *
 * The metadata line format: `# @l3u L:C=XXXX,L:C=XXXX,...`
 * where L is line index (0-based), C is column (0-based in the
 * MODIFIED line after prior same-line replacements), XXXX is hex codepoint.
 *
 * If no unicode characters are found, returns text unchanged (no metadata).
 *
 * @param text - Input text
 * @returns Text with unicode chars replaced and metadata appended
 */
function normalizeUnicode(text: string): string {
  const replacements: UnicodeReplacement[] = [];
  const lines = text.split('\n');

  const resultLines = lines.map((line, lineIdx) => {
    let modified = line;

    for (const [char, ascii, hex] of UNICODE_MAP) {
      let searchFrom = 0;
      while (true) {
        const pos = modified.indexOf(char, searchFrom);
        if (pos === -1) break;

        // Record position in the modified line at the point of replacement.
        // The reverse restores right-to-left (descending col), so each
        // recorded position is valid for lookup in the final modified line.
        replacements.push({ line: lineIdx, col: pos, hex });

        // Perform the replacement
        modified = modified.slice(0, pos) + ascii + modified.slice(pos + char.length);
        searchFrom = pos + ascii.length;
      }
    }

    return modified;
  });

  if (replacements.length === 0) return text;

  // Build the metadata comment and append it
  const meta = replacements.map((r) => `${r.line}:${r.col}=${r.hex}`).join(',');
  resultLines.push(L3_UNICODE_META_PREFIX + meta);

  return resultLines.join('\n');
}

/**
 * Restore unicode characters from the L3 metadata comment.
 * Reads the `# @l3u` line, replaces ASCII equivalents with original
 * unicode chars at the recorded positions, then removes the metadata line.
 *
 * If no metadata line is found, returns text unchanged.
 *
 * @param text - L3-compressed text (may contain unicode metadata)
 * @returns Text with original unicode characters restored
 */
function restoreUnicode(text: string): string {
  const lines = text.split('\n');

  // Find and remove the metadata line (always at end if present)
  const metaLineIdx = lines.findIndex((l) => l.startsWith(L3_UNICODE_META_PREFIX));
  if (metaLineIdx === -1) return text;

  const metaLine = lines[metaLineIdx];
  if (!metaLine) return text;
  const metaContent = metaLine.slice(L3_UNICODE_META_PREFIX.length);
  lines.splice(metaLineIdx, 1);

  // If the metadata content is empty or clearly garbled (no valid entries),
  // return text without the metadata line rather than corrupting output.
  if (!metaContent || metaContent.trim() === '') {
    return lines.join('\n');
  }

  // Parse metadata entries: "L:C=XXXX,L:C=XXXX,..."
  // Each entry must match the pattern `number:number=hex`. Malformed entries
  // (NaN line/col, out-of-range positions, unknown hex codes) are skipped.
  const entries: Array<{ line: number; col: number; hex: string }> = [];
  for (const entry of metaContent.split(',')) {
    const eqIdx = entry.indexOf('=');
    if (eqIdx === -1) continue; // malformed: no '=' separator

    const posStr = entry.slice(0, eqIdx);
    const hex = entry.slice(eqIdx + 1);
    if (!hex) continue; // empty hex code

    const colonIdx = posStr.indexOf(':');
    if (colonIdx === -1) continue; // malformed: no ':' separator

    const line = Number(posStr.slice(0, colonIdx));
    const col = Number(posStr.slice(colonIdx + 1));

    // Skip entries where line or col parse as NaN
    if (Number.isNaN(line) || Number.isNaN(col)) continue;
    // Skip entries with negative indices
    if (line < 0 || col < 0) continue;
    // Skip entries where line is out of range
    if (line >= lines.length) continue;
    // Skip entries where col is beyond the line length
    if (col > (lines[line]?.length ?? 0)) continue;
    // Skip entries where hex is not a known codepoint
    if (!HEX_TO_CHAR.has(hex)) continue;

    entries.push({ line, col, hex });
  }

  // If no valid entries survived parsing, return text without the metadata line
  if (entries.length === 0) {
    return lines.join('\n');
  }

  // Group by line for efficient processing, sorted by column descending
  // so replacements don't shift positions of subsequent replacements
  const byLine = new Map<number, Array<{ col: number; hex: string }>>();
  for (const e of entries) {
    const arr = byLine.get(e.line) ?? [];
    arr.push({ col: e.col, hex: e.hex });
    byLine.set(e.line, arr);
  }

  for (const [lineIdx, positions] of byLine) {
    // Sort by column descending so we replace right-to-left
    positions.sort((a, b) => b.col - a.col);
    let line = lines[lineIdx] ?? '';

    for (const { col, hex } of positions) {
      const originalChar = HEX_TO_CHAR.get(hex);
      const asciiReplacement = HEX_TO_ASCII.get(hex);
      if (!originalChar || !asciiReplacement) continue;

      // Replace the ASCII equivalent at this position with the original char
      line = line.slice(0, col) + originalChar + line.slice(col + asciiReplacement.length);
    }

    lines[lineIdx] = line;
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Transform 5: Consecutive duplicate line collapse
// ---------------------------------------------------------------------------

/**
 * Collapse consecutive identical lines into a single line with a count.
 * Example: 3 consecutive identical lines → `line (×3)`.
 *
 * Lines that already end with literal `(×` are escaped first to prevent
 * collision with the dedup notation on reverse.
 *
 * Blank lines and header lines (starting with `@` or `#`) are skipped
 * to avoid collapsing structural PAKT elements.
 *
 * @param text - Input text
 * @returns Text with consecutive duplicate lines collapsed
 */
function collapsDuplicateLines(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // Don't collapse blank lines, headers, or comments — they're structural
    if (line.trim() === '' || line.startsWith('@') || line.startsWith('#')) {
      result.push(line);
      i++;
      continue;
    }

    // Escape any literal `(×` in the line to prevent collision
    const escaped = line.replace(DEDUP_LITERAL_PATTERN, DEDUP_ESCAPE);

    // Count consecutive identical lines
    let count = 1;
    while (i + count < lines.length && lines[i + count] === line) {
      count++;
    }

    if (count >= 2) {
      result.push(`${escaped} (×${count})`);
    } else {
      result.push(escaped);
    }

    i += count;
  }

  return result.join('\n');
}

/**
 * Expand duplicate line notation back to repeated lines.
 * Reverses `line (×N)` back to N copies of `line`.
 * Also unescapes any `(\\×` back to literal `(×`.
 *
 * @param text - L3-compressed text with dedup notation
 * @returns Text with duplicate lines expanded
 */
function expandDuplicateLines(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    const match = DEDUP_PATTERN.exec(line);
    if (match?.[1]) {
      const count = Number.parseInt(match[1], 10);
      // Remove the ` (×N)` suffix and unescape
      const original = line.slice(0, match.index).replace(DEDUP_ESCAPE_PATTERN, '(×');
      for (let j = 0; j < count; j++) {
        result.push(original);
      }
    } else {
      // Unescape any escaped `(×` sequences
      result.push(line.replace(DEDUP_ESCAPE_PATTERN, '(×'));
    }
  }

  return result.join('\n');
}

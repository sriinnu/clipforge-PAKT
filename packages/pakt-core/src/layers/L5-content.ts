/**
 * @module layers/L5-content
 * L5 content-aware compression layer.
 *
 * Compresses VALUES, not just FORMAT. Uses deterministic, rule-based
 * transforms that LLMs understand perfectly:
 *
 * 1. **Word abbreviation** — `application` → `app`, `configuration` → `config`
 * 2. **URL compression** — `https://` → `h//`
 * 3. **Timestamp normalization** — strip redundant precision from ISO timestamps
 *
 * Boolean/null shorthand (`true`→`T`) was removed because it's inherently
 * ambiguous on reverse — can't distinguish a genuine `T` value from a
 * compressed boolean. This decision prioritizes data integrity over marginal
 * token savings.
 *
 * L5 is opt-in (disabled by default), and flagged via `@compress content`
 * header. Marked as non-reversible since abbreviations lose the original
 * word form — though the semantic meaning is preserved.
 */

import type { DocumentNode, HeaderNode } from '../parser/ast.js';
import {
  ABBREVIATIONS,
  MIN_ABBREV_SAVINGS,
  MIN_ABBREV_WORD_LENGTH,
  REVERSE_ABBREVIATIONS,
} from './L5-abbreviations.js';

// ---------------------------------------------------------------------------
// Header management
// ---------------------------------------------------------------------------

/** Header value that signals L5 content compression was applied. */
const L5_COMPRESS_VALUE = 'content';

/**
 * Add `@compress content` header to the document AST.
 * Returns a new document; does not mutate the input.
 */
export function markL5(doc: DocumentNode): DocumentNode {
  const header: HeaderNode = {
    type: 'header',
    headerType: 'compress',
    value: L5_COMPRESS_VALUE,
    position: { line: 0, column: 0, offset: 0 },
  };
  return {
    ...doc,
    headers: [...doc.headers.filter((h) => h.value !== L5_COMPRESS_VALUE), header],
  };
}

/**
 * Check whether a raw PAKT string has the L5 content marker.
 */
export function hasL5Marker(text: string): boolean {
  return /^@compress\s+content\s*$/m.test(text);
}

// ---------------------------------------------------------------------------
// Transform 1: Word abbreviation
// ---------------------------------------------------------------------------

/**
 * Pattern to match whole words in unquoted scalar values.
 * Matches word boundaries — won't abbreviate inside compound words.
 */
function abbreviateWords(text: string): string {
  const lines = text.split('\n');
  return lines
    .map((line) => {
      // Skip header lines, dict blocks, comments
      if (line.startsWith('@') || line.startsWith('#') || line.trimStart().startsWith('$')) {
        return line;
      }

      // Only process the value portion (after `:` or `|`)
      return abbreviateLine(line);
    })
    .join('\n');
}

/**
 * Abbreviate known words in a single line.
 * Operates on whole words only — uses word boundary matching.
 * Skips values wrapped in double quotes to avoid corrupting literal strings.
 */
function abbreviateLine(line: string): string {
  // If the value portion is a quoted string, leave the line untouched.
  // In PAKT, quoted values appear after `:` or as pipe-delimited segments
  // wrapped in `"`. We detect any quoted segment and protect it.
  if (containsQuotedValue(line)) return line;

  let result = line;
  for (const [full, abbr] of ABBREVIATIONS) {
    if (full.length < MIN_ABBREV_WORD_LENGTH) continue;
    if (full.length - abbr.length < MIN_ABBREV_SAVINGS) continue;

    // Case-insensitive whole-word replacement
    const pattern = new RegExp(`\\b${escapeRegex(full)}\\b`, 'gi');
    result = result.replace(pattern, (match) => {
      // Preserve original casing pattern
      if (match === match.toUpperCase()) return abbr.toUpperCase();
      if (match[0] === match[0]?.toUpperCase()) {
        return abbr[0]?.toUpperCase() + abbr.slice(1);
      }
      return abbr;
    });
  }
  return result;
}

/**
 * Reverse word abbreviations — expand known abbreviations back.
 * Only used when L5 marker is present.
 */
export function expandWords(text: string): string {
  const lines = text.split('\n');
  return lines
    .map((line) => {
      if (line.startsWith('@') || line.startsWith('#') || line.trimStart().startsWith('$')) {
        return line;
      }
      let result = line;
      for (const [abbr, full] of REVERSE_ABBREVIATIONS) {
        const pattern = new RegExp(`\\b${escapeRegex(abbr)}\\b`, 'g');
        result = result.replace(pattern, full);
      }
      return result;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Transform 2: URL compression
// ---------------------------------------------------------------------------

/**
 * Compress common URL prefixes:
 * - `https://` → `h//`
 * - `http://` → `h/`
 *
 * Only matches full protocol prefixes — won't touch already-compressed
 * `h//` or `h/` values since those don't contain `https://` or `http://`.
 */
function compressUrls(text: string): string {
  // Replace https:// first (longer match) to avoid http:// consuming the `http` prefix
  return text.replace(/\bhttps:\/\//g, 'h//').replace(/\bhttp:\/\//g, 'h/');
}

/**
 * Reverse URL compression.
 *
 * Expand `h//` → `https://` and `h/` → `http://`.
 * Uses a negative lookbehind to avoid expanding `h/` inside already-expanded
 * `https://` (which contains `h/` after the `ttps:` prefix — but that's not
 * a risk since `h/` requires a word boundary before it).
 *
 * The `h/` pattern requires a non-slash char after it to avoid matching
 * filesystem paths like `h/` at end-of-string or `h//` (which is https).
 */
export function expandUrls(text: string): string {
  // Expand h// first to avoid h/ consuming the first slash of h//
  return text.replace(/\bh\/\//g, 'https://').replace(/\bh\/(?!\/)/g, 'http://');
}

// ---------------------------------------------------------------------------
// Transform 3: Timestamp normalization
// ---------------------------------------------------------------------------

/**
 * Normalize ISO 8601 timestamps to reduce redundant precision:
 * - `2024-03-15T14:30:00.000Z` → `2024-03-15T14:30Z`
 * - `2024-03-15T14:30:00Z` → `2024-03-15T14:30Z`
 * - `2024-03-15T14:30:45.000Z` → `2024-03-15T14:30:45Z`
 *
 * Only trims trailing `:00` seconds and `.000` milliseconds.
 */
function normalizeTimestamps(text: string): string {
  return text.replace(/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}):00(\.000)?Z\b/g, '$1Z');
}

// ---------------------------------------------------------------------------
// Combined L5 pipeline
// ---------------------------------------------------------------------------

/**
 * Apply all L5 content-aware transforms to serialized PAKT text.
 * Call this AFTER L3 transforms (or after serialize() if L3 is disabled).
 *
 * Transform order: abbreviations → URLs → timestamps
 *
 * @param text - Serialized PAKT string
 * @returns Content-compressed PAKT string
 */
export function applyL5Transforms(text: string): string {
  let result = text;
  result = abbreviateWords(result);
  result = compressUrls(result);
  result = normalizeTimestamps(result);
  return result;
}

/**
 * Reverse L5 content transforms.
 * Applied before standard PAKT parsing when `@compress content` is present.
 *
 * Reverse order: timestamps (no-op) → URLs → abbreviations
 */
export function reverseL5Transforms(text: string): string {
  if (!hasL5Marker(text)) return text;
  let result = text;
  // Timestamps: no reverse needed (precision was genuinely redundant)
  result = expandUrls(result);
  result = expandWords(result);
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape special regex characters in a string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check whether a line contains a quoted value (wrapped in double quotes).
 * In PAKT, quoted values preserve literal content — transforms must not
 * modify text inside quotes. This is a conservative check: if ANY part of
 * the line has a quoted segment, we skip the entire line to avoid partial
 * corruption of values like `key: "application configuration"`.
 */
function containsQuotedValue(line: string): boolean {
  return /"[^"]*"/.test(line);
}

/**
 * @module mixed/extractor-helpers
 * Internal utility functions for the mixed-content block extractor.
 *
 * Provides:
 * - JSON bracket matching (`findMatchingBracket`)
 * - CSV delimiter detection (`detectCsvDelimiter`)
 * - Occupied-interval bookkeeping (`buildOccupiedIntervals`, `isOverlapping`)
 *
 * These functions are pure helpers with no side effects and are exported so
 * that they can be unit-tested independently from the main extractor pipeline.
 */

import type { PaktFormat } from '../types.js';

// ---------------------------------------------------------------------------
// Shared public type
// ---------------------------------------------------------------------------

/**
 * A block of structured data found within mixed content.
 * Defined here to avoid circular imports — re-exported from extractor.ts.
 */
export interface ExtractedBlock {
  /** Format of this block ('json', 'yaml', 'csv'). */
  format: PaktFormat;
  /** The raw content of the block. */
  content: string;
  /** Start offset in the original text. */
  startOffset: number;
  /** End offset in the original text. */
  endOffset: number;
  /** If from a fenced code block, the language tag (e.g., 'json', 'yaml'). */
  languageTag?: string;
}

// ---------------------------------------------------------------------------
// JSON bracket matching
// ---------------------------------------------------------------------------

/**
 * Find the matching closing bracket for a JSON object or array.
 * Handles nested brackets and string literals (including escape sequences).
 *
 * @param text - Text to scan.
 * @param startIdx - Index of the opening `{` or `[` character.
 * @returns Index of the matching closing bracket, or -1 if not found.
 */
export function findMatchingBracket(text: string, startIdx: number): number {
  const open = text[startIdx];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i]!;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

// ---------------------------------------------------------------------------
// CSV delimiter detection
// ---------------------------------------------------------------------------

/** Minimum number of consistent rows to consider a section as CSV. */
export const MIN_CSV_ROWS = 3;

/**
 * Check if a set of consecutive lines looks like a CSV table.
 * Requires at least {@link MIN_CSV_ROWS} rows with consistent comma or tab
 * delimiters and at least 2 columns.
 *
 * @param lines - Array of text lines to check.
 * @returns The delimiter character (`','` or `'\t'`) if CSV-like, or `null`.
 */
export function detectCsvDelimiter(lines: string[]): string | null {
  if (lines.length < MIN_CSV_ROWS) return null;

  for (const delim of [',', '\t']) {
    const counts = lines.map((l) => l.split(delim).length);
    const first = counts[0]!;
    // Need at least 2 columns and all rows must match
    if (first >= 2 && counts.every((c) => c === first)) {
      return delim;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Occupied-interval bookkeeping
// ---------------------------------------------------------------------------

/**
 * Build a sorted array of `[startOffset, endOffset]` intervals from already-extracted
 * blocks. Sorting by start enables O(log N) binary-search overlap checks.
 *
 * @param blocks - Already-extracted blocks whose ranges should be marked occupied.
 * @returns Sorted `[start, end]` intervals, one per block.
 */
export function buildOccupiedIntervals(blocks: ExtractedBlock[]): Array<[number, number]> {
  return blocks
    .map((block): [number, number] => [block.startOffset, block.endOffset])
    .sort((a, b) => a[0] - b[0]);
}

/**
 * O(log N) half-open range overlap check against a sorted interval list.
 * Two ranges [a,b) and [c,d) overlap iff a < d && c < b.
 *
 * @param start - Inclusive start of query range.
 * @param end - Exclusive end of query range.
 * @param intervals - Sorted `[start, end]` intervals (ascending by start).
 * @returns `true` if any stored interval overlaps `[start, end)`.
 */
export function isOverlapping(
  start: number,
  end: number,
  intervals: Array<[number, number]>,
): boolean {
  let lo = 0;
  let hi = intervals.length - 1;
  let candidate = -1;

  // Find rightmost interval whose start < end (only those can overlap).
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (intervals[mid]![0] < end) {
      candidate = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (candidate === -1) return false;

  // Walk left from candidate: intervals are sorted by START, not by end,
  // so we cannot break early — a wider interval earlier in the list may
  // still overlap [start, end) even when a later one does not.
  for (let idx = candidate; idx >= 0; idx--) {
    if (intervals[idx]![1] > start) return true;
  }

  return false;
}

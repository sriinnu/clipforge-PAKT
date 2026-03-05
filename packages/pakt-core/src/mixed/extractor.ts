/**
 * @module mixed/extractor
 * Detects and extracts structured data blocks from mixed text/markdown content.
 *
 * Scans for fenced code blocks, inline JSON objects/arrays, YAML frontmatter,
 * and CSV-like tabular sections. Each block is returned with its format,
 * content, and character offsets so callers can selectively compress them.
 */

import { detect } from '../detect.js';
import type { PaktFormat } from '../types.js';

// -- Public types -------------------------------------------------------------

/** A block of structured data found within mixed content. */
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

// -- Language tag to PaktFormat mapping --------------------------------------

/** Maps common fenced-code-block language tags to PaktFormat values. */
const LANG_TAG_MAP: Record<string, PaktFormat> = {
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  csv: 'csv',
  tsv: 'csv',
};

// -- Fenced code block extraction --------------------------------------------

/** Regex for fenced code blocks: ```lang ... ``` */
const FENCED_RE = /^(`{3,})([\w.-]*)\s*\n([\s\S]*?)^\1\s*$/gm;

/**
 * Extract fenced code blocks with structured language tags.
 * Falls back to auto-detection for blocks without a recognized tag.
 *
 * @param text - Full input text
 * @returns Array of extracted blocks from fenced code blocks
 */
function extractFencedBlocks(text: string): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];

  // Reset lastIndex before iteration
  FENCED_RE.lastIndex = 0;
  for (let match = FENCED_RE.exec(text); match !== null; match = FENCED_RE.exec(text)) {
    const langTag = (match[2] ?? '').toLowerCase().trim();
    const content = match[3] ?? '';
    const startOffset = match.index;
    const endOffset = match.index + match[0].length;

    // Skip empty code blocks
    if (content.trim().length === 0) continue;

    // Determine format from language tag or auto-detect
    let format: PaktFormat | undefined = LANG_TAG_MAP[langTag];
    if (!format) {
      const detected = detect(content);
      // Only accept high-confidence structured detections
      if (
        detected.confidence >= 0.8 &&
        detected.format !== 'text' &&
        detected.format !== 'markdown'
      ) {
        format = detected.format;
      }
    }

    if (format) {
      blocks.push({
        format,
        content,
        startOffset,
        endOffset,
        languageTag: langTag || undefined,
      });
    }
  }

  return blocks;
}

// -- YAML frontmatter extraction ---------------------------------------------

/** Regex for YAML frontmatter at the start of the document. */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---(?:\n|$)/;

/**
 * Extract YAML frontmatter from the beginning of the text.
 *
 * @param text - Full input text
 * @returns An extracted block for the frontmatter, or null if none found
 */
function extractFrontmatter(text: string): ExtractedBlock | null {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return null;

  const content = match[1] ?? '';
  if (content.trim().length === 0) return null;

  return {
    format: 'yaml',
    content,
    startOffset: match.index,
    endOffset: match.index + match[0].length,
  };
}

// -- Inline JSON extraction --------------------------------------------------

/**
 * Find the matching closing bracket for a JSON object or array.
 * Handles nested brackets and string literals.
 *
 * @param text - Text to scan
 * @param startIdx - Index of the opening bracket
 * @returns Index of the closing bracket, or -1 if not found
 */
function findMatchingBracket(text: string, startIdx: number): number {
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

/**
 * Extract standalone inline JSON objects/arrays from the text.
 * Only matches blocks that start at the beginning of a line.
 *
 * @param text - Full input text
 * @param intervals - Sorted array of `[start, end]` intervals already claimed by other blocks
 * @returns Array of extracted JSON blocks
 */
function extractInlineJson(text: string, intervals: Array<[number, number]>): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  const lines = text.split('\n');
  let offset = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();
    const leadingSpaces = line.length - trimmed.length;

    if (
      (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
      !isOverlapping(offset + leadingSpaces, offset + leadingSpaces + 1, intervals)
    ) {
      const startIdx = offset + leadingSpaces;
      const closeIdx = findMatchingBracket(text, startIdx);

      if (closeIdx > startIdx) {
        const content = text.slice(startIdx, closeIdx + 1);
        // Validate it is actually JSON
        try {
          JSON.parse(content);
          blocks.push({
            format: 'json',
            content,
            startOffset: startIdx,
            endOffset: closeIdx + 1,
          });
        } catch {
          // Not valid JSON, skip
        }
      }
    }

    offset += line.length + 1; // +1 for the newline
  }

  return blocks;
}

// -- CSV-like tabular section extraction -------------------------------------

/** Minimum number of consistent rows to consider a section as CSV. */
const MIN_CSV_ROWS = 3;

/**
 * Check if a set of consecutive lines looks like a CSV table.
 * Requires consistent comma or tab delimiters across all rows.
 *
 * @param lines - Array of text lines to check
 * @returns The delimiter character if CSV-like, or null
 */
function detectCsvDelimiter(lines: string[]): string | null {
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

/**
 * Extract CSV-like tabular sections from the text.
 * Scans for runs of lines with consistent delimiters.
 *
 * @param text - Full input text
 * @param intervals - Sorted array of `[start, end]` intervals already claimed by other blocks
 * @returns Array of extracted CSV blocks
 */
function extractCsvSections(text: string, intervals: Array<[number, number]>): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  const allLines = text.split('\n');
  let offset = 0;
  const lineOffsets: number[] = [];

  for (const line of allLines) {
    // build per-line start offsets
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  let i = 0;
  while (i < allLines.length) {
    const lineStart = lineOffsets[i] ?? 0;
    const lineLen = allLines[i]?.length ?? 0;

    // Skip lines that are already occupied or empty
    if (
      isOverlapping(lineStart, lineStart + lineLen + 1, intervals) ||
      allLines[i]?.trim().length === 0
    ) {
      i++;
      continue;
    }

    // Extend the run as long as lines are non-empty and unoccupied.
    let end = i + 1;
    while (end < allLines.length) {
      const es = lineOffsets[end] ?? 0;
      const el = allLines[end]?.length ?? 0;
      if ((allLines[end]?.trim().length ?? 0) === 0 || isOverlapping(es, es + el + 1, intervals))
        break;
      end++;
    }

    const candidateLines = allLines.slice(i, end);
    if (detectCsvDelimiter(candidateLines)) {
      const startOffset = lineOffsets[i] ?? 0;
      const endLineOffset = (lineOffsets[end - 1] ?? 0) + (allLines[end - 1]?.length ?? 0);
      const content = text.slice(startOffset, endLineOffset);
      blocks.push({
        format: 'csv',
        content,
        startOffset,
        endOffset: endLineOffset,
      });
      i = end;
    } else {
      i++;
    }
  }

  return blocks;
}

// -- Main extraction function ------------------------------------------------

/**
 * Build a sorted array of `[startOffset, endOffset]` intervals from already-extracted
 * blocks. Sorting by start enables O(log N) binary-search overlap checks.
 *
 * @param blocks - Already-extracted blocks whose ranges should be marked occupied
 * @returns Sorted `[start, end]` intervals, one per block
 */
function buildOccupiedIntervals(blocks: ExtractedBlock[]): Array<[number, number]> {
  return blocks
    .map((block): [number, number] => [block.startOffset, block.endOffset])
    .sort((a, b) => a[0] - b[0]);
}

/**
 * O(log N) half-open range overlap check against a sorted interval list.
 * Two ranges [a,b) and [c,d) overlap iff a < d && c < b.
 *
 * @param start - Inclusive start of query range
 * @param end - Exclusive end of query range
 * @param intervals - Sorted `[start, end]` intervals (ascending by start)
 * @returns `true` if any stored interval overlaps `[start, end)`
 */
function isOverlapping(start: number, end: number, intervals: Array<[number, number]>): boolean {
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

  // Walk left; stop as soon as an interval ends before our start (sorted order
  // guarantees earlier intervals also end no later than this one).
  for (let idx = candidate; idx >= 0; idx--) {
    const ivEnd = intervals[idx]![1];
    if (ivEnd > start) return true;
    if (ivEnd <= start) break;
  }

  return false;
}

/**
 * Extract structured data blocks from mixed content.
 *
 * Detects:
 * - Fenced code blocks (```json ... ```, ```yaml ... ```, ```csv ... ```)
 * - Inline JSON objects/arrays (standalone { } or [ ] blocks)
 * - YAML frontmatter (--- ... ---)
 * - CSV-like tabular sections
 *
 * Blocks do not overlap. Results are sorted by startOffset.
 *
 * @param text - The mixed content to scan
 * @returns Array of extracted blocks sorted by position
 *
 * @example
 * ```ts
 * const blocks = extractBlocks('# Report\n```json\n{"key": "value"}\n```\nEnd.');
 * // [{ format: 'json', content: '{"key": "value"}\n', startOffset: 10, ... }]
 * ```
 */
export function extractBlocks(text: string): ExtractedBlock[] {
  const allBlocks: ExtractedBlock[] = [];

  // 1. YAML frontmatter (highest priority, always at start)
  const frontmatter = extractFrontmatter(text);
  if (frontmatter) {
    allBlocks.push(frontmatter);
  }

  // 2. Fenced code blocks
  const fenced = extractFencedBlocks(text);
  allBlocks.push(...fenced);

  // Build occupied intervals to avoid overlaps (O(log N) per query vs O(N) Set)
  let intervals = buildOccupiedIntervals(allBlocks);

  // 3. Inline JSON objects/arrays
  const inlineJson = extractInlineJson(text, intervals);
  allBlocks.push(...inlineJson);

  // Rebuild occupied intervals after adding inline JSON blocks
  intervals = buildOccupiedIntervals(allBlocks);

  // 4. CSV-like tabular sections
  const csvSections = extractCsvSections(text, intervals);
  allBlocks.push(...csvSections);

  // Sort by startOffset and return
  allBlocks.sort((a, b) => a.startOffset - b.startOffset);
  return allBlocks;
}

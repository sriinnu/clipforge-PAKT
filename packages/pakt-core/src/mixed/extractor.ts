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

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Language tag to PaktFormat mapping
// ---------------------------------------------------------------------------

/** Maps common fenced-code-block language tags to PaktFormat values. */
const LANG_TAG_MAP: Record<string, PaktFormat> = {
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  csv: 'csv',
  tsv: 'csv',
};

// ---------------------------------------------------------------------------
// Fenced code block extraction
// ---------------------------------------------------------------------------

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
  let match: RegExpExecArray | null;

  // Reset lastIndex before iteration
  FENCED_RE.lastIndex = 0;
  while ((match = FENCED_RE.exec(text)) !== null) {
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
      if (detected.confidence >= 0.8 && detected.format !== 'text' && detected.format !== 'markdown') {
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

// ---------------------------------------------------------------------------
// YAML frontmatter extraction
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Inline JSON extraction
// ---------------------------------------------------------------------------

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
 * @param occupied - Set of character indices already claimed by other blocks
 * @returns Array of extracted JSON blocks
 */
function extractInlineJson(text: string, occupied: Set<number>): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  const lines = text.split('\n');
  let offset = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();
    const leadingSpaces = line.length - trimmed.length;

    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && !occupied.has(offset + leadingSpaces)) {
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

// ---------------------------------------------------------------------------
// CSV-like tabular section extraction
// ---------------------------------------------------------------------------

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
 * @param occupied - Set of character indices already claimed by other blocks
 * @returns Array of extracted CSV blocks
 */
function extractCsvSections(text: string, occupied: Set<number>): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  const allLines = text.split('\n');
  let offset = 0;
  const lineOffsets: number[] = [];

  // Build line offset map
  for (const line of allLines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  let i = 0;
  while (i < allLines.length) {
    // Skip lines that are already occupied or empty
    if (occupied.has(lineOffsets[i]!) || allLines[i]!.trim().length === 0) {
      i++;
      continue;
    }

    // Try to find a CSV run starting at line i
    let end = i + 1;
    while (end < allLines.length && !occupied.has(lineOffsets[end]!) && allLines[end]!.trim().length > 0) {
      end++;
    }

    const candidateLines = allLines.slice(i, end);
    if (detectCsvDelimiter(candidateLines)) {
      const startOffset = lineOffsets[i]!;
      const endLineOffset = lineOffsets[end - 1]! + allLines[end - 1]!.length;
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

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

/**
 * Build a set of occupied character indices from existing blocks.
 *
 * @param blocks - Already-extracted blocks
 * @returns Set of all character indices covered by existing blocks
 */
function buildOccupiedSet(blocks: ExtractedBlock[]): Set<number> {
  const occupied = new Set<number>();
  for (const block of blocks) {
    for (let i = block.startOffset; i < block.endOffset; i++) {
      occupied.add(i);
    }
  }
  return occupied;
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

  // Build occupied set to avoid overlaps
  let occupied = buildOccupiedSet(allBlocks);

  // 3. Inline JSON objects/arrays
  const inlineJson = extractInlineJson(text, occupied);
  allBlocks.push(...inlineJson);

  // Rebuild occupied set
  occupied = buildOccupiedSet(allBlocks);

  // 4. CSV-like tabular sections
  const csvSections = extractCsvSections(text, occupied);
  allBlocks.push(...csvSections);

  // Sort by startOffset and return
  allBlocks.sort((a, b) => a.startOffset - b.startOffset);
  return allBlocks;
}

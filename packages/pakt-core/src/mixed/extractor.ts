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
import {
  type ExtractedBlock,
  buildOccupiedIntervals,
  detectCsvDelimiter,
  findMatchingBracket,
  isOverlapping,
} from './extractor-helpers.js';

// -- Public types (re-exported from extractor-helpers) -----------------------

export type { ExtractedBlock } from './extractor-helpers.js';

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
 * @param text - Full input text.
 * @returns Array of extracted blocks from fenced code blocks.
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
        wrapper: 'fence',
        fence: match[1] ?? '```',
        trailingNewline: match[0].endsWith('\n'),
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
 * @param text - Full input text.
 * @returns An extracted block for the frontmatter, or null if none found.
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
    wrapper: 'frontmatter',
    trailingNewline: match[0].endsWith('\n'),
  };
}

// -- Inline JSON extraction --------------------------------------------------

/**
 * Extract standalone inline JSON objects/arrays from the text.
 * Only matches blocks that start at the beginning of a line (after optional
 * leading whitespace) and are not already claimed by another block.
 *
 * @param text - Full input text.
 * @param intervals - Sorted `[start, end]` intervals already claimed by other blocks.
 * @returns Array of extracted JSON blocks.
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
            wrapper: 'inline',
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

/**
 * Extract CSV-like tabular sections from the text.
 * Scans for runs of lines with consistent delimiters that are not already
 * claimed by fenced or JSON blocks.
 *
 * @param text - Full input text.
 * @param intervals - Sorted `[start, end]` intervals already claimed by other blocks.
 * @returns Array of extracted CSV blocks.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CSV extraction needs line-by-line gap analysis with interval overlap checks
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
        wrapper: 'inline',
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
 * Extract structured data blocks from mixed content.
 *
 * Detects:
 * - Fenced code blocks (```json ... ```, ```yaml ... ```, ```csv ... ```)
 * - Inline JSON objects/arrays (standalone `{ }` or `[ ]` blocks)
 * - YAML frontmatter (`--- ... ---`)
 * - CSV-like tabular sections
 *
 * Blocks do not overlap. Results are sorted by startOffset.
 *
 * @param text - The mixed content to scan.
 * @returns Array of extracted blocks sorted by position.
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

// -- Re-exports for backward compatibility -----------------------------------

export {
  buildOccupiedIntervals,
  detectCsvDelimiter,
  findMatchingBracket,
  isOverlapping,
} from './extractor-helpers.js';

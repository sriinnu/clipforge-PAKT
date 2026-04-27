/**
 * @module layers/compress-text-preprocess
 * Whitespace normalization + line deduplication for plain-text compression.
 *
 * Split out of `compress-text.ts` to keep each file under the 400-line cap.
 * Pure helpers — only consumed by `compress-text.ts`.
 */

/** Marker for deduplicated lines: `@L<first-occurrence-line-number>`. */
export const LINE_DEDUP_PREFIX = '@L';

/** Minimum line length before dedup is even considered. */
const MIN_DEDUP_LINE_LENGTH = 10;

/** Metadata needed to restore original whitespace exactly. */
export interface WhitespaceMetadata {
  /** Lines that had trailing whitespace: [lineNum, trailingChars] */
  trailing: Array<[number, string]>;
  /** Consecutive blank line groups: [startLine, count] */
  blankRuns: Array<[number, number]>;
}

/** Result of {@link preprocess} — normalized text + metadata for restoration. */
export interface PreprocessResult {
  /** Normalized text (whitespace stripped, blank runs collapsed, lines deduped). */
  text: string;
  /** Whitespace restoration metadata; `null` when no changes were made. */
  wsMeta: WhitespaceMetadata | null;
  /** `dedupedLine -> firstOccurrenceLine` map; `null` when nothing was deduped. */
  lineMap: Map<number, number> | null;
  /** Original input lines (kept for caller to restore). */
  originalLines: string[];
}

/** Strip trailing whitespace per line, recording what was removed. */
function stripTrailingWhitespace(lines: string[]): {
  stripped: string[];
  trailing: Array<[number, string]>;
} {
  const trailing: Array<[number, string]> = [];
  const stripped: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.replace(/\s+$/, '');
    if (trimmed.length < line.length) {
      trailing.push([i, line.slice(trimmed.length)]);
    }
    stripped.push(trimmed);
  }
  return { stripped, trailing };
}

/** Collapse consecutive blank lines to a single blank, recording run lengths. */
function collapseBlankRuns(lines: string[]): {
  collapsed: string[];
  blankRuns: Array<[number, number]>;
} {
  const blankRuns: Array<[number, number]> = [];
  const collapsed: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line === '' && i + 1 < lines.length && lines[i + 1] === '') {
      // Start of a blank run: collapse to a single blank line.
      const start = collapsed.length;
      let count = 0;
      while (i < lines.length && lines[i] === '') {
        count++;
        i++;
      }
      blankRuns.push([start, count]);
      collapsed.push('');
    } else {
      collapsed.push(line);
      i++;
    }
  }
  return { collapsed, blankRuns };
}

/** Replace duplicate lines with `@L<first-occurrence>` references. */
function dedupeLines(lines: string[]): {
  deduped: string[];
  lineMap: Map<number, number>;
} {
  const firstOccurrence = new Map<string, number>();
  const lineMap = new Map<number, number>();
  const deduped: string[] = [];

  for (let j = 0; j < lines.length; j++) {
    const line = lines[j] ?? '';
    // Skip blank and very short lines — not worth a back-reference.
    if (line.length < MIN_DEDUP_LINE_LENGTH) {
      deduped.push(line);
      continue;
    }
    const existing = firstOccurrence.get(line);
    if (existing !== undefined) {
      deduped.push(`${LINE_DEDUP_PREFIX}${existing}`);
      lineMap.set(j, existing);
    } else {
      firstOccurrence.set(line, j);
      deduped.push(line);
    }
  }

  return { deduped, lineMap };
}

/**
 * Normalize whitespace and deduplicate identical lines.
 *
 * Three passes:
 *  1. Strip trailing whitespace per line (recorded for lossless restore).
 *  2. Collapse consecutive blank lines to a single blank (run lengths recorded).
 *  3. Deduplicate identical lines >= {@link MIN_DEDUP_LINE_LENGTH} chars,
 *     replacing repeats with `@L<N>` references.
 *
 * @param input - Raw text to normalize
 * @returns Normalized text and the metadata required to reverse all three passes
 */
export function preprocess(input: string): PreprocessResult {
  const originalLines = input.split('\n');

  const { stripped, trailing } = stripTrailingWhitespace(originalLines);
  const { collapsed, blankRuns } = collapseBlankRuns(stripped);
  const { deduped, lineMap } = dedupeLines(collapsed);

  const hasWsChanges = trailing.length > 0 || blankRuns.length > 0;
  const hasDedup = lineMap.size > 0;

  if (!hasWsChanges && !hasDedup) {
    return { text: input, wsMeta: null, lineMap: null, originalLines };
  }

  return {
    text: deduped.join('\n'),
    wsMeta: hasWsChanges ? { trailing, blankRuns } : null,
    lineMap: hasDedup ? lineMap : null,
    originalLines,
  };
}

/**
 * Encode whitespace characters for the `@ws-trail` metadata line.
 * `' '` → `s`, `\t` → `t`, `\r` → `r`.
 */
export function encodeWs(ws: string): string {
  return ws.replace(/ /g, 's').replace(/\t/g, 't').replace(/\r/g, 'r');
}

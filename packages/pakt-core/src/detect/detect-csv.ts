/**
 * @module detect/detect-csv
 * CSV format detection.
 *
 * Identifies CSV input by checking for consistent delimiters across lines.
 * Supported delimiters: comma (`,`), tab (`\t`), and semicolon (`;`).
 *
 * Detection requirements:
 * - At least 3 non-empty lines (header + 2 data rows)
 * - Consistent delimiter count per line (>=80% match the header row)
 * - Header row must contain non-numeric text fields
 * - Header fields must not look like natural-language prose (>4 words)
 *
 * Each delimiter is tried independently; the one with the highest
 * confidence wins.
 */

import type { Candidate } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Supported CSV delimiters in detection order */
const CSV_DELIMITERS = [',', '\t', ';'] as const;

// ---------------------------------------------------------------------------
// Helper: YAML-line check (used to reject false-positive CSV on YAML input)
// ---------------------------------------------------------------------------

/**
 * Quick check: does this line look like a YAML key-value pair?
 * Pattern: `key: value` where key is an identifier with no commas.
 *
 * @param line - A single line of text
 * @returns `true` if the line matches `key: value` YAML syntax
 */
function isLikelyYamlLine(line: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*:\s+\S/.test(line.trim());
}

// ---------------------------------------------------------------------------
// Helper: count & split delimiters
// ---------------------------------------------------------------------------

/**
 * Count occurrences of a delimiter in a line, respecting double-quoted fields.
 * Delimiters inside `"..."` are not counted.
 *
 * @param line  - A single CSV line
 * @param delim - The delimiter character
 * @returns Number of unquoted delimiter occurrences
 */
function countDelimiter(line: string, delim: string): number {
  let count = 0;
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      inQuotes = !inQuotes;
    } else if (line[i] === delim && !inQuotes) {
      count++;
    }
  }

  return count;
}

/**
 * Split a CSV line on the delimiter, respecting double-quoted fields.
 *
 * @param line  - A single CSV line
 * @param delim - The delimiter character
 * @returns Array of field values (quotes stripped at split level only)
 */
function splitCsvLine(line: string, delim: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      inQuotes = !inQuotes;
    } else if (line[i] === delim && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += line[i];
    }
  }
  fields.push(current);

  return fields;
}

// ---------------------------------------------------------------------------
// Per-delimiter trial
// ---------------------------------------------------------------------------

/**
 * Try a specific delimiter against the input lines and produce a candidate.
 *
 * Checks consistency of delimiter counts across rows, validates the header
 * row, and computes a confidence score.
 *
 * @param lines - Non-empty lines from the input
 * @param delim - The delimiter character to test
 * @returns A CSV candidate or `null` if the delimiter is a poor fit
 */
function tryDelimiter(lines: string[], delim: string): Candidate | null {
  const delimName = delim === ',' ? 'comma' : delim === '\t' ? 'tab' : 'semicolon';

  // Count delimiters per line
  const counts = lines.map((line) => countDelimiter(line, delim));
  const headerCount = counts[0];

  // Must have at least 2 columns (i.e., at least 1 delimiter in header)
  if (headerCount === undefined || headerCount < 1) return null;

  // Reject if header looks like YAML (key: value pattern)
  const firstLine = lines[0];
  if (delim === ',' && firstLine && isLikelyYamlLine(firstLine)) return null;

  // Check consistency: each line should have the same delimiter count (+/-1)
  let consistent = 0;
  let total = 0;
  for (let i = 1; i < counts.length; i++) {
    total++;
    const count = counts[i];
    if (count !== undefined && Math.abs(count - headerCount) <= 1) {
      consistent++;
    }
  }

  if (total === 0) return null;
  const consistencyRatio = consistent / total;

  // Need at least 80% consistency
  if (consistencyRatio < 0.8) return null;

  // Header should contain text fields (not all numbers)
  if (firstLine === undefined) return null;
  const headerFields = splitCsvLine(firstLine, delim);
  const allNumeric = headerFields.every((f) => /^\s*-?\d+(\.\d+)?\s*$/.test(f));
  if (allNumeric) return null; // Header is all numbers -- unlikely to be a real CSV header

  // Reject if header fields look like natural-language prose (>4 words per field)
  const hasProseHeader = headerFields.some((f) => f.trim().split(/\s+/).length > 4);
  if (hasProseHeader) return null;

  // Calculate confidence based on consistency and number of lines
  let confidence = 0.85;
  if (consistencyRatio === 1.0) confidence = 0.9;
  if (consistencyRatio === 1.0 && lines.length >= 5) confidence = 0.95;

  return {
    format: 'csv',
    confidence,
    reason: `Consistent ${delimName}-delimited columns (${headerCount + 1} cols, ${lines.length} rows)`,
  };
}

// ---------------------------------------------------------------------------
// Main CSV detector
// ---------------------------------------------------------------------------

/**
 * Detect CSV format from the input lines.
 *
 * Tries each supported delimiter and picks the one that produces the
 * highest-confidence candidate. Returns `null` if no delimiter produces
 * a viable candidate.
 *
 * @param lines - All lines from the input (including empty ones)
 * @returns A CSV candidate or `null`
 */
export function detectCsv(lines: string[]): Candidate | null {
  // Need at least 3 lines (header + 2 data rows) for a reliable CSV signal
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
  if (nonEmptyLines.length < 3) return null;

  // Try each delimiter and pick the best one
  let bestResult: Candidate | null = null;

  for (const delim of CSV_DELIMITERS) {
    const result = tryDelimiter(nonEmptyLines, delim);
    if (result && (!bestResult || result.confidence > bestResult.confidence)) {
      bestResult = result;
    }
  }

  return bestResult;
}

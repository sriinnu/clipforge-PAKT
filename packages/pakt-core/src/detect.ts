/**
 * @module detect
 * Format detection for input text.
 *
 * This module exports the {@link detect} function that identifies
 * the format of an input string (JSON, YAML, CSV, Markdown, PAKT,
 * or plain text) using a series of heuristic checks.
 *
 * Detection runs in strict priority order: PAKT > JSON > CSV > Markdown > YAML > Text.
 * Each detector returns a candidate with a confidence score; the highest wins.
 * No external dependencies are used — all checks are pure string analysis.
 */

import type { DetectionResult } from './types.js';

// ---------------------------------------------------------------------------
// Known PAKT header keywords (matches the HeaderType union in types.ts)
// ---------------------------------------------------------------------------

const PAKT_HEADERS = new Set(['from', 'target', 'dict', 'compress', 'warning', 'version']);

/**
 * Regex for PAKT tabular array headers like `name [5]{field1|field2}:`
 * This is a very strong signal that the input is PAKT format.
 */
const PAKT_TABULAR_RE = /^\S+\s*\[\d+\]\{[^}]+\}:/m;

// ---------------------------------------------------------------------------
// Internal candidate type
// ---------------------------------------------------------------------------

interface Candidate {
  format: DetectionResult['format'];
  confidence: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// PAKT detection
// ---------------------------------------------------------------------------

function detectPakt(input: string, lines: string[]): Candidate | null {
  // Check for @header lines at start of any line
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('@')) {
      // Extract the keyword after @
      const match = trimmed.match(/^@(\w+)/);
      if (match && match[1] && PAKT_HEADERS.has(match[1])) {
        return {
          format: 'pakt',
          confidence: 1.0,
          reason: `Contains @${match[1]} header`,
        };
      }
    }
  }

  // Check for tabular array syntax (strong PAKT signal)
  if (PAKT_TABULAR_RE.test(input)) {
    return {
      format: 'pakt',
      confidence: 1.0,
      reason: 'Contains PAKT tabular array header syntax',
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// JSON detection
// ---------------------------------------------------------------------------

/**
 * Strip single-line (//) and multi-line comments from input before JSON parse.
 * This handles "JSON with comments" (JSONC) which editors like VS Code support.
 */
function stripJsonComments(text: string): string {
  let result = '';
  let i = 0;
  let inString = false;
  let escape = false;

  while (i < text.length) {
    const ch = text[i];

    if (inString) {
      result += ch;
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      i++;
      continue;
    }

    // Not in a string
    if (ch === '"') {
      inString = true;
      result += ch;
      i++;
    } else if (ch === '/' && i + 1 < text.length) {
      if (text[i + 1] === '/') {
        // Single-line comment: skip to end of line
        i += 2;
        while (i < text.length && text[i] !== '\n') i++;
      } else if (text[i + 1] === '*') {
        // Multi-line comment: skip to closing */
        i += 2;
        while (i + 1 < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
        i += 2; // skip the closing */
      } else {
        result += ch;
        i++;
      }
    } else {
      result += ch;
      i++;
    }
  }

  return result;
}

function detectJson(trimmed: string): Candidate | null {
  const firstChar = trimmed[0];

  // Must start with { or [ to be considered JSON
  if (firstChar !== '{' && firstChar !== '[') return null;

  // Try parsing directly first (fast path)
  try {
    JSON.parse(trimmed);
    return {
      format: 'json',
      confidence: 0.99,
      reason: `Starts with ${firstChar} and valid JSON parse`,
    };
  } catch {
    // Direct parse failed; try stripping comments (JSONC support)
  }

  // Try with comments stripped
  try {
    const stripped = stripJsonComments(trimmed);
    JSON.parse(stripped);
    return {
      format: 'json',
      confidence: 0.95,
      reason: `Starts with ${firstChar} and valid JSON after stripping comments`,
    };
  } catch {
    // Still fails — likely malformed JSON
  }

  // Starts with JSON-like character but cannot parse: low-confidence JSON
  return {
    format: 'json',
    confidence: 0.7,
    reason: `Starts with ${firstChar} but JSON parse failed (possibly malformed)`,
  };
}

// ---------------------------------------------------------------------------
// CSV detection
// ---------------------------------------------------------------------------

/** Supported CSV delimiters in detection order */
const CSV_DELIMITERS = [',', '\t', ';'] as const;

function detectCsv(lines: string[]): Candidate | null {
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

function tryDelimiter(lines: string[], delim: string): Candidate | null {
  const delimName = delim === ',' ? 'comma' : delim === '\t' ? 'tab' : 'semicolon';

  // Count delimiters per line
  const counts = lines.map((line) => countDelimiter(line, delim));
  const headerCount = counts[0];

  // Must have at least 2 columns (i.e., at least 1 delimiter in header)
  if (headerCount === undefined || headerCount < 1) return null;

  // Check header doesn't look like YAML (key: value pattern)
  // A CSV header with commas shouldn't have "key: value" as its primary pattern
  const firstLine = lines[0];
  if (delim === ',' && firstLine && isLikelyYamlLine(firstLine)) return null;

  // Check consistency: each line should have the same delimiter count (+-1)
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
  const headerFields = splitCsvLine(firstLine!, delim);
  const allNumeric = headerFields.every((f) => /^\s*-?\d+(\.\d+)?\s*$/.test(f));
  if (allNumeric) return null; // Header is all numbers — unlikely to be a real CSV header

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

/** Count occurrences of a delimiter in a line, respecting quoted fields */
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

/** Split a CSV line on the delimiter, respecting quoted fields */
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

/** Quick check: does this line look like a YAML key-value pair? */
function isLikelyYamlLine(line: string): boolean {
  // "key: value" pattern where key has no commas
  return /^[a-zA-Z_][a-zA-Z0-9_]*:\s+\S/.test(line.trim());
}

// ---------------------------------------------------------------------------
// Markdown detection
// ---------------------------------------------------------------------------

function detectMarkdown(input: string, lines: string[]): Candidate | null {
  let score = 0;
  const reasons: string[] = [];
  const trimmedFirst = lines[0]?.trim() ?? '';

  // Starts with # heading — strong signal
  if (/^#{1,6}\s+\S/.test(trimmedFirst)) {
    score += 0.9;
    reasons.push('starts with # heading');
  }

  // Contains markdown table pattern: | --- | or |---| or | :--- |
  if (/\|[\s-:]+\|/.test(input)) {
    score += 0.85;
    reasons.push('contains markdown table separator');
  }

  // Contains ## or ### headings (not at start — that's already caught)
  if (/^#{2,6}\s+\S/m.test(input) && !reasons.includes('starts with # heading')) {
    score += 0.8;
    reasons.push('contains markdown headings');
  }

  // Contains bold **text** or __text__
  if (/\*\*[^*]+\*\*/.test(input) || /__[^_]+__/.test(input)) {
    score += 0.3;
    reasons.push('contains bold formatting');
  }

  // Contains task lists - [ ] or - [x]
  if (/^[-*]\s+\[[ x]\]/m.test(input)) {
    score += 0.3;
    reasons.push('contains task list');
  }

  // Contains fenced code blocks ```
  if (/^```/m.test(input)) {
    score += 0.3;
    reasons.push('contains fenced code block');
  }

  // Contains [text](url) link syntax
  if (/\[[^\]]+\]\([^)]+\)/.test(input)) {
    score += 0.75;
    reasons.push('contains markdown link syntax');
  }

  if (score === 0) return null;

  // Cap confidence at 0.95, floor at 0.75
  const confidence = Math.min(0.95, Math.max(0.75, score > 1 ? 0.75 + (score - 0.75) * 0.15 : score));

  return {
    format: 'markdown',
    confidence: Math.round(confidence * 100) / 100,
    reason: reasons.length > 1
      ? `Multiple markdown signals: ${reasons.join(', ')}`
      : reasons[0] ? `Contains ${reasons[0]}` : 'Markdown patterns detected',
  };
}

// ---------------------------------------------------------------------------
// YAML detection
// ---------------------------------------------------------------------------

function detectYaml(input: string, lines: string[]): Candidate | null {
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
  if (nonEmptyLines.length === 0) return null;

  let confidence = 0;
  const reasons: string[] = [];
  const trimmedFirst = nonEmptyLines[0]!.trim();

  // Starts with --- (YAML document separator)
  if (trimmedFirst === '---') {
    confidence = 0.85;
    reasons.push('starts with --- document separator');
  }

  // Count lines that look like key: value pairs (not inside code blocks)
  let kvCount = 0;
  let inCodeBlock = false;

  for (const line of nonEmptyLines) {
    const trimmed = line.trim();

    // Track fenced code blocks so we don't count code as YAML
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Key: value pattern — key is an identifier, followed by `: ` and a value
    if (/^[a-zA-Z_][a-zA-Z0-9_.\-]*:\s+\S/.test(trimmed)) {
      kvCount++;
    }
    // Key: with nested indent (key on its own line)
    if (/^[a-zA-Z_][a-zA-Z0-9_.\-]*:\s*$/.test(trimmed)) {
      kvCount++;
    }
  }

  // Need enough key-value lines relative to total lines
  if (kvCount >= 2) {
    const kvRatio = kvCount / nonEmptyLines.length;
    if (kvRatio >= 0.5) {
      confidence = Math.max(confidence, 0.8);
      reasons.push('key-value pairs with colon separator');
    } else if (kvRatio >= 0.3) {
      confidence = Math.max(confidence, 0.7);
      reasons.push('some key-value pairs detected');
    }
  }

  // Check for YAML-specific indented blocks under keys
  let hasIndentedBlock = false;
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1]!;
    const curr = lines[i]!;
    // Previous line ends with : (key with nested content) and current is indented
    if (/^[a-zA-Z_]\S*:\s*$/.test(prev.trim()) && /^\s{2,}/.test(curr) && curr.trim().length > 0) {
      hasIndentedBlock = true;
      break;
    }
  }

  if (hasIndentedBlock) {
    confidence = Math.max(confidence, 0.75);
    if (!reasons.includes('key-value pairs with colon separator')) {
      reasons.push('indented blocks under keys');
    }
  }

  // Check for YAML list syntax (- item under a key)
  const hasYamlLists = /^\s+-\s+\S/m.test(input);
  if (hasYamlLists && kvCount >= 1) {
    confidence = Math.max(confidence, 0.75);
    reasons.push('YAML list syntax');
  }

  // Single-line key: value — very low confidence, could be anything
  if (kvCount === 1 && nonEmptyLines.length === 1) {
    confidence = Math.max(confidence, 0.6);
    if (reasons.length === 0) reasons.push('single key-value pair');
  }

  if (confidence === 0) return null;

  return {
    format: 'yaml',
    confidence: Math.round(confidence * 100) / 100,
    reason: reasons.join('; ') || 'YAML structure detected',
  };
}

// ---------------------------------------------------------------------------
// Main detect function
// ---------------------------------------------------------------------------

/**
 * Detect the format of input text.
 *
 * Runs a series of heuristic checks in priority order:
 * 1. **PAKT** -- Checks for `@from`, `@dict`, `@version` headers and tabular syntax.
 * 2. **JSON** -- Attempts `JSON.parse()` on trimmed input.
 * 3. **CSV** -- Looks for consistent comma/tab/semicolon delimiters across lines.
 * 4. **Markdown** -- Looks for `#` headings, tables, links, code blocks.
 * 5. **YAML** -- Checks for key-value patterns with `:` separators, leading `---`.
 * 6. **Text** -- Fallback when no structured format is detected.
 *
 * The returned confidence score (0-1) reflects how certain the
 * detection is. The detector with the highest confidence wins.
 * When PAKT is detected it always wins (confidence 1.0). For other
 * formats, each detector produces a candidate and the highest is selected.
 *
 * @param input - The text to analyze
 * @returns Detection result with format, confidence, and reasoning
 *
 * @example
 * ```ts
 * import { detect } from '@yugenlab/pakt';
 *
 * detect('{"key": "value"}');
 * // { format: 'json', confidence: 0.99, reason: 'Starts with { and valid JSON parse' }
 *
 * detect('name: Sriinnu\nage: 28');
 * // { format: 'yaml', confidence: 0.8, reason: 'Key-value pairs with colon separator' }
 *
 * detect('@from json\nname: Alice');
 * // { format: 'pakt', confidence: 1.0, reason: 'Contains @from header' }
 *
 * detect('id,name,role\n1,Alice,dev\n2,Bob,pm');
 * // { format: 'csv', confidence: 0.9, reason: 'Consistent comma-delimited columns' }
 *
 * detect('# My Document\n\nSome text here.');
 * // { format: 'markdown', confidence: 0.9, reason: 'Contains starts with # heading' }
 *
 * detect('Hello, world!');
 * // { format: 'text', confidence: 0.5, reason: 'No structured format detected' }
 * ```
 */
export function detect(input: string): DetectionResult {
  const trimmed = input.trim();

  // Empty or whitespace-only input is plain text
  if (trimmed.length === 0) {
    return { format: 'text', confidence: 0.5, reason: 'Empty or whitespace-only input' };
  }

  const lines = input.split('\n');

  // ---- Priority 1: PAKT (always wins if detected) ----
  const pakt = detectPakt(input, lines);
  if (pakt) return pakt;

  // ---- Priority 2: JSON (check before others since it's unambiguous when valid) ----
  const json = detectJson(trimmed);
  // If JSON parsed successfully (high confidence), return immediately.
  // Malformed JSON (0.7) still competes with other formats below.
  if (json && json.confidence >= 0.95) return json;

  // ---- Collect candidates from remaining detectors ----
  const candidates: Candidate[] = [];

  // Include malformed-JSON candidate if present
  if (json) candidates.push(json);

  // Priority 3: CSV
  const csv = detectCsv(lines);
  if (csv) candidates.push(csv);

  // Priority 4: Markdown
  const markdown = detectMarkdown(input, lines);
  if (markdown) candidates.push(markdown);

  // Priority 5: YAML
  const yaml = detectYaml(input, lines);
  if (yaml) candidates.push(yaml);

  // Pick the candidate with the highest confidence
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.confidence - a.confidence);
    const winner = candidates[0]!;
    return {
      format: winner.format,
      confidence: winner.confidence,
      reason: winner.reason,
    };
  }

  // ---- Priority 6: Text (fallback) ----
  return { format: 'text', confidence: 0.5, reason: 'No structured format detected' };
}

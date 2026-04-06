/**
 * @module detect/detect-pakt
 * PAKT format detection.
 *
 * Identifies PAKT-formatted input by looking for two strong signals:
 * 1. Lines starting with `@keyword` where keyword is a known PAKT header
 *    (`from`, `target`, `dict`, `compress`, `warning`, `version`).
 * 2. Tabular array syntax like `name [5]{field1|field2}:`.
 *
 * When either signal is present the detector returns confidence 1.0,
 * meaning PAKT always wins over other formats.
 */

import type { Candidate } from './types.js';

// ---------------------------------------------------------------------------
// Known PAKT header keywords (matches the HeaderType union in types.ts)
// ---------------------------------------------------------------------------

/** Set of recognised `@header` keywords that signal PAKT format */
const PAKT_HEADERS = new Set(['from', 'target', 'dict', 'compress', 'warning', 'version']);

/**
 * Regex for PAKT tabular array headers like `name [5]{field1|field2}:`
 * This is a very strong signal that the input is PAKT format.
 */
const PAKT_TABULAR_RE = /^\S+\s*\[\d+\]\{[^}]+\}:/m;

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

/**
 * Detect PAKT format in the given input.
 *
 * Scans every line for `@keyword` headers and tests the full input
 * against the tabular array regex. Returns `null` when no PAKT
 * signal is found.
 *
 * @param input - Full raw input text
 * @param lines - Pre-split lines of `input`
 * @returns A candidate with confidence 1.0, or `null`
 */
/** Valid formats that can follow @from in a PAKT document. */
const VALID_FROM_FORMATS = new Set(['json', 'yaml', 'csv', 'text', 'markdown', 'pakt']);

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: multi-signal PAKT detection requires layered header and format validation
export function detectPakt(input: string, lines: string[]): Candidate | null {
  // Primary signal: first non-empty line must start with a known PAKT @header.
  // This prevents false positives on text containing @from/@dict mid-document,
  // @username handles, @decorator patterns, etc.
  const firstLine = lines[0]?.trim() ?? '';
  const headerMatch = firstLine.match(/^@(\w+)/);
  const firstKeyword = headerMatch?.[1] ?? '';

  if (!PAKT_HEADERS.has(firstKeyword)) {
    // First line doesn't start with a known PAKT header.
    // Still check for tabular array syntax — a very strong PAKT-specific signal.
    if (PAKT_TABULAR_RE.test(input)) {
      return { format: 'pakt', confidence: 1.0, reason: 'Contains PAKT tabular array syntax' };
    }
    return null;
  }

  // Validate the first keyword specifically:
  // @from must be followed by a valid format name
  if (firstKeyword === 'from') {
    const fromMatch = firstLine.match(/^@from\s+(\w+)/);
    if (!fromMatch?.[1] || !VALID_FROM_FORMATS.has(fromMatch[1])) {
      return null; // "@from John" or "@from " — not PAKT
    }
    return { format: 'pakt', confidence: 1.0, reason: `Starts with @from ${fromMatch[1]} header` };
  }

  // Other known headers (@version, @target, @compress, @warning, @dict) are valid first lines
  // but require at least one more PAKT signal (another @header or tabular syntax)
  // to avoid false positives on text that happens to start with e.g. "@warning".
  let headerCount = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    const m = trimmed.match(/^@(\w+)/);
    if (m?.[1] && PAKT_HEADERS.has(m[1])) headerCount++;
    if (headerCount >= 2) {
      return {
        format: 'pakt',
        confidence: 1.0,
        reason: `Contains multiple @${firstKeyword} headers`,
      };
    }
  }

  // Single header + tabular syntax = PAKT
  if (PAKT_TABULAR_RE.test(input)) {
    return {
      format: 'pakt',
      confidence: 1.0,
      reason: 'Contains PAKT header and tabular array syntax',
    };
  }

  return null;
}

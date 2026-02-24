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
const PAKT_HEADERS = new Set([
  'from',
  'target',
  'dict',
  'compress',
  'warning',
  'version',
]);

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
export function detectPakt(input: string, lines: string[]): Candidate | null {
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

/**
 * @module detect/detect-json
 * JSON format detection.
 *
 * Identifies JSON (and JSONC) input by attempting `JSON.parse()`.
 * The detector follows a three-tier approach:
 *
 * 1. **Fast path** -- Direct `JSON.parse()`. Confidence 0.99.
 * 2. **JSONC fallback** -- Strip `//` and block comments, then re-parse.
 *    Confidence 0.95.
 * 3. **Malformed** -- Input starts with `{` or `[` but cannot parse.
 *    Confidence 0.7 (competes with other detectors).
 *
 * The `stripJsonComments` utility is kept here as a local copy per
 * project instruction (another agent handles consolidation).
 */

import type { Candidate } from './types.js';

// ---------------------------------------------------------------------------
// JSONC comment stripping
// ---------------------------------------------------------------------------

/**
 * Strip single-line (`//`) and multi-line comments from input before JSON parse.
 * Handles "JSON with comments" (JSONC) which editors like VS Code support.
 * Iterates character-by-character to avoid stripping inside JSON string literals.
 *
 * @param text - Possibly-commented JSON text
 * @returns Clean JSON text with all comments removed
 */
function stripJsonComments(text: string): string {
  let result = '';
  let i = 0;
  let inString = false;
  let escaped = false;

  while (i < text.length) {
    const ch = text[i];

    if (inString) {
      result += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      i++;
      continue;
    }

    // Not inside a string literal
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

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

/**
 * Detect JSON format from a trimmed input string.
 *
 * Returns `null` immediately if the input does not start with `{` or `[`.
 * Otherwise tries increasingly lenient parsing strategies.
 *
 * @param trimmed - Whitespace-trimmed input text
 * @returns A candidate with confidence 0.7-0.99, or `null`
 */
export function detectJson(trimmed: string): Candidate | null {
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
    // Still fails -- likely malformed JSON
  }

  // Starts with JSON-like character but cannot parse: low-confidence JSON
  return {
    format: 'json',
    confidence: 0.7,
    reason: `Starts with ${firstChar} but JSON parse failed (possibly malformed)`,
  };
}

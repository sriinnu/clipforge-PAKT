/**
 * @module format-parsers
 * Dispatches raw input text to format-specific parsers (JSON, YAML, CSV).
 *
 * Re-exports individual parsers for direct use. The primary entry point
 * is {@link parseInput}, which routes by detected format.
 */

import type { PaktFormat } from '../types.js';
import { parseCsv } from './csv.js';
import { parseYaml } from './yaml.js';

// Re-exports for direct use
export { parseYaml, yamlScalar, indentOf } from './yaml.js';
export { parseCsv, splitCsvLine, detectCsvDelimiter, inferCsvValue } from './csv.js';

// ---------------------------------------------------------------------------
// JSONC comment stripping
// ---------------------------------------------------------------------------

/**
 * Strip `//` and block comments from JSONC text, respecting string literals.
 * Iterates character-by-character to avoid stripping inside JSON strings.
 * @param text - JSONC source text
 * @returns JSON text with comments removed
 */
export function stripJsonComments(text: string): string {
  let result = '';
  let i = 0;
  let inString = false;
  let escaped = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === undefined) break;
    if (inString) {
      result += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      result += ch;
      i++;
    } else if (ch === '/' && i + 1 < text.length) {
      if (text[i + 1] === '/') {
        i += 2;
        while (i < text.length && text[i] !== '\n') i++;
      } else if (text[i + 1] === '*') {
        i += 2;
        while (i + 1 < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
        i += 2;
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
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Parse raw input text into a JS value based on the detected format.
 * Routes to JSON.parse, YAML parser, or CSV parser as appropriate.
 * Non-structural formats (markdown, text, pakt) return wrapper objects.
 *
 * @param input - Raw input text
 * @param format - Detected or specified format
 * @returns Parsed JS value
 * @throws {SyntaxError} If JSON parsing fails (even after JSONC stripping)
 */
export function parseInput(input: string, format: PaktFormat): unknown {
  switch (format) {
    case 'json': {
      try {
        return JSON.parse(input) as unknown;
      } catch {
        /* JSONC fallback */
      }
      return JSON.parse(stripJsonComments(input)) as unknown;
    }
    case 'yaml':
      return parseYaml(input);
    case 'csv':
      return parseCsv(input);
    case 'markdown':
      return { _markdown: input };
    case 'text':
      return { _text: input };
    case 'pakt':
      return { _pakt: input };
  }
}

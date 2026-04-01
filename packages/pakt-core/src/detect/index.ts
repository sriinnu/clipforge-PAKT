/**
 * @module detect
 * Format detection for input text.
 *
 * This module exports the {@link detect} function that identifies
 * the format of an input string (JSON, YAML, CSV, Markdown, PAKT,
 * or plain text) using a series of heuristic checks.
 *
 * Detection runs in strict priority order:
 *   Envelope > PAKT > JSON > CSV > Markdown > YAML > Text.
 *
 * Each detector returns a candidate with a confidence score; the
 * highest wins. No external dependencies are used -- all checks
 * are pure string analysis.
 *
 * Sub-module layout:
 * - {@link detect/detect-pakt}     -- PAKT header & tabular detection
 * - {@link detect/detect-json}     -- JSON / JSONC detection
 * - {@link detect/detect-csv}      -- CSV delimiter detection
 * - {@link detect/detect-markdown} -- Markdown signal detection
 * - {@link detect/detect-yaml}     -- YAML key-value detection
 * - {@link detect/detect-envelope} -- HTTP envelope detection
 */

import type { DetectionResult, EnvelopeInfo } from '../types.js';
import { detectCsv } from './detect-csv.js';
import { detectEnvelope } from './detect-envelope.js';
import { detectJson } from './detect-json.js';
import { detectMarkdown } from './detect-markdown.js';
import { detectPakt } from './detect-pakt.js';
import { detectYaml } from './detect-yaml.js';
import type { Candidate } from './types.js';

// Re-export the Candidate type for consumers that need it
export type { Candidate } from './types.js';

// ---------------------------------------------------------------------------
// Main detect function
// ---------------------------------------------------------------------------

/**
 * Detect the format of input text.
 *
 * Runs a series of heuristic checks in priority order:
 * 1. **Envelope** -- Strips HTTP envelope if present, detects body format.
 * 2. **PAKT** -- Checks for `@from`, `@dict`, `@version` headers and tabular syntax.
 * 3. **JSON** -- Attempts `JSON.parse()` on trimmed input.
 * 4. **CSV** -- Looks for consistent comma/tab/semicolon delimiters across lines.
 * 5. **Markdown** -- Looks for `#` headings, tables, links, code blocks.
 * 6. **YAML** -- Checks for key-value patterns with `:` separators, leading `---`.
 * 7. **Text** -- Fallback when no structured format is detected.
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
 * import { detect } from '@sriinnu/pakt';
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

  // ---- Priority 0: Envelope detection (e.g. HTTP response wrapping JSON) ----
  const envelope = detectEnvelope(input);
  if (envelope) {
    // Detect the format of the body content (recursive call on body only)
    const bodyResult = detect(envelope.body);
    // Only wrap in envelope if the body is a structured format worth compressing
    if (bodyResult.format !== 'text') {
      const envInfo: EnvelopeInfo = {
        type: 'http',
        preamble: envelope.preamble,
        bodyOffset: envelope.bodyOffset,
      };
      return {
        ...bodyResult,
        reason: `HTTP envelope with ${bodyResult.format} body`,
        envelope: envInfo,
      };
    }
  }

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
    const winner = candidates[0];
    if (!winner) return null;
    return {
      format: winner.format,
      confidence: winner.confidence,
      reason: winner.reason,
    };
  }

  // ---- Priority 6: Text (fallback) ----
  return { format: 'text', confidence: 0.5, reason: 'No structured format detected' };
}

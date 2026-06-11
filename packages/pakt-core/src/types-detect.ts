/**
 * @module types-detect
 * Format-detection types. Split out of `types.ts` to keep that module
 * under the per-file line cap; everything here is re-exported from
 * `./types.js`, which remains the single import surface.
 */

import type { PaktFormat } from './types.js';

/**
 * Information about a detected envelope wrapping the body content.
 * For example, an HTTP response with headers wrapping a JSON body.
 * @example
 * ```ts
 * const env: EnvelopeInfo = {
 *   type: 'http',
 *   preamble: ['HTTP/1.1 200 OK', 'Content-Type: application/json'],
 *   bodyOffset: 52,
 * };
 * ```
 */
export interface EnvelopeInfo {
  /** Type of envelope detected */
  type: 'http';
  /** The preamble lines (status line, headers) before the body */
  preamble: string[];
  /** Character offset where the body starts in the original input */
  bodyOffset: number;
}

/**
 * Result from detect(). Identifies the format of input text.
 * @example
 * ```ts
 * const r: DetectionResult = detect('{"key": "value"}');
 * // { format: 'json', confidence: 0.99, reason: 'Valid JSON parse' }
 * ```
 */
export interface DetectionResult {
  /** Detected format */
  format: PaktFormat;
  /** Confidence score (0 = none, 1 = certain) */
  confidence: number;
  /** Human-readable reasoning */
  reason: string;
  /** If present, the input has an envelope (e.g. HTTP headers) wrapping the body */
  envelope?: EnvelopeInfo;
}

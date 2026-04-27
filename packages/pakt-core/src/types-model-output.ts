/**
 * @module types-model-output
 * Types for `interpretModelOutput()` — the LLM-response interpreter.
 *
 * Split out of `types.ts` to keep the canonical types module under the
 * 400-line cap. Re-exported from `types.ts` so existing
 * `from './types.js'` imports continue to work.
 */

import type { ValidationResult } from './types-validation.js';
import type { PaktFormat } from './types.js';

/**
 * Final action taken when interpreting an LLM response.
 *
 * - `passthrough` — the response was not PAKT; returned untouched.
 * - `invalid-pakt` — looked like PAKT but failed validation/repair.
 * - `decompressed` — valid PAKT, decompressed cleanly.
 * - `repaired-decompressed` — decompressed only after best-effort repair.
 */
export type ModelOutputAction =
  | 'passthrough'
  | 'invalid-pakt'
  | 'decompressed'
  | 'repaired-decompressed';

/**
 * Options for `interpretModelOutput()`.
 *
 * Use this helper when an LLM may respond with raw prose, JSON, or valid PAKT.
 * It auto-detects PAKT responses, optionally repairs minor syntax issues, and
 * decompresses them back to structured output.
 */
export interface ModelOutputOptions {
  /** Requested output format when decompression succeeds. Defaults to the `@from` header format. */
  outputFormat?: PaktFormat;
  /** Attempt best-effort repair before giving up on malformed PAKT. @default true */
  attemptRepair?: boolean;
  /** Search fenced code blocks for embedded PAKT. @default true */
  extractFenced?: boolean;
}

/**
 * Result from `interpretModelOutput()`.
 *
 * `text` is always the safest value to feed downstream:
 * - raw model response for passthrough / invalid PAKT
 * - decompressed output for valid PAKT
 */
export interface ModelOutputResult {
  /** Action taken by the interpreter. */
  action: ModelOutputAction;
  /** Final text for downstream consumers. */
  text: string;
  /** Structured data when decompression succeeds; otherwise the raw response text. */
  data: unknown;
  /** Original raw model response before any extraction or decompression. */
  originalText: string;
  /** Extracted PAKT candidate when one was found. */
  candidateText?: string;
  /** Format detected for the original model response. */
  responseFormat: PaktFormat;
  /** Original structured format declared inside PAKT, when decompressed. */
  originalFormat?: PaktFormat;
  /** True when the decompressed PAKT had `@warning lossy`. */
  wasLossy: boolean;
  /** True when best-effort repair was required before decompression. */
  repaired: boolean;
  /** True when the PAKT candidate came from a fenced code block instead of the full response. */
  extractedFromFence: boolean;
  /** Validation report for the chosen PAKT candidate, when applicable. */
  validation?: ValidationResult;
}

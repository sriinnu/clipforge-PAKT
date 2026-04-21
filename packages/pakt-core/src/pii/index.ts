/**
 * @module pii
 * Barrel export for PII (personally-identifiable information) detection
 * and redaction helpers.
 *
 * @example
 * ```ts
 * import { detectPII, redactPII } from '@sriinnu/pakt';
 * ```
 */

export { detectPII } from './detector.js';
export type { PIIKind, PIIMatch, PIIDetectionOptions } from './detector.js';

export { redactPII } from './redact.js';
export type { RedactPIIOptions, RedactPIIResult } from './redact.js';

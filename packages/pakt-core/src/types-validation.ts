/**
 * @module types-validation
 * Validation result types for the PAKT validator.
 *
 * Split out of `types.ts` to keep the canonical types module under the
 * 400-line cap. Re-exported from `types.ts` so existing
 * `from './types.js'` imports continue to work.
 */

/**
 * Validation result from validate().
 * @example
 * ```ts
 * const r: ValidationResult = {
 *   valid: true, errors: [],
 *   warnings: [{ line: 3, column: 1, message: 'Unused alias $c', code: 'W001' }],
 * };
 * ```
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * A validation error with source location.
 * @example
 * ```ts
 * const err: ValidationError = { line: 5, column: 12, message: 'Undefined alias $z', code: 'E001' };
 * ```
 */
export interface ValidationError {
  line: number;
  column: number;
  message: string;
  /** Machine-readable code (e.g., "E001") */
  code: string;
}

/**
 * A non-fatal validation warning with source location.
 * @example
 * ```ts
 * const w: ValidationWarning = { line: 2, column: 1, message: 'Missing @from header', code: 'W002' };
 * ```
 */
export interface ValidationWarning {
  line: number;
  column: number;
  message: string;
  code: string;
}

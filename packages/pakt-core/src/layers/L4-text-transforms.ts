/**
 * @module layers/L4-text-transforms
 * Text-level lossy transforms applied after AST serialization.
 *
 * These transforms operate on the final PAKT string to achieve
 * last-mile token savings. Each is applied progressively, stopping
 * once the output fits within the caller-supplied token budget.
 *
 * Transforms in application order:
 * - **A -- Whitespace normalization**: collapse redundant spaces
 * - **B -- Abbreviated values**: shorten common boolean/null literals
 * - **C -- Numeric precision reduction**: reduce decimal places
 */

import { countTokens } from '../tokens/counter.js';

// ---------------------------------------------------------------------------
// Transform A — Whitespace normalization
// ---------------------------------------------------------------------------

/**
 * Collapse multiple consecutive spaces to a single space and
 * strip trailing whitespace from every line.
 *
 * @param text - The serialized PAKT string
 * @returns The whitespace-normalized string
 *
 * @example
 * ```ts
 * normalizeWhitespace('key:  value  \n  next:   line  ');
 * // 'key: value\n next: line'
 * ```
 */
export function normalizeWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      // Preserve leading indent (important for PAKT structure)
      const match = line.match(/^(\s*)(.*)/);
      if (!match) return line;
      const [, indent, rest] = match;
      // Collapse multiple spaces in the content portion only
      const collapsed = rest?.replace(/ {2,}/g, ' ').trimEnd();
      return indent + collapsed;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Transform B — Abbreviated values
// ---------------------------------------------------------------------------

/**
 * Replace common verbose value patterns in PAKT value positions
 * (after `|` delimiters or after `: `).
 *
 * Replacements:
 * - `true`  -> `T`
 * - `false` -> `F`
 * - `null`  -> `~`
 *
 * Only replaces in value positions to avoid corrupting keys or headers.
 *
 * @param text - The serialized PAKT string
 * @returns The abbreviated string
 *
 * @example
 * ```ts
 * abbreviateValues('active: true\nenabled|false|null');
 * // 'active: T\nenabled|F|~'
 * ```
 */
export function abbreviateValues(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      // Skip header lines (start with @)
      if (line.trimStart().startsWith('@')) return line;
      // Skip comment lines (start with %)
      if (line.trimStart().startsWith('%')) return line;

      // Replace values after `: ` (key-value pairs)
      let result = line.replace(
        /^(\s*\S+:\s+)(true|false|null)$/,
        (_match, prefix: string, val: string) => {
          return prefix + abbreviate(val);
        },
      );

      // Replace values in pipe-delimited rows
      if (result.includes('|')) {
        result = abbreviatePipeValues(result);
      }

      return result;
    })
    .join('\n');
}

/**
 * Abbreviate a single value string.
 * @param val - The value to abbreviate
 * @returns The abbreviated form
 */
function abbreviate(val: string): string {
  switch (val) {
    case 'true':
      return 'T';
    case 'false':
      return 'F';
    case 'null':
      return '~';
    default:
      return val;
  }
}

/**
 * Replace true/false/null in pipe-delimited value positions.
 * @param line - A line containing pipe delimiters
 * @returns The line with abbreviated values
 */
function abbreviatePipeValues(line: string): string {
  // Split by pipe, abbreviate each cell, rejoin
  const match = line.match(/^(\s*)(.*)/);
  if (!match) return line;
  const [, indent, content] = match;

  const parts = content?.split('|');
  const abbreviated = parts.map((part) => {
    const trimmed = part.trim();
    if (trimmed === 'true' || trimmed === 'false' || trimmed === 'null') {
      return abbreviate(trimmed);
    }
    return part;
  });

  return indent + abbreviated.join('|');
}

// ---------------------------------------------------------------------------
// Transform C — Numeric precision reduction
// ---------------------------------------------------------------------------

/**
 * Reduce decimal precision in numeric values to at most 2 decimal places.
 * Only affects numbers with more than 2 decimal places.
 *
 * @param text - The serialized PAKT string
 * @returns The string with reduced numeric precision
 *
 * @example
 * ```ts
 * reduceNumericPrecision('pi: 3.14159265');
 * // 'pi: 3.14'
 * ```
 */
export function reduceNumericPrecision(text: string): string {
  // Match numbers with 3+ decimal places in value positions
  return text.replace(/(\d+\.\d{3,})/g, (_match, num: string) => {
    const parsed = Number.parseFloat(num);
    if (!Number.isFinite(parsed)) return num;
    return parsed.toFixed(2);
  });
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Apply text-level lossy transforms progressively until within budget.
 *
 * Transform order:
 * 1. Whitespace normalization (cheapest, usually sufficient)
 * 2. Value abbreviation (moderate savings)
 * 3. Numeric precision reduction (last resort)
 *
 * After each transform, the token count is checked. Processing stops
 * as soon as the output fits within budget.
 *
 * @param text   - Serialized PAKT string
 * @param budget - Target token budget (0 or negative = no-op)
 * @returns The (possibly shortened) PAKT string
 *
 * @example
 * ```ts
 * const result = applyTextTransforms(paktString, 200);
 * ```
 */
export function applyTextTransforms(text: string, budget: number): string {
  // No-op for non-positive budget
  if (budget <= 0) return text;

  // Check if already within budget
  if (countTokens(text) <= budget) return text;

  // Transform A: whitespace normalization
  let result = normalizeWhitespace(text);
  if (countTokens(result) <= budget) return result;

  // Transform B: value abbreviation
  result = abbreviateValues(result);
  if (countTokens(result) <= budget) return result;

  // Transform C: numeric precision reduction
  result = reduceNumericPrecision(result);

  return result;
}

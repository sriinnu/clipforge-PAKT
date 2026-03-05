/**
 * @module utils/validate
 * Validation utility for PAKT documents. Checks structural and semantic
 * correctness of PAKT-formatted strings and reports errors/warnings.
 *
 * The {@link repair} function is re-exported from `./repair.js`.
 */

import type { ValidationError, ValidationResult, ValidationWarning } from '../types.js';

export { repair } from './repair.js';

// ---------------------------------------------------------------------------
// Known formats (must match PaktFormat)
// ---------------------------------------------------------------------------

const KNOWN_FORMATS = new Set(['json', 'yaml', 'csv', 'markdown', 'pakt', 'text']);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a PAKT document string for structural and semantic correctness.
 *
 * Checks performed:
 * - Valid `@from` header (required, must be a known format)
 * - `@dict` block has matching `@end`
 * - Dictionary aliases are used (warn if defined but unused)
 * - Dictionary aliases are defined (error if used but undefined)
 * - Tabular array counts match actual row counts
 * - Inline array counts match actual item counts
 * - Consistent indentation (2-space)
 * - No trailing whitespace
 * - Pipe-delimited rows match header field count
 * - No empty lines inside tabular arrays
 *
 * @param pakt - A PAKT-formatted string to validate
 * @returns Validation result with errors and warnings
 *
 * @example
 * ```ts
 * import { validate } from '@sriinnu/pakt';
 * const result = validate('@from json\nname: Alice');
 * console.log(result.valid); // true
 * ```
 */
export function validate(pakt: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const text = pakt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n');

  // Track state as we walk lines
  let hasFrom = false;
  let dictOpen = false;
  let dictOpenLine = -1;
  const definedAliases = new Map<string, number>(); // alias -> line
  const usedAliases = new Set<string>();
  let inTabular = false;
  let tabularKey = '';
  let tabularDeclaredCount = 0;
  let tabularActualCount = 0;
  let tabularFields: string[] = [];
  let tabularIndent = -1;
  let tabularHeaderLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    // ---- Trailing whitespace check ----------------------------------------
    if (line.length > 0 && line !== line.trimEnd()) {
      warnings.push({
        line: lineNum,
        column: line.trimEnd().length + 1,
        message: 'Trailing whitespace',
        code: 'W003',
      });
    }

    const trimmed = line.trim();

    // ---- Empty line inside tabular ends the block -------------------------
    if (trimmed === '' && inTabular) {
      finalizeTabular(
        errors,
        tabularKey,
        tabularDeclaredCount,
        tabularActualCount,
        tabularHeaderLine,
      );
      inTabular = false;
      continue;
    }

    if (trimmed === '') continue;

    // ---- Indentation consistency check ------------------------------------
    const leadingSpaces = line.length - line.trimStart().length;
    if (leadingSpaces > 0 && leadingSpaces % 2 !== 0) {
      warnings.push({
        line: lineNum,
        column: 1,
        message: `Odd indentation (${leadingSpaces} spaces), expected multiples of 2`,
        code: 'W002',
      });
    }

    // ---- Close tabular if indent drops ------------------------------------
    if (inTabular && leadingSpaces <= tabularIndent && !trimmed.startsWith('%')) {
      finalizeTabular(
        errors,
        tabularKey,
        tabularDeclaredCount,
        tabularActualCount,
        tabularHeaderLine,
      );
      inTabular = false;
    }

    // ---- @from header -----------------------------------------------------
    if (trimmed.startsWith('@from ')) {
      hasFrom = true;
      const fmt = trimmed.slice(6).trim();
      if (!KNOWN_FORMATS.has(fmt)) {
        errors.push({
          line: lineNum,
          column: 7,
          message: `Unknown format "${fmt}" in @from header`,
          code: 'E002',
        });
      }
      continue;
    }
    if (trimmed === '@from') {
      hasFrom = true;
      errors.push({
        line: lineNum,
        column: 1,
        message: '@from header has no format value',
        code: 'E002',
      });
      continue;
    }

    // ---- @dict / @end -----------------------------------------------------
    if (trimmed === '@dict') {
      if (dictOpen) {
        errors.push({
          line: lineNum,
          column: 1,
          message: 'Nested @dict blocks are not allowed',
          code: 'E004',
        });
      }
      dictOpen = true;
      dictOpenLine = lineNum;
      continue;
    }
    if (trimmed === '@end') {
      if (!dictOpen) {
        errors.push({
          line: lineNum,
          column: 1,
          message: '@end without matching @dict',
          code: 'E003',
        });
      }
      dictOpen = false;
      continue;
    }

    // ---- Dict entries (inside @dict block) --------------------------------
    if (dictOpen) {
      const entryMatch = trimmed.match(/^(\$\w+)\s*:\s*(.*)$/);
      if (entryMatch) {
        definedAliases.set(entryMatch[1]!, lineNum);
      }
      continue;
    }

    // ---- Skip comment and other header lines ------------------------------
    if (trimmed.startsWith('%') || trimmed.startsWith('@')) continue;

    // ---- Tabular rows (inside tabular block) ------------------------------
    if (inTabular) {
      if (trimmed.startsWith('%')) continue;
      tabularActualCount++;
      const fieldCount = countPipeFields(trimmed);
      if (fieldCount !== tabularFields.length) {
        errors.push({
          line: lineNum,
          column: 1,
          message: `Row has ${fieldCount} field(s) but header declares ${tabularFields.length} (${tabularFields.join('|')})`,
          code: 'E006',
        });
      }
      collectAliasUsage(trimmed, usedAliases);
      continue;
    }

    // ---- Detect tabular array header --------------------------------------
    const tabMatch = trimmed.match(/^(\w[\w.]*)\s*\[(\d+)\]\s*\{([^}]+)\}\s*:$/);
    if (tabMatch) {
      inTabular = true;
      tabularKey = tabMatch[1]!;
      tabularDeclaredCount = Number.parseInt(tabMatch[2]!, 10);
      tabularFields = tabMatch[3]?.split('|').map((f) => f.trim()) ?? [];
      tabularActualCount = 0;
      tabularIndent = leadingSpaces;
      tabularHeaderLine = lineNum;
      continue;
    }

    // ---- Detect inline array ----------------------------------------------
    const inlineMatch = trimmed.match(/^(\w[\w.]*)\s*\[(\d+)\]\s*:\s*(.+)$/);
    if (inlineMatch) {
      const declaredCount = Number.parseInt(inlineMatch[2]!, 10);
      const items = (inlineMatch[3] ?? '').split(',').map((v) => v.trim());
      if (items.length !== declaredCount) {
        errors.push({
          line: lineNum,
          column: 1,
          message: `Inline array "${inlineMatch[1]}" declares [${declaredCount}] but has ${items.length} item(s)`,
          code: 'E007',
        });
      }
      for (const item of items) collectAliasUsage(item, usedAliases);
      continue;
    }

    // ---- Detect list array header (key [N]:) ------------------------------
    const listMatch = trimmed.match(/^(\w[\w.]*)\s*\[(\d+)\]\s*:$/);
    if (listMatch) {
      const listKey = listMatch[1]!;
      const declaredCount = Number.parseInt(listMatch[2]!, 10);
      const actualCount = countListItems(lines, i + 1, leadingSpaces);
      if (actualCount !== declaredCount) {
        errors.push({
          line: lineNum,
          column: 1,
          message: `List array "${listKey}" declares [${declaredCount}] but has ${actualCount} item(s)`,
          code: 'E007',
        });
      }
      continue;
    }

    // ---- Scan body lines for alias usage ----------------------------------
    collectAliasUsage(trimmed, usedAliases);
  }

  // ---- Finalize any open tabular block ------------------------------------
  if (inTabular) {
    finalizeTabular(
      errors,
      tabularKey,
      tabularDeclaredCount,
      tabularActualCount,
      tabularHeaderLine,
    );
  }

  // ---- Missing @from header -----------------------------------------------
  if (!hasFrom) {
    errors.push({ line: 1, column: 1, message: 'Missing required @from header', code: 'E001' });
  }

  // ---- Unclosed @dict block -----------------------------------------------
  if (dictOpen) {
    errors.push({
      line: dictOpenLine,
      column: 1,
      message: '@dict block missing @end',
      code: 'E003',
    });
  }

  // ---- Unused aliases (warning) -------------------------------------------
  for (const [alias, defLine] of definedAliases) {
    if (!usedAliases.has(alias)) {
      warnings.push({
        line: defLine,
        column: 1,
        message: `Unused dictionary alias "${alias}"`,
        code: 'W001',
      });
    }
  }

  // ---- Undefined alias references (error) ---------------------------------
  for (const alias of usedAliases) {
    if (!definedAliases.has(alias)) {
      errors.push({
        line: 1,
        column: 1,
        message: `Undefined alias "${alias}" used in body`,
        code: 'E005',
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Finalize a tabular array block -- check declared vs actual row count. */
function finalizeTabular(
  errors: ValidationError[],
  key: string,
  declared: number,
  actual: number,
  headerLine: number,
): void {
  if (actual !== declared) {
    errors.push({
      line: headerLine,
      column: 1,
      message: `Tabular array "${key}" declares [${declared}] but has ${actual} row(s)`,
      code: 'E007',
    });
  }
}

/** Count pipe-separated fields in a tabular row, respecting quoted strings. */
function countPipeFields(row: string): number {
  let count = 1;
  let inQuote = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]!;
    if (ch === '"') inQuote = !inQuote;
    else if (ch === '\\' && inQuote && i + 1 < row.length) i++;
    else if (ch === '|' && !inQuote) count++;
  }
  return count;
}

/** Count dash-prefixed list items indented deeper than parentIndent. */
function countListItems(lines: string[], startIdx: number, parentIndent: number): number {
  let count = 0;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= parentIndent) break;
    if (trimmed.startsWith('- ')) count++;
  }
  return count;
}

/** Collect `$alias` references from a text line into the usedAliases set. */
function collectAliasUsage(text: string, used: Set<string>): void {
  const aliasRe = /\$\w+/g;
  let m: RegExpExecArray | null = aliasRe.exec(text);
  while (m !== null) {
    used.add(m[0]);
    m = aliasRe.exec(text);
  }
}

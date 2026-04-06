/**
 * @module utils/repair
 * Best-effort auto-repair for malformed PAKT documents.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attempt best-effort repair of a malformed PAKT string.
 *
 * Fixes applied:
 * - Strips trailing whitespace from all lines
 * - Normalizes inconsistent indentation to 2-space
 * - Adds missing `@end` for unclosed `@dict` blocks
 * - Fixes count mismatches in `[N]` brackets (updates N to actual count)
 * - Fixes inconsistent delimiters (mixed `|` and `,` in tabular rows)
 *
 * @param malformed - A potentially malformed PAKT string
 * @returns The repaired PAKT string, or `null` if unfixable
 *
 * @example
 * ```ts
 * import { repair } from '@sriinnu/pakt';
 * const fixed = repair('@from json\n@dict\n  $a: foo\nname: $a');
 * // Adds missing @end: '@from json\n@dict\n  $a: foo\n@end\nname: $a'
 * ```
 */
export function repair(malformed: string): string | null {
  const stripped = malformed.trim();
  if (stripped.length === 0) return null;

  if (!looksLikePakt(stripped)) return null;

  const text = malformed.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let lines = text.split('\n');

  // Pass 1: Strip trailing whitespace
  lines = lines.map((l) => l.trimEnd());

  // Pass 2: Normalize indentation to 2-space
  lines = normalizeIndentation(lines);

  // Pass 3: Add missing @end for @dict
  lines = fixMissingDictEnd(lines);

  // Pass 4: Fix count mismatches in [N] brackets
  lines = fixCountMismatches(lines);

  // Pass 5: Fix mixed delimiters in tabular rows
  lines = fixMixedDelimiters(lines);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check whether input has at least some PAKT-recognizable structure. */
function looksLikePakt(text: string): boolean {
  const lines = text.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('@')) return true;
    if (/^\w[\w.]*\s*:/.test(t)) return true;
    if (/^\w[\w.]*\s*\[/.test(t)) return true;
    if (t.startsWith('% ')) return true;
    if (t.startsWith('- ')) return true;
  }
  return false;
}

/** Normalize indentation to multiples of 2 spaces. Tabs become 2 spaces. */
function normalizeIndentation(lines: string[]): string[] {
  return lines.map((line) => {
    if (line.length === 0) return line;
    const processed = line.replace(/\t/g, '  ');
    const content = processed.trimStart();
    if (content.length === 0) return '';
    const spaces = processed.length - content.length;
    if (spaces === 0) return content;
    const normalizedSpaces = Math.round(spaces / 2) * 2;
    return ' '.repeat(normalizedSpaces) + content;
  });
}

/** Add missing `@end` after `@dict` blocks that are never closed. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: dict end repair tracks open/close state across multiple line types
function fixMissingDictEnd(lines: string[]): string[] {
  const result: string[] = [];
  let dictOpen = false;
  let lastDictEntryIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? '').trim();

    if (trimmed === '@dict') {
      if (dictOpen) {
        result.splice(lastDictEntryIdx + 1, 0, '@end');
      }
      dictOpen = true;
      lastDictEntryIdx = result.length;
      // biome-ignore lint/style/noNonNullAssertion: index guaranteed within bounds by loop condition
      result.push(lines[i]!);
      continue;
    }

    if (trimmed === '@end') {
      dictOpen = false;
      // biome-ignore lint/style/noNonNullAssertion: index guaranteed within bounds by loop condition
      result.push(lines[i]!);
      continue;
    }

    if (dictOpen) {
      if (trimmed.match(/^\$\w+\s*:/)) {
        lastDictEntryIdx = result.length;
      } else if (trimmed !== '' && !trimmed.startsWith('%') && !trimmed.startsWith('@')) {
        result.push('@end');
        dictOpen = false;
      }
    }

    // biome-ignore lint/style/noNonNullAssertion: index guaranteed within bounds by loop condition
    result.push(lines[i]!);
  }

  if (dictOpen) {
    result.push('@end');
  }

  return result;
}

/** Fix `[N]` count mismatches by updating N to the actual count. */
function fixCountMismatches(lines: string[]): string[] {
  const result = [...lines];

  for (let i = 0; i < result.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index guaranteed within bounds by loop condition
    const line = result[i]!;
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;
    const prefix = ' '.repeat(indent);

    // Tabular array: key [N]{fields}:
    const tabMatch = trimmed.match(/^(\w[\w.]*)\s*\[\d+\]\s*(\{[^}]+\})\s*:$/);
    if (tabMatch) {
      const actualCount = countTabularRows(result, i + 1, indent);
      result[i] = `${prefix}${tabMatch[1]} [${actualCount}]${tabMatch[2]}:`;
      continue;
    }

    // Inline array: key [N]: val1,val2,...
    const inlineMatch = trimmed.match(/^(\w[\w.]*)\s*\[\d+\]\s*:\s*(.+)$/);
    if (inlineMatch && !inlineMatch[2]?.match(/^\s*$/)) {
      const items = (inlineMatch[2] ?? '').split(',').map((v) => v.trim());
      result[i] = `${prefix}${inlineMatch[1]} [${items.length}]: ${inlineMatch[2]}`;
      continue;
    }

    // List array: key [N]:
    const listMatch = trimmed.match(/^(\w[\w.]*)\s*\[\d+\]\s*:$/);
    if (listMatch) {
      const nextContent = findNextContentLine(result, i + 1);
      if (nextContent !== null && result[nextContent]?.trim().startsWith('- ')) {
        const actualCount = countListItems(result, i + 1, indent);
        result[i] = `${prefix}${listMatch[1]} [${actualCount}]:`;
      }
    }
  }

  return result;
}

/** Count tabular rows following a tabular header at the given indent. */
function countTabularRows(lines: string[], startIdx: number, parentIndent: number): number {
  let count = 0;
  for (let i = startIdx; i < lines.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index guaranteed within bounds by loop condition
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === '') break;
    const lineIndent = line.length - line.trimStart().length;
    if (lineIndent <= parentIndent) break;
    if (trimmed.startsWith('%')) continue;
    count++;
  }
  return count;
}

/** Count dash-prefixed list items indented deeper than parentIndent. */
function countListItems(lines: string[], startIdx: number, parentIndent: number): number {
  let count = 0;
  for (let i = startIdx; i < lines.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index guaranteed within bounds by loop condition
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= parentIndent) break;
    if (trimmed.startsWith('- ')) count++;
  }
  return count;
}

/** Find the index of the next non-empty line. */
function findNextContentLine(lines: string[], startIdx: number): number | null {
  for (let i = startIdx; i < lines.length; i++) {
    if (lines[i]?.trim() !== '') return i;
  }
  return null;
}

/** Fix mixed delimiters in tabular rows (commas -> pipes). */
function fixMixedDelimiters(lines: string[]): string[] {
  const result = [...lines];
  let inTabular = false;
  let tabularFieldCount = 0;
  let tabularIndent = -1;

  for (let i = 0; i < result.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index guaranteed within bounds by loop condition
    const rl = result[i]!;
    const trimmed = rl.trim();
    const indent = rl.length - rl.trimStart().length;

    if (inTabular && (trimmed === '' || indent <= tabularIndent)) {
      inTabular = false;
    }

    const tabMatch = trimmed.match(/^(\w[\w.]*)\s*\[\d+\]\s*\{([^}]+)\}\s*:$/);
    if (tabMatch) {
      inTabular = true;
      tabularFieldCount = (tabMatch[2] ?? '').split('|').length;
      tabularIndent = indent;
      continue;
    }

    if (inTabular && trimmed !== '' && !trimmed.startsWith('%')) {
      const pipeCount = countUnquotedChar(trimmed, '|');
      const commaCount = countUnquotedChar(trimmed, ',');

      if (pipeCount === 0 && commaCount === tabularFieldCount - 1) {
        const prefix = ' '.repeat(indent);
        result[i] = prefix + replaceDelimiter(trimmed, ',', '|');
      }
    }
  }

  return result;
}

/** Count occurrences of a character outside quoted strings. */
function countUnquotedChar(text: string, ch: string): number {
  let count = 0;
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index guaranteed within bounds by loop condition
    const c = text[i]!;
    if (c === '"') inQuote = !inQuote;
    else if (c === '\\' && inQuote) i++;
    else if (c === ch && !inQuote) count++;
  }
  return count;
}

/** Replace a delimiter character with another, respecting quoted strings. */
function replaceDelimiter(text: string, from: string, to: string): string {
  let result = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index guaranteed within bounds by loop condition
    const c = text[i]!;
    if (c === '"') {
      inQuote = !inQuote;
      result += c;
    } else if (c === '\\' && inQuote && i + 1 < text.length) {
      // biome-ignore lint/style/noNonNullAssertion: i+1 checked in condition above
      result += c + text[i + 1]!;
      i++;
    } else if (c === from && !inQuote) {
      result += to;
    } else {
      result += c;
    }
  }
  return result;
}

/**
 * @module utils/replace-all
 * Fast, allocation-friendly string replacement utility.
 *
 * Replaces every occurrence of `search` inside `text` with `replacement`
 * using `indexOf` scans — no regex overhead.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Replace every occurrence of `search` in `text` with `replacement`.
 *
 * Uses a simple indexOf loop which avoids regex construction and is safe
 * against special characters in the search string.
 *
 * @param text - The source string
 * @param search - The literal substring to find
 * @param replacement - The string to substitute in place of each match
 * @returns A new string with all occurrences replaced
 *
 * @example
 * ```ts
 * replaceAll('foo bar foo', 'foo', 'baz'); // 'baz bar baz'
 * ```
 */
export function replaceAll(text: string, search: string, replacement: string): string {
  let out = '';
  let pos = 0;
  while (true) {
    const idx = text.indexOf(search, pos);
    if (idx === -1) {
      out += text.slice(pos);
      break;
    }
    out += text.slice(pos, idx) + replacement;
    pos = idx + search.length;
  }
  return out;
}

/**
 * @module utils/split-quoted
 * Quote-aware splitting for PAKT payloads such as inline-array values.
 */

/**
 * Split `text` on `sep` wherever it sits outside a double-quoted run.
 * Backslash escapes inside quotes are skipped, so `"a\",b"` stays whole.
 * Parts are returned untrimmed.
 *
 * @param text - Payload to split
 * @param sep - Single-character separator (e.g. `,`)
 * @returns The parts, in source order (always at least one)
 */
export function splitOutsideQuotes(text: string, sep: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote && ch === '\\') {
      i++;
      continue;
    }
    if (ch === '"') inQuote = !inQuote;
    else if (ch === sep && !inQuote) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

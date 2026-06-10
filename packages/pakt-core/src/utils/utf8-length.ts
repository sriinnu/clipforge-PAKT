/**
 * @module utils/utf8-length
 * Allocation-free UTF-8 byte counting with early exit.
 *
 * Used by the OOM guard in `compress()`: oversized inputs (e.g. 100MB)
 * are rejected without first allocating 100MB via `TextEncoder`.
 */

/**
 * UTF-8 byte size of a single BMP code unit (non-surrogate).
 * @param c - UTF-16 code unit value (must NOT be in the surrogate range D800-DFFF)
 * @returns 1, 2, or 3 bytes per the standard UTF-8 encoding rules.
 */
function bmpByteSize(c: number): number {
  if (c < 0x80) return 1;
  if (c < 0x800) return 2;
  return 3;
}

/**
 * UTF-8 byte size starting at a high-surrogate position.
 *
 * Returns `{ size, paired }` where `paired` is `true` iff the next code unit
 * is a valid low surrogate (DC00-DFFF). A valid pair encodes one supplementary
 * codepoint as 4 bytes; an unpaired high surrogate is replaced by U+FFFD (3 bytes)
 * by `TextEncoder`, matching what the runtime would do for the same input.
 *
 * @param next - The next UTF-16 code unit (0 if past end of string)
 */
function highSurrogateByteSize(next: number): { size: number; paired: boolean } {
  if (next >= 0xdc00 && next <= 0xdfff) return { size: 4, paired: true };
  return { size: 3, paired: false };
}

/**
 * Count the UTF-8 byte length of a JS string without allocating a buffer,
 * short-circuiting once a `stopAt` threshold is exceeded.
 *
 * @param s - Input string (UTF-16 code units)
 * @param stopAt - Return early once the running byte count reaches this
 *   value. Pass `Infinity` to count the entire string.
 * @returns Number of UTF-8 bytes, capped at `stopAt`.
 */
export function utf8ByteLength(s: string, stopAt: number): number {
  let len = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0xd800 || c >= 0xe000) {
      // Non-surrogate: BMP code point, simple per-range size.
      len += bmpByteSize(c);
    } else if (c <= 0xdbff) {
      // High surrogate: peek at the next unit to decide pair vs unpaired.
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      const { size, paired } = highSurrogateByteSize(next);
      len += size;
      if (paired) i++; // consume the low surrogate as part of the pair
    } else {
      // Isolated low surrogate -> U+FFFD (3 bytes) by TextEncoder semantics.
      len += 3;
    }
    if (len >= stopAt) return len;
  }
  return len;
}

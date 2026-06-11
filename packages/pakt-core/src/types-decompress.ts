/**
 * @module types-decompress
 * Decompression-side types. Split out of `types.ts` to keep that module
 * under the per-file line cap; everything here is re-exported from
 * `./types.js`, which remains the single import surface.
 */

import type { PaktFormat } from './types.js';

/**
 * Options bag accepted by `decompress()` (second argument). Passing a
 * bare {@link PaktFormat} string remains supported for backwards
 * compatibility and is equivalent to `{ to: format }`.
 *
 * @example
 * ```ts
 * // Dictionary-as-system-prompt round-trip:
 * const { compressed, dictBlock } = compress(json, { dictPlacement: 'system' });
 * const result = decompress(compressed, { dict: dictBlock });
 * ```
 */
export interface DecompressOptions {
  /** Desired output format. Defaults to the `@from` header value. */
  to?: PaktFormat;
  /**
   * External dictionary block to merge before alias expansion — the
   * `dictBlock` string returned by `compress()` with
   * `dictPlacement: 'system'`. Accepts the full `@dict ... @end` block
   * (a trailing `@cache prefix-end` line is tolerated) or a bare list of
   * `$alias: expansion` lines.
   *
   * Precedence on alias conflicts: **inline entries win** — a body's own
   * `@dict` definitions are authoritative; external entries fill in the
   * aliases the body doesn't define. (Outputs produced with
   * `dictPlacement: 'system'` never carry an inline dict, so conflicts
   * only occur with a stale external dict.)
   */
  dict?: string;
}

/**
 * Result from decompress(). Contains decompressed data in both
 * structured and string form.
 * @example
 * ```ts
 * const result: DecompressResult = decompress(paktStr, 'json');
 * console.log(result.text);     // formatted JSON
 * console.log(result.data);     // parsed JS object
 * console.log(result.wasLossy); // false
 * ```
 */
export interface DecompressResult {
  /** Parsed structured data */
  data: unknown;
  /** Formatted output string in the requested format */
  text: string;
  /** Original format from @from header */
  originalFormat: PaktFormat;
  /** Whether lossy compression (L4) was applied */
  wasLossy: boolean;
  /** Recovered envelope preamble lines (e.g. HTTP headers), if present */
  envelope?: string[];
}

/**
 * @module mixed/decompress-mixed
 * Decompresses mixed content by finding PAKT markers and restoring
 * each compressed block back to its original format.
 *
 * Scans for `<!-- PAKT:format -->...<!-- /PAKT -->` markers, decompresses
 * each PAKT block, and reassembles the document with the original content
 * restored.
 */

import { decompress } from '../decompress.js';

// ---------------------------------------------------------------------------
// Marker regex
// ---------------------------------------------------------------------------

/**
 * Regex to find PAKT markers in mixed content.
 * Captures the format tag and the PAKT content between markers.
 *
 * Pattern: <!-- PAKT:format -->\n...content...\n<!-- /PAKT -->
 */
const PAKT_MARKER_RE = /<!-- PAKT:(\w+) -->\n([\s\S]*?)\n<!-- \/PAKT -->/g;

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Decompress mixed content by finding PAKT markers and decompressing each block.
 *
 * For each `<!-- PAKT:format -->...<!-- /PAKT -->` marker found, the enclosed
 * PAKT content is decompressed back to its original format. The surrounding
 * text/prose is left untouched.
 *
 * If no PAKT markers are found, returns the input unchanged.
 * If decompression of any block fails, that block is left as-is (graceful).
 *
 * @param input - The mixed content with PAKT markers
 * @returns The text with all PAKT blocks decompressed back to original format
 *
 * @example
 * ```ts
 * const mixed = '# Report\n<!-- PAKT:json -->\n@from json\nname: Alice\n<!-- /PAKT -->\nEnd.';
 * const restored = decompressMixed(mixed);
 * // '# Report\n{"name":"Alice"}\nEnd.'
 * ```
 */
export function decompressMixed(input: string): string {
  // Reset lastIndex before iteration
  PAKT_MARKER_RE.lastIndex = 0;

  return input.replace(PAKT_MARKER_RE, (_fullMatch, format: string, paktContent: string) => {
    try {
      const result = decompress(paktContent, format as Parameters<typeof decompress>[1]);
      return result.text;
    } catch {
      // Graceful degradation: leave the original PAKT block in place
      return _fullMatch;
    }
  });
}

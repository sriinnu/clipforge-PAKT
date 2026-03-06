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
const PAKT_MARKER_RE = /<!-- PAKT:(\w+)(?: ([^\n]*?))? -->\n([\s\S]*?)\n<!-- \/PAKT -->/g;

interface MixedMarkerMeta {
  wrapper?: 'fence' | 'frontmatter';
  fence?: string;
  languageTag?: string;
  trailingNewline?: boolean;
}

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

  return input.replace(
    PAKT_MARKER_RE,
    (_fullMatch, format: string, rawMeta: string | undefined, paktContent: string) => {
      const meta = parseMarkerMeta(rawMeta);

      try {
        const result = decompress(paktContent, format as Parameters<typeof decompress>[1]);
        return restoreWrapper(result.text, meta);
      } catch {
        // Graceful degradation: leave the original PAKT block in place
        return _fullMatch;
      }
    },
  );
}

function parseMarkerMeta(rawMeta: string | undefined): MixedMarkerMeta | null {
  if (!rawMeta) return null;

  try {
    return JSON.parse(rawMeta) as MixedMarkerMeta;
  } catch {
    return null;
  }
}

function restoreWrapper(text: string, meta: MixedMarkerMeta | null): string {
  if (meta?.wrapper === 'fence') {
    const fence = meta.fence ?? '```';
    const languageTag = meta.languageTag ?? '';
    const restored = `${fence}${languageTag}\n${text}\n${fence}`;
    return meta.trailingNewline ? `${restored}\n` : restored;
  }

  if (meta?.wrapper === 'frontmatter') {
    const restored = `---\n${text}\n---`;
    return meta.trailingNewline ? `${restored}\n` : restored;
  }

  return text;
}

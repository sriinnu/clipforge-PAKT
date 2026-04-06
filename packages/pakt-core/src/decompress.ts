/**
 * @module decompress
 * PAKT decompression pipeline entry point.
 *
 * This module exports the primary {@link decompress} function that
 * reverses the PAKT compression: parsing the PAKT string, expanding
 * dictionary aliases, and serializing back to the original or
 * requested format.
 */

import {
  decompressL2,
  decompressText,
  reverseL3Transforms,
  revertDeltaEncoding,
} from './layers/index.js';
import type { CommentNode, DocumentNode } from './parser/ast.js';
import { parse } from './parser/index.js';
import { bodyToValue, toCsv, toJson, toMarkdown, toText, toYaml } from './reverse/index.js';
import type { DecompressResult, PaktFormat } from './types.js';

/**
 * Decompress a PAKT string back to the original or requested format.
 *
 * The decompression pipeline (reverse of compress: L1 → delta → L2):
 * 1. **Parse** — Tokenize and parse the PAKT string into an AST.
 * 2. **L2 Expand** — Replace all dictionary aliases (`$a`, `$b`, ...)
 *    with their full expansions from the `@dict` header. Must run
 *    before delta decoding because L2 may have aliased `~` sentinels.
 * 3. **Delta Decode** — Revert delta-encoded `~` sentinels to real
 *    values by copying from the previous row.
 * 4. **Reconstruct** — Convert the AST back into a structured data
 *    object (arrays, objects, scalars).
 * 5. **Serialize** — Format the data as the requested output format
 *    (JSON, YAML, CSV, Markdown, or plain text).
 *
 * If no `outputFormat` is specified, the format from the `@from`
 * header is used (e.g., if the PAKT string says `@from json`, the
 * output will be JSON).
 *
 * @param pakt - The PAKT-formatted string to decompress
 * @param outputFormat - Desired output format. Defaults to the original
 *   format declared in the `@from` header.
 * @returns Decompressed data and formatted text.
 *   On error, returns the raw PAKT string as text with format 'text' (graceful degradation).
 *
 * @example
 * ```ts
 * import { decompress } from '@sriinnu/pakt';
 *
 * const pakt = `@from json
 * users [2]{name|role}:
 *   Alice|dev
 *   Bob|dev`;
 *
 * const result = decompress(pakt, 'json');
 * console.log(result.text);
 * // {"users":[{"name":"Alice","role":"dev"},{"name":"Bob","role":"dev"}]}
 *
 * console.log(result.data);
 * // { users: [{ name: 'Alice', role: 'dev' }, { name: 'Bob', role: 'dev' }] }
 *
 * console.log(result.wasLossy); // false
 * ```
 *
 * @example
 * ```ts
 * // Convert PAKT to YAML instead of the original format
 * import { decompress } from '@sriinnu/pakt';
 *
 * const result = decompress(paktString, 'yaml');
 * console.log(result.text);
 * // users:
 * //   - name: Alice
 * //     role: dev
 * //   - name: Bob
 * //     role: dev
 * ```
 */
export function decompress(pakt: string, outputFormat?: PaktFormat): DecompressResult {
  // Graceful degradation: wrap the entire pipeline in try-catch so that
  // on ANY error we return the raw PAKT string as text instead of crashing.
  try {
    return decompressPipeline(pakt, outputFormat);
  } catch {
    return {
      data: pakt,
      text: pakt,
      originalFormat: 'text',
      wasLossy: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal pipeline (wrapped by decompress() for error handling)
// ---------------------------------------------------------------------------

/**
 * Core decompression pipeline extracted for try-catch wrapping.
 * @param pakt - The PAKT-formatted string to decompress
 * @param outputFormat - Desired output format
 * @returns Decompressed data and formatted text
 */
function decompressPipeline(pakt: string, outputFormat?: PaktFormat): DecompressResult {
  // 0a. If the input doesn't look like PAKT, return it unchanged.
  // Real PAKT always starts with @from <format> or @version on the first line.
  // This prevents false decompression of text that happens to contain @-prefixed words.
  const trimmed = pakt.trimStart();
  // Match detection logic: @from requires a valid format, @version requires a second signal
  const isPaktSignature = /^@from\s+(json|yaml|csv|text|markdown|pakt)\b/.test(trimmed);
  if (!isPaktSignature) {
    return { data: pakt, text: pakt, originalFormat: 'text', wasLossy: false };
  }

  // 0b. Check for text/markdown compression (bypasses AST parser entirely)
  const textFormatMatch = /^@from (text|markdown)\n/.exec(trimmed);
  if (textFormatMatch) {
    const expandedText = decompressText(pakt);
    return {
      data: expandedText,
      text: expandedText,
      originalFormat: textFormatMatch[1] as PaktFormat,
      wasLossy: false,
    };
  }

  // 1. Reverse L3 tokenizer transforms if applied (before parsing)
  const normalizedPakt = reverseL3Transforms(pakt);

  // 2. Parse the PAKT string into an AST
  const doc: DocumentNode = parse(normalizedPakt);

  // 3. Extract the original format from the @from header
  const fromHeader = doc.headers.find((h) => h.headerType === 'from');
  const originalFormat = validFormat(fromHeader?.value) ?? 'text';

  // 4. Check @warning header for lossy flag
  const warningHeader = doc.headers.find((h) => h.headerType === 'warning');
  const wasLossy = warningHeader?.value.includes('lossy') ?? false;

  // 5. Expand dictionary aliases FIRST — L2 may have aliased the `~` sentinel
  //    during compression, so aliases must be resolved before delta decoding
  //    can find the sentinel values. (Compress order: L1 → delta → L2,
  //    so decompress must reverse: L2 → delta → L1.)
  const l2Expanded = decompressL2(doc);

  // 6. Revert delta encoding (~ sentinels → real values) on the L2-expanded doc
  const expanded = revertDeltaEncoding(l2Expanded);

  // 7. Determine which format to serialize to
  const targetFormat: PaktFormat = outputFormat ?? originalFormat;

  // 8. Extract envelope comments if present
  const envelopeResult = extractEnvelope(expanded.body);

  // 9. Convert body to formatted text (envelope comments are ignored by bodyToValue)
  const text = formatBody(expanded, targetFormat, normalizedPakt);

  // 10. Get structured data from the expanded body
  const data: unknown = bodyToValue(expanded.body);

  const result: DecompressResult = { data, text, originalFormat, wasLossy };
  if (envelopeResult) {
    result.envelope = envelopeResult;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Envelope extraction
// ---------------------------------------------------------------------------

/**
 * Extract envelope preamble from leading comment nodes in the body.
 * Looks for the `@envelope http` marker comment followed by preamble lines.
 * Returns the preamble lines array, or null if no envelope is present.
 */
function extractEnvelope(body: import('./parser/ast.js').BodyNode[]): string[] | null {
  if (body.length === 0) return null;

  // First node must be a comment with `@envelope http`
  const first = body[0];
  if (!first) return null;
  if (first.type !== 'comment') return null;
  if ((first as CommentNode).text !== '@envelope http') return null;

  // Collect subsequent comment nodes as preamble lines
  const preamble: string[] = [];
  for (let i = 1; i < body.length; i++) {
    const node = body[i];
    if (!node || node.type !== 'comment') break;
    preamble.push((node as CommentNode).text);
  }

  return preamble.length > 0 ? preamble : null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set of valid PaktFormat values for runtime validation. */
const VALID_FORMATS = new Set<PaktFormat>(['json', 'yaml', 'csv', 'markdown', 'pakt', 'text']);

/**
 * Validate a string as a {@link PaktFormat}. Returns the format if valid,
 * or `undefined` if the value is not a recognized format.
 */
function validFormat(value: string | undefined): PaktFormat | undefined {
  if (value == null) return undefined;
  return VALID_FORMATS.has(value as PaktFormat) ? (value as PaktFormat) : undefined;
}

/**
 * Serialize the expanded document body to the requested format string.
 * Falls back to plain text for unknown formats.
 */
function formatBody(doc: DocumentNode, format: PaktFormat, rawPakt: string): string {
  switch (format) {
    case 'json':
      return toJson(doc.body);
    case 'yaml':
      return toYaml(doc.body);
    case 'csv':
      return toCsv(doc.body);
    case 'markdown':
      return toMarkdown(doc.body);
    case 'pakt':
      return rawPakt;
    case 'text':
      return toText(doc.body);
    default: {
      // Exhaustive check — if a new format is added to PaktFormat,
      // TypeScript will flag this as an error.
      const _exhaustive: never = format;
      void _exhaustive;
      return toText(doc.body);
    }
  }
}

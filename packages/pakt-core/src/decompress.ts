/**
 * @module decompress
 * PAKT decompression pipeline entry point.
 *
 * This module exports the primary {@link decompress} function that
 * reverses the PAKT compression: parsing the PAKT string, expanding
 * dictionary aliases, and serializing back to the original or
 * requested format.
 */

import type { DecompressResult, PaktFormat } from './types.js';
import type { CommentNode, DocumentNode } from './parser/ast.js';
import { parse } from './parser/index.js';
import { decompressL2, reverseL3Transforms } from './layers/index.js';
import {
  toJson,
  toYaml,
  toCsv,
  toMarkdown,
  toText,
  bodyToValue,
} from './reverse/index.js';

/**
 * Decompress a PAKT string back to the original or requested format.
 *
 * The decompression pipeline:
 * 1. **Parse** — Tokenize and parse the PAKT string into an AST.
 * 2. **Expand** — Replace all dictionary aliases (`$a`, `$b`, ...)
 *    with their full expansions from the `@dict` header.
 * 3. **Reconstruct** — Convert the AST back into a structured data
 *    object (arrays, objects, scalars).
 * 4. **Serialize** — Format the data as the requested output format
 *    (JSON, YAML, CSV, Markdown, or plain text).
 *
 * If no `outputFormat` is specified, the format from the `@from`
 * header is used (e.g., if the PAKT string says `@from json`, the
 * output will be JSON).
 *
 * @param pakt - The PAKT-formatted string to decompress
 * @param outputFormat - Desired output format. Defaults to the original
 *   format declared in the `@from` header.
 * @returns Decompressed data and formatted text
 * @throws {Error} If the PAKT string is malformed or unparseable
 *
 * @example
 * ```ts
 * import { decompress } from '@yugenlab/pakt';
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
 * import { decompress } from '@yugenlab/pakt';
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
  // 1. Reverse L3 tokenizer transforms if applied (before parsing)
  const normalizedPakt = reverseL3Transforms(pakt);

  // 2. Parse the PAKT string into an AST
  const doc: DocumentNode = parse(normalizedPakt);

  // 3. Extract the original format from the @from header
  const fromHeader = doc.headers.find((h) => h.headerType === 'from');
  const originalFormat = validFormat(fromHeader?.value) ?? 'text';

  // 4. Check @warning header for lossy flag
  const warningHeader = doc.headers.find((h) => h.headerType === 'warning');
  const wasLossy = warningHeader != null && warningHeader.value.includes('lossy');

  // 5. Expand dictionary aliases in the body
  const expanded = decompressL2(doc);

  // 6. Determine which format to serialize to
  const targetFormat: PaktFormat = outputFormat ?? originalFormat;

  // 7. Extract envelope comments if present
  const envelopeResult = extractEnvelope(expanded.body);

  // 8. Convert body to formatted text (envelope comments are ignored by bodyToValue)
  const text = formatBody(expanded, targetFormat, normalizedPakt);

  // 9. Get structured data from the expanded body
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
  const first = body[0]!;
  if (first.type !== 'comment') return null;
  if ((first as CommentNode).text !== '@envelope http') return null;

  // Collect subsequent comment nodes as preamble lines
  const preamble: string[] = [];
  for (let i = 1; i < body.length; i++) {
    const node = body[i]!;
    if (node.type !== 'comment') break;
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

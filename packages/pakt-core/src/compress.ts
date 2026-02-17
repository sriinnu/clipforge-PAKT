/**
 * @module compress
 * PAKT compression pipeline entry point.
 *
 * This module exports the primary {@link compress} function that runs
 * input text through the PAKT compression pipeline:
 * L1 (structural) -> L2 (dictionary) -> L3 (tokenizer, optional) -> L4 (semantic, optional)
 */

import { detect } from './detect.js';
import { compressL1, compressL2, extractDictEntries } from './layers/index.js';
import { serialize } from './serializer/index.js';
import { countTokens } from './tokens/index.js';
import type { PaktOptions, PaktResult, PaktFormat, PaktLayers } from './types.js';
import { DEFAULT_OPTIONS, DEFAULT_LAYERS } from './types.js';

// ---------------------------------------------------------------------------
// JSONC comment stripping
// ---------------------------------------------------------------------------

/** Strip `//` and `/* ... *​/` comments from JSONC text, respecting strings. */
function stripJsonComments(text: string): string {
  let result = '';
  let i = 0;
  let inString = false;
  let escape = false;
  while (i < text.length) {
    const ch = text[i]!;
    if (inString) {
      result += ch;
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') { inString = true; result += ch; i++; }
    else if (ch === '/' && i + 1 < text.length) {
      if (text[i + 1] === '/') {
        i += 2;
        while (i < text.length && text[i] !== '\n') i++;
      } else if (text[i + 1] === '*') {
        i += 2;
        while (i + 1 < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
        i += 2;
      } else { result += ch; i++; }
    } else { result += ch; i++; }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Simple YAML parser (covers common cases)
// ---------------------------------------------------------------------------

/** Infer a scalar YAML value to its JS type (numbers, booleans, null). */
function yamlScalar(raw: string): unknown {
  const v = raw.trim();
  if (v === '' || v === '~' || v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    return v.slice(1, -1);
  return v;
}

/** Count leading spaces in a line. */
function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

interface YamlLine { indent: number; raw: string; trimmed: string }

/** Parse a simple YAML document into a JS value. */
function parseYaml(input: string): unknown {
  const rawLines = input.split('\n');
  const lines: YamlLine[] = [];
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === '---' || trimmed === '...') continue;
    if (trimmed.startsWith('#')) continue;
    lines.push({ indent: indentOf(raw), raw, trimmed });
  }
  if (lines.length === 0) return null;
  return parseYamlBlock(lines, 0, lines.length, 0);
}

/** Parse a YAML block (list or object) at a given indent level. */
function parseYamlBlock(
  lines: YamlLine[], start: number, end: number, baseIndent: number,
): unknown {
  if (start >= end) return null;
  const firstLine = lines[start]!;
  if (firstLine.trimmed.startsWith('- '))
    return parseYamlList(lines, start, end, baseIndent);
  return parseYamlObject(lines, start, end, baseIndent);
}

/** Parse YAML list items (`- value` or `- key: value` blocks). */
function parseYamlList(
  lines: YamlLine[], start: number, end: number, baseIndent: number,
): unknown[] {
  const result: unknown[] = [];
  let i = start;
  while (i < end) {
    const line = lines[i]!;
    if (line.indent < baseIndent) break;
    if (!line.trimmed.startsWith('- ')) { i++; continue; }
    const content = line.trimmed.slice(2).trim();
    const kvMatch = content.match(/^([a-zA-Z_][a-zA-Z0-9_.\-]*):\s+(.*)/);
    if (kvMatch) {
      const obj: Record<string, unknown> = {};
      obj[kvMatch[1]!] = yamlScalar(kvMatch[2]!);
      const itemIndent = line.indent + 2;
      let j = i + 1;
      while (j < end && lines[j]!.indent >= itemIndent) j++;
      if (j > i + 1) {
        const nested = parseYamlObject(lines, i + 1, j, itemIndent);
        if (typeof nested === 'object' && nested !== null && !Array.isArray(nested))
          Object.assign(obj, nested);
      }
      result.push(obj);
      i = j;
    } else if (content.includes(':')) {
      const colonIdx = content.indexOf(':');
      const key = content.slice(0, colonIdx).trim();
      const val = content.slice(colonIdx + 1).trim();
      if (key && !val) {
        const itemIndent = line.indent + 2;
        let j = i + 1;
        while (j < end && lines[j]!.indent >= itemIndent) j++;
        const nested = parseYamlBlock(lines, i + 1, j, itemIndent);
        result.push({ [key]: nested });
        i = j;
      } else {
        result.push(yamlScalar(content));
        i++;
      }
    } else {
      result.push(yamlScalar(content));
      i++;
    }
  }
  return result;
}

/** Parse YAML object (key: value pairs) at a given indent level. */
function parseYamlObject(
  lines: YamlLine[], start: number, end: number, baseIndent: number,
): unknown {
  const obj: Record<string, unknown> = {};
  let i = start;
  while (i < end) {
    const line = lines[i]!;
    if (line.indent < baseIndent) break;
    if (line.indent > baseIndent) { i++; continue; }
    const colonIdx = line.trimmed.indexOf(':');
    if (colonIdx === -1) {
      if (start === end - 1) return yamlScalar(line.trimmed);
      i++; continue;
    }
    const key = line.trimmed.slice(0, colonIdx).trim();
    const rest = line.trimmed.slice(colonIdx + 1).trim();
    if (rest) {
      obj[key] = yamlScalar(rest);
      i++;
    } else {
      const childIndent = baseIndent + 2;
      let j = i + 1;
      while (j < end && lines[j]!.indent >= childIndent) j++;
      obj[key] = j > i + 1 ? parseYamlBlock(lines, i + 1, j, childIndent) : null;
      i = j;
    }
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Simple CSV parser
// ---------------------------------------------------------------------------

const CSV_DELIMITERS = [',', '\t', ';'] as const;

/** Split a CSV line on the delimiter, handling quoted fields and `""` escapes. */
function splitCsvLine(line: string, delim: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i += 2; }
        else { inQuotes = false; i++; }
      } else { current += ch; i++; }
    } else if (ch === '"') { inQuotes = true; i++; }
    else if (ch === delim) { fields.push(current.trim()); current = ''; i++; }
    else { current += ch; i++; }
  }
  fields.push(current.trim());
  return fields;
}

/** Detect the best CSV delimiter by column-count consistency. */
function detectCsvDelimiter(lines: string[]): string {
  let bestDelim = ',';
  let bestScore = -1;
  for (const delim of CSV_DELIMITERS) {
    const cols = splitCsvLine(lines[0]!, delim).length;
    if (cols < 2) continue;
    let consistent = 0;
    for (let i = 1; i < lines.length; i++)
      if (splitCsvLine(lines[i]!, delim).length === cols) consistent++;
    const score = consistent / (lines.length - 1);
    if (score > bestScore) { bestScore = score; bestDelim = delim; }
  }
  return bestDelim;
}

/** Infer a CSV cell to its JS type. */
function inferCsvValue(raw: string): unknown {
  const v = raw.trim();
  if (v === '') return '';
  if (v === 'null' || v === 'NULL') return null;
  if (v === 'true' || v === 'TRUE') return true;
  if (v === 'false' || v === 'FALSE') return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return v;
}

/** Parse CSV text into an array of objects using the first row as headers. */
function parseCsv(input: string): Record<string, unknown>[] {
  const rawLines = input.split('\n').filter((l) => l.trim().length > 0);
  if (rawLines.length < 2)
    return rawLines.length === 1 ? [{ _line: rawLines[0] }] : [];
  const delim = detectCsvDelimiter(rawLines);
  const headers = splitCsvLine(rawLines[0]!, delim);
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < rawLines.length; i++) {
    const values = splitCsvLine(rawLines[i]!, delim);
    const row: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j] ?? `col${j}`;
      row[key] = inferCsvValue(values[j] ?? '');
    }
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Parse input by format
// ---------------------------------------------------------------------------

/** Parse raw input text into a JS value based on the detected format. */
function parseInput(input: string, format: PaktFormat): unknown {
  switch (format) {
    case 'json': {
      try { return JSON.parse(input) as unknown; }
      catch { /* JSONC fallback */ }
      return JSON.parse(stripJsonComments(input)) as unknown;
    }
    case 'yaml': return parseYaml(input);
    case 'csv': return parseCsv(input);
    case 'markdown': return { _markdown: input };
    case 'text': return { _text: input };
    case 'pakt': return { _pakt: input };
  }
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

/** Merge user-supplied partial layers with defaults. */
function mergeLayers(partial?: Partial<PaktLayers>): PaktLayers {
  if (!partial) return { ...DEFAULT_LAYERS };
  return {
    structural: partial.structural ?? DEFAULT_LAYERS.structural,
    dictionary: partial.dictionary ?? DEFAULT_LAYERS.dictionary,
    tokenizerAware: partial.tokenizerAware ?? DEFAULT_LAYERS.tokenizerAware,
    semantic: partial.semantic ?? DEFAULT_LAYERS.semantic,
  };
}

// ---------------------------------------------------------------------------
// Main compress function
// ---------------------------------------------------------------------------

/**
 * Compress input text into PAKT format.
 *
 * Runs the input through the PAKT compression pipeline. By default,
 * only L1 (structural) and L2 (dictionary) are enabled. L3 (tokenizer)
 * and L4 (semantic) require explicit opt-in via the `layers` option.
 *
 * The pipeline stages:
 * 1. **L1 -- Structural**: Detects the input format, parses it, and
 *    converts to PAKT syntax (stripping braces, quotes, whitespace).
 * 2. **L2 -- Dictionary**: Finds repeated n-grams and replaces them
 *    with short aliases (`$a`, `$b`, ...) in a `@dict` header.
 * 3. **L3 -- Tokenizer-Aware** *(gated)*: Re-encodes delimiters to
 *    minimize token count for the target model's tokenizer.
 * 4. **L4 -- Semantic** *(opt-in)*: Lossy compression via
 *    summarization. Flags the output as non-reversible.
 *
 * @param input - The text to compress (JSON, YAML, CSV, Markdown, or plain text)
 * @param options - Compression options (layers, target model, etc.)
 * @returns Compression result with PAKT string and savings metadata
 * @throws {Error} If the input cannot be parsed in the detected/specified format
 *
 * @example
 * ```ts
 * import { compress } from '@yugenlab/pakt';
 *
 * const json = '{"users": [{"name": "Alice", "role": "dev"}, {"name": "Bob", "role": "dev"}]}';
 * const result = compress(json);
 *
 * console.log(result.compressed);
 * // @from json
 * // @dict
 * //   $a: dev
 * // @end
 * // users [2]{name|role}:
 * //   Alice|$a
 * //   Bob|$a
 *
 * console.log(result.savings.totalPercent); // ~45
 * ```
 *
 * @example
 * ```ts
 * // With custom options
 * import { compress } from '@yugenlab/pakt';
 *
 * const csv = 'name,role\nAlice,dev\nBob,dev';
 * const result = compress(csv, {
 *   fromFormat: 'csv',
 *   layers: { structural: true, dictionary: true },
 *   dictMinSavings: 2,
 * });
 * ```
 */
export function compress(input: string, options?: Partial<PaktOptions>): PaktResult {
  // 1. Merge options with defaults
  const layers = mergeLayers(options?.layers);
  const fromFormat = options?.fromFormat;
  const targetModel = options?.targetModel ?? DEFAULT_OPTIONS.targetModel;
  const dictMinSavings = options?.dictMinSavings ?? DEFAULT_OPTIONS.dictMinSavings;

  // 2. Detect format (use user-specified if provided, else auto-detect)
  const detectedFormat: PaktFormat = fromFormat ?? detect(input).format;

  // 3. Handle PAKT input -- already compressed, return early with 0% savings
  if (detectedFormat === 'pakt') {
    const tokens = countTokens(input, targetModel);
    return {
      compressed: input,
      originalTokens: tokens,
      compressedTokens: tokens,
      savings: {
        totalPercent: 0,
        totalTokens: 0,
        byLayer: { structural: 0, dictionary: 0, tokenizer: 0, semantic: 0 },
      },
      reversible: true,
      detectedFormat: 'pakt',
      dictionary: [],
    };
  }

  // 4. Parse the raw input into a JS value
  const data = parseInput(input, detectedFormat);

  // 5. Count original tokens
  const originalTokens = countTokens(input, targetModel);

  // 6. Run L1 structural compression
  let doc = compressL1(data, detectedFormat);

  // Measure tokens after L1 to track per-layer savings
  const afterL1 = serialize(doc);
  const l1Tokens = countTokens(afterL1, targetModel);
  const structuralSaved = originalTokens - l1Tokens;

  // 7. Run L2 dictionary deduplication (if enabled)
  let dictionarySaved = 0;
  if (layers.dictionary) {
    doc = compressL2(doc, dictMinSavings);
    const afterL2 = serialize(doc);
    const l2Tokens = countTokens(afterL2, targetModel);
    dictionarySaved = l1Tokens - l2Tokens;
  }

  // L3 and L4 are not yet implemented (gated behind layer flags).

  // 8. Serialize the final AST
  const compressed = serialize(doc);
  const compressedTokens = countTokens(compressed, targetModel);

  // 9. Compute total savings
  const totalTokens = originalTokens - compressedTokens;
  const totalPercent = originalTokens > 0
    ? Math.round((totalTokens / originalTokens) * 100)
    : 0;

  // 10. Extract dictionary entries and return result
  const dictionary = extractDictEntries(doc);

  return {
    compressed,
    originalTokens,
    compressedTokens,
    savings: {
      totalPercent,
      totalTokens,
      byLayer: {
        structural: Math.max(0, structuralSaved),
        dictionary: Math.max(0, dictionarySaved),
        tokenizer: 0,
        semantic: 0,
      },
    },
    reversible: true,
    detectedFormat,
    dictionary,
  };
}

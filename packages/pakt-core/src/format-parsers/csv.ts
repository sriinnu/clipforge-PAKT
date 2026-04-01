/**
 * @module format-parsers/csv
 * CSV parser with auto-delimiter detection and type inference.
 *
 * Supports comma, tab, and semicolon delimiters. Handles quoted fields
 * with escaped double-quotes (`""`). Infers cell types to numbers,
 * booleans, and null where applicable.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Candidate delimiters ordered by prevalence. */
const CSV_DELIMITERS = [',', '\t', ';'] as const;

// ---------------------------------------------------------------------------
// Line splitting
// ---------------------------------------------------------------------------

/**
 * Split a CSV line on the delimiter, handling quoted fields and `""` escapes.
 * @param line - Single CSV row
 * @param delim - Delimiter character
 * @returns Array of trimmed field strings
 * @example
 * ```ts
 * splitCsvLine('Alice,"New York",30', ',');
 * // ['Alice', 'New York', '30']
 * ```
 */
export function splitCsvLine(line: string, delim: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === undefined) break;
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        current += ch;
        i++;
      }
    } else if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === delim) {
      fields.push(current.trim());
      current = '';
      i++;
    } else {
      current += ch;
      i++;
    }
  }
  fields.push(current.trim());
  return fields;
}

// ---------------------------------------------------------------------------
// Delimiter detection
// ---------------------------------------------------------------------------

/**
 * Detect the best CSV delimiter by column-count consistency.
 * Tries each candidate delimiter and picks the one producing the
 * most consistent column count across all rows.
 * @param lines - Non-empty lines of CSV text
 * @returns Best delimiter character
 */
export function detectCsvDelimiter(lines: string[]): string {
  let bestDelim = ',';
  let bestScore = -1;
  const firstLine = lines[0];
  if (firstLine === undefined) return bestDelim;
  for (const delim of CSV_DELIMITERS) {
    const cols = splitCsvLine(firstLine, delim).length;
    if (cols < 2) continue;
    let consistent = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line !== undefined && splitCsvLine(line, delim).length === cols) consistent++;
    }
    const score = consistent / (lines.length - 1);
    if (score > bestScore) {
      bestScore = score;
      bestDelim = delim;
    }
  }
  return bestDelim;
}

// ---------------------------------------------------------------------------
// Type inference
// ---------------------------------------------------------------------------

/**
 * Infer a CSV cell to its JS type.
 * @param raw - Raw cell string
 * @returns Typed value (null, boolean, number, or string)
 * @example
 * ```ts
 * inferCsvValue('42');     // 42
 * inferCsvValue('true');   // true
 * inferCsvValue('null');   // null
 * inferCsvValue('Alice');  // 'Alice'
 * ```
 */
export function inferCsvValue(raw: string): unknown {
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

// ---------------------------------------------------------------------------
// Main CSV parser
// ---------------------------------------------------------------------------

/**
 * Parse CSV text into an array of objects using the first row as headers.
 * @param input - Raw CSV text
 * @returns Array of row objects keyed by header names
 * @example
 * ```ts
 * parseCsv('name,age\nAlice,30\nBob,25');
 * // [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }]
 * ```
 */
export function parseCsv(input: string): Record<string, unknown>[] {
  const rawLines = input.split('\n').filter((l) => l.trim().length > 0);
  if (rawLines.length < 2) return rawLines.length === 1 ? [{ _line: rawLines[0] }] : [];
  const delim = detectCsvDelimiter(rawLines);
  const headerLine = rawLines[0];
  if (headerLine === undefined) return [];
  const headers = splitCsvLine(headerLine, delim);
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    if (rawLine === undefined) continue;
    const values = splitCsvLine(rawLine, delim);
    const row: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j] ?? `col${j}`;
      row[key] = inferCsvValue(values[j] ?? '');
    }
    rows.push(row);
  }
  return rows;
}

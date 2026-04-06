/**
 * @module format-parsers/yaml
 * Simple YAML parser covering common cases: objects, lists, nested blocks.
 *
 * Only supports a subset of YAML 1.2 (no anchors, tags, or flow syntax).
 * Sufficient for the majority of API response payloads and config files.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed YAML line with indent tracking. */
interface YamlLine {
  indent: number;
  raw: string;
  trimmed: string;
}

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

/**
 * Infer a scalar YAML value to its JS type (numbers, booleans, null).
 * @param raw - Raw YAML value string
 * @returns Typed JS value (null, boolean, number, or string)
 * @example
 * ```ts
 * yamlScalar('true');   // true
 * yamlScalar('42');     // 42
 * yamlScalar('~');      // null
 * yamlScalar('hello');  // 'hello'
 * ```
 */
export function yamlScalar(raw: string): unknown {
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

// ---------------------------------------------------------------------------
// Indent helper
// ---------------------------------------------------------------------------

/**
 * Count leading spaces in a line.
 * @param line - Source line
 * @returns Number of leading space characters
 */
export function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

// ---------------------------------------------------------------------------
// Block parser
// ---------------------------------------------------------------------------

/**
 * Parse a simple YAML document into a JS value.
 * Strips comments, blank lines, `---` and `...` markers before parsing.
 * @param input - Raw YAML text
 * @returns Parsed JS value (object, array, scalar, or null)
 * @example
 * ```ts
 * parseYaml('name: Alice\nrole: developer');
 * // { name: 'Alice', role: 'developer' }
 * ```
 */
export function parseYaml(input: string): unknown {
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

/**
 * Parse a YAML block (list or object) at a given indent level.
 * Delegates to parseYamlList or parseYamlObject based on first-line content.
 */
export function parseYamlBlock(
  lines: YamlLine[],
  start: number,
  end: number,
  baseIndent: number,
): unknown {
  if (start >= end) return null;
  const firstLine = lines[start];
  if (!firstLine) return null;
  if (firstLine.trimmed.startsWith('- ')) return parseYamlList(lines, start, end, baseIndent);
  return parseYamlObject(lines, start, end, baseIndent);
}

/**
 * Parse YAML list items (`- value` or `- key: value` blocks).
 * Handles nested objects under list items at increased indent.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: YAML list parsing handles nested objects at variable indent
export function parseYamlList(
  lines: YamlLine[],
  start: number,
  end: number,
  baseIndent: number,
): unknown[] {
  const result: unknown[] = [];
  let i = start;
  while (i < end) {
    const line = lines[i];
    if (!line) break;
    if (line.indent < baseIndent) break;
    if (!line.trimmed.startsWith('- ')) {
      i++;
      continue;
    }
    const content = line.trimmed.slice(2).trim();
    const kvMatch = content.match(/^([a-zA-Z_][a-zA-Z0-9_.\-]*):\s+(.*)/);
    if (kvMatch) {
      const obj: Record<string, unknown> = {};
      const [, key, value] = kvMatch;
      if (!key) {
        i++;
        continue;
      }
      obj[key] = yamlScalar(value ?? '');
      const itemIndent = line.indent + 2;
      let j = i + 1;
      while (j < end && (lines[j]?.indent ?? 0) >= itemIndent) j++;
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
        while (j < end && (lines[j]?.indent ?? 0) >= itemIndent) j++;
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

/**
 * Parse YAML object (key: value pairs) at a given indent level.
 * Handles nested blocks for keys without inline values.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: YAML object parsing handles nested blocks and inline values
export function parseYamlObject(
  lines: YamlLine[],
  start: number,
  end: number,
  baseIndent: number,
): unknown {
  const obj: Record<string, unknown> = {};
  let i = start;
  while (i < end) {
    const line = lines[i];
    if (!line) break;
    if (line.indent < baseIndent) break;
    if (line.indent > baseIndent) {
      i++;
      continue;
    }
    const colonIdx = line.trimmed.indexOf(':');
    if (colonIdx === -1) {
      if (start === end - 1) return yamlScalar(line.trimmed);
      i++;
      continue;
    }
    const key = line.trimmed.slice(0, colonIdx).trim();
    const rest = line.trimmed.slice(colonIdx + 1).trim();
    if (rest) {
      obj[key] = yamlScalar(rest);
      i++;
    } else {
      const childIndent = baseIndent + 2;
      let j = i + 1;
      while (j < end && (lines[j]?.indent ?? 0) >= childIndent) j++;
      obj[key] = j > i + 1 ? parseYamlBlock(lines, i + 1, j, childIndent) : null;
      i = j;
    }
  }
  return obj;
}

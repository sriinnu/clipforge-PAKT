/**
 * @module dict-external
 * Cache-directive and external-dictionary plumbing for PAKT output.
 *
 * Owns the string-level transforms behind two cache-synergy features:
 *
 * 1. **`@cache prefix-end` directive** — injected right after the
 *    `@dict ... @end` block so MCP clients know exactly where to place a
 *    provider `cache_control` breakpoint. The directive is a no-op header:
 *    {@link stripCacheDirectives} removes it before parsing so round-trips
 *    stay lossless.
 * 2. **Dictionary-as-system-prompt** (`dictPlacement: 'system'`) —
 *    {@link extractDictBlock} splits the `@dict` block out of the
 *    compressed output and {@link mergeExternalDict} re-injects an
 *    externally-stored dictionary before decompression.
 */

/** The cache directive line emitted after the `@dict ... @end` block. */
export const CACHE_DIRECTIVE = '@cache prefix-end';

/**
 * Known PAKT header line prefixes for the header-region walk. Mirrors the
 * whitelist in `cache-breakpoint.ts`: restricting recognition prevents body
 * lines that legitimately start with `@` (e.g. `@mention`) from being
 * treated as part of the header region.
 */
const HEADER_PREFIXES = [
  '@from',
  '@compress',
  '@warning',
  '@version',
  '@target',
  '@profile',
  '@cache',
  '@ws-trail',
  '@ws-blanks',
];

/** True when a (trimmed) line is a recognised header/directive line. */
function isHeaderLine(line: string): boolean {
  if (line.length === 0 || line[0] !== '@') return false;
  const space = line.indexOf(' ');
  const head = space < 0 ? line : line.slice(0, space);
  return HEADER_PREFIXES.includes(head);
}

/** Strip a trailing `\r` so CRLF inputs compare like LF inputs. */
function chomp(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/**
 * Walk the header region of a PAKT string and return the index of the
 * first body line. Header region = leading known headers, blank lines,
 * and one `@dict ... @end` block. Returns `lines.length` when the whole
 * input is header-only.
 */
function findBodyStart(lines: string[]): number {
  let inDict = false;
  for (let i = 0; i < lines.length; i++) {
    const line = chomp(lines[i] ?? '');
    if (inDict) {
      if (line === '@end') inDict = false;
      continue;
    }
    if (line === '@dict' || line.startsWith('@dict ')) {
      inDict = true;
      continue;
    }
    if (line === '' || isHeaderLine(line)) continue;
    return i;
  }
  return lines.length;
}

// ---------------------------------------------------------------------------
// @cache directive: inject / strip
// ---------------------------------------------------------------------------

/**
 * Inject the `@cache prefix-end` directive on its own line immediately
 * after the header-region `@dict ... @end` block.
 *
 * No-ops (returns the input unchanged) when:
 * - there is no `@dict` block in the header region, or
 * - a `@cache` directive is already present in the header region.
 *
 * @param compressed - Serialized PAKT output
 * @returns The output with the directive injected after `@end`
 */
export function injectCacheDirective(compressed: string): string {
  const lines = compressed.split('\n');
  const bodyStart = findBodyStart(lines);

  let dictEnd = -1;
  let inDict = false;
  for (let i = 0; i < bodyStart; i++) {
    const line = chomp(lines[i] ?? '');
    if (line.startsWith('@cache')) return compressed; // already present
    if (inDict && line === '@end') {
      dictEnd = i;
      inDict = false;
    }
    if (line === '@dict') inDict = true;
  }
  if (dictEnd < 0) return compressed; // no dict block — nothing to mark

  lines.splice(dictEnd + 1, 0, CACHE_DIRECTIVE);
  return lines.join('\n');
}

/**
 * Remove `@cache ...` directive lines from the header region of a PAKT
 * string. Body lines are never touched, so text-format bodies that happen
 * to contain `@cache` survive intact. Decompression calls this first so
 * the directive behaves as a pure no-op header.
 *
 * @param pakt - PAKT string possibly carrying a cache directive
 * @returns The string with header-region `@cache` lines removed
 */
export function stripCacheDirectives(pakt: string): string {
  const lines = pakt.split('\n');
  const bodyStart = findBodyStart(lines);

  let removed = false;
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = chomp(lines[i] ?? '');
    if (i < bodyStart && line.startsWith('@cache')) {
      removed = true;
      continue;
    }
    kept.push(lines[i] ?? '');
  }
  return removed ? kept.join('\n') : pakt;
}

// ---------------------------------------------------------------------------
// Dictionary-as-system-prompt: extract / parse / merge
// ---------------------------------------------------------------------------

/** Result of splitting a `@dict` block out of compressed PAKT output. */
export interface DictBlockSplit {
  /**
   * The standalone dictionary block (`@dict` ... `@end`, plus the
   * `@cache prefix-end` directive when one was emitted). Suitable for
   * pinning into a system prompt with a `cache_control` breakpoint.
   */
  dictBlock: string;
  /** The remaining PAKT body (headers + data) with the dict block removed. */
  body: string;
}

/**
 * Split the header-region `@dict ... @end` block (and an immediately
 * following `@cache` directive, if present) out of a compressed PAKT
 * string. Used by `compress()` when `dictPlacement === 'system'`.
 *
 * @param compressed - Serialized PAKT output
 * @returns The split, or `null` when no dict block exists
 */
export function extractDictBlock(compressed: string): DictBlockSplit | null {
  const lines = compressed.split('\n');
  const bodyStart = findBodyStart(lines);

  let dictStart = -1;
  let dictEnd = -1;
  let inDict = false;
  for (let i = 0; i < bodyStart; i++) {
    const line = chomp(lines[i] ?? '');
    if (!inDict && line === '@dict') {
      dictStart = i;
      inDict = true;
      continue;
    }
    if (inDict && line === '@end') {
      dictEnd = i;
      break;
    }
  }
  if (dictStart < 0 || dictEnd < 0) return null;

  // Absorb a directly-following @cache directive into the dict block.
  let blockEnd = dictEnd;
  if (chomp(lines[dictEnd + 1] ?? '').startsWith('@cache')) blockEnd = dictEnd + 1;

  const dictBlock = lines.slice(dictStart, blockEnd + 1).join('\n');
  const body = [...lines.slice(0, dictStart), ...lines.slice(blockEnd + 1)].join('\n');
  return { dictBlock, body };
}

/** A parsed dictionary entry (alias → expansion). */
interface ExternalDictEntry {
  alias: string;
  expansion: string;
}

/**
 * Parse `$alias: expansion` entries out of a dictionary block string.
 * Tolerates surrounding `@dict` / `@end` / `@cache` lines and arbitrary
 * indentation, so callers can pass either a bare entry list or the full
 * block produced by {@link extractDictBlock}.
 */
function parseDictEntries(dict: string): ExternalDictEntry[] {
  const entries: ExternalDictEntry[] = [];
  for (const raw of dict.split('\n')) {
    const line = chomp(raw).trim();
    if (line === '' || line.startsWith('@')) continue;
    const match = /^(\$[a-z]{1,2}):\s+(.*)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      entries.push({ alias: match[1], expansion: match[2] });
    }
  }
  return entries;
}

/**
 * Merge an externally-supplied dictionary block into a PAKT string so the
 * standard decompression pipeline can expand aliases.
 *
 * Precedence: **inline entries win** on alias conflicts. A body produced
 * with `dictPlacement: 'system'` never carries an inline dict, so
 * conflicts only arise when a caller passes a stale external dict against
 * an inline-compressed body — in that case the document's own definitions
 * are authoritative. Non-conflicting external entries are emitted first
 * (preserving their order), then inline entries.
 *
 * @param pakt - PAKT body (with or without an inline `@dict` block)
 * @param externalDict - Dictionary block string (e.g. `PaktResult.dictBlock`)
 * @returns PAKT string with a single merged inline `@dict` block
 */
export function mergeExternalDict(pakt: string, externalDict: string): string {
  const external = parseDictEntries(externalDict);
  if (external.length === 0) return pakt;

  const lines = pakt.split('\n');
  const bodyStart = findBodyStart(lines);

  // Locate any inline dict block in the header region.
  let dictStart = -1;
  let dictEnd = -1;
  let inDict = false;
  for (let i = 0; i < bodyStart; i++) {
    const line = chomp(lines[i] ?? '');
    if (!inDict && line === '@dict') {
      dictStart = i;
      inDict = true;
    } else if (inDict && line === '@end') {
      dictEnd = i;
      break;
    }
  }

  const inline =
    dictStart >= 0 && dictEnd > dictStart
      ? parseDictEntries(lines.slice(dictStart + 1, dictEnd).join('\n'))
      : [];
  const inlineAliases = new Set(inline.map((e) => e.alias));

  const merged = [...external.filter((e) => !inlineAliases.has(e.alias)), ...inline];
  const block = ['@dict', ...merged.map((e) => `  ${e.alias}: ${e.expansion}`), '@end'];

  if (dictStart >= 0 && dictEnd > dictStart) {
    // Replace the existing inline block in place.
    return [...lines.slice(0, dictStart), ...block, ...lines.slice(dictEnd + 1)].join('\n');
  }

  /* No inline dict: insert after the leading pre-dict header run
     (@version / @from / @target / whitespace metadata) so the parser sees
     the dict exactly where compression would have emitted it. */
  let insertAt = 0;
  for (let i = 0; i < bodyStart; i++) {
    const line = chomp(lines[i] ?? '');
    if (line !== '' && isHeaderLine(line) && !line.startsWith('@cache')) {
      insertAt = i + 1;
    } else if (line !== '') {
      break;
    }
  }
  return [...lines.slice(0, insertAt), ...block, ...lines.slice(insertAt)].join('\n');
}

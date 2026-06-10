/**
 * @module layers/L3-5-metatoken
 * L3.5 — Meta-token compression: lossless aliasing of recurring BPE token spans
 * that cross word boundaries (the gap L2's word-ish substring mining misses).
 *
 * ### Algorithm
 * 1. Encode body with BPE; slide 2–4 token windows; keep boundary-crossing spans.
 * 2. Score: `netSavings = (spanToks − 1) × occ − (spanToks + 2)`. Keep net > 0.
 * 3. Dominance pruning: drop shorter spans subsumed by a longer same-freq one.
 * 4. Per-span safety gate: skip if rewrite doesn't reduce token count.
 * 5. Inject `$letter: span` after existing L2 aliases (append-only → cache-stable).
 *    Body occurrences are written as **quoted** `"${letter}"` or `"before${letter}after"`.
 *    Quoting is mandatory — bare `${` corrupts the PAKT parse (`{` is a delimiter).
 *
 * ### Lossless-by-construction gate
 * `verifyBodyRoundtrip` expands all placeholders and compares against the original
 * body before committing. On mismatch the rewrite is abandoned and
 * `_verifyGateAbandonCount` is incremented. Overhead: one linear body scan.
 *
 * ### Decompression
 * No new logic needed. `${letter}` is expanded by `decompressL2 → cloneScalar` Mode 3.
 *
 * @see src/layers/L3-5-metatoken-encode.ts
 * @see src/compress-helpers.ts
 */

import { countTokens } from '../tokens/index.js';
import {
  buildCharOffsets,
  encodeForModel,
  getEncoderForModel,
} from './L3-5-metatoken-encode.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum non-overlapping body occurrences to justify an alias. */
const MIN_OCCURRENCES = 3;

/** Token n-gram window sizes (in tokens), checked longest-first. */
const TOKEN_WINDOW_SIZES: ReadonlyArray<number> = [4, 3, 2];

/** Maximum aliases L3.5 may append (stays within the 52-alias total budget). */
const MAX_METATOKEN_ALIASES = 20;

/** A span must contain at least one of these characters to cross a boundary. */
const BOUNDARY_RE = /[ _\-./:]/;

/** Minimum span character length (very short spans are too low-value). */
const MIN_SPAN_LENGTH = 4;

/** Reject spans with structural/delimiter chars: `\n\r`, `$`, `|`, `{`, `}`.
 *  `{`/`}` are PAKT tokenizer delimiters — bare `${b}` in a value corrupts the parse. */
const SPAN_INVALID_RE = /[\n\r$|{}]/;
/** Spans must not start with 2+ spaces (PAKT indent) or a colon. */
const SPAN_STRUCTURAL_START_RE = /^ {2,}|^:/;
/** Spans must not be blank or end with `: ` (key-colon suffix). */
const SPAN_STRUCTURAL_END_RE = /:\s*$|^\s*$/;

/**
 * Matches a PAKT key-value line (possibly indented): `  key: value`.
 * Capture groups: [1] = indent+key+colon-space prefix, [2] = value text.
 * The value may be a double-quoted string (starting with `"`) or a bare token.
 */
const KV_LINE_RE = /^([ \t]*(?:[^:\n\r]+): )(.*\S.*)$/;

// -- Types -------------------------------------------------------------------

/** Internal candidate before safety-gate verification. */
interface MetatokenCandidate {
  span: string;
  occurrences: number;
  netSavings: number;
}

/** One selected meta-token alias, returned for testing and reporting. */
export interface MetatokenEntry {
  span: string;       // Literal text span aliased
  alias: string;      // Assigned alias string, e.g. `$c`
  occurrences: number;
  netSavings: number;
}

/** Result of {@link applyMetatokenCompression}. */
export interface MetatokenResult {
  pakt: string;                            // Updated PAKT (unchanged on no-op)
  savedTokens: number;                     // Real token reduction (0 on no-op)
  selected: ReadonlyArray<MetatokenEntry>; // Aliases selected (empty on no-op)
}

// -- Helpers -----------------------------------------------------------------

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countNonOverlapping(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while (true) {
    const idx = haystack.indexOf(needle, pos);
    if (idx === -1) break;
    count++;
    pos = idx + needle.length;
  }
  return count;
}

/**
 * Map 0-based alias index → alias string. 0–25 → `$a`–`$z`, 26–51 → `$aa`–`$az`.
 * Mirrors `L2-scoring.aliasForIndex`.
 */
function aliasForIndex(index: number): string {
  if (index < 26) return `$${String.fromCharCode(97 + index)}`;
  return `$a${String.fromCharCode(97 + (index - 26))}`;
}

/**
 * Escape `s` for embedding inside a PAKT `"..."` value (no surrounding quotes).
 * Handles: `\`, `"`, `\n`, `\t`, `\r`.
 */
function escapeForQuotedValue(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r');
}

/**
 * Replace `span` with `placeholder` in the body, quoting affected values.
 *
 * The PAKT tokenizer treats `{` as a structural delimiter. Bare unquoted values
 * containing `${b}` (e.g. `AASn${b}`) would be tokenised as `AASn` + BRACE_OPEN
 * + KEY(`b`) + BRACE_CLOSE, corrupting the document. This function is line-aware:
 * - Already-quoted values: replace inside the inner string (no rewrapping needed).
 * - Bare values: if the result contains `${`, wrap the entire value in `"..."`.
 * - Non-key-value lines (tabular, comment): skip conservatively if result has `${`.
 *
 * @param bodyText - PAKT body text (everything after @end)
 * @param span - Literal text span to replace
 * @param placeholder - Replacement string (e.g. `${b}`)
 * @returns Updated body text with properly quoted values
 */
function replaceSpanInBody(
  bodyText: string,
  span: string,
  placeholder: string,
): string {
  if (!bodyText.includes(span)) return bodyText;

  const outputLines: string[] = [];
  for (const line of bodyText.split('\n')) {
    if (!line.includes(span)) {
      outputLines.push(line);
      continue;
    }

    const kvMatch = KV_LINE_RE.exec(line);
    if (!kvMatch) {
      // Not a key-value line (tabular row, comment, etc.).
      // Conservative: skip lines where we can't safely quote the replacement.
      const replaced = line.split(span).join(placeholder);
      if (replaced.includes('${')) {
        // Unsafe — leave line unchanged to avoid parse corruption.
        outputLines.push(line);
      } else {
        outputLines.push(replaced);
      }
      continue;
    }

    // kvMatch[1] = "  key: " prefix, kvMatch[2] = value text
    const prefix = kvMatch[1] ?? '';
    const valueText = kvMatch[2] ?? '';

    if (valueText.startsWith('"') && valueText.endsWith('"') && valueText.length >= 2) {
      // Already quoted: replace inside the quoted content.
      // The inner text (without surrounding quotes) has PAKT escape sequences.
      const inner = valueText.slice(1, -1); // strip outer quotes
      if (!inner.includes(span)) {
        outputLines.push(line);
        continue;
      }
      const newInner = inner.split(span).join(escapeForQuotedValue(placeholder));
      outputLines.push(`${prefix}"${newInner}"`);
    } else {
      // Bare (unquoted) value: replace and re-quote if the result contains `${`.
      const newValue = valueText.split(span).join(placeholder);
      if (newValue.includes('${')) {
        // Must quote: `${` is invalid in an unquoted PAKT value.
        outputLines.push(`${prefix}"${escapeForQuotedValue(newValue)}"`);
      } else {
        outputLines.push(`${prefix}${newValue}`);
      }
    }
  }

  return outputLines.join('\n');
}

/**
 * Lossless-by-construction gate: expand all `${letter}` placeholders in
 * `rewrittenBody` via `aliasMap` and compare against `originalBody`.
 * Returns `true` iff they match exactly. On `false` the caller abandons the
 * entire rewrite. Overhead: one linear body scan — negligible for < 10 KB.
 *
 * @param rewrittenBody - Body after span→placeholder substitutions
 * @param originalBody - Body before any L3.5 rewrites
 * @param aliasMap - letter → span (e.g. `"b"` → `"_suffix"`)
 */
function verifyBodyRoundtrip(
  rewrittenBody: string,
  originalBody: string,
  aliasMap: ReadonlyMap<string, string>,
): boolean {
  // Expand all ${letter} placeholders in rewrittenBody using aliasMap
  const expanded = rewrittenBody.replace(/\$\{([a-z]{1,2})\}/g, (_match, name: string) => {
    const exp = aliasMap.get(name);
    return exp !== undefined ? exp : _match;
  });
  return expanded === originalBody;
}

/** Number of rewrites abandoned by the verification gate (debug observable). */
export let _verifyGateAbandonCount = 0;
/** Reset gate abandon counter (for tests). @internal */
export function _resetVerifyGateAbandonCount(): void { _verifyGateAbandonCount = 0; }

// -- Dict parsing ------------------------------------------------------------

/** Parse the `@dict` block: existing expansions, next alias index, `@end` line idx. */
function parseDictInfo(pakt: string): {
  existingExpansions: Set<string>;
  nextAliasIndex: number;
  dictEndLineIdx: number;
} {
  const lines = pakt.split('\n');
  let inDict = false;
  let dictEndLineIdx = -1;
  const existingExpansions = new Set<string>();
  let nextAliasIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? '').trim();
    if (trimmed === '@dict') { inDict = true; continue; }
    if (inDict && trimmed === '@end') { dictEndLineIdx = i; inDict = false; continue; }
    if (inDict) {
      const m = trimmed.match(/^\$([a-z]{1,2}):\s+(.+)$/);
      if (m?.[2]) { existingExpansions.add(m[2].trim()); nextAliasIndex++; }
    }
  }

  return { existingExpansions, nextAliasIndex, dictEndLineIdx };
}

/** Return the first body line index (after headers and `@dict...@end`). */
function findBodyStart(pakt: string, dictEndLineIdx: number): number {
  const lines = pakt.split('\n');
  const after = dictEndLineIdx >= 0 ? dictEndLineIdx + 1 : 0;
  for (let i = after; i < lines.length; i++) {
    const t = (lines[i] ?? '').trim();
    if (t === '' || t.startsWith('@') || t.startsWith('#')) continue;
    return i;
  }
  return after;
}

// -- Candidate discovery -----------------------------------------------------

/**
 * Discover meta-token candidates via BPE n-gram windows, scored by net savings.
 * Returns candidates sorted descending by savings with dominated spans removed.
 *
 * @param bodyText - PAKT body text (after @dict...@end)
 * @param existingExpansions - Already-aliased strings to skip
 * @param model - Target model for BPE encoding
 * @param nextAliasIndex - Next available alias slot
 */
function discoverCandidates(
  bodyText: string,
  existingExpansions: ReadonlySet<string>,
  model: string,
  nextAliasIndex: number,
): MetatokenCandidate[] {
  if (bodyText.trim().length === 0) return [];

  const maxNew = Math.min(MAX_METATOKEN_ALIASES, 52 - nextAliasIndex);
  if (maxNew <= 0) return [];

  const tokenIds = encodeForModel(bodyText, model);
  if (tokenIds.length < 2) return [];

  const encoder = getEncoderForModel(model);
  const offsets = buildCharOffsets(tokenIds, bodyText, encoder);
  if (!offsets) return [];

  // Collect unique spans from all window sizes in a single pass
  const slideCount = new Map<string, number>();
  for (const winSize of TOKEN_WINDOW_SIZES) {
    if (tokenIds.length < winSize) continue;
    for (let i = 0; i <= tokenIds.length - winSize; i++) {
      const spanStart = offsets[i];
      const spanEnd = offsets[i + winSize];
      if (spanStart === undefined || spanEnd === undefined) continue;
      const span = bodyText.slice(spanStart, spanEnd);
      if (!BOUNDARY_RE.test(span)) continue;
      if (span.length < MIN_SPAN_LENGTH) continue;
      if (existingExpansions.has(span)) continue;
      // Guard: no newlines (multi-line aliases break PAKT structure), no $ or |
      // Also rejects { and } (PAKT tokenizer delimiters that corrupt unquoted values)
      if (SPAN_INVALID_RE.test(span)) continue;
      // Guard: don't alias PAKT structural prefixes (indented key lines)
      if (SPAN_STRUCTURAL_START_RE.test(span)) continue;
      // Guard: don't alias patterns ending in colon-space (key: suffix)
      if (SPAN_STRUCTURAL_END_RE.test(span)) continue;
      slideCount.set(span, (slideCount.get(span) ?? 0) + 1);
    }
  }

  // Score and filter
  const candidates: MetatokenCandidate[] = [];
  for (const [span, rawCount] of slideCount) {
    if (rawCount < MIN_OCCURRENCES) continue;
    const occ = countNonOverlapping(bodyText, span);
    if (occ < MIN_OCCURRENCES) continue;
    const spanToks = countTokens(span, model);
    if (spanToks <= 1) continue;
    const netSavings = (spanToks - 1) * occ - (spanToks + 2);
    if (netSavings <= 0) continue;
    candidates.push({ span, occurrences: occ, netSavings });
  }

  candidates.sort((a, b) => b.netSavings - a.netSavings || b.span.length - a.span.length);

  // Dominance pruning: drop shorter spans subsumed by longer (same/higher freq)
  const kept: MetatokenCandidate[] = [];
  for (const c of candidates) {
    let dominated = false;
    for (const k of kept) {
      if (k.span.length > c.span.length && k.span.includes(c.span) && k.occurrences >= c.occurrences) {
        dominated = true;
        break;
      }
    }
    if (!dominated) kept.push(c);
    if (kept.length >= maxNew) break;
  }

  return kept;
}

// -- Main API ----------------------------------------------------------------

/**
 * Apply L3.5 meta-token compression to a fully serialized PAKT string.
 *
 * Finds recurring BPE token n-grams that cross word boundaries, appends
 * `$letter: span` aliases to the `@dict` block (append-only, cache-stable),
 * and rewrites occurrences as double-quoted `"${letter}"` inline aliases
 * handled by the existing decompressor. Returns input unchanged when:
 * - no `@dict` block exists (L2 must run first)
 * - no profitable spans found
 * - per-span or roundtrip-verification gate fires
 * - overall token count does not decrease
 *
 * @param pakt - Serialized PAKT string (after L2/L3)
 * @param model - Target model for BPE token counting (default `'gpt-4o'`)
 * @returns {@link MetatokenResult}
 */
export function applyMetatokenCompression(
  pakt: string,
  model = 'gpt-4o',
): MetatokenResult {
  const noOp: MetatokenResult = { pakt, savedTokens: 0, selected: [] };

  if (!pakt.includes('@dict')) return noOp;

  const { existingExpansions, nextAliasIndex, dictEndLineIdx } = parseDictInfo(pakt);
  if (dictEndLineIdx < 0) return noOp;
  if (nextAliasIndex >= 52) return noOp;

  const lines = pakt.split('\n');
  const bodyStartIdx = findBodyStart(pakt, dictEndLineIdx);
  const bodyText = lines.slice(bodyStartIdx).join('\n');
  if (bodyText.trim().length === 0) return noOp;

  const candidates = discoverCandidates(bodyText, existingExpansions, model, nextAliasIndex);
  if (candidates.length === 0) return noOp;

  // Apply candidates with per-span safety gate
  const selected: MetatokenEntry[] = [];
  const newDictLines: string[] = [];
  // aliasLetterMap: letter (e.g. "b") -> span (e.g. "_suffix") for roundtrip verify
  const aliasLetterMap = new Map<string, string>();
  let updatedBody = bodyText;

  for (const c of candidates) {
    if (nextAliasIndex + selected.length >= 52) break;
    const alias = aliasForIndex(nextAliasIndex + selected.length);
    const letter = alias.slice(1); // e.g. "b" from "$b"
    const placeholder = `\${${letter}}`; // e.g. "${b}"

    const before = countTokens(updatedBody, model);
    const candidate = replaceSpanInBody(updatedBody, c.span, placeholder);
    const after = countTokens(candidate, model);
    if (after >= before) continue; // skip: no real savings

    updatedBody = candidate;
    aliasLetterMap.set(letter, c.span);
    newDictLines.push(`  ${alias}: ${c.span}`);
    selected.push({ span: c.span, alias, occurrences: c.occurrences, netSavings: c.netSavings });
  }

  if (selected.length === 0) return noOp;

  // Lossless-by-construction safety gate: verify roundtrip before committing.
  // Expand all ${letter} placeholders in updatedBody and compare to original bodyText.
  if (!verifyBodyRoundtrip(updatedBody, bodyText, aliasLetterMap)) {
    _verifyGateAbandonCount++;
    return noOp;
  }

  // Reconstruct: inject new dict entries before the @end line
  const headerLines = lines.slice(0, dictEndLineIdx);
  const endLine = lines[dictEndLineIdx] ?? '@end';
  const interimLines = lines.slice(dictEndLineIdx + 1, bodyStartIdx);
  const newBodyLines = updatedBody.split('\n');

  const finalPakt = [
    ...headerLines,
    ...newDictLines,
    endLine,
    ...interimLines,
    ...newBodyLines,
  ].join('\n');

  // Final safety gate: overall token count must decrease
  const savedTokens = countTokens(pakt, model) - countTokens(finalPakt, model);
  if (savedTokens <= 0) return noOp;

  return { pakt: finalPakt, savedTokens, selected };
}

/**
 * @module cache-breakpoint
 * Compute a cache_control breakpoint hint for compressed PAKT output.
 *
 * The cacheable prefix ends right after the `@dict ... @end` block (or
 * after `@from <fmt>` when no dictionary was emitted). Body content
 * shifts per turn; the prefix above must stay byte-identical for the
 * provider's prompt cache to hit.
 *
 * Bedrock supports `cache_control.ttl = 3600` (Jan 2026); Anthropic's
 * direct API defaults to 300s (Mar 2026). OpenAI and Google auto-manage
 * caching and ignore explicit TTL — we surface 0 to mean "let the
 * provider decide."
 */

import type { CacheBreakpoint, CacheTarget } from './types.js';

const TTL_BY_TARGET: Record<CacheTarget, number> = {
  anthropic: 300,
  bedrock: 3600,
  openai: 0,
  google: 0,
};

/* `Buffer` is Node-only — using it in this module would crash the
   extension popup, desktop renderer, and playground worker the moment
   a user enables `cacheTarget`. `TextEncoder` is universal (Node 11+,
   all evergreen browsers) and gives the same byte length. We allocate
   once per call here, but the prefix region is small (a few hundred
   bytes typically) so it's not worth caching. */
const TEXT_ENCODER = new TextEncoder();
function utf8ByteLength(s: string): number {
  return TEXT_ENCODER.encode(s).length;
}

/**
 * Known PAKT headers. Restricting recognition to this set prevents a
 * body line that legitimately starts with `@` (`@mention`, `@Component`,
 * email-on-line-start) from being absorbed into the cacheable prefix
 * and silently destroying byte-stability across turns.
 */
const KNOWN_HEADERS = new Set([
  '@from',
  '@dict',
  '@end',
  '@compress',
  '@warning',
  '@version',
  '@target',
  '@profile',
  '@cache',
]);

/** Hard cap on dict scan to prevent unterminated `@dict` from swallowing the body. */
const MAX_DICT_LINES = 10_000;

function isKnownHeaderLine(line: string): boolean {
  if (line.length === 0 || line[0] !== '@') return false;
  const space = line.indexOf(' ');
  const head = space < 0 ? line : line.slice(0, space);
  return KNOWN_HEADERS.has(head);
}

/**
 * Find the byte offset where the cacheable prefix ends in `compressed`.
 *
 * Walks the leading lines and includes them in the prefix while they
 * are: `@`-prefixed headers, blank separators, or indented entries
 * inside a `@dict ... @end` block. Stops at the first body line. The
 * resulting offset is byte-stable as long as the header block stays
 * byte-stable across turns — that's the precondition for hitting the
 * provider's prompt cache.
 */
function findPrefixEnd(compressed: string): number {
  let pos = 0;
  let inDict = false;
  let dictLinesScanned = 0;
  /* If we enter @dict and never see @end within MAX_DICT_LINES, treat
     the input as malformed and refuse to emit any boundary — better to
     return null than to accidentally cache the body. */
  const dictStartPos = { value: -1 };

  while (pos < compressed.length) {
    const nl = compressed.indexOf('\n', pos);
    const lineEnd = nl >= 0 ? nl : compressed.length;
    let line = compressed.slice(pos, lineEnd);
    // Tolerate CRLF: strip a trailing \r so header comparisons match.
    if (line.endsWith('\r')) line = line.slice(0, -1);
    const advance = lineEnd + (nl >= 0 ? 1 : 0);

    if (inDict) {
      pos = advance;
      dictLinesScanned++;
      if (line === '@end') {
        inDict = false;
      } else if (dictLinesScanned > MAX_DICT_LINES) {
        // Unterminated @dict — refuse the boundary entirely.
        return 0;
      }
      continue;
    }

    if (line === '@dict' || line.startsWith('@dict ')) {
      pos = advance;
      inDict = true;
      dictStartPos.value = pos;
      dictLinesScanned = 0;
      continue;
    }

    if (line === '') {
      pos = advance;
      continue;
    }

    /* Restrict header recognition to a known whitelist. A body line
       starting with `@mention` or `@Component` would otherwise leak
       into the prefix and shift its bytes per turn — destroying the
       byte-stability the caller depends on for cache hits. */
    if (isKnownHeaderLine(line)) {
      pos = advance;
      continue;
    }

    // First non-empty, non-header line — body starts here.
    break;
  }

  // If we exited the loop while still inside @dict, dict was unterminated.
  if (inDict) return 0;

  return utf8ByteLength(compressed.slice(0, pos));
}

/**
 * Find the byte offset immediately after the `@cache prefix-end`
 * directive line (newline included) in the header region of a compressed
 * PAKT string. The directive explicitly marks where the cacheable prefix
 * ends, so consumers can place a provider `cache_control` breakpoint at
 * exactly this offset.
 *
 * Only the header region is scanned (known headers, blanks, and one
 * `@dict ... @end` block) — a body line that happens to start with
 * `@cache` is never matched.
 *
 * @param compressed - Serialized PAKT output
 * @returns Byte offset right after the directive line, or `null` when no
 *   directive is present in the header region
 */
export function findCacheDirectiveOffset(compressed: string): number | null {
  if (typeof compressed !== 'string' || compressed.length === 0) return null;

  let pos = 0;
  let inDict = false;
  let dictLinesScanned = 0;

  while (pos < compressed.length) {
    const nl = compressed.indexOf('\n', pos);
    const lineEnd = nl >= 0 ? nl : compressed.length;
    let line = compressed.slice(pos, lineEnd);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    const advance = lineEnd + (nl >= 0 ? 1 : 0);

    if (inDict) {
      pos = advance;
      dictLinesScanned++;
      if (line === '@end') inDict = false;
      else if (dictLinesScanned > MAX_DICT_LINES) return null;
      continue;
    }
    if (line === '@dict' || line.startsWith('@dict ')) {
      pos = advance;
      inDict = true;
      dictLinesScanned = 0;
      continue;
    }
    if (line === '@cache prefix-end') {
      return utf8ByteLength(compressed.slice(0, advance));
    }
    if (line === '' || isKnownHeaderLine(line)) {
      pos = advance;
      continue;
    }
    break; // body starts — no directive in the header region
  }
  return null;
}

/**
 * Compute a cache breakpoint hint for the given compressed output and
 * target. Returns `null` when the prefix has no usable boundary (e.g.
 * the input was passed through unchanged with no PAKT headers).
 *
 * When a `@cache prefix-end` directive is present in the header region,
 * its position is authoritative — the byte offset lands immediately
 * after the directive line. Otherwise the boundary falls back to the
 * end of the header block (after `@dict ... @end` or `@from`).
 *
 * Guards: returns `null` for null/undefined/empty input rather than
 * crashing — the function is exported on the public surface, so JS
 * callers (without TS protection) can hit it with bad arguments. The
 * TTL lookup falls back to `0` for unknown targets so a tampered
 * downstream string can't produce `undefined` numerics.
 */
export function computeCacheBreakpoint(
  compressed: string,
  target: CacheTarget,
): CacheBreakpoint | null {
  if (typeof compressed !== 'string' || compressed.length === 0) return null;

  const byteOffset = findCacheDirectiveOffset(compressed) ?? findPrefixEnd(compressed);
  if (byteOffset === 0) return null;

  return {
    byteOffset,
    recommendedTTLSeconds: TTL_BY_TARGET[target] ?? 0,
    target,
  };
}

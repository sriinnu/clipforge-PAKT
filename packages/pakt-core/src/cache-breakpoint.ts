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

  return Buffer.byteLength(compressed.slice(0, pos), 'utf8');
}

/**
 * Compute a cache breakpoint hint for the given compressed output and
 * target. Returns `null` when the prefix has no usable boundary (e.g.
 * the input was passed through unchanged with no PAKT headers).
 */
export function computeCacheBreakpoint(
  compressed: string,
  target: CacheTarget,
): CacheBreakpoint | null {
  const byteOffset = findPrefixEnd(compressed);
  if (byteOffset === 0) return null;

  return {
    byteOffset,
    recommendedTTLSeconds: TTL_BY_TARGET[target],
    target,
  };
}

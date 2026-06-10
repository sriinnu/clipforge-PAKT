/**
 * Cache-synergy pack tests (0.10 roadmap items 1a/1b).
 *
 * Covers:
 * - per-session rolling dictionary on the `pakt_compress` MCP path:
 *   byte-identical prefix (headers + @dict + @cache directive) across
 *   turns, with new aliases appending after existing entries
 * - the `@cache prefix-end` directive: emission, round-trip safety
 *   (no-op header), and byte-offset computation in cache-breakpoint.ts
 * - the `statelessDict` opt-out
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { computeCacheBreakpoint, findCacheDirectiveOffset } from '../src/cache-breakpoint.js';
import { compress } from '../src/compress.js';
import { decompress } from '../src/decompress.js';
import { CACHE_DIRECTIVE, stripCacheDirectives } from '../src/dict-external.js';
import { handlePaktTool } from '../src/mcp/index.js';
import { resetRollingDict, rollingDict } from '../src/mcp/rolling-dict.js';
import type { PaktCompressResult } from '../src/mcp/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Heterogeneous keyed records (not column-uniform arrays) so delta
 * encoding can't subsume the repetition and the L2 dictionary kicks in.
 * Mirrors the payload-shape used by the pakt_auto stability test.
 */
const buildPayload = (rows: Array<Record<string, string>>): string =>
  JSON.stringify(Object.fromEntries(rows.map((r, i) => [`row_${String(i)}`, r])));

const A = 'platform_engineering_team';
const B = 'security_engineering_team';
const C = 'observability_squad_team';

const TURN1 = buildPayload([
  { a: A, b: A, c: B },
  { a: B, b: A, c: A },
  { a: A, b: B, c: A },
  { a: B, b: A, c: B },
  { a: A, b: A, c: B },
  { a: B, b: B, c: A },
]);

/** Same value set as TURN1, different arrangement — overlapping payload. */
const TURN2 = buildPayload([
  { a: B, b: A, c: A },
  { a: A, b: B, c: B },
  { a: B, b: B, c: A },
  { a: A, b: A, c: B },
  { a: B, b: A, c: A },
  { a: A, b: B, c: B },
]);

/** Introduces a brand-new repeated value (C) on top of the shared set. */
const TURN3 = buildPayload([
  { a: A, b: C, c: B },
  { a: B, b: A, c: C },
  { a: C, b: B, c: A },
  { a: A, b: C, c: B },
  { a: C, b: A, c: B },
  { a: B, b: C, c: A },
]);

/** Run pakt_compress through the public tool dispatcher. */
function mcpCompress(args: Record<string, unknown>): PaktCompressResult {
  return handlePaktTool('pakt_compress', args) as PaktCompressResult;
}

/** Extract the trimmed `@dict` entry lines from a PAKT string. */
function dictLines(pakt: string): string[] {
  const lines = pakt.split('\n');
  const start = lines.findIndex((l) => l.trim() === '@dict');
  if (start === -1) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if ((lines[i] ?? '').trim() === '@end') break;
    out.push((lines[i] ?? '').trim());
  }
  return out;
}

beforeEach(() => {
  resetRollingDict();
});

// ---------------------------------------------------------------------------
// MCP prefix stability across turns
// ---------------------------------------------------------------------------

describe('pakt_compress rolling dictionary (prefix-cache stability)', () => {
  it('emits a byte-identical prefix (headers + @dict + @cache) on turn 2', () => {
    const turn1 = mcpCompress({ text: TURN1, cacheTarget: 'anthropic' });
    const turn2 = mcpCompress({ text: TURN2, cacheTarget: 'anthropic' });

    expect(dictLines(turn1.compressed).length).toBeGreaterThan(0);
    expect(turn1.cacheByteOffset).toBeDefined();
    expect(turn2.cacheByteOffset).toBe(turn1.cacheByteOffset);

    // The full cacheable prefix — including the @cache directive — must
    // be byte-identical turn-over-turn for provider caches to hit.
    const offset = turn1.cacheByteOffset ?? 0;
    const prefix1 = Buffer.from(turn1.compressed, 'utf8').subarray(0, offset);
    const prefix2 = Buffer.from(turn2.compressed, 'utf8').subarray(0, offset);
    expect(prefix2.equals(prefix1)).toBe(true);
    expect(prefix1.toString('utf8')).toContain(CACHE_DIRECTIVE);
  });

  it('appends new aliases after existing entries (append-only @dict)', () => {
    const turn1 = mcpCompress({ text: TURN1, cacheTarget: 'anthropic' });
    mcpCompress({ text: TURN2, cacheTarget: 'anthropic' });
    const turn3 = mcpCompress({ text: TURN3, cacheTarget: 'anthropic' });

    const d1 = dictLines(turn1.compressed);
    const d3 = dictLines(turn3.compressed);
    expect(d3.length).toBeGreaterThan(d1.length);

    // Every turn-1 entry keeps its exact slot ($a, $b, ...) in turn 3;
    // the new expansion appends at the end.
    for (let i = 0; i < d1.length; i++) {
      expect(d3[i]).toBe(d1[i]);
    }
    expect(d3.slice(d1.length).join('\n')).toContain(C);
  });

  it('statelessDict opts out of the session dictionary', () => {
    mcpCompress({ text: TURN1, statelessDict: true });
    mcpCompress({ text: TURN2, statelessDict: true });
    expect(rollingDict.getStats().size).toBe(0);

    // A stateful call seeds the session dictionary.
    mcpCompress({ text: TURN1 });
    expect(rollingDict.getStats().size).toBeGreaterThan(0);
  });

  it('round-trips MCP output carrying the directive back to the original data', () => {
    const turn1 = mcpCompress({ text: TURN1, cacheTarget: 'bedrock' });
    expect(turn1.compressed).toContain(CACHE_DIRECTIVE);
    const restored = decompress(turn1.compressed, 'json');
    expect(JSON.parse(restored.text)).toEqual(JSON.parse(TURN1));
  });
});

// ---------------------------------------------------------------------------
// @cache directive emission + offsets (library surface)
// ---------------------------------------------------------------------------

describe('@cache prefix-end directive', () => {
  it('is emitted after @end when a cache target is set', () => {
    const result = compress(TURN1, { target: 'anthropic' });
    const lines = result.compressed.split('\n');
    const endIdx = lines.indexOf('@end');
    expect(endIdx).toBeGreaterThan(0);
    expect(lines[endIdx + 1]).toBe(CACHE_DIRECTIVE);
  });

  it('is emitted via cacheDirective: true without a provider target', () => {
    const result = compress(TURN1, { cacheDirective: true });
    expect(result.compressed).toContain(CACHE_DIRECTIVE);
    expect(result.cacheBreakpoint).toBeUndefined();
  });

  it('is NOT emitted when no dictionary block exists', () => {
    const result = compress('{"a":1,"b":2}', { target: 'anthropic', dictMinSavings: 999 });
    expect(result.compressed).not.toContain(CACHE_DIRECTIVE);
  });

  it('cache-breakpoint byte offset matches the actual directive position', () => {
    const result = compress(TURN1, { target: 'anthropic' });
    const needle = `${CACHE_DIRECTIVE}\n`;
    const idx = result.compressed.indexOf(needle);
    expect(idx).toBeGreaterThan(0);
    const expected = Buffer.byteLength(result.compressed.slice(0, idx + needle.length), 'utf8');

    expect(findCacheDirectiveOffset(result.compressed)).toBe(expected);
    expect(result.cacheBreakpoint?.byteOffset).toBe(expected);
    expect(computeCacheBreakpoint(result.compressed, 'anthropic')?.byteOffset).toBe(expected);
  });

  it('ignores @cache-looking lines in the body (text format)', () => {
    const body = '@from text\nplain line one\n@cache prefix-end\nplain line two\n';
    expect(findCacheDirectiveOffset(body)).toBeNull();
    expect(stripCacheDirectives(body)).toBe(body);
  });

  it('decompression treats the directive as a no-op header (lossless round-trip)', () => {
    const withDirective = compress(TURN1, { target: 'bedrock' });
    const without = compress(TURN1);
    expect(withDirective.compressed).toContain(CACHE_DIRECTIVE);
    expect(without.compressed).not.toContain(CACHE_DIRECTIVE);

    const a = decompress(withDirective.compressed, 'json');
    const b = decompress(without.compressed, 'json');
    expect(a.wasLossy).toBe(false);
    expect(JSON.parse(a.text)).toEqual(JSON.parse(TURN1));
    expect(a.text).toBe(b.text);
  });
});

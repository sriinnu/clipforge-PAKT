/**
 * Cache breakpoint hint tests.
 *
 * Validates the `target` option on `compress()` produces a usable
 * cacheBreakpoint that lands right after the @dict ... @end block, with
 * the correct provider-specific TTL.
 */
import { describe, expect, it } from 'vitest';
import { compress } from '../src/compress.js';

describe('cache breakpoint hint', () => {
  const records = JSON.stringify(
    Array.from({ length: 30 }, (_, i) => ({
      name: `User_${String(i)}`,
      role: 'developer',
      department: 'engineering',
      active: true,
    })),
  );

  it('returns no hint when target is unset', () => {
    const result = compress(records);
    expect(result.cacheBreakpoint).toBeUndefined();
  });

  it('returns a hint at the start of the body for bedrock', () => {
    const result = compress(records, { target: 'bedrock' });
    expect(result.cacheBreakpoint).toBeDefined();
    expect(result.cacheBreakpoint?.target).toBe('bedrock');
    expect(result.cacheBreakpoint?.recommendedTTLSeconds).toBe(3600);

    // The byteOffset must land at a line boundary right before the body
    // (so all `@`-headers + dict + blank separators are in the prefix).
    const offset = result.cacheBreakpoint?.byteOffset ?? 0;
    const buf = Buffer.from(result.compressed, 'utf8');
    const prefix = buf.subarray(0, offset).toString('utf8');
    const suffix = buf.subarray(offset).toString('utf8');
    // Prefix must end on a line boundary.
    expect(prefix.length === 0 || prefix.endsWith('\n')).toBe(true);
    // Suffix must NOT start with an `@`-header — the cacheable region
    // is supposed to contain ALL of those.
    expect(suffix.startsWith('@')).toBe(false);
  });

  it('emits 300s TTL for anthropic direct', () => {
    const result = compress(records, { target: 'anthropic' });
    expect(result.cacheBreakpoint?.recommendedTTLSeconds).toBe(300);
  });

  it('emits 0s TTL for auto-managed providers (openai, google)', () => {
    const openai = compress(records, { target: 'openai' });
    expect(openai.cacheBreakpoint?.recommendedTTLSeconds).toBe(0);
    const google = compress(records, { target: 'google' });
    expect(google.cacheBreakpoint?.recommendedTTLSeconds).toBe(0);
  });

  it('falls back to @from header when no @dict block is emitted', () => {
    /* Force a high min-savings threshold so PAKT skips emitting @dict
       on a tiny input. The breakpoint should still anchor on @from. */
    const result = compress('{"a":1,"b":2}', {
      target: 'bedrock',
      dictMinSavings: 999,
    });
    expect(result.cacheBreakpoint).toBeDefined();

    const offset = result.cacheBreakpoint?.byteOffset ?? 0;
    const buf = Buffer.from(result.compressed, 'utf8');
    const prefix = buf.subarray(0, offset).toString('utf8');
    const suffix = buf.subarray(offset).toString('utf8');
    expect(prefix.startsWith('@from ')).toBe(true);
    expect(suffix.startsWith('@')).toBe(false);
  });

  it('byte offset matches across targets — only TTL differs', () => {
    const bedrock = compress(records, { target: 'bedrock' });
    const anthropic = compress(records, { target: 'anthropic' });
    expect(bedrock.cacheBreakpoint?.byteOffset).toBe(anthropic.cacheBreakpoint?.byteOffset);
    expect(bedrock.cacheBreakpoint?.recommendedTTLSeconds).not.toBe(
      anthropic.cacheBreakpoint?.recommendedTTLSeconds,
    );
  });

  it('does NOT absorb a body line that legitimately starts with @ (e.g. @mention)', () => {
    /* Markdown body whose first line is `@channel announcement`. The
       finder must NOT treat @channel as a header — that would shift
       the prefix end past real body content and break byte-stability
       across turns when the @mention text changes. */
    const md = '@channel announcement\n\nbody line two\nbody line three\n';
    const result = compress(md, { target: 'bedrock' });
    if (!result.cacheBreakpoint) return; // Passthrough — nothing to assert.

    const offset = result.cacheBreakpoint.byteOffset;
    const buf = Buffer.from(result.compressed, 'utf8');
    const suffix = buf.subarray(offset).toString('utf8');
    // The body must not be cut into the prefix — the suffix should
    // still contain the @channel content as body, not have it absorbed.
    expect(suffix.includes('@channel')).toBe(true);
  });

  it('refuses a boundary when @dict is unterminated (malformed input)', async () => {
    /* Construct synthetic compressed text directly to test the
       defensive path — an upstream bug or truncated write that opens
       @dict and never closes it. We invoke findPrefixEnd transitively
       by passing already-PAKT input back through compress' detection
       layer, but the guarantee we want here is: zero offset → no hint. */
    const { computeCacheBreakpoint } = await import('../src/cache-breakpoint.js');
    const malformed = '@from json\n@dict\n  $a: developer\nbody line never closed dict\n';
    const hint = computeCacheBreakpoint(malformed, 'bedrock');
    expect(hint).toBeNull();
  });

  it('handles CRLF line endings (does not break dict detection)', async () => {
    const { computeCacheBreakpoint } = await import('../src/cache-breakpoint.js');
    const crlf = '@from json\r\n@dict\r\n  $a: dev\r\n@end\r\n\r\nbody line\r\n';
    const hint = computeCacheBreakpoint(crlf, 'bedrock');
    expect(hint).not.toBeNull();
    const offset = hint?.byteOffset ?? 0;
    const prefix = crlf.slice(0, offset);
    // The @dict block must be inside the prefix.
    expect(prefix.includes('$a: dev')).toBe(true);
    // Body must be after.
    expect(crlf.slice(offset).includes('body line')).toBe(true);
  });

  it('byte offset is consistent across turns when @dict is prefix-stable', () => {
    /* Two calls with the same input should produce the same prefix and
       therefore the same byte offset. This is the cache-stability
       invariant the rolling-dict work depends on. */
    const a = compress(records, { target: 'bedrock' });
    const b = compress(records, { target: 'bedrock' });
    expect(a.cacheBreakpoint?.byteOffset).toBe(b.cacheBreakpoint?.byteOffset);
    expect(a.compressed.slice(0, a.cacheBreakpoint?.byteOffset)).toBe(
      b.compressed.slice(0, b.cacheBreakpoint?.byteOffset),
    );
  });
});

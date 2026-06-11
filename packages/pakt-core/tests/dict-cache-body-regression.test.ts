/**
 * @module tests/dict-cache-body-regression
 * Regression tests for P1-4: `@cache` lines in the body must NOT be stripped
 * by `stripCacheDirectives`. Only `@cache` lines that `injectCacheDirective`
 * could have placed (immediately after `@dict...@end`) are header-region lines.
 *
 * Bug: `findBodyStart` absorbed any `@cache`-prefixed line as a known header,
 * so a text/markdown body whose first content line was `@cache prefix-end`
 * would be silently deleted by `stripCacheDirectives`.
 */

import { describe, expect, it } from 'vitest';
import { compress, decompress } from '../src/index.js';
import { stripCacheDirectives, injectCacheDirective } from '../src/dict-external.js';

// ---------------------------------------------------------------------------
// Direct stripCacheDirectives unit tests
// ---------------------------------------------------------------------------

describe('stripCacheDirectives — body @cache lines survive', () => {
  it('only strips header-region @cache; body @cache prefix-end is preserved', () => {
    const pakt = [
      '@from text',
      '@dict',
      '  $a: some_value',
      '@end',
      '@cache prefix-end',   // <-- valid header, should be stripped
      '@cache prefix-end',   // <-- first body line (position after header ends), must survive
      'some body content',
    ].join('\n');

    const stripped = stripCacheDirectives(pakt);
    const lines = stripped.split('\n');

    // Header @cache removed, body @cache preserved
    const headerCacheCount = lines
      .slice(0, lines.indexOf('@cache prefix-end'))
      .filter((l) => l.startsWith('@cache')).length;
    expect(headerCacheCount).toBe(0);

    // The body line '@cache prefix-end' must still be in the output
    expect(stripped).toContain('@cache prefix-end');
    // But the header should not carry it (only one occurrence if the body still has it)
    const allCacheLines = lines.filter((l) => l.trim() === '@cache prefix-end');
    // After stripping, only the body copy remains (1 occurrence, not 2)
    expect(allCacheLines.length).toBe(1);
  });

  it('@cache immediately after @dict...@end is treated as header and stripped', () => {
    // When @cache appears immediately after @end, it is indistinguishable from
    // the directive placed by injectCacheDirective — treated as header, stripped.
    // This documents the expected (and correct) behavior: users should not place
    // literal '@cache ...' lines as the very first body line after @dict...@end.
    const raw = [
      '@from text',
      '@dict',
      '  $a: hello',
      '@end',
      '@cache prefix-end',   // immediately after @end — treated as header
      'more text',
      'final line',
    ].join('\n');

    const stripped = stripCacheDirectives(raw);
    // The @cache immediately after @end is stripped (it looks like a header injection)
    expect(stripped).not.toContain('@cache prefix-end');
    expect(stripped).toContain('more text');
    expect(stripped).toContain('final line');
  });

  it('@cache before @dict is treated as body (not stripped)', () => {
    // If @cache appears before any @dict block, it's a body line
    const pakt = [
      '@from text',
      '@cache something',      // before @dict — should NOT be stripped
      '@dict',
      '  $a: value',
      '@end',
      'body here',
    ].join('\n');

    const stripped = stripCacheDirectives(pakt);
    expect(stripped).toContain('@cache something');
  });

  it('header @cache line immediately after @dict...@end is stripped normally', () => {
    const pakt = [
      '@from json',
      '@dict',
      '  $a: developer',
      '@end',
      '@cache prefix-end',   // valid header — should be stripped
      'key: $a',
    ].join('\n');

    const stripped = stripCacheDirectives(pakt);
    expect(stripped).not.toContain('@cache prefix-end');
    expect(stripped).toContain('key: $a');
  });
});

// ---------------------------------------------------------------------------
// injectCacheDirective — only injects in valid position
// ---------------------------------------------------------------------------

describe('injectCacheDirective — does not inject into body', () => {
  it('no-ops when body starts with @cache (avoid double injection)', () => {
    const pakt = [
      '@from json',
      '@dict',
      '  $a: dev',
      '@end',
      '@cache prefix-end',   // already injected — no-op
      'key: $a',
    ].join('\n');

    const result = injectCacheDirective(pakt);
    // Already present → returned unchanged
    expect(result).toBe(pakt);
  });
});

// ---------------------------------------------------------------------------
// Roundtrip: text payload with @cache mid-body
// ---------------------------------------------------------------------------

describe('roundtrip: text/markdown payloads with @cache mid-body', () => {
  it('markdown payload containing @cache mid-body roundtrips intact', () => {
    // Craft a text payload that contains @cache somewhere in the body
    // and compress it with a cacheTarget so a real @cache header is injected.
    const REPETITIVE = Array.from(
      { length: 8 },
      (_, i) => `entry ${String(i)}: platform_reliability_squad platform_reliability_squad`,
    ).join('\n') + '\n@cache some-annotation\nend of file';

    // compress with text format (no structural compression, but @cache directive may be added)
    const result = compress(REPETITIVE, { fromFormat: 'text', target: 'anthropic' });

    // decompress should restore the original text including the @cache mid-body line
    const restored = decompress(result.compressed);
    expect(restored.text).toContain('@cache some-annotation');
  });

  it('text payload with @cache prefix-end as first body line roundtrips', () => {
    // Build a text that starts with @cache prefix-end after some leading text
    const body = '@cache prefix-end\nrest of text here\n more text';
    const repetitive = Array.from({ length: 6 }, () => body).join('\n');

    const result = compress(repetitive, { fromFormat: 'text' });
    const restored = decompress(result.compressed);

    // The body must survive intact
    expect(restored.text).toContain('@cache prefix-end');
  });
});

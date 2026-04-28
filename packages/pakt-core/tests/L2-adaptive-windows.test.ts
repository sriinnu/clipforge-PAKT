/**
 * Unit tests for the adaptive substring window-size selector used by L2.
 * Covers the three adaptations layered on top of the static ladder:
 * cap by max length, extend upward for long values, extend downward for
 * short-heavy corpora.
 */

import { describe, expect, it } from 'vitest';
import { SUBSTRING_WINDOW_SIZES, computeAdaptiveWindowSizes } from '../src/layers/L2-scoring.js';

describe('computeAdaptiveWindowSizes', () => {
  it('returns the default ladder when the input is empty', () => {
    // Empty corpora should not crash callers; the static ladder is a safe
    // fallback because the mining loop will simply find no matches.
    expect(computeAdaptiveWindowSizes([])).toEqual([...SUBSTRING_WINDOW_SIZES]);
  });

  it('returns an empty ladder when no value is large enough to mine', () => {
    // Smallest viable window is 6; with all values below that the miner
    // can short-circuit instead of looping.
    expect(computeAdaptiveWindowSizes(['ab', 'cd', 'ef'])).toEqual([]);
  });

  it('caps the ladder by the longest value length', () => {
    // Longest value is 16 chars → windows above 16 are unreachable.
    const sizes = computeAdaptiveWindowSizes(['error-handler-x', 'error-handler-y']);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(16);
    expect(sizes).not.toContain(20);
    expect(sizes).not.toContain(24);
    expect(sizes).not.toContain(32);
  });

  it('extends upward (40/48/64) when long values are present', () => {
    // 80+ char URL-style strings — the default 32-cap would split repeats.
    const longUrl =
      'https://api.example.com/v1/tenants/acme-corp/users/12345/orders/78901/items.json';
    expect(longUrl.length).toBeGreaterThanOrEqual(64);
    const sizes = computeAdaptiveWindowSizes([longUrl, longUrl, longUrl]);
    expect(sizes).toContain(64);
    expect(sizes).toContain(48);
    expect(sizes).toContain(40);
    // Default ladder still present.
    expect(sizes).toContain(32);
    expect(sizes).toContain(6);
  });

  it('extends downward (5) when most values are shorter than 12 chars', () => {
    // 6 short values + 1 medium → shortRatio ≈ 0.86, well over the 0.5 trigger.
    const sizes = computeAdaptiveWindowSizes(['AB', 'CD', 'EF', 'GH', 'IJ', 'KL', 'longer-string']);
    expect(sizes).toContain(5);
    expect(sizes).toContain(6);
  });

  it('does not append window 5 when the corpus is mostly long values', () => {
    // Single short value out of three — shortRatio = 0.33, below threshold.
    const sizes = computeAdaptiveWindowSizes(['ab', 'longer-string-one', 'another-longer-string']);
    expect(sizes).not.toContain(5);
  });

  it('returns sizes sorted descending and de-duplicated', () => {
    // Values that trigger both extensions ensure no duplicates leak through
    // the Set-based merge and the sort order is stable for the miner.
    const longUrl =
      'https://api.example.com/v1/tenants/acme-corp/users/12345/orders/78901/items.json';
    const sizes = computeAdaptiveWindowSizes([longUrl, 'ab', 'cd', 'ef', 'gh']);
    const sorted = [...sizes].sort((a, b) => b - a);
    expect(sizes).toEqual(sorted);
    expect(new Set(sizes).size).toBe(sizes.length);
  });
});

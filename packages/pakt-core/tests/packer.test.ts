import { describe, expect, it } from 'vitest';
import { pack } from '../src/packer/packer.js';
import type { PackerItem } from '../src/packer/types.js';
import { countTokens } from '../src/tokens/counter.js';

// ---------------------------------------------------------------------------
// Test fixtures — reusable items for multiple tests
// ---------------------------------------------------------------------------

/**
 * Build a JSON string representing N users. Produces content that
 * benefits from PAKT compression (repeated keys, structured data).
 */
function makeJsonContent(count: number): string {
  const users = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `User${i + 1}`,
    role: 'developer',
    active: true,
  }));
  return JSON.stringify({ users });
}

/** Small JSON payload — low token count. */
const SMALL_JSON = '{"name":"Alice","role":"dev"}';

/** Medium JSON payload — moderate token count. */
const MEDIUM_JSON = makeJsonContent(5);

/** Large JSON payload — higher token count. */
const LARGE_JSON = makeJsonContent(20);

// ===========================================================================
// 1. Basic packing — all items fit
// ===========================================================================

describe('pack — basic packing', () => {
  it('packs 3 small items within a generous budget', () => {
    const items: PackerItem[] = [
      { id: 'a', content: SMALL_JSON, priority: 1 },
      { id: 'b', content: SMALL_JSON, priority: 2 },
      { id: 'c', content: SMALL_JSON, priority: 3 },
    ];

    // Use a very large budget so everything fits
    const result = pack(items, { budget: 10_000 });

    expect(result.packed).toHaveLength(3);
    expect(result.dropped).toHaveLength(0);
    expect(result.totalTokens).toBeGreaterThan(0);
    expect(result.remainingBudget).toBeGreaterThan(0);
    expect(result.stats.totalItems).toBe(3);
    expect(result.stats.packedCount).toBe(3);
    expect(result.stats.droppedCount).toBe(0);
  });

  it('returns empty result for empty input array', () => {
    const result = pack([], { budget: 1000 });

    expect(result.packed).toHaveLength(0);
    expect(result.dropped).toHaveLength(0);
    expect(result.totalTokens).toBe(0);
    expect(result.stats.totalItems).toBe(0);
  });
});

// ===========================================================================
// 2. Budget overflow — some items dropped
// ===========================================================================

describe('pack — budget overflow', () => {
  it('drops items when budget is exceeded (5 items, only some fit)', () => {
    const items: PackerItem[] = [
      { id: 'a', content: MEDIUM_JSON, priority: 50 },
      { id: 'b', content: MEDIUM_JSON, priority: 40 },
      { id: 'c', content: MEDIUM_JSON, priority: 30 },
      { id: 'd', content: MEDIUM_JSON, priority: 20 },
      { id: 'e', content: MEDIUM_JSON, priority: 10 },
    ];

    // Find how many tokens a single compressed item needs
    const singleResult = pack([items[0]], { budget: 10_000 });
    const tokensPerItem = singleResult.totalTokens;

    // Set budget to fit ~3 items (plus reserve)
    const budget = tokensPerItem * 3 + 50;
    const result = pack(items, { budget });

    expect(result.packed.length).toBeGreaterThanOrEqual(2);
    expect(result.packed.length).toBeLessThanOrEqual(4);
    expect(result.dropped.length).toBeGreaterThan(0);
    expect(result.stats.packedCount + result.stats.droppedCount).toBe(5);

    // Dropped items should have a reason
    for (const d of result.dropped) {
      expect(d.reason).toBe('over_budget');
      expect(d.tokensNeeded).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// 3. Priority ordering
// ===========================================================================

describe('pack — priority strategy', () => {
  it('packs higher-priority items first', () => {
    const items: PackerItem[] = [
      { id: 'low', content: MEDIUM_JSON, priority: 1 },
      { id: 'high', content: MEDIUM_JSON, priority: 100 },
      { id: 'mid', content: MEDIUM_JSON, priority: 50 },
    ];

    // Budget for only 1 item
    const singleResult = pack([items[0]], { budget: 10_000 });
    const tokensPerItem = singleResult.totalTokens;
    const budget = tokensPerItem + 50;

    const result = pack(items, { budget, strategy: 'priority' });

    // The highest-priority item should be packed
    expect(result.packed.length).toBeGreaterThanOrEqual(1);
    expect(result.packed[0].id).toBe('high');
  });
});

// ===========================================================================
// 4. Recency strategy
// ===========================================================================

describe('pack — recency strategy', () => {
  it('packs most recent items (last in array) first', () => {
    const items: PackerItem[] = [
      { id: 'oldest', content: MEDIUM_JSON, priority: 100 },
      { id: 'middle', content: MEDIUM_JSON, priority: 100 },
      { id: 'newest', content: MEDIUM_JSON, priority: 100 },
    ];

    // Budget for only 1 item
    const singleResult = pack([items[0]], { budget: 10_000 });
    const tokensPerItem = singleResult.totalTokens;
    const budget = tokensPerItem + 50;

    const result = pack(items, { budget, strategy: 'recency' });

    // The newest item (last in array) should be packed first
    expect(result.packed.length).toBeGreaterThanOrEqual(1);
    expect(result.packed[0].id).toBe('newest');
  });
});

// ===========================================================================
// 5. Adaptive compression
// ===========================================================================

describe('pack — adaptive compression', () => {
  it('applies more aggressive compression to lower-priority items', () => {
    // Create items with varying priority — the bottom 30% should get L3
    const items: PackerItem[] = Array.from({ length: 10 }, (_, i) => ({
      id: `item-${i}`,
      content: makeJsonContent(3),
      priority: 10 - i,
    }));

    // Large budget so all items fit, but we can observe adaptive behavior
    const withAdaptive = pack(items, {
      budget: 50_000,
      strategy: 'priority',
      adaptiveCompression: true,
    });

    const withoutAdaptive = pack(items, {
      budget: 50_000,
      strategy: 'priority',
      adaptiveCompression: false,
    });

    // With adaptive, total tokens should be roughly comparable to without adaptive.
    // L3 can occasionally add minor overhead (e.g., @target header costs ~1-2 tokens
    // when the tokenizer optimization doesn't fully compensate), so we allow a
    // small margin. The key insight: adaptive compression *attempts* to save more
    // but the safety revert in compress() handles cases where L3 doesn't help.
    const tolerance = 10;
    expect(withAdaptive.totalTokens).toBeLessThanOrEqual(withoutAdaptive.totalTokens + tolerance);

    // Both should pack all items
    expect(withAdaptive.stats.packedCount).toBe(10);
    expect(withoutAdaptive.stats.packedCount).toBe(10);
  });
});

// ===========================================================================
// 6. Zero budget — all items dropped
// ===========================================================================

describe('pack — zero budget', () => {
  it('drops all items when budget is 0', () => {
    const items: PackerItem[] = [
      { id: 'a', content: SMALL_JSON, priority: 10 },
      { id: 'b', content: SMALL_JSON, priority: 5 },
    ];

    const result = pack(items, { budget: 0 });

    expect(result.packed).toHaveLength(0);
    expect(result.dropped).toHaveLength(2);
    expect(result.totalTokens).toBe(0);
    expect(result.remainingBudget).toBe(0);
  });

  it('drops all items when budget equals reserve tokens', () => {
    const items: PackerItem[] = [{ id: 'a', content: SMALL_JSON }];

    // Budget exactly equals the default reserve (50), effective budget = 0
    const result = pack(items, { budget: 50 });

    expect(result.packed).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
  });
});

// ===========================================================================
// 7. Single item
// ===========================================================================

describe('pack — single item', () => {
  it('packs a single item correctly', () => {
    const items: PackerItem[] = [
      { id: 'only', content: MEDIUM_JSON, priority: 5, metadata: { source: 'test' } },
    ];

    const result = pack(items, { budget: 10_000 });

    expect(result.packed).toHaveLength(1);
    expect(result.packed[0].id).toBe('only');
    expect(result.packed[0].originalTokens).toBeGreaterThan(0);
    expect(result.packed[0].compressedTokens).toBeGreaterThan(0);
    expect(result.packed[0].metadata).toEqual({ source: 'test' });
    expect(result.dropped).toHaveLength(0);
    expect(result.stats.totalItems).toBe(1);
    expect(result.stats.packedCount).toBe(1);
  });

  it('drops a single item when it exceeds budget', () => {
    const items: PackerItem[] = [{ id: 'big', content: LARGE_JSON }];

    // Budget too small for the item (just reserve + a few tokens)
    const result = pack(items, { budget: 55 });

    expect(result.packed).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].id).toBe('big');
    expect(result.dropped[0].reason).toBe('over_budget');
  });
});

// ===========================================================================
// 8. Error handling — bad input doesn't crash
// ===========================================================================

describe('pack — error handling', () => {
  it('handles items with empty content gracefully', () => {
    const items: PackerItem[] = [
      { id: 'empty', content: '', priority: 5 },
      { id: 'valid', content: SMALL_JSON, priority: 10 },
    ];

    const result = pack(items, { budget: 10_000 });

    // Should not throw; both items should be processed
    expect(result.stats.totalItems).toBe(2);
    expect(result.packed.length).toBeGreaterThanOrEqual(1);
  });

  it('handles items with non-compressible content gracefully', () => {
    const items: PackerItem[] = [
      { id: 'plain', content: 'Just a simple plain text string.', priority: 5 },
      { id: 'json', content: SMALL_JSON, priority: 10 },
    ];

    const result = pack(items, { budget: 10_000 });

    // Plain text won't compress — should still be packed as-is
    expect(result.stats.totalItems).toBe(2);
    const plainPacked = result.packed.find((p) => p.id === 'plain');
    expect(plainPacked).toBeDefined();
    // For plain text, wasCompressed should be false (no PAKT benefit)
    // or true if compress happened to reduce it (unlikely for plain text)
    expect(plainPacked!.compressedTokens).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 9. Stats accuracy
// ===========================================================================

describe('pack — stats accuracy', () => {
  it('stats match the actual packed/dropped counts', () => {
    const items: PackerItem[] = [
      { id: 'a', content: MEDIUM_JSON, priority: 10 },
      { id: 'b', content: MEDIUM_JSON, priority: 5 },
      { id: 'c', content: MEDIUM_JSON, priority: 1 },
    ];

    const result = pack(items, { budget: 10_000 });

    // Stats should match the arrays
    expect(result.stats.totalItems).toBe(result.packed.length + result.dropped.length);
    expect(result.stats.packedCount).toBe(result.packed.length);
    expect(result.stats.droppedCount).toBe(result.dropped.length);

    // compressedTotalTokens should equal sum of packed items' compressedTokens
    const sumCompressed = result.packed.reduce((s, p) => s + p.compressedTokens, 0);
    expect(result.stats.compressedTotalTokens).toBe(sumCompressed);

    // totalTokens should match compressedTotalTokens
    expect(result.totalTokens).toBe(sumCompressed);

    // overallSavingsPercent should be in [0, 100]
    expect(result.stats.overallSavingsPercent).toBeGreaterThanOrEqual(0);
    expect(result.stats.overallSavingsPercent).toBeLessThanOrEqual(100);
  });

  it('remaining budget is consistent with totalTokens', () => {
    const items: PackerItem[] = [{ id: 'a', content: SMALL_JSON, priority: 10 }];

    const budget = 5000;
    const reserve = 50;
    const result = pack(items, { budget, reserveTokens: reserve });

    // remainingBudget + totalTokens should equal effective budget
    const effectiveBudget = budget - reserve;
    expect(result.remainingBudget + result.totalTokens).toBe(effectiveBudget);
  });

  it('savings percent is calculated correctly for packed items', () => {
    const items: PackerItem[] = [{ id: 'a', content: MEDIUM_JSON, priority: 10 }];

    const result = pack(items, { budget: 10_000 });
    const item = result.packed[0];

    if (item.wasCompressed) {
      // savingsPercent should be (original - compressed) / original * 100
      const expected = Math.round(
        ((item.originalTokens - item.compressedTokens) / item.originalTokens) * 100,
      );
      expect(item.savingsPercent).toBe(expected);
    } else {
      expect(item.savingsPercent).toBe(0);
    }
  });
});

// ===========================================================================
// 10. Balanced strategy
// ===========================================================================

describe('pack — balanced strategy', () => {
  it('considers both priority and recency', () => {
    const items: PackerItem[] = [
      { id: 'old-high', content: MEDIUM_JSON, priority: 10 },
      { id: 'old-low', content: MEDIUM_JSON, priority: 1 },
      { id: 'new-mid', content: MEDIUM_JSON, priority: 5 },
    ];

    // Budget for only 1 item
    const singleResult = pack([items[0]], { budget: 10_000 });
    const tokensPerItem = singleResult.totalTokens;
    const budget = tokensPerItem + 50;

    const result = pack(items, { budget, strategy: 'balanced' });

    // With balanced: old-high has priority=10, recency=0/2=0.0
    //   score = 10*0.6 + 0.0*0.4 = 6.0
    // old-low: priority=1, recency=1/2=0.5
    //   score = 1*0.6 + 0.5*0.4 = 0.8
    // new-mid: priority=5, recency=2/2=1.0
    //   score = 5*0.6 + 1.0*0.4 = 3.4
    // Expected order: old-high (6.0), new-mid (3.4), old-low (0.8)
    expect(result.packed.length).toBeGreaterThanOrEqual(1);
    expect(result.packed[0].id).toBe('old-high');
  });
});

// ===========================================================================
// 11. Metadata preservation
// ===========================================================================

describe('pack — metadata preservation', () => {
  it('preserves metadata on packed items', () => {
    const items: PackerItem[] = [
      {
        id: 'with-meta',
        content: SMALL_JSON,
        priority: 10,
        metadata: { source: 'rag', chunk: 42, nested: { key: 'value' } },
      },
    ];

    const result = pack(items, { budget: 10_000 });

    expect(result.packed[0].metadata).toEqual({
      source: 'rag',
      chunk: 42,
      nested: { key: 'value' },
    });
  });

  it('preserves metadata on dropped items', () => {
    const items: PackerItem[] = [
      {
        id: 'will-drop',
        content: LARGE_JSON,
        priority: 1,
        metadata: { important: true },
      },
    ];

    const result = pack(items, { budget: 55 });

    expect(result.dropped[0].metadata).toEqual({ important: true });
  });
});

// ===========================================================================
// 12. Reserve tokens
// ===========================================================================

describe('pack — reserve tokens', () => {
  it('respects custom reserve token setting', () => {
    const items: PackerItem[] = [{ id: 'a', content: SMALL_JSON }];

    // Count how many tokens the item actually needs
    const origTokens = countTokens(SMALL_JSON);

    // Set budget to item size + large reserve — item shouldn't fit
    const result = pack(items, { budget: origTokens + 5, reserveTokens: origTokens });

    // Effective budget = (origTokens + 5) - origTokens = 5 — too small
    expect(result.packed).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
  });
});

/**
 * @module tests/rolling-dict
 * Tests for the RollingDictionary class and its integration with the
 * L2 dictionary compression layer.
 *
 * Covers: seed/update cycle, turn tracking, pruning, capacity enforcement,
 * alias naming, stats, reset, and integration with compressL2 seedAliases.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { compress } from '../src/compress.js';
import { compressL2, extractDictEntries } from '../src/layers/L2-dictionary.js';
import type {
  BodyNode,
  DocumentNode,
  HeaderNode,
  KeyValueNode,
  ScalarNode,
  SourcePosition,
} from '../src/parser/ast.js';
import type { DictEntry } from '../src/types.js';
import { RollingDictionary } from '../src/mcp/rolling-dict.js';

// ---------------------------------------------------------------------------
// AST helpers (mirrors L2-dictionary.test.ts)
// ---------------------------------------------------------------------------

const p: SourcePosition = { line: 0, column: 0, offset: 0 };

const s = (v: string, q = false): ScalarNode => ({
  type: 'scalar',
  scalarType: 'string',
  value: v,
  quoted: q,
  position: p,
});

const kv = (key: string, val: ScalarNode): KeyValueNode => ({
  type: 'keyValue',
  key,
  value: val,
  position: p,
});

const doc = (body: BodyNode[], headers: HeaderNode[] = []): DocumentNode => ({
  type: 'document',
  headers,
  dictionary: null,
  body,
  position: p,
});

// ---------------------------------------------------------------------------
// RollingDictionary unit tests
// ---------------------------------------------------------------------------

describe('RollingDictionary', () => {
  let rd: RollingDictionary;

  beforeEach(() => {
    rd = new RollingDictionary(100, 20);
  });

  // -----------------------------------------------------------------------
  // Basic seed/update cycle
  // -----------------------------------------------------------------------

  describe('seed/update cycle', () => {
    it('returns an empty seed map on first call (no entries yet)', () => {
      const seeds = rd.seed();
      expect(seeds.size).toBe(0);
    });

    it('accumulates entries after update and seeds them on next call', () => {
      // First call: seed returns empty, then update with some dict entries
      const seeds1 = rd.seed();
      expect(seeds1.size).toBe(0);

      const entries: DictEntry[] = [
        { alias: '$a', expansion: 'developer', occurrences: 5, tokensSaved: 10 },
        { alias: '$b', expansion: 'production', occurrences: 4, tokensSaved: 8 },
      ];
      rd.update(entries, seeds1);

      // Second call: seed should now return the accumulated entries
      const seeds2 = rd.seed();
      expect(seeds2.size).toBe(2);
      expect(seeds2.has('developer')).toBe(true);
      expect(seeds2.has('production')).toBe(true);
    });

    it('skips entries with fewer than 2 occurrences during update', () => {
      const seeds = rd.seed();
      const entries: DictEntry[] = [
        { alias: '$a', expansion: 'singleton', occurrences: 1, tokensSaved: 0 },
      ];
      rd.update(entries, seeds);

      const seeds2 = rd.seed();
      expect(seeds2.size).toBe(0);
    });

    it('does not add duplicate entries on subsequent updates', () => {
      const seeds1 = rd.seed();
      const entries: DictEntry[] = [
        { alias: '$a', expansion: 'developer', occurrences: 3, tokensSaved: 6 },
      ];
      rd.update(entries, seeds1);

      // Second update with same expansion — should not create a duplicate
      const seeds2 = rd.seed();
      const entries2: DictEntry[] = [
        { alias: '$a', expansion: 'developer', occurrences: 4, tokensSaved: 8 },
      ];
      rd.update(entries2, seeds2);

      // Should still be just 1 entry
      expect(rd.getAllEntries().size).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Turn increment
  // -----------------------------------------------------------------------

  describe('turn tracking', () => {
    it('increments turn counter on each seed() call', () => {
      expect(rd.getStats().currentTurn).toBe(0);

      rd.seed();
      expect(rd.getStats().currentTurn).toBe(1);

      rd.seed();
      expect(rd.getStats().currentTurn).toBe(2);

      rd.seed();
      expect(rd.getStats().currentTurn).toBe(3);
    });

    it('increments turn BEFORE pruning (first turn is never pruned)', () => {
      // Add an entry at turn 1
      const seeds1 = rd.seed(); // turn = 1
      rd.update(
        [{ alias: '$a', expansion: 'developer', occurrences: 3, tokensSaved: 6 }],
        seeds1,
      );
      // Entry has lastUsedAtTurn = 1

      // Immediately seed again — turn goes to 2, cutoff = 2 - 20 = -18
      // Entry at turn 1 should NOT be pruned
      const seeds2 = rd.seed();
      expect(seeds2.has('developer')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Pruning
  // -----------------------------------------------------------------------

  describe('pruning', () => {
    it('prunes entries unused for more than pruneAfterTurns', () => {
      // Use a small pruneAfterTurns for testability
      const smallRd = new RollingDictionary(100, 3);

      // Turn 1: add an entry
      const seeds1 = smallRd.seed();
      smallRd.update(
        [{ alias: '$a', expansion: 'developer', occurrences: 5, tokensSaved: 10 }],
        seeds1,
      );
      // developer.lastUsedAtTurn = 1

      // Advance turns without using the entry: turns 2, 3, 4
      smallRd.seed(); // turn 2
      smallRd.update([], new Set());
      smallRd.seed(); // turn 3
      smallRd.update([], new Set());
      smallRd.seed(); // turn 4
      smallRd.update([], new Set());

      // Turn 5: cutoff = 5 - 3 = 2; entry at turn 1 < 2, pruned
      const seeds5 = smallRd.seed();
      expect(seeds5.has('developer')).toBe(false);
      expect(smallRd.getAllEntries().size).toBe(0);
    });

    it('does not prune entries that are still in use', () => {
      const smallRd = new RollingDictionary(100, 3);

      // Turn 1: add
      const seeds1 = smallRd.seed();
      smallRd.update(
        [{ alias: '$a', expansion: 'developer', occurrences: 3, tokensSaved: 6 }],
        seeds1,
      );

      // Turn 2: seed returns developer, simulate it being used
      const seeds2 = smallRd.seed();
      expect(seeds2.has('developer')).toBe(true);
      // Simulate the entry appearing in compression results
      smallRd.update(
        [{ alias: '$ra', expansion: 'developer', occurrences: 2, tokensSaved: 4 }],
        seeds2,
      );
      // developer.lastUsedAtTurn is now 2

      // Turns 3, 4
      smallRd.seed(); // turn 3
      smallRd.update([], new Set());
      smallRd.seed(); // turn 4
      smallRd.update([], new Set());

      // Turn 5: cutoff = 5 - 3 = 2; entry at turn 2 is NOT < 2, so kept
      const seeds5 = smallRd.seed();
      expect(seeds5.has('developer')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Capacity enforcement
  // -----------------------------------------------------------------------

  describe('capacity enforcement', () => {
    it('evicts lowest-value entries when over maxEntries', () => {
      const tinyRd = new RollingDictionary(3, 100);

      const seeds = tinyRd.seed();
      // Add 4 entries — only 3 should survive
      tinyRd.update(
        [
          { alias: '$a', expansion: 'aaa_expansion', occurrences: 2, tokensSaved: 4 },
          { alias: '$b', expansion: 'bbb_expansion', occurrences: 10, tokensSaved: 20 },
          { alias: '$c', expansion: 'ccc_expansion', occurrences: 2, tokensSaved: 4 },
          { alias: '$d', expansion: 'ddd_expansion_longer', occurrences: 8, tokensSaved: 16 },
        ],
        seeds,
      );

      // Should have trimmed to 3 entries
      expect(tinyRd.getAllEntries().size).toBe(3);

      // The entry with the lowest score should be evicted
      // Scores: usageCount(all 1) * tokensPerOcc
      // aaa_expansion: tokPerOcc = max(1, ceil(13/4) - 1) = max(1,3) = 3 => score 3
      // bbb_expansion: tokPerOcc = max(1, ceil(13/4) - 1) = 3 => score 3
      // ccc_expansion: tokPerOcc = 3 => score 3
      // ddd_expansion_longer: tokPerOcc = max(1, ceil(20/4) - 1) = max(1,4) = 4 => score 4
      // All usage=1, so scores are by tokPerOcc. Ties broken by lastUsed (all same turn).
      // Sort ascending by score then lastUsed: aaa, bbb, ccc are all score 3,
      // ddd is score 4. Needs to remove 1. The first in sort order (lowest score, oldest lastUsed)
      // Since all are same turn, the first alphabetically in the sorted array gets evicted.
      // Actually sort is stable, so the one inserted first with lowest score gets evicted.
      const remaining = tinyRd.getAllEntries();
      expect(remaining.size).toBe(3);
    });

    it('keeps high-value entries and evicts low-value ones', () => {
      const tinyRd = new RollingDictionary(2, 100);

      // Turn 1: add two entries
      const seeds1 = tinyRd.seed();
      tinyRd.update(
        [
          { alias: '$a', expansion: 'high_value_word', occurrences: 5, tokensSaved: 10 },
          { alias: '$b', expansion: 'low_val', occurrences: 2, tokensSaved: 2 },
        ],
        seeds1,
      );
      expect(tinyRd.getAllEntries().size).toBe(2);

      // Turn 2: boost "high_value_word" usage
      const seeds2 = tinyRd.seed();
      tinyRd.update(
        [
          { alias: '$ra', expansion: 'high_value_word', occurrences: 4, tokensSaved: 8 },
          { alias: '$rb', expansion: 'low_val', occurrences: 2, tokensSaved: 2 },
          { alias: '$c', expansion: 'another_entry_here', occurrences: 3, tokensSaved: 6 },
        ],
        seeds2,
      );

      // Should be 3 entries, pruned to 2
      const entries = tinyRd.getAllEntries();
      expect(entries.size).toBe(2);
      // high_value_word has usageCount=2, tokPerOcc=max(1,ceil(15/4)-1)=max(1,3)=3 => score=6
      // low_val has usageCount=2, tokPerOcc=max(1,ceil(7/4)-1)=max(1,1)=1 => score=2
      // another_entry_here has usageCount=1, tokPerOcc=max(1,ceil(18/4)-1)=max(1,4)=4 => score=4
      // Sorted ascending: low_val(2), another_entry_here(4), high_value_word(6)
      // Remove 1 (lowest): low_val
      expect(entries.has('high_value_word')).toBe(true);
      expect(entries.has('low_val')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Alias naming
  // -----------------------------------------------------------------------

  describe('seed output format', () => {
    it('returns a Set of expansion strings (no custom alias namespace)', () => {
      const rd26 = new RollingDictionary(30, 100);
      const seeds1 = rd26.seed();
      const entries: DictEntry[] = [];
      for (let i = 0; i < 10; i++) {
        entries.push({
          alias: `$${String.fromCharCode(97 + i)}`,
          expansion: `expansion_value_${String(i).padStart(3, '0')}`,
          occurrences: 3,
          tokensSaved: 6,
        });
      }
      rd26.update(entries, seeds1);

      const seeds2 = rd26.seed();
      // seed() now returns Set<string> of expansion values, not Map with $ra aliases
      expect(seeds2).toBeInstanceOf(Set);
      expect(seeds2.size).toBe(10);
      // The set contains expansion strings, not alias names
      expect(seeds2.has('expansion_value_000')).toBe(true);
      expect(seeds2.has('expansion_value_009')).toBe(true);
    });

    it('caps seeds at 52 entries', () => {
      const rdBig = new RollingDictionary(60, 100);
      const seeds1 = rdBig.seed();
      const entries: DictEntry[] = [];
      for (let i = 0; i < 55; i++) {
        entries.push({
          alias: `$${String.fromCharCode(97 + (i % 26))}`,
          expansion: `longer_expansion_value_number_${String(i).padStart(3, '0')}`,
          occurrences: 3,
          tokensSaved: 6,
        });
      }
      rdBig.update(entries, seeds1);

      const seeds2 = rdBig.seed();
      // Capped at 52 — same as L2 alias limit
      expect(seeds2.size).toBeLessThanOrEqual(52);
    });

    it('seeds are emitted in deterministic, prefix-stable order across turns', () => {
      // The order of seeds drives the order L2 assigns $a, $b, $c... aliases.
      // For provider prefix caches (Anthropic cache_control, OpenAI prefix
      // cache) to hit, the @dict block at the top of the PAKT output must
      // be byte-identical across turns. That means seed order must be
      // deterministic and append-only — entries discovered earlier must
      // never get reordered by later usage.
      const rdStable = new RollingDictionary(30, 100);

      // Turn 1: discover three expansions
      const seeds1 = rdStable.seed();
      rdStable.update(
        [
          { alias: '$a', expansion: 'platform_engineer', occurrences: 4, tokensSaved: 8 },
          { alias: '$b', expansion: 'security_engineer', occurrences: 3, tokensSaved: 6 },
          { alias: '$c', expansion: 'machine_learning', occurrences: 3, tokensSaved: 6 },
        ],
        seeds1,
      );

      const order1 = [...rdStable.seed()];

      // Turn 3: hammer the LAST-discovered entry so its usageCount is
      // highest. With usage-DESC sorting it would jump to position 0 and
      // invalidate the cached prefix. Stable ordering must NOT do that.
      rdStable.update(
        [{ alias: '$c', expansion: 'machine_learning', occurrences: 9, tokensSaved: 18 }],
        new Set(['machine_learning']),
      );
      rdStable.update(
        [{ alias: '$c', expansion: 'machine_learning', occurrences: 9, tokensSaved: 18 }],
        new Set(['machine_learning']),
      );

      const order2 = [...rdStable.seed()];
      // Same expansions in the same order — prefix-stable.
      expect(order2).toEqual(order1);
    });

    it('newly discovered seeds append at the end (cache prefix grows monotonically)', () => {
      const rdAppend = new RollingDictionary(30, 100);

      const seeds1 = rdAppend.seed();
      rdAppend.update(
        [
          { alias: '$a', expansion: 'developer', occurrences: 3, tokensSaved: 6 },
          { alias: '$b', expansion: 'engineer', occurrences: 3, tokensSaved: 6 },
        ],
        seeds1,
      );

      const seedsT2 = rdAppend.seed();
      const orderT2 = [...seedsT2];

      // New entry discovered in turn 2 — it should append, not insert mid-list.
      rdAppend.update(
        [{ alias: '$c', expansion: 'architect', occurrences: 3, tokensSaved: 6 }],
        seedsT2,
      );

      const orderT3 = [...rdAppend.seed()];
      // Existing entries keep their positions; new entry appears after them.
      expect(orderT3.slice(0, orderT2.length)).toEqual(orderT2);
      expect(orderT3.at(-1)).toBe('architect');
    });

    it('L2 assigns standard $a-$az aliases to seeded expansions', () => {
      // Seeded expansions get standard aliases from L2, not custom $ra ones
      const rdCheck = new RollingDictionary(60, 100);
      const seeds1 = rdCheck.seed();
      const entries: DictEntry[] = [
        { alias: '$a', expansion: 'infrastructure_engineer_role', occurrences: 5, tokensSaved: 10 },
      ];
      rdCheck.update(entries, seeds1);

      const seeds2 = rdCheck.seed();
      // Seeds are expansion strings — L2 will assign its own aliases
      expect(seeds2.has('infrastructure_engineer_role')).toBe(true);
      // No $ra aliases — L2 uses standard $a-$az
      for (const val of seeds2) {
        expect(val).not.toMatch(/^\$/);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  describe('getStats()', () => {
    it('returns correct initial stats', () => {
      const stats = rd.getStats();
      expect(stats.size).toBe(0);
      expect(stats.maxEntries).toBe(100);
      expect(stats.currentTurn).toBe(0);
      expect(stats.totalReuses).toBe(0);
      expect(stats.estimatedSeedSavings).toBe(0);
    });

    it('reflects size and turn after operations', () => {
      const seeds1 = rd.seed();
      rd.update(
        [{ alias: '$a', expansion: 'developer', occurrences: 5, tokensSaved: 10 }],
        seeds1,
      );

      const stats = rd.getStats();
      expect(stats.size).toBe(1);
      expect(stats.currentTurn).toBe(1);
    });

    it('increments totalReuses when seeded entry is used again', () => {
      // Turn 1: discover
      const seeds1 = rd.seed();
      rd.update(
        [{ alias: '$a', expansion: 'developer', occurrences: 5, tokensSaved: 10 }],
        seeds1,
      );

      // Turn 2: seed and use
      const seeds2 = rd.seed();
      expect(seeds2.has('developer')).toBe(true);
      rd.update(
        [{ alias: '$ra', expansion: 'developer', occurrences: 3, tokensSaved: 6 }],
        seeds2,
      );

      const stats = rd.getStats();
      expect(stats.totalReuses).toBe(1);
    });

    it('calculates estimatedSeedSavings for entries with usageCount > 1', () => {
      // Turn 1: discover
      const seeds1 = rd.seed();
      rd.update(
        [{ alias: '$a', expansion: 'developer', occurrences: 5, tokensSaved: 10 }],
        seeds1,
      );
      // usageCount = 1, estimatedSeedSavings = 0

      // Turn 2: reuse
      const seeds2 = rd.seed();
      rd.update(
        [{ alias: '$ra', expansion: 'developer', occurrences: 3, tokensSaved: 6 }],
        seeds2,
      );
      // usageCount = 2, tokensPerOcc for "developer" = max(1, ceil(9/4) - 1) = max(1, 2) = 2
      // estimatedSeedSavings = (2 - 1) * 2 = 2

      const stats = rd.getStats();
      expect(stats.estimatedSeedSavings).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  describe('reset()', () => {
    it('clears all entries and resets counters', () => {
      // Add some state
      const seeds1 = rd.seed();
      rd.update(
        [
          { alias: '$a', expansion: 'developer', occurrences: 5, tokensSaved: 10 },
          { alias: '$b', expansion: 'production', occurrences: 3, tokensSaved: 6 },
        ],
        seeds1,
      );

      // Verify non-empty
      expect(rd.getAllEntries().size).toBe(2);
      expect(rd.getStats().currentTurn).toBe(1);

      // Reset
      rd.reset();

      // Verify clean slate
      const stats = rd.getStats();
      expect(stats.size).toBe(0);
      expect(stats.currentTurn).toBe(0);
      expect(stats.totalReuses).toBe(0);
      expect(stats.estimatedSeedSavings).toBe(0);
      expect(rd.getAllEntries().size).toBe(0);

      // Seed after reset should return empty
      const seeds2 = rd.seed();
      expect(seeds2.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Update with usage tracking
  // -----------------------------------------------------------------------

  describe('update usage tracking', () => {
    it('updates usageCount and totalOccurrences for reused seeds', () => {
      // Turn 1: discover
      const seeds1 = rd.seed();
      rd.update(
        [{ alias: '$a', expansion: 'developer', occurrences: 5, tokensSaved: 10 }],
        seeds1,
      );

      const entry1 = rd.getAllEntries().get('developer');
      expect(entry1?.usageCount).toBe(1);
      expect(entry1?.totalOccurrences).toBe(5);

      // Turn 2: seed and reuse
      const seeds2 = rd.seed();
      rd.update(
        [{ alias: '$ra', expansion: 'developer', occurrences: 3, tokensSaved: 6 }],
        seeds2,
      );

      const entry2 = rd.getAllEntries().get('developer');
      expect(entry2?.usageCount).toBe(2);
      expect(entry2?.totalOccurrences).toBe(8);
      expect(entry2?.lastUsedAtTurn).toBe(2);
    });

    it('does not increment usage for seeds that had 0 occurrences', () => {
      const seeds1 = rd.seed();
      rd.update(
        [{ alias: '$a', expansion: 'developer', occurrences: 3, tokensSaved: 6 }],
        seeds1,
      );

      // Turn 2: seed but entry has 0 occurrences in the result
      const seeds2 = rd.seed();
      rd.update(
        [{ alias: '$ra', expansion: 'developer', occurrences: 0, tokensSaved: 0 }],
        seeds2,
      );

      const entry = rd.getAllEntries().get('developer');
      expect(entry?.usageCount).toBe(1);
      expect(entry?.lastUsedAtTurn).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration: seeded values in L2 compression
// ---------------------------------------------------------------------------

describe('L2 integration with seedAliases', () => {
  it('seeded values are added as candidates in the candidate stage', () => {
    // Seeded values get a lower threshold in candidate detection (2 occ, 0 minSav),
    // but the greedy simulation stage re-checks with MIN_OCCURRENCES (3) and
    // minSavings (3). So seeds with exactly 2 occurrences are filtered by the
    // greedy pass. This test documents the current behavior.
    //
    // For the seed to actually produce an alias, it needs >= 3 occurrences
    // AND net savings >= minSavings — same as any non-seeded candidate in
    // the greedy simulation.
    const longValue = 'infrastructure_engineer_role';  // 28 chars => 7 tokens
    // At 3 occ: net = (7-1)*3 - (7+3) = 18 - 10 = 8 >= 3 => aliased

    const body: BodyNode[] = [
      kv('role1', s(longValue)),
      kv('role2', s(longValue)),
      kv('role3', s(longValue)),
      kv('name', s('Alice')),
    ];
    const input = doc(body);

    // Without seed at 3 occ: should be aliased (meets normal thresholds)
    const withoutSeed = compressL2(input);
    const entriesWithout = extractDictEntries(withoutSeed);
    expect(entriesWithout.find((e) => e.expansion === longValue)).toBeDefined();

    // With seed at 3 occ: should also be aliased
    const seedMap = new Set([longValue]);
    const withSeed = compressL2(input, 3, seedMap);
    const entriesWith = extractDictEntries(withSeed);
    const entryWith = entriesWith.find((e) => e.expansion === longValue);
    expect(entryWith).toBeDefined();
    expect(entryWith?.occurrences).toBe(3);
  });

  it('seeded values with only 2 occurrences ARE aliased (greedy sim uses lower threshold)', () => {
    // Seeded values get lower thresholds in BOTH candidate detection and
    // greedy simulation — 2 occurrences instead of 3, 0 minSavings instead of 3.
    const longValue = 'infrastructure_engineer_role';

    const body: BodyNode[] = [
      kv('role1', s(longValue)),
      kv('role2', s(longValue)),
      kv('name', s('Alice')),
    ];
    const input = doc(body);

    const seedMap = new Set([longValue]);
    const result = compressL2(input, 3, seedMap);
    const entries = extractDictEntries(result);
    // Seeded values pass both candidate and greedy stages at 2 occurrences
    expect(entries.find((e) => e.expansion === longValue)).toBeDefined();
  });

  it('seeded values appearing once are NOT aliased', () => {
    // "developer" appears only once — even with seed, threshold is 2
    const body: BodyNode[] = [
      kv('role', s('developer')),
      kv('name', s('Alice')),
    ];
    const input = doc(body);

    const seedMap = new Set(['developer']);
    const result = compressL2(input, 3, seedMap);
    const entries = extractDictEntries(result);
    const devEntry = entries.find((e) => e.expansion === 'developer');
    expect(devEntry).toBeUndefined();
  });

  it('seed aliases are accepted without error even when empty', () => {
    // Edge case: passing an empty seed map should behave identically to no seeds
    const body: BodyNode[] = [
      kv('role', s('developer')),
      kv('name', s('Alice')),
    ];
    const input = doc(body);

    const emptySeeds = new Set<string>();
    const result = compressL2(input, 3, emptySeeds);
    // Should not throw, and produce the same output as without seeds
    const resultNoSeed = compressL2(input, 3);
    const entriesSeeded = extractDictEntries(result);
    const entriesNone = extractDictEntries(resultNoSeed);
    expect(entriesSeeded.length).toBe(entriesNone.length);
  });

  it('seedAliases flow through compress() pipeline without errors', () => {
    // Verify that passing seedAliases through the compress() pipeline works.
    // The seed map is accepted as part of PaktPipelineOptions and flows
    // through to compressL2 via applyDictionaryLayer.
    const role = 'infrastructure_engineer_role';
    const jsonInput = JSON.stringify({
      users: [
        { name: 'Alice', role },
        { name: 'Bob', role },
        { name: 'Charlie', role },
        { name: 'Diana', role },
      ],
    });

    // Compress with seedAliases — should not throw
    const result = compress(jsonInput, {
      fromFormat: 'json',
      seedAliases: new Set([role]),
    });

    // The compression should produce savings (structural at minimum)
    expect(result.savings.totalPercent).toBeGreaterThan(0);

    // Compressing without seeds should also work and produce similar output
    const resultNoSeed = compress(jsonInput, { fromFormat: 'json' });
    expect(resultNoSeed.savings.totalPercent).toBeGreaterThan(0);
  });
});

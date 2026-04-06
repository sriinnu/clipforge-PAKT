import { beforeEach, describe, expect, it } from 'vitest';
import { DedupCache, entryBytes } from '../src/mcp/dedup-cache.js';

describe('DedupCache', () => {
  let cache: DedupCache;

  beforeEach(() => {
    cache = new DedupCache();
  });

  // -----------------------------------------------------------------------
  // Basic get / set
  // -----------------------------------------------------------------------

  it('returns undefined for a cache miss', () => {
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('stores and retrieves a compressed value', () => {
    cache.set('abc', 'compressed-abc');
    expect(cache.get('abc')).toBe('compressed-abc');
  });

  it('overwrites an existing entry on re-set', () => {
    cache.set('abc', 'v1');
    cache.set('abc', 'v2');
    expect(cache.get('abc')).toBe('v2');
    expect(cache.getStats().size).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Byte-budget eviction
  // -----------------------------------------------------------------------

  it('evicts LRU entries when byte budget is exceeded', () => {
    // Each entry: compressed.length + hash.length + 200 overhead
    // hash = "a" (1 byte), compressed = 200 chars => entryBytes ~= 401
    // With maxBytes = 500, first entry fits (401), second overflows (802)
    // so inserting the second should evict the first.
    const smallCache = new DedupCache(500, 1000);

    smallCache.set('a', 'x'.repeat(200));
    expect(smallCache.getStats().size).toBe(1);

    smallCache.set('b', 'y'.repeat(200));
    // byte budget exceeded → "a" (LRU) should be evicted
    expect(smallCache.get('a')).toBeUndefined();
    expect(smallCache.get('b')).toBe('y'.repeat(200));
    expect(smallCache.getStats().size).toBe(1);
  });

  it('evicts multiple LRU entries to make room', () => {
    // hash = 2 chars each, compressed = 100 chars => ~302 bytes each
    // maxBytes = 700 → fits 2 entries (604), third (906) triggers eviction
    const smallCache = new DedupCache(700, 1000);

    smallCache.set('aa', 'x'.repeat(100));
    smallCache.set('bb', 'y'.repeat(100));
    expect(smallCache.getStats().size).toBe(2);

    // Third entry should evict "aa" (LRU)
    smallCache.set('cc', 'z'.repeat(100));
    expect(smallCache.get('aa')).toBeUndefined();
    expect(smallCache.get('bb')).toBeDefined();
    expect(smallCache.get('cc')).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // LRU ordering — access promotes to MRU
  // -----------------------------------------------------------------------

  it('evicts the least recently used entry, not the oldest inserted', () => {
    // 3 entries at capacity, access A, insert D → B is evicted (not A)
    // hash = 1 char, compressed = 100 chars => ~301 bytes each
    // maxBytes = 950 → fits 3 entries (903), 4th (1204) triggers eviction
    const smallCache = new DedupCache(950, 1000);

    smallCache.set('A', 'a'.repeat(100));
    smallCache.set('B', 'b'.repeat(100));
    smallCache.set('C', 'c'.repeat(100));
    expect(smallCache.getStats().size).toBe(3);

    // Access A — promotes it to MRU. Order is now: B, C, A
    smallCache.get('A');

    // Insert D — must evict LRU which is B
    smallCache.set('D', 'd'.repeat(100));

    expect(smallCache.get('B')).toBeUndefined(); // evicted
    expect(smallCache.get('A')).toBe('a'.repeat(100)); // still alive
    expect(smallCache.get('C')).toBeDefined();
    expect(smallCache.get('D')).toBeDefined();
  });

  it('recordHit promotes entry to MRU position', () => {
    const smallCache = new DedupCache(950, 1000);

    smallCache.set('A', 'a'.repeat(100));
    smallCache.set('B', 'b'.repeat(100));
    smallCache.set('C', 'c'.repeat(100));

    // recordHit on A — promotes it. Order: B, C, A
    smallCache.recordHit('A');

    // Insert D — evicts B (LRU)
    smallCache.set('D', 'd'.repeat(100));

    expect(smallCache.get('B')).toBeUndefined();
    expect(smallCache.get('A')).toBe('a'.repeat(100));
  });

  // -----------------------------------------------------------------------
  // Entry-count cap alongside byte budget
  // -----------------------------------------------------------------------

  it('respects maxEntries cap even when byte budget has room', () => {
    // Generous byte budget but only 2 entries allowed
    const smallCache = new DedupCache(10 * 1024 * 1024, 2);

    smallCache.set('a', 'short');
    smallCache.set('b', 'short');
    expect(smallCache.getStats().size).toBe(2);

    // Third entry triggers entry-count eviction
    smallCache.set('c', 'short');
    expect(smallCache.getStats().size).toBe(2);
    expect(smallCache.get('a')).toBeUndefined(); // LRU evicted
    expect(smallCache.get('b')).toBeDefined();
    expect(smallCache.get('c')).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  it('tracks hits and misses correctly', () => {
    cache.set('a', 'compressed-a'); // miss
    cache.set('b', 'compressed-b'); // miss
    cache.get('a'); // hit
    cache.get('a'); // hit
    cache.get('nonexistent'); // no-op (not counted as miss)

    const stats = cache.getStats();
    expect(stats.totalHits).toBe(2);
    expect(stats.totalMisses).toBe(2);
    expect(stats.hitRate).toBe(0.5);
  });

  it('getStats includes currentBytes and maxBytes', () => {
    const smallCache = new DedupCache(2048, 100);
    smallCache.set('hash1', 'payload');

    const stats = smallCache.getStats();
    expect(stats.currentBytes).toBeGreaterThan(0);
    expect(stats.maxBytes).toBe(2048);
    expect(stats.maxEntries).toBe(100);
    expect(stats.size).toBe(1);
  });

  it('currentBytes tracks the actual byte footprint', () => {
    const smallCache = new DedupCache();
    expect(smallCache.getStats().currentBytes).toBe(0);

    smallCache.set('abc', 'x'.repeat(50));
    const bytesAfterOne = smallCache.getStats().currentBytes;
    expect(bytesAfterOne).toBe(50 + 3 + 200); // compressed + hash + overhead

    smallCache.set('def', 'y'.repeat(50));
    expect(smallCache.getStats().currentBytes).toBe(bytesAfterOne * 2);
  });

  // -----------------------------------------------------------------------
  // entryBytes helper
  // -----------------------------------------------------------------------

  it('entryBytes accounts for compressed + hash + overhead', () => {
    const bytes = entryBytes({
      hash: 'abcdef',
      compressed: 'x'.repeat(100),
      hits: 0,
      lastAccess: Date.now(),
    });
    // 100 (compressed) + 6 (hash) + 200 (overhead) = 306
    expect(bytes).toBe(306);
  });

  // -----------------------------------------------------------------------
  // Compounding savings
  // -----------------------------------------------------------------------

  it('compoundingSavings returns 0 for misses and unhit entries', () => {
    expect(cache.compoundingSavings('missing')).toBe(0);
    cache.set('a', 'payload');
    expect(cache.compoundingSavings('a')).toBe(0);
  });

  it('compoundingSavings returns compressed length after hits', () => {
    cache.set('a', 'payload');
    cache.get('a'); // hit → hits = 1
    expect(cache.compoundingSavings('a')).toBe('payload'.length);
  });

  it('totalCompoundingSavings sums across all entries', () => {
    cache.set('a', 'aa');
    cache.set('b', 'bbb');
    cache.get('a'); // hits=1
    cache.get('a'); // hits=2
    cache.get('b'); // hits=1

    // a: 2 * 2 = 4, b: 1 * 3 = 3 → total = 7
    expect(cache.totalCompoundingSavings()).toBe(7);
  });

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  it('reset clears all entries and counters', () => {
    cache.set('a', 'compressed-a');
    cache.get('a');
    cache.reset();

    const stats = cache.getStats();
    expect(stats.size).toBe(0);
    expect(stats.totalHits).toBe(0);
    expect(stats.totalMisses).toBe(0);
    expect(stats.currentBytes).toBe(0);
    expect(stats.hitRate).toBe(0);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.getAllEntries()).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // getAllEntries
  // -----------------------------------------------------------------------

  it('getAllEntries returns snapshot of all cached entries', () => {
    cache.set('x', 'cx');
    cache.set('y', 'cy');

    const entries = cache.getAllEntries();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.hash).sort()).toEqual(['x', 'y']);
  });

  // -----------------------------------------------------------------------
  // Default constructor values
  // -----------------------------------------------------------------------

  it('defaults to 10 MB byte budget and 500 entry cap', () => {
    const defaultCache = new DedupCache();
    const stats = defaultCache.getStats();
    expect(stats.maxBytes).toBe(10 * 1024 * 1024);
    expect(stats.maxEntries).toBe(500);
  });
});

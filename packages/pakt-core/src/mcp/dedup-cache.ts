/**
 * @module mcp/dedup-cache
 * Byte-budget LRU deduplication cache for PAKT MCP tool responses.
 *
 * Stores compressed output keyed by content hash to avoid recompressing
 * identical payloads. Eviction is governed by two limits — a byte budget
 * (sum of compressed string lengths + metadata overhead) and a hard entry
 * cap — whichever fires first triggers LRU eviction.
 *
 * Uses a plain Map for iteration-order-based LRU: the most recently
 * accessed entry is always at the end (delete + re-insert on access).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single cached compression result. */
export interface DedupEntry {
  /** Content hash of the original input. */
  hash: string;
  /** Compressed output string. */
  compressed: string;
  /** Number of cache hits for this entry. */
  hits: number;
  /** Timestamp of the last access (get, set, or recordHit). */
  lastAccess: number;
}

/** Aggregate statistics exposed by {@link DedupCache.getStats}. */
export interface DedupStats {
  /** Number of entries currently in the cache. */
  size: number;
  /** Maximum number of entries before eviction kicks in. */
  maxEntries: number;
  /** Total cache hits across all entries. */
  totalHits: number;
  /** Total cache misses (set calls). */
  totalMisses: number;
  /** Hit rate as a fraction (0–1). */
  hitRate: number;
  /** Current byte footprint of all cached entries. */
  currentBytes: number;
  /** Maximum byte budget before eviction kicks in. */
  maxBytes: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Overhead estimate per entry — hash string, metadata fields, Map slot. */
const ENTRY_OVERHEAD_BYTES = 200;

/**
 * Estimate the byte footprint of a single cache entry.
 *
 * Accounts for the compressed payload length, the hash key length,
 * and a fixed overhead for metadata fields and Map bookkeeping.
 *
 * @param entry - The cache entry to measure
 * @returns Approximate byte size
 */
export function entryBytes(entry: DedupEntry): number {
  return entry.compressed.length + entry.hash.length + ENTRY_OVERHEAD_BYTES;
}

// ---------------------------------------------------------------------------
// DedupCache
// ---------------------------------------------------------------------------

/**
 * Byte-budget LRU cache for deduplicated compression results.
 *
 * @example
 * ```ts
 * const cache = new DedupCache(1024 * 1024, 200); // 1 MB, 200 entries
 * cache.set('abc123', 'compressed-payload');
 * const hit = cache.get('abc123'); // 'compressed-payload'
 * ```
 */
export class DedupCache {
  /** Maximum byte budget for all entries combined. */
  private readonly maxBytes: number;

  /** Maximum number of entries (secondary cap). */
  private readonly maxEntries: number;

  /** Current byte footprint of all cached entries. */
  private currentBytes = 0;

  /** Total number of cache hits. */
  private totalHits = 0;

  /** Total number of cache misses (set calls). */
  private totalMisses = 0;

  /** Underlying Map — iteration order = insertion order = LRU order. */
  private cache = new Map<string, DedupEntry>();

  /**
   * Create a new DedupCache.
   *
   * @param maxBytes - Byte budget ceiling (default 10 MB)
   * @param maxEntries - Hard entry count ceiling (default 500)
   */
  constructor(maxBytes = 10 * 1024 * 1024, maxEntries = 500) {
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Retrieve a cached compressed string by hash.
   *
   * On a hit the entry is promoted to the most-recently-used position
   * (delete + re-insert) and its hit counter / access time are bumped.
   *
   * @param hash - Content hash to look up
   * @returns The compressed string, or undefined on a miss
   */
  get(hash: string): string | undefined {
    const entry = this.cache.get(hash);
    if (!entry) {
      return undefined;
    }

    // Promote to MRU position
    this.cache.delete(hash);
    entry.hits++;
    entry.lastAccess = Date.now();
    this.cache.set(hash, entry);

    this.totalHits++;
    return entry.compressed;
  }

  /**
   * Insert or overwrite a cache entry.
   *
   * After insertion, if the byte budget or entry cap is exceeded the
   * least-recently-used entries (front of the Map) are evicted until
   * both limits are satisfied.
   *
   * @param hash - Content hash key
   * @param compressed - Compressed output to cache
   */
  set(hash: string, compressed: string): void {
    // If already present, remove first so we can re-insert at MRU position
    const existing = this.cache.get(hash);
    if (existing) {
      this.currentBytes -= entryBytes(existing);
      this.cache.delete(hash);
    }

    const entry: DedupEntry = {
      hash,
      compressed,
      hits: 0,
      lastAccess: Date.now(),
    };

    this.cache.set(hash, entry);
    this.currentBytes += entryBytes(entry);
    this.totalMisses++;

    // Evict LRU entries until both limits are satisfied
    this.evict();
  }

  /**
   * Record an external hit on an existing entry (e.g. compounding savings).
   *
   * Bumps the hit count and promotes the entry to MRU position.
   *
   * @param hash - Content hash of the entry
   */
  recordHit(hash: string): void {
    const entry = this.cache.get(hash);
    if (!entry) return;

    // Promote to MRU position
    this.cache.delete(hash);
    entry.hits++;
    entry.lastAccess = Date.now();
    this.cache.set(hash, entry);
  }

  /**
   * Token savings from returning a cached compressed result instead
   * of re-compressing. Returns 0 for a cache miss.
   *
   * @param hash - Content hash to look up
   * @returns Estimated token savings (compressed string length as proxy)
   */
  compoundingSavings(hash: string): number {
    const entry = this.cache.get(hash);
    if (!entry || entry.hits === 0) return 0;
    return entry.compressed.length;
  }

  /**
   * Sum of compounding savings across all cache entries.
   *
   * @returns Total estimated savings
   */
  totalCompoundingSavings(): number {
    let total = 0;
    for (const entry of this.cache.values()) {
      if (entry.hits > 0) {
        total += entry.compressed.length * entry.hits;
      }
    }
    return total;
  }

  /**
   * Aggregate cache statistics.
   *
   * @returns Current stats snapshot
   */
  getStats(): DedupStats {
    const totalRequests = this.totalHits + this.totalMisses;
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
      totalHits: this.totalHits,
      totalMisses: this.totalMisses,
      hitRate: totalRequests > 0 ? this.totalHits / totalRequests : 0,
      currentBytes: this.currentBytes,
      maxBytes: this.maxBytes,
    };
  }

  /**
   * Return a snapshot of all cached entries (for inspection/debugging).
   *
   * @returns Array of entry copies
   */
  getAllEntries(): DedupEntry[] {
    return [...this.cache.values()];
  }

  /**
   * Clear all entries and reset counters.
   */
  reset(): void {
    this.cache.clear();
    this.currentBytes = 0;
    this.totalHits = 0;
    this.totalMisses = 0;
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /**
   * Evict LRU entries (from front of Map) until both the byte budget
   * and entry-count cap are satisfied.
   */
  private evict(): void {
    while (this.currentBytes > this.maxBytes || this.cache.size > this.maxEntries) {
      // Map.keys().next() gives the oldest (LRU) key
      const oldest = this.cache.keys().next();
      if (oldest.done) break;

      const key = oldest.value;
      const entry = this.cache.get(key);
      if (entry) {
        this.currentBytes -= entryBytes(entry);
      }
      this.cache.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton and convenience helpers
// ---------------------------------------------------------------------------

/** Shared singleton for the current server process. */
export const dedupCache = new DedupCache();

/** Reset the dedup cache (for testing). */
export function resetDedupCache(): void {
  dedupCache.reset();
}

/**
 * @module mcp/rolling-dict
 * Session-level rolling dictionary for incremental compression.
 *
 * Maintains a persistent set of known alias→expansion mappings across
 * multiple compression calls within a single MCP server session. When
 * a new input is compressed, the rolling dictionary "seeds" L2 with
 * previously discovered aliases — so recurring values like `"developer"`
 * get aliased immediately without re-discovery.
 *
 * This is the "compounding savings" multiplier for multi-turn agent
 * workflows: each turn benefits from patterns discovered in prior turns.
 */

import { estimateTokens } from '../layers/L2-scoring.js';
import type { DictEntry } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A rolling dictionary entry with usage tracking. */
export interface RollingEntry {
  /** The expansion value (e.g. "developer"). */
  expansion: string;
  /** How many compression calls have used this entry. */
  usageCount: number;
  /** Total occurrences across all calls where this entry was used. */
  totalOccurrences: number;
  /** Estimated tokens saved per occurrence. */
  tokensPerOcc: number;
  /** Turn number when this entry was first discovered. */
  discoveredAtTurn: number;
  /** Turn number when this entry was last used. */
  lastUsedAtTurn: number;
}

/** Stats snapshot for the rolling dictionary. */
export interface RollingDictStats {
  /** Number of known expansions. */
  size: number;
  /** Maximum capacity before pruning. */
  maxEntries: number;
  /** Current turn number. */
  currentTurn: number;
  /** Total times a seed alias was reused across turns. */
  totalReuses: number;
  /** Estimated total tokens saved by seeding (vs re-discovery overhead). */
  estimatedSeedSavings: number;
}

// ---------------------------------------------------------------------------
// RollingDictionary
// ---------------------------------------------------------------------------

/**
 * Session-level dictionary that accumulates L2 aliases across compression calls.
 *
 * Each call to {@link seed} returns a Map of expansion→alias that L2 can use
 * as pre-existing aliases. After compression, {@link update} merges newly
 * discovered entries back into the rolling set.
 *
 * Entries that haven't been used in `pruneAfterTurns` turns are pruned
 * to prevent unbounded growth.
 */
export class RollingDictionary {
  /** Maximum entries before pruning least-valuable ones. */
  private readonly maxEntries: number;

  /** Number of turns without use before an entry is pruned. */
  private readonly pruneAfterTurns: number;

  /** Expansion value → rolling entry. */
  private entries = new Map<string, RollingEntry>();

  /** Current turn counter (incremented on each seed() call). */
  private turn = 0;

  /** Cumulative count of seed reuses across all turns. */
  private totalReuses = 0;

  /**
   * @param maxEntries - Maximum entries to retain (default 100)
   * @param pruneAfterTurns - Prune entries unused for this many turns (default 20)
   */
  constructor(maxEntries = 100, pruneAfterTurns = 20) {
    this.maxEntries = maxEntries;
    this.pruneAfterTurns = pruneAfterTurns;
  }

  /**
   * Prepare seed expansions for the next compression call.
   *
   * Increments the turn counter, prunes stale entries, and returns
   * a Set of known expansion strings. L2 uses standard `$a`-`$az` aliases
   * for these — no separate namespace needed. The seeded expansions just
   * get a lower occurrence threshold (2 instead of 3) in L2's candidate
   * detection and greedy simulation.
   *
   * The default order is deterministic (by `discoveredAtTurn` ASC, then
   * lexicographic on the expansion) so that the `@dict` block at the top
   * of the output is **prefix-stable** turn-over-turn. Stable prefixes are
   * the precondition for hitting provider prompt caches (Anthropic
   * cache_control, OpenAI automatic prefix cache) — a single misordering
   * invalidates the entire cached prefix.
   *
   * @returns Ordered set of expansion strings known from prior turns
   */
  seed(): Set<string> {
    this.turn++;
    this.prune();

    /* Deterministic ordering keeps the alias map stable across turns.
       New entries naturally append (higher discoveredAtTurn) so previously
       cached prefixes stay valid. We tie-break on expansion string so the
       order is reproducible even if two entries were discovered in the
       same turn. */
    const sorted = [...this.entries.entries()].sort(
      (a, b) =>
        a[1].discoveredAtTurn - b[1].discoveredAtTurn || a[0].localeCompare(b[0]),
    );

    const seeds = new Set<string>();
    let count = 0;
    for (const [expansion] of sorted) {
      if (count >= 52) break; // Same cap as L2's $a..$az alias namespace
      seeds.add(expansion);
      count++;
    }

    return seeds;
  }

  /**
   * Update the rolling dictionary with results from a compression call.
   *
   * ### PII safety invariant
   * Callers **must** set `piiSafe: true` only when the payload was compressed
   * without PII content, or after PII has been redacted. Passing `false`
   * (the default) causes the update to be silently skipped so that sensitive
   * values discovered in PII payloads can never be seeded into the cross-call
   * rolling state.
   *
   * In `handler-compress.ts` the rolling dictionary is skipped entirely when
   * PII mode is active — `update` is therefore only called with `piiSafe: true`
   * in that path. Direct callers outside `handler-compress` must honour the same
   * invariant.
   *
   * @param dictEntries - DictEntry[] from the compression result
   * @param seededExpansions - The seed set returned by seed() for this call
   * @param opts - Safety options: `{ piiSafe }`. Defaults to `{ piiSafe: false }`.
   */
  update(
    dictEntries: DictEntry[],
    seededExpansions: Set<string>,
    opts: { piiSafe: boolean } = { piiSafe: false },
  ): void {
    // Refuse to seed PII-tainted content into the cross-call rolling state.
    if (!opts.piiSafe) return;

    // Track which seeds were actually used
    for (const expansion of seededExpansions) {
      const entry = this.entries.get(expansion);
      if (!entry) continue;

      // Check if this expansion appeared in the compression result
      const matching = dictEntries.find((d) => d.expansion === expansion);
      if (matching && matching.occurrences > 0) {
        entry.usageCount++;
        entry.totalOccurrences += matching.occurrences;
        entry.lastUsedAtTurn = this.turn;
        this.totalReuses++;
      }
    }

    // Add new entries discovered by L2 that aren't in the rolling dict yet
    for (const entry of dictEntries) {
      if (entry.occurrences < 2) continue;
      if (this.entries.has(entry.expansion)) continue;

      const tokPerOcc = Math.max(1, estimateTokens(entry.expansion) - 1);
      this.entries.set(entry.expansion, {
        expansion: entry.expansion,
        usageCount: 1,
        totalOccurrences: entry.occurrences,
        tokensPerOcc: tokPerOcc,
        discoveredAtTurn: this.turn,
        lastUsedAtTurn: this.turn,
      });
    }

    // Enforce capacity
    this.enforceCapacity();
  }

  /**
   * Get current rolling dictionary statistics.
   */
  getStats(): RollingDictStats {
    let estimatedSeedSavings = 0;
    for (const entry of this.entries.values()) {
      if (entry.usageCount > 1) {
        // Each reuse saves the discovery overhead (scanning + scoring)
        // plus the alias tokens are already "warm" in the dict block
        estimatedSeedSavings += (entry.usageCount - 1) * entry.tokensPerOcc;
      }
    }

    return {
      size: this.entries.size,
      maxEntries: this.maxEntries,
      currentTurn: this.turn,
      totalReuses: this.totalReuses,
      estimatedSeedSavings,
    };
  }

  /** Get all current entries (for inspection/debugging). */
  getAllEntries(): Map<string, RollingEntry> {
    return new Map(this.entries);
  }

  /** Clear all entries and reset state. */
  reset(): void {
    this.entries.clear();
    this.turn = 0;
    this.totalReuses = 0;
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /** Remove entries that haven't been used in pruneAfterTurns turns. */
  private prune(): void {
    const cutoff = this.turn - this.pruneAfterTurns;
    for (const [expansion, entry] of this.entries) {
      if (entry.lastUsedAtTurn < cutoff) {
        this.entries.delete(expansion);
      }
    }
  }

  /** Evict least-valuable entries when over capacity. */
  private enforceCapacity(): void {
    if (this.entries.size <= this.maxEntries) return;

    // Score entries: usage * tokens saved per occurrence
    const scored = [...this.entries.entries()]
      .map(([expansion, entry]) => ({
        expansion,
        score: entry.usageCount * entry.tokensPerOcc,
        lastUsed: entry.lastUsedAtTurn,
      }))
      .sort((a, b) => a.score - b.score || a.lastUsed - b.lastUsed);

    // Remove lowest-value entries until under capacity
    const toRemove = scored.slice(0, this.entries.size - this.maxEntries);
    for (const item of toRemove) {
      this.entries.delete(item.expansion);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/** Shared singleton for the current server process. */
export const rollingDict = new RollingDictionary();

/** Reset the rolling dictionary (for testing). */
export function resetRollingDict(): void {
  rollingDict.reset();
}

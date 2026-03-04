/**
 * @module packer/types
 * Type definitions for the context window packer.
 *
 * The packer takes N items (tool call results, RAG chunks, conversation
 * messages) and fits as many as possible into a token budget using PAKT
 * compression, respecting priority-based ordering.
 */

import type { PaktOptions } from '../types.js';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/**
 * A single item to be packed into a context window.
 * Items have content, optional priority, and optional metadata.
 *
 * @example
 * ```ts
 * const item: PackerItem = {
 *   id: 'tool-result-1',
 *   content: '{"users": [{"name": "Alice"}, {"name": "Bob"}]}',
 *   priority: 10,
 *   role: 'tool',
 *   metadata: { source: 'database-query' },
 * };
 * ```
 */
export interface PackerItem {
  /** Unique identifier for this item. */
  id: string;
  /** The raw text content to compress and pack. */
  content: string;
  /** Priority (higher = more important, kept first). @default 0 */
  priority?: number;
  /** Role hint for conversation-aware packing. */
  role?: 'system' | 'user' | 'assistant' | 'tool';
  /** Arbitrary metadata preserved in results. */
  metadata?: Record<string, unknown>;
}

/**
 * Options for the context window packer.
 *
 * @example
 * ```ts
 * const opts: PackerOptions = {
 *   budget: 4096,
 *   model: 'gpt-4o',
 *   strategy: 'priority',
 *   adaptiveCompression: true,
 *   reserveTokens: 50,
 * };
 * ```
 */
export interface PackerOptions {
  /** Maximum token budget for all packed items combined. */
  budget: number;
  /** Target model for token counting. @default 'gpt-4o' */
  model?: string;
  /** Compression options passed to compress(). */
  compressOptions?: Partial<PaktOptions>;
  /**
   * Strategy for handling overflow.
   * - 'priority': Pack highest-priority items first (default)
   * - 'recency': Pack most recent items first (by array order, last = newest)
   * - 'balanced': Mix of priority and recency
   */
  strategy?: 'priority' | 'recency' | 'balanced';
  /**
   * When true, compress items more aggressively as budget runs low.
   * Lower-priority items get dictionary-only compression; lowest get L3 too.
   * @default true
   */
  adaptiveCompression?: boolean;
  /**
   * Reserve tokens for system overhead (separators, framing).
   * @default 50
   */
  reserveTokens?: number;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/**
 * Result of packing items into a context window.
 *
 * @example
 * ```ts
 * const result: PackerResult = pack(items, { budget: 4096 });
 * console.log(`Packed ${result.stats.packedCount} of ${result.stats.totalItems}`);
 * console.log(`Remaining budget: ${result.remainingBudget} tokens`);
 * ```
 */
export interface PackerResult {
  /** Items that fit within the budget, in recommended order. */
  packed: PackedItem[];
  /** Items that didn't fit. */
  dropped: DroppedItem[];
  /** Total tokens used by packed items. */
  totalTokens: number;
  /** Remaining budget after packing. */
  remainingBudget: number;
  /** Summary statistics. */
  stats: PackerStats;
}

/**
 * A successfully packed item with compression metadata.
 *
 * @example
 * ```ts
 * const packed: PackedItem = {
 *   id: 'tool-result-1',
 *   compressed: '@from json\nusers[2]{name}:\nAlice\nBob',
 *   originalTokens: 30,
 *   compressedTokens: 15,
 *   savingsPercent: 50,
 *   wasCompressed: true,
 * };
 * ```
 */
export interface PackedItem {
  /** Item identifier (matches the input PackerItem.id). */
  id: string;
  /** The compressed content (PAKT or original if compression wasn't beneficial). */
  compressed: string;
  /** Original token count. */
  originalTokens: number;
  /** Compressed token count. */
  compressedTokens: number;
  /** Savings percentage (0-100). */
  savingsPercent: number;
  /** Whether PAKT compression was applied (false = kept original). */
  wasCompressed: boolean;
  /** Preserved metadata from input. */
  metadata?: Record<string, unknown>;
}

/**
 * An item that was dropped due to budget constraints.
 *
 * @example
 * ```ts
 * const dropped: DroppedItem = {
 *   id: 'low-priority-chunk',
 *   reason: 'over_budget',
 *   tokensNeeded: 250,
 * };
 * ```
 */
export interface DroppedItem {
  /** Item identifier (matches the input PackerItem.id). */
  id: string;
  /** Why it was dropped. */
  reason: 'over_budget' | 'low_priority';
  /** How many tokens it would have needed (compressed size). */
  tokensNeeded: number;
  /** Preserved metadata from input. */
  metadata?: Record<string, unknown>;
}

/**
 * Packing statistics summarizing the pack() operation.
 *
 * @example
 * ```ts
 * const stats: PackerStats = {
 *   totalItems: 10,
 *   packedCount: 7,
 *   droppedCount: 3,
 *   originalTotalTokens: 5000,
 *   compressedTotalTokens: 3200,
 *   overallSavingsPercent: 36,
 * };
 * ```
 */
export interface PackerStats {
  /** Total number of items provided. */
  totalItems: number;
  /** Number of items that fit. */
  packedCount: number;
  /** Number of items that were dropped. */
  droppedCount: number;
  /** Sum of original token counts across all items (packed + dropped). */
  originalTotalTokens: number;
  /** Sum of compressed token counts for packed items only. */
  compressedTotalTokens: number;
  /** Overall savings percentage across all packed items. */
  overallSavingsPercent: number;
}

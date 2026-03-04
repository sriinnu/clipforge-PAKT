/**
 * @module packer/packer
 * Core context window packing logic.
 *
 * Given N items and a token budget, the packer compresses each item
 * with PAKT and greedily fills the budget in priority/recency order.
 *
 * Algorithm overview:
 * 1. Sort items by the chosen strategy (priority, recency, or balanced).
 * 2. For each item in sorted order:
 *    a. Compress using PAKT (with adaptive options if enabled).
 *    b. Pick the smaller of original vs compressed.
 *    c. If it fits in the remaining budget, add to packed list.
 *    d. Otherwise, add to dropped list.
 * 3. Return packed items, dropped items, and aggregate stats.
 */

import { compress } from '../compress.js';
import { countTokens } from '../tokens/counter.js';
import type {
  DroppedItem,
  PackedItem,
  PackerItem,
  PackerOptions,
  PackerResult,
  PackerStats,
} from './types.js';

// ---------------------------------------------------------------------------
// Default option values
// ---------------------------------------------------------------------------

/** Default strategy when none is specified. */
const DEFAULT_STRATEGY = 'priority';

/** Default model for token counting. */
const DEFAULT_MODEL = 'gpt-4o';

/** Default token reserve for framing overhead. */
const DEFAULT_RESERVE = 50;

/** Items in the bottom 30% of the sorted list get aggressive compression. */
const ADAPTIVE_THRESHOLD = 0.7;

// ---------------------------------------------------------------------------
// Sorting helpers
// ---------------------------------------------------------------------------

/**
 * Internal representation of a packer item with its original array index.
 * Preserving the original index is necessary for recency-based scoring.
 */
interface IndexedItem {
  /** The original packer item. */
  item: PackerItem;
  /** Position in the input array (0-based). Used for recency scoring. */
  originalIndex: number;
}

/**
 * Sort items by the selected strategy.
 *
 * - 'priority': Descending priority (higher first), stable on original order.
 * - 'recency': Reverse array order (last item = most recent = first).
 * - 'balanced': Weighted score = priority * 0.6 + recencyIndex * 0.4.
 *
 * @param items - Input items to sort
 * @param strategy - Packing strategy
 * @returns Sorted array of indexed items
 */
function sortByStrategy(
  items: IndexedItem[],
  strategy: 'priority' | 'recency' | 'balanced',
): IndexedItem[] {
  const sorted = Array.from(items);
  const maxIndex = items.length - 1;

  switch (strategy) {
    case 'priority':
      // Higher priority first; ties broken by original order (stable sort)
      sorted.sort((a, b) => (b.item.priority ?? 0) - (a.item.priority ?? 0));
      break;

    case 'recency':
      // Most recent (highest originalIndex) first
      sorted.sort((a, b) => b.originalIndex - a.originalIndex);
      break;

    case 'balanced': {
      // Weighted combination: 60% priority, 40% recency
      // Normalize recency to 0..1 range based on position in original array
      const score = (idx: IndexedItem): number => {
        const priorityScore = idx.item.priority ?? 0;
        const recencyScore = maxIndex > 0 ? idx.originalIndex / maxIndex : 1;
        return priorityScore * 0.6 + recencyScore * 0.4;
      };
      sorted.sort((a, b) => score(b) - score(a));
      break;
    }
  }

  return sorted;
}

// ---------------------------------------------------------------------------
// Compression helper
// ---------------------------------------------------------------------------

/**
 * Compress a single item, choosing the best representation (original or PAKT).
 * Returns the compressed text and metadata about the compression.
 *
 * When adaptive compression is enabled and the item falls in the bottom 30%
 * of the sorted list, L3 (tokenizer) compression is also applied for more
 * aggressive savings.
 *
 * @param item - The item to compress
 * @param model - Target model for token counting
 * @param options - User-provided packer options
 * @param positionRatio - Position in sorted list (0 = first, 1 = last)
 * @returns Object with best text, token counts, and whether PAKT was applied
 */
function compressItem(
  item: PackerItem,
  model: string,
  options: PackerOptions,
  positionRatio: number,
): { text: string; originalTokens: number; compressedTokens: number; wasCompressed: boolean } {
  const originalTokens = countTokens(item.content, model);

  // Try PAKT compression, fall back to original on error
  try {
    // Build compress options, merging user overrides
    const compressOpts = { ...options.compressOptions };

    // Adaptive compression: bottom 30% gets L3 enabled for more savings
    const adaptive = options.adaptiveCompression ?? true;
    if (adaptive && positionRatio >= ADAPTIVE_THRESHOLD) {
      compressOpts.layers = {
        ...compressOpts.layers,
        structural: true,
        dictionary: true,
        tokenizerAware: true,
      };
      // Lower the dict savings threshold for more aggressive deduplication
      compressOpts.dictMinSavings = Math.min(compressOpts.dictMinSavings ?? 3, 2);
    }

    compressOpts.targetModel = model;
    const result = compress(item.content, compressOpts);

    // Verify token count independently (don't trust compress() blindly)
    const verifiedCompressedTokens = countTokens(result.compressed, model);

    // Pick whichever is smaller
    if (verifiedCompressedTokens < originalTokens) {
      return {
        text: result.compressed,
        originalTokens,
        compressedTokens: verifiedCompressedTokens,
        wasCompressed: true,
      };
    }

    // Compression didn't help — keep original
    return {
      text: item.content,
      originalTokens,
      compressedTokens: originalTokens,
      wasCompressed: false,
    };
  } catch {
    // Compression failed — gracefully fall back to original text
    return {
      text: item.content,
      originalTokens,
      compressedTokens: originalTokens,
      wasCompressed: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Stats builder
// ---------------------------------------------------------------------------

/**
 * Build aggregate packing statistics from the packed and dropped lists.
 *
 * @param packed - Successfully packed items
 * @param dropped - Items that were dropped
 * @returns Aggregate statistics
 */
function buildStats(packed: PackedItem[], dropped: DroppedItem[]): PackerStats {
  const totalItems = packed.length + dropped.length;
  const originalTotalTokens =
    packed.reduce((sum, p) => sum + p.originalTokens, 0) +
    dropped.reduce((sum, d) => sum + d.tokensNeeded, 0);
  const compressedTotalTokens = packed.reduce((sum, p) => sum + p.compressedTokens, 0);

  // Calculate overall savings across packed items only
  const packedOriginal = packed.reduce((sum, p) => sum + p.originalTokens, 0);
  const overallSavingsPercent =
    packedOriginal > 0
      ? Math.round(((packedOriginal - compressedTotalTokens) / packedOriginal) * 100)
      : 0;

  return {
    totalItems,
    packedCount: packed.length,
    droppedCount: dropped.length,
    originalTotalTokens,
    compressedTotalTokens,
    overallSavingsPercent,
  };
}

// ---------------------------------------------------------------------------
// Main pack function
// ---------------------------------------------------------------------------

/**
 * Pack multiple items into a token budget using PAKT compression.
 *
 * This is the killer feature for AI integration. Given N items
 * (tool call results, RAG chunks, conversation messages) and a
 * token budget, it packs as many as possible into the budget
 * using PAKT compression with priority-based ordering.
 *
 * @param items - Array of items to pack
 * @param options - Packing options (budget, strategy, model, etc.)
 * @returns Packing result with packed/dropped items and statistics
 *
 * @example
 * ```ts
 * import { pack } from '@sriinnu/pakt';
 *
 * const items = [
 *   { id: 'sys', content: 'You are a helpful assistant.', priority: 100 },
 *   { id: 'rag-1', content: '{"docs": [...]}', priority: 50 },
 *   { id: 'rag-2', content: '{"docs": [...]}', priority: 30 },
 * ];
 *
 * const result = pack(items, { budget: 2048, strategy: 'priority' });
 * console.log(result.packed.map(p => p.id));
 * console.log(`Used ${result.totalTokens} of 2048 tokens`);
 * ```
 */
export function pack(items: PackerItem[], options: PackerOptions): PackerResult {
  const strategy = options.strategy ?? DEFAULT_STRATEGY;
  const model = options.model ?? DEFAULT_MODEL;
  const reserveTokens = options.reserveTokens ?? DEFAULT_RESERVE;

  // Effective budget after reserving overhead tokens
  const effectiveBudget = Math.max(0, options.budget - reserveTokens);

  // Handle empty input
  if (items.length === 0) {
    return {
      packed: [],
      dropped: [],
      totalTokens: 0,
      remainingBudget: effectiveBudget,
      stats: buildStats([], []),
    };
  }

  // 1. Index items to preserve original position for recency scoring
  const indexed: IndexedItem[] = items.map((item, i) => ({ item, originalIndex: i }));

  // 2. Sort by strategy
  const sorted = sortByStrategy(indexed, strategy);
  const totalSorted = sorted.length;

  // 3. Greedily pack items into the budget
  const packed: PackedItem[] = [];
  const dropped: DroppedItem[] = [];
  let usedTokens = 0;

  for (let i = 0; i < totalSorted; i++) {
    const { item } = sorted[i]!;
    // Position ratio: 0.0 for the first (highest priority), approaching 1.0 for the last
    const positionRatio = totalSorted > 1 ? i / (totalSorted - 1) : 0;

    // Compress the item (adaptive compression kicks in for bottom 30%)
    const compressed = compressItem(item, model, options, positionRatio);
    const remaining = effectiveBudget - usedTokens;

    if (compressed.compressedTokens <= remaining) {
      // Item fits — add to packed list
      const savingsPercent =
        compressed.originalTokens > 0
          ? Math.round(
              ((compressed.originalTokens - compressed.compressedTokens) /
                compressed.originalTokens) *
                100,
            )
          : 0;

      packed.push({
        id: item.id,
        compressed: compressed.text,
        originalTokens: compressed.originalTokens,
        compressedTokens: compressed.compressedTokens,
        savingsPercent,
        wasCompressed: compressed.wasCompressed,
        metadata: item.metadata,
      });

      usedTokens += compressed.compressedTokens;
    } else {
      // Item doesn't fit — drop it
      dropped.push({
        id: item.id,
        reason: 'over_budget',
        tokensNeeded: compressed.compressedTokens,
        metadata: item.metadata,
      });
    }
  }

  // 4. Build result
  return {
    packed,
    dropped,
    totalTokens: usedTokens,
    remainingBudget: effectiveBudget - usedTokens,
    stats: buildStats(packed, dropped),
  };
}

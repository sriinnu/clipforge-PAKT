/**
 * @module context-engine/history-strategies
 * History compression and deduplication strategies for the PAKT Context Engine.
 *
 * Both strategies are pure functions (given external state) so they can be
 * tested independently and imported without instantiating a full engine.
 * The engine delegates to these rather than implementing the loops inline.
 */

import { compress } from '../compress.js';
import { detect } from '../detect.js';
import { countTokens } from '../tokens/index.js';
import type { ContextMessage } from './types.js';

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Walk `messages` and replace repeated content with a short reference note.
 *
 * Uses a `first-200-chars + length` hash as the duplicate key — cheap and
 * collision-resistant enough for conversation-scale payloads. Opaque messages
 * (provider compaction blocks) are always skipped.
 *
 * @param messages     - Message array to dedup in place (cloned externally).
 * @param contentHashes - Persistent hash → first-turn map owned by the engine.
 * @param model        - Model identifier for token counting.
 * @returns Tokens saved by deduplication.
 */
export function deduplicateContent(
  messages: ContextMessage[],
  contentHashes: Map<string, number>,
  model: string,
): number {
  let saved = 0;

  for (const msg of messages) {
    if (msg.role === 'system') continue;
    if ((msg.currentTokens ?? 0) < 50) continue;
    // SAFETY: never dedup a message that carries provider opaque blocks.
    if (msg.containsOpaqueBlocks) continue;

    // Simple content hash: first 200 chars + total length.
    const hash = `${msg.content.slice(0, 200)}:${String(msg.content.length)}`;

    const firstSeen = contentHashes.get(hash);
    if (firstSeen !== undefined && firstSeen < (msg.turn ?? 0)) {
      const originalTokens = msg.currentTokens ?? 0;
      msg.content = `[Same as turn ${String(firstSeen)}: ${msg.content.slice(0, 60)}...]`;
      msg.currentTokens = countTokens(msg.content, model);
      saved += originalTokens - msg.currentTokens;
    } else {
      contentHashes.set(hash, msg.turn ?? 0);
    }
  }

  return Math.max(0, saved);
}

// ---------------------------------------------------------------------------
// Progressive history compression
// ---------------------------------------------------------------------------

/**
 * Compress structured content in turns older than `currentTurn - recentTurns`
 * using PAKT structural compression. Non-structured content and recent turns
 * are skipped. Opaque messages are never touched.
 *
 * @param messages    - Message array to operate on in place.
 * @param currentTurn - Latest turn counter from the engine.
 * @param recentTurns - Number of recent turns to preserve at full fidelity.
 * @param strategy    - Compression strategy; `'minimal'` disables history compression.
 * @returns Tokens saved by history compression.
 */
export function compressHistory(
  messages: ContextMessage[],
  currentTurn: number,
  recentTurns: number,
  strategy: string,
): number {
  if (strategy === 'minimal') return 0;

  const cutoff = currentTurn - recentTurns;
  if (cutoff <= 0) return 0;

  let saved = 0;

  for (const msg of messages) {
    if ((msg.turn ?? 0) > cutoff) continue;
    if (msg.role === 'system') continue;
    if (msg.paktCompressed) continue;
    if ((msg.currentTokens ?? 0) < 50) continue;
    // SAFETY: never compress a message that carries provider opaque blocks.
    if (msg.containsOpaqueBlocks) continue;

    const detected = detect(msg.content);
    if (
      detected.format === 'json' ||
      detected.format === 'yaml' ||
      detected.format === 'csv'
    ) {
      const result = compress(msg.content, { fromFormat: detected.format });
      if (result.compressedTokens < (msg.currentTokens ?? 0)) {
        const before = msg.currentTokens ?? 0;
        msg.content = result.compressed;
        msg.currentTokens = result.compressedTokens;
        msg.paktCompressed = true;
        saved += before - result.compressedTokens;
      }
    }
  }

  return saved;
}

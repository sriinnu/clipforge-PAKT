/**
 * @module context-engine/tool-aging
 * Tool-result aging utilities for the PAKT Context Engine.
 *
 * Implements the Gemini-CLI back-to-front aging pattern: when the running
 * token total exceeds a budget ceiling, older tool-result messages are
 * tail-truncated to keep the most-recent context lines while respecting
 * the provider-compaction safety boundary (opaque messages are skipped).
 */

import { countTokens } from '../tokens/index.js';
import type { ContextMessage } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Minimum token count of a single-line tool result before we attempt
 * character-tail truncation instead of line-based truncation.
 * Below this threshold the overhead of the elision marker is not worth it.
 */
const SINGLE_LINE_TOKEN_THRESHOLD = 1000;

/**
 * Maximum characters to keep when falling back to character-tail truncation
 * (used when the message has too few newlines for line-based aging).
 */
const TAIL_CHAR_BUDGET = 4000;

// ---------------------------------------------------------------------------
// Pre-ingestion clamp
// ---------------------------------------------------------------------------

/**
 * Clamp `content` to at most `maxBytes` characters before it enters the
 * engine. A single 100 MB stdout dump would OOM the engine on `split('\n')`
 * alone; this guard keeps the worst case bounded.
 *
 * We char-slice (not byte-slice) for simplicity — UTF-8 bytes are bounded by
 * 4× chars, so the cap is at most ~4× generous, which is fine for a
 * defensive guard.
 *
 * @param content  - Raw tool-result string.
 * @param maxBytes - Character limit (not byte limit).
 * @returns The original string when within budget, or a truncated+annotated
 *          version when it exceeds the cap.
 */
export function clampToolResult(content: string, maxBytes: number): string {
  if (content.length <= maxBytes) return content;
  const elidedChars = content.length - maxBytes;
  return `[... ${String(elidedChars)} earlier characters elided: tool result exceeded ${String(maxBytes)} bytes ...]\n${content.slice(-maxBytes)}`;
}

// ---------------------------------------------------------------------------
// Truncation helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to tail-truncate a single tool-result message in place.
 *
 * Returns the token saving (≥ 0). Returns 0 if the message could not be
 * meaningfully shortened.
 *
 * Safety: callers must already have checked `msg.containsOpaqueBlocks`
 * before invoking this function — opaque messages must never reach here.
 *
 * @param msg       - Tool-result message to age (mutated in place).
 * @param tailLines - Number of tail lines to keep (line-based path).
 * @param model     - Model identifier for token counting.
 */
export function ageSingleToolResult(
  msg: ContextMessage,
  tailLines: number,
  model: string,
): number {
  const before = msg.currentTokens ?? 0;
  const lines = msg.content.split('\n');

  let aged: string | null = null;

  if (lines.length > tailLines) {
    const elided = lines.length - tailLines;
    const tail = lines.slice(-tailLines).join('\n');
    aged = `[... ${String(elided)} earlier lines elided by tool-result aging ...]\n${tail}`;
  } else if (before > SINGLE_LINE_TOKEN_THRESHOLD && msg.content.length > TAIL_CHAR_BUDGET) {
    /* Too few newlines for line-based truncation, but the payload is
       large enough to warrant char-tail truncation. Keep the tail. */
    const elidedChars = msg.content.length - TAIL_CHAR_BUDGET;
    const tail = msg.content.slice(-TAIL_CHAR_BUDGET);
    aged = `[... ${String(elidedChars)} earlier characters elided by tool-result aging ...]\n${tail}`;
  }

  if (aged === null) return 0;

  const after = countTokens(aged, model);
  if (after >= before) return 0; // Aging didn't help (rare).

  msg.content = aged;
  msg.currentTokens = after;
  return before - after;
}

// ---------------------------------------------------------------------------
// Cutoff computation
// ---------------------------------------------------------------------------

/**
 * Walk the message array back-to-front and return the index where running
 * token total first exceeds `ceiling`, then snap it forward to the nearest
 * user-message boundary so a user → assistant → tool turn is never split.
 *
 * Returns -1 when no aging is needed (within budget or no boundary found).
 *
 * @param messages - Full message array to inspect.
 * @param ceiling  - Effective token ceiling.
 */
export function computeAgingCutoff(
  messages: ContextMessage[],
  ceiling: number,
): number {
  let running = 0;
  let cutoffIdx = -1;

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    running += m.currentTokens ?? 0;
    if (running > ceiling) {
      cutoffIdx = i;
      break;
    }
  }

  if (cutoffIdx < 0) return -1; // Within budget.

  // Snap forward to the nearest user-message boundary.
  let snapped = cutoffIdx;
  while (snapped < messages.length && messages[snapped]?.role !== 'user') {
    snapped++;
  }
  if (snapped >= messages.length) return -1; // No earlier turn boundary.

  return snapped;
}

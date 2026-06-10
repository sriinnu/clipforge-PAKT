/**
 * @module layers/L3-5-metatoken-encode
 * BPE encoding helpers for the L3.5 meta-token layer.
 *
 * Provides a model-aware `encodeForModel` function and a
 * `buildCharOffsets` utility that maps token indices to character
 * positions in the original text. Kept as a separate module to
 * satisfy the ≤400 LOC/file constraint.
 *
 * @see layers/L3-5-metatoken.ts (consumer)
 */

import { encode as encodeCl100k } from 'gpt-tokenizer/encoding/cl100k_base';
import { encode as encodeO200k } from 'gpt-tokenizer/encoding/o200k_base';
import { getTokenizerFamily } from '../tokens/tokenizer-family.js';

// ---------------------------------------------------------------------------
// Encoder dispatch
// ---------------------------------------------------------------------------

/** BPE encoder function type shared between cl100k_base and o200k_base. */
export type BpeEncoder = (text: string) => number[];

/**
 * Return the BPE encoder for the given model's tokenizer family.
 *
 * - Models in the `o200k_base` family (GPT-4o, o1, o3, o4) → `encodeO200k`
 * - All other models (GPT-4, Claude, Llama, unknown) → `encodeCl100k`
 *
 * @param model - Model identifier string (e.g. `'gpt-4o'`, `'claude-sonnet'`)
 * @returns The matching BPE encoder function
 */
export function getEncoderForModel(model: string): BpeEncoder {
  const family = getTokenizerFamily(model);
  return family === 'o200k_base' ? encodeO200k : encodeCl100k;
}

/**
 * Encode text to BPE token IDs using the tokenizer family for the model.
 *
 * @param text - Text to encode
 * @param model - Target model identifier
 * @returns Array of integer token IDs
 */
export function encodeForModel(text: string, model: string): number[] {
  return getEncoderForModel(model)(text);
}

// ---------------------------------------------------------------------------
// Char-offset map
// ---------------------------------------------------------------------------

/**
 * Build a char-offset array: `offsets[i]` = character position in `text`
 * where token `i` starts. `offsets[tokenIds.length]` = `text.length`.
 *
 * Strategy: greedily scan forward from position 0. For each token at index `t`,
 * advance 1–8 characters until encoding that substring produces `tokenIds[t]`
 * as its first token. This is O(n × L) where n = token count and L ≤ 8,
 * so it is fast for PAKT body sizes (typically < 10 KB).
 *
 * Returns `null` when the scan fails (e.g., the BPE encoding does not
 * cleanly decompose), which causes the caller to skip the candidate batch.
 *
 * @param tokenIds - Token IDs produced by encoding `text`
 * @param text - The exact text that was encoded
 * @param encoder - The BPE encoder used to encode `text`
 * @returns Char-offset array of length `tokenIds.length + 1`, or `null` on failure
 */
export function buildCharOffsets(
  tokenIds: number[],
  text: string,
  encoder: BpeEncoder,
): number[] | null {
  const offsets: number[] = [0];
  let pos = 0;

  for (let t = 0; t < tokenIds.length; t++) {
    const targetId = tokenIds[t];
    if (targetId === undefined) return null;

    let found = false;
    // Try advancing 1–8 chars; covers virtually all BPE token byte spans
    const maxStep = Math.min(8, text.length - pos);
    for (let len = 1; len <= maxStep; len++) {
      const ids = encoder(text.slice(pos, pos + len));
      if (ids[0] === targetId) {
        pos = pos + len;
        offsets.push(pos);
        found = true;
        break;
      }
    }
    if (!found) {
      // Fallback: single-char advance to prevent infinite loop
      pos = Math.min(pos + 1, text.length);
      offsets.push(pos);
    }
  }

  return offsets.length === tokenIds.length + 1 ? offsets : null;
}

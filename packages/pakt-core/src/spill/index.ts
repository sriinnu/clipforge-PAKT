/**
 * @module spill
 * Spill-at-append: cache-safe gisting for large tool results.
 *
 * A tool result over a token threshold is replaced, once and at the moment it
 * is appended, by a deterministic gist (its first lines plus a pointer) and the
 * full text goes to a {@link SpillStore}. The model fetches it back by id with
 * the `pakt_recall` MCP tool (or `engine.recall(id)`).
 *
 * Why at append time: a gist written once never changes, so the conversation
 * prefix stays byte-stable and every later request is a prompt-cache read.
 * Gisting old turns after the fact (rewrite mode) breaks the cache prefix and,
 * on models with preserved thinking, the thinking-block check.
 *
 * The gist is a pure function of the content and options, and the id is a
 * content hash, so the same result always spills to the same bytes.
 */

import { countTokens } from '../tokens/index.js';

/** Where spilled content lives until it is recalled. */
export interface SpillStore {
  put(id: string, content: string): void;
  get(id: string): string | undefined;
}

/** In-memory store; the default for a single process. */
export class MemorySpillStore implements SpillStore {
  private readonly items = new Map<string, string>();
  put(id: string, content: string): void {
    this.items.set(id, content);
  }
  get(id: string): string | undefined {
    return this.items.get(id);
  }
  get size(): number {
    return this.items.size;
  }
}

/** Options for {@link spill}. */
export interface SpillOptions {
  /** Spill only when the content is above this many tokens. @default 2000 */
  thresholdTokens?: number;
  /** Lines of the original kept inline in the gist. @default 20 */
  headLines?: number;
  /** Hard cap on inline characters, for very long lines. @default 4000 */
  maxHeadChars?: number;
  /** Tokenizer model. @default 'gpt-4o' */
  model?: string;
  /** Precomputed token count of `content`, to skip a recount. */
  tokens?: number;
}

/** Result of {@link spill}. */
export interface SpillResult {
  /** The text to put in context: the gist, or the original when not spilled. */
  content: string;
  spilled: boolean;
  /** Content id, present when spilled. */
  id?: string;
  originalTokens: number;
  /** Token count of `content`. */
  tokens: number;
}

/** Id format: `sp_` plus 16 hex chars. */
export const SPILL_ID_PATTERN = /^sp_[0-9a-f]{16}$/;

/**
 * Deterministic content id: two independent 32-bit FNV-1a lanes over the
 * UTF-16 code units. Not cryptographic; it only has to be stable and
 * collision-resistant enough for one store.
 */
export function spillId(content: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ content.length;
  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c ^ (i & 0xff), 0x01000197) >>> 0;
  }
  return `sp_${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

/** Build the inline gist for spilled content. Pure. */
export function spillGist(
  content: string,
  id: string,
  originalTokens: number,
  headLines = 20,
  maxHeadChars = 4000,
): string {
  const lines = content.split('\n');
  let head = lines.slice(0, headLines).join('\n');
  if (head.length > maxHeadChars) head = head.slice(0, maxHeadChars);
  const keptLines = head.split('\n').length;
  const more = lines.length - keptLines;
  return [
    head,
    `[pakt spilled ${id}: ${originalTokens} tokens, ${lines.length} lines` +
      `${more > 0 ? `, ${more} more not shown` : ''}. Full text: pakt_recall {"id":"${id}"}]`,
  ].join('\n');
}

/**
 * Spill `content` to `store` when it is over the threshold and the gist is
 * actually smaller. Otherwise returns it unchanged and stores nothing.
 */
export function spill(content: string, store: SpillStore, opts: SpillOptions = {}): SpillResult {
  const model = opts.model ?? 'gpt-4o';
  const originalTokens = opts.tokens ?? countTokens(content, model);
  const threshold = opts.thresholdTokens ?? 2000;
  if (originalTokens <= threshold) {
    return { content, spilled: false, originalTokens, tokens: originalTokens };
  }
  const id = spillId(content);
  const gist = spillGist(content, id, originalTokens, opts.headLines, opts.maxHeadChars);
  const gistTokens = countTokens(gist, model);
  if (gistTokens >= originalTokens) {
    return { content, spilled: false, originalTokens, tokens: originalTokens };
  }
  store.put(id, content);
  return { content: gist, spilled: true, id, originalTokens, tokens: gistTokens };
}

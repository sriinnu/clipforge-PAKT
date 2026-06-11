/**
 * @module types-cache
 * Prompt-cache related types: provider targets, breakpoint hints, and
 * dictionary placement. Split out of `types.ts` to keep that module
 * under the per-file line cap; everything here is re-exported from
 * `./types.js`, which remains the single import surface.
 */

/** LLM provider targets for cache_control breakpoint hints. */
export type CacheTarget = 'anthropic' | 'bedrock' | 'openai' | 'google';

/**
 * Cache-control hint computed during compression. Indicates where the
 * cacheable prefix ends in `compressed` and what TTL the chosen target
 * supports. Consumers pass this to their provider SDK.
 *
 * When the output carries a `@cache prefix-end` directive (emitted after
 * the `@dict ... @end` block whenever a cache target is set or
 * `cacheDirective: true` is passed), `byteOffset` lands immediately
 * after that directive line.
 */
export interface CacheBreakpoint {
  /** Byte offset in `compressed` where the cacheable prefix ends. */
  byteOffset: number;
  /**
   * Recommended cache TTL in seconds. `3600` for Bedrock, `300` for
   * Anthropic direct, `0` for providers that auto-manage caching
   * (OpenAI, Google).
   */
  recommendedTTLSeconds: number;
  /** Target provider this hint was computed for. */
  target: CacheTarget;
}

/**
 * Where the L2 dictionary lives in the compression output.
 *
 * - `'inline'` (default) — the `@dict ... @end` block is emitted at the
 *   top of the compressed string (current behavior).
 * - `'system'` — the dictionary is returned separately on
 *   `PaktResult.dictBlock` and the body omits the inline `@dict`
 *   section, referencing aliases only. Pin the dict block into the
 *   system prompt (where provider prompt caching is most effective) and
 *   send only bodies per turn. Decompress with
 *   `decompress(body, { dict: dictBlock })`.
 */
export type DictPlacement = 'inline' | 'system';

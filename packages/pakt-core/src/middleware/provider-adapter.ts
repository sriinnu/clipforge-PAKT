/**
 * @module middleware/provider-adapter
 * Provider-native cache hint generation from PAKT compress results.
 *
 * Pure, model-free, network-free functions that translate `compress()` output
 * (`cacheBreakpoint`, `dictBlock`) into ready-to-use Anthropic Messages API
 * and OpenAI Chat Completions API fragments. Never calls any SDK.
 *
 * ### Anthropic rules encoded
 * Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
 * - Max **4** `cache_control` breakpoints per request.
 * - Min cacheable prefix: 2 048 tokens (Sonnet-class) / 4 096 (Opus-class).
 *   Default here is 4 096 (conservative); pass `minPrefixTokens:2048` for Sonnet 4.6+.
 * - TTL 5 min (1.25× write, 0.1× read) — break-even ≈ 2nd read.
 *   TTL 1 h (2× write, 0.1× read) — break-even ≈ 3rd read.
 *   Prefer 1 h for stable system/dict prompts, 5 min for per-session prefixes.
 *
 * ### OpenAI rules encoded
 * Source: https://developers.openai.com/api/docs/guides/prompt-caching
 * Source: https://developers.openai.com/cookbook/examples/prompt_caching_201
 * - Auto-caches prefixes > 1 024 tokens in 128-token increments.
 * - `prompt_cache_key` biases shard routing; derived here from SHA-256 of
 *   the stable dict block so it stays constant across turns.
 */

import { createHash } from 'node:crypto';
import { utf8ByteLength } from '../utils/utf8-length.js';
import type { PaktResult } from '../types.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Maximum `cache_control` breakpoints allowed in a single Anthropic request.
 * Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching */
const ANTHROPIC_MAX_BREAKPOINTS = 4;

/**
 * Derive a stable, short cache routing key from arbitrary content.
 * Uses the first 16 hex characters (64 bits) of the SHA-256 digest — long
 * enough to be collision-resistant in practice, short enough to be cheap
 * in request bodies.
 */
function stableKey(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Anthropic types
// ---------------------------------------------------------------------------

/**
 * An Anthropic `cache_control` annotation — placed on the last content block
 * of the segment you want to mark as the end of a cacheable prefix.
 * Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
 */
export interface AnthropicCacheControl {
  /** Currently only `'ephemeral'` is supported by the API. */
  type: 'ephemeral';
  /**
   * Optional TTL override in seconds. `300` = 5 min (default),
   * `3600` = 1 hour. Only Bedrock accepts `3600`; Anthropic direct
   * silently caps at `300` as of Mar 2026.
   */
  ttl?: number;
}

/**
 * A single content block in the Anthropic Messages API `system` array or
 * `messages[].content` array, annotated with optional `cache_control`.
 * Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
 */
export interface AnthropicContentBlock {
  type: 'text';
  text: string;
  cache_control?: AnthropicCacheControl;
}

/**
 * Result from {@link buildAnthropicCacheHints}.
 *
 * - `systemBlocks`: ready-to-use `system` array (dict-block path).
 * - `prefixBlock` + `suffixBlock`: split compressed text at the byte boundary
 *   (inline-breakpoint path). `prefixBlock` carries `cache_control`;
 *   joining prefix + suffix always reproduces the original string.
 */
export interface AnthropicCacheHints {
  /** Dict-block entry with `cache_control`; present when `dictPlacement:'system'` was used. */
  systemBlocks?: AnthropicContentBlock[];
  /** Cacheable prefix of `result.compressed` up to the byte offset; carries `cache_control`. */
  prefixBlock?: AnthropicContentBlock;
  /** Remainder of `result.compressed` after the breakpoint; no `cache_control`. */
  suffixBlock?: AnthropicContentBlock;
  /** Reason hints were not fully emitted (debug/observability). */
  reason?: string;
  /** Number of `cache_control` breakpoints consumed; caller uses this to track the 4-bp budget. */
  breakpointsUsed: number;
}

/** Options for {@link buildAnthropicCacheHints}. */
export interface AnthropicCacheHintsOptions {
  /**
   * Min estimated tokens in the cacheable prefix. Anthropic requires 2 048
   * (Sonnet-class) or 4 096 (Opus-class). Estimated as `byteOffset / 4`
   * to avoid pulling in a tokenizer. @default 4096
   */
  minPrefixTokens?: number;
  /**
   * `cache_control.ttl` seconds. Omit for provider default (300 s).
   * Pass `3600` when routing through Bedrock. @default undefined
   */
  ttl?: number;
  /**
   * Breakpoints already used in this request. Hints are skipped when
   * `existingBreakpoints + new >= 4`. @default 0
   */
  existingBreakpoints?: number;
}

// ---------------------------------------------------------------------------
// OpenAI types
// ---------------------------------------------------------------------------

/** Result from {@link buildOpenAICacheHints}. */
export interface OpenAICacheHints {
  /**
   * Routing hint for `prompt_cache_key`. 16-char hex derived from SHA-256
   * of the stable prefix. Absent when no stable prefix is available.
   */
  prompt_cache_key?: string;
  /** `true` when the prefix is byte-stable across turns (dict block present). */
  promptPrefixStable: boolean;
  /** Estimated token count of the stable prefix (`byteLen / 4`). */
  estimatedPrefixTokens: number;
  /** Reason caching may not activate or no key was emitted. */
  reason?: string;
}

/** Options for {@link buildOpenAICacheHints}. */
export interface OpenAICacheHintsOptions {
  /** Min prefix tokens; `reason` is populated when below this. @default 1024 */
  minPrefixTokens?: number;
}

// ---------------------------------------------------------------------------
// buildAnthropicCacheHints
// ---------------------------------------------------------------------------

/**
 * Translate a {@link PaktResult} into ready-to-use Anthropic Messages API
 * cache fragments. Two paths:
 *
 * **Dict-block path** (`dictPlacement:'system'` on compress): returns
 * `systemBlocks` with `cache_control` on the dict block.
 *
 * **Inline-breakpoint path** (`target:'anthropic'` on compress): splits
 * `result.compressed` at `cacheBreakpoint.byteOffset` into
 * `prefixBlock` (with `cache_control`) + `suffixBlock`.
 *
 * Check `hints.reason` when no fragments are returned — it explains why
 * (budget exhausted, payload too small, missing breakpoint).
 *
 * @param result - Output from `compress()`.
 * @param opts - Tuning — see {@link AnthropicCacheHintsOptions}.
 * @returns Cache fragments and metadata.
 * @see https://platform.claude.com/docs/en/build-with-claude/prompt-caching
 */
export function buildAnthropicCacheHints(
  result: PaktResult,
  opts: AnthropicCacheHintsOptions = {},
): AnthropicCacheHints {
  const minPrefixTokens = opts.minPrefixTokens ?? 4096;
  const existingBreakpoints = opts.existingBreakpoints ?? 0;
  const remainingBudget = ANTHROPIC_MAX_BREAKPOINTS - existingBreakpoints;

  if (remainingBudget <= 0) {
    return {
      breakpointsUsed: 0,
      reason: `breakpoint budget exhausted (${existingBreakpoints}/${ANTHROPIC_MAX_BREAKPOINTS} already used)`,
    };
  }

  const cacheCtrl: AnthropicCacheControl = opts.ttl !== undefined
    ? { type: 'ephemeral', ttl: opts.ttl }
    : { type: 'ephemeral' };

  let breakpointsUsed = 0;
  const out: AnthropicCacheHints = { breakpointsUsed: 0 };

  // ---- dict block path (dictPlacement: 'system') -------------------------
  if (result.dictBlock !== undefined && result.dictBlock.length > 0) {
    const estimatedTokens = Math.floor(
      utf8ByteLength(result.dictBlock, Infinity) / 4,
    );
    if (estimatedTokens < minPrefixTokens) {
      out.reason =
        `dict block too small for Anthropic cache (estimated ~${estimatedTokens} tokens, ` +
        `minimum ${minPrefixTokens})`;
      // Still return the block, just without cache_control — callers can
      // decide whether to attach it anyway.
      out.systemBlocks = [{ type: 'text', text: result.dictBlock }];
      return out;
    }
    breakpointsUsed++;
    out.systemBlocks = [{ type: 'text', text: result.dictBlock, cache_control: cacheCtrl }];
    out.breakpointsUsed = breakpointsUsed;
    return out;
  }

  // ---- inline breakpoint path (cacheBreakpoint present) -----------------
  if (result.cacheBreakpoint === undefined) {
    out.reason =
      'no cacheBreakpoint on result — pass `target` or `cacheDirective: true` to compress()';
    out.breakpointsUsed = 0;
    return out;
  }

  const byteOffset = result.cacheBreakpoint.byteOffset;
  if (byteOffset === 0) {
    out.reason = 'cacheBreakpoint.byteOffset is 0 — no usable boundary detected';
    out.breakpointsUsed = 0;
    return out;
  }

  // Token-count gate (conservative estimate: 4 bytes ≈ 1 token).
  const estimatedTokens = Math.floor(byteOffset / 4);
  if (estimatedTokens < minPrefixTokens) {
    out.reason =
      `prefix too small for Anthropic cache (estimated ~${estimatedTokens} tokens, ` +
      `minimum ${minPrefixTokens} — consider lowering minPrefixTokens for Sonnet-class models)`;
    out.breakpointsUsed = 0;
    return out;
  }

  if (remainingBudget < 1) {
    out.reason = 'no breakpoint budget remaining';
    out.breakpointsUsed = 0;
    return out;
  }

  // Slice the compressed string at the byte boundary.
  const { prefixText, suffixText } = splitAtByteOffset(result.compressed, byteOffset);

  breakpointsUsed++;
  out.prefixBlock = { type: 'text', text: prefixText, cache_control: cacheCtrl };
  out.suffixBlock = { type: 'text', text: suffixText };
  out.breakpointsUsed = breakpointsUsed;
  return out;
}

// ---------------------------------------------------------------------------
// buildOpenAICacheHints
// ---------------------------------------------------------------------------

/**
 * Translate a {@link PaktResult} into OpenAI prompt caching hints.
 *
 * Returns a deterministic `prompt_cache_key` (first 16 hex chars of
 * SHA-256 of the stable prefix) for shard routing, and `promptPrefixStable`
 * to signal whether the prefix is expected to stay byte-identical across
 * turns. Also returns an estimated token count for the prefix so callers
 * can check whether automatic caching (> 1 024 tokens) will trigger.
 *
 * @param result - Output from `compress()`.
 * @param opts - Tuning — see {@link OpenAICacheHintsOptions}.
 * @returns Hints. Always returns an object; fields absent when no stable prefix.
 * @see https://developers.openai.com/api/docs/guides/prompt-caching
 * @see https://developers.openai.com/cookbook/examples/prompt_caching_201
 */
export function buildOpenAICacheHints(
  result: PaktResult,
  opts: OpenAICacheHintsOptions = {},
): OpenAICacheHints {
  const minPrefixTokens = opts.minPrefixTokens ?? 1024;

  // The most stable prefix anchor is the dict block (unchanged across turns
  // when the same compression run is reused).
  if (result.dictBlock !== undefined && result.dictBlock.length > 0) {
    const dictByteLen = utf8ByteLength(result.dictBlock, Infinity);
    const estimatedTokens = Math.floor(dictByteLen / 4);
    const key = stableKey(result.dictBlock);

    const out: OpenAICacheHints = {
      prompt_cache_key: key,
      promptPrefixStable: true,
      estimatedPrefixTokens: estimatedTokens,
    };
    if (estimatedTokens < minPrefixTokens) {
      out.reason =
        `dict block estimated ~${estimatedTokens} tokens; OpenAI auto-caches ` +
        `above ${minPrefixTokens} — caching may not activate`;
    }
    return out;
  }

  // Fall back to the cache breakpoint region (inline dict in compressed string).
  if (result.cacheBreakpoint !== undefined && result.cacheBreakpoint.byteOffset > 0) {
    const { prefixText } = splitAtByteOffset(
      result.compressed,
      result.cacheBreakpoint.byteOffset,
    );
    const byteLen = utf8ByteLength(prefixText, Infinity);
    const estimatedTokens = Math.floor(byteLen / 4);
    const key = stableKey(prefixText);

    const out: OpenAICacheHints = {
      prompt_cache_key: key,
      promptPrefixStable: true,
      estimatedPrefixTokens: estimatedTokens,
    };
    if (estimatedTokens < minPrefixTokens) {
      out.reason =
        `prefix estimated ~${estimatedTokens} tokens; OpenAI auto-caches ` +
        `above ${minPrefixTokens} — caching may not activate`;
    }
    return out;
  }

  return {
    promptPrefixStable: false,
    estimatedPrefixTokens: 0,
    reason:
      'no stable prefix available — compress with `dictPlacement:"system"` or `target:"openai"` ' +
      'to obtain a stable prefix anchor',
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Split `s` at a UTF-8 byte offset, always on a codepoint boundary.
 * Joining `prefixText + suffixText` always reproduces `s` exactly.
 *
 * @param s - Full string to split.
 * @param byteOffset - Desired split point in UTF-8 bytes (≥ 0).
 * @returns `{ prefixText, suffixText }` whose concatenation equals `s`.
 */
function splitAtByteOffset(
  s: string,
  byteOffset: number,
): { prefixText: string; suffixText: string } {
  if (byteOffset <= 0) return { prefixText: '', suffixText: s };

  // Walk characters accumulating byte count, stop when we hit the target.
  let accumulated = 0;
  let charIdx = 0;

  while (charIdx < s.length) {
    const c = s.charCodeAt(charIdx);
    let charBytes: number;

    if (c < 0x80) {
      charBytes = 1;
    } else if (c < 0x800) {
      charBytes = 2;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      // High surrogate — paired with a low surrogate = 4 bytes.
      const next = charIdx + 1 < s.length ? s.charCodeAt(charIdx + 1) : 0;
      charBytes = next >= 0xdc00 && next <= 0xdfff ? 4 : 3;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      // Isolated low surrogate = 3 bytes (TextEncoder U+FFFD fallback).
      charBytes = 3;
    } else {
      charBytes = 3; // BMP U+0800..U+FFFF
    }

    if (accumulated + charBytes > byteOffset) break;
    accumulated += charBytes;
    charIdx += c >= 0xd800 && c <= 0xdbff && charIdx + 1 < s.length ? 2 : 1;
  }

  return {
    prefixText: s.slice(0, charIdx),
    suffixText: s.slice(charIdx),
  };
}

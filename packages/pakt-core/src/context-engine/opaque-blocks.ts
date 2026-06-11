/**
 * @module context-engine/opaque-blocks
 * Provider compaction block detection and immutability guards.
 *
 * Anthropic's server-side compaction (beta header `compact-2026-01-12`)
 * returns `compaction` content blocks inside assistant messages. These blocks
 * MUST be preserved verbatim and passed back unchanged — summarising,
 * compressing, aging, or deduplicating them breaks the conversation.
 *
 * This module exposes:
 * - `isOpaqueBlock` — recognises a single content block as provider-owned and
 *   untouchable (extensible via `extraOpaqueTypes`).
 * - `messageIsImmutable` — returns `true` when a {@link ContextMessage} carries
 *   any opaque block and must therefore be passed through byte-identical.
 * - `BUILTIN_OPAQUE_TYPES` — the set of block `type` strings that are always
 *   treated as opaque regardless of configuration.
 */

import type { ContextMessage } from './types.js';

// ---------------------------------------------------------------------------
// Built-in opaque block type strings
// ---------------------------------------------------------------------------

/**
 * Block `type` values that are always opaque.
 *
 * - `'compaction'` — Anthropic server-side compaction summary block
 *   (beta `compact-2026-01-12`). Represents an irreversible lossy summary of
 *   prior context; mutating it corrupts the conversation.
 * - `'clear_tool_uses'` — Anthropic `context_editing` clearing placeholder.
 *   Signals that earlier tool-use/tool-result pairs have been cleared by the
 *   provider; the placeholder must be echoed back verbatim.
 *
 * @see https://platform.claude.com/docs/en/build-with-claude/compaction
 * @see https://platform.claude.com/docs/en/build-with-claude/context-editing
 */
export const BUILTIN_OPAQUE_TYPES: ReadonlySet<string> = new Set([
  'compaction',
  'clear_tool_uses',
]);

// ---------------------------------------------------------------------------
// Content-block shape
// ---------------------------------------------------------------------------

/**
 * Minimal shape of a provider content block embedded inside a
 * {@link ContextMessage}. The `type` discriminant is enough to determine
 * opacity; additional fields are carried opaquely and must never be read or
 * mutated by the context engine.
 */
export interface OpaqueContentBlock {
  /** Provider-assigned block type discriminant. */
  type: string;
  /** Arbitrary provider payload — treat as a black box. */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

/**
 * Returns `true` when `block` is a provider-owned opaque block that must be
 * preserved verbatim.
 *
 * Extensible: pass `extraOpaqueTypes` to guard custom provider block types
 * beyond {@link BUILTIN_OPAQUE_TYPES} without modifying this module.
 *
 * @param block - Content block to inspect.
 * @param extraOpaqueTypes - Additional type strings to treat as opaque.
 *
 * @example
 * ```ts
 * isOpaqueBlock({ type: 'compaction', summary: '...' });          // true
 * isOpaqueBlock({ type: 'text', text: 'hello' });                 // false
 * isOpaqueBlock({ type: 'my_block' }, ['my_block']);              // true
 * ```
 */
export function isOpaqueBlock(
  block: OpaqueContentBlock,
  extraOpaqueTypes: readonly string[] = [],
): boolean {
  if (BUILTIN_OPAQUE_TYPES.has(block.type)) return true;
  for (const t of extraOpaqueTypes) {
    if (block.type === t) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Message-level immutability check
// ---------------------------------------------------------------------------

/**
 * Returns `true` when `message` contains one or more opaque provider blocks
 * and must therefore be passed through the context engine byte-identical —
 * never compressed, deduped, aged, or summarised.
 *
 * Detection strategy: the {@link ContextMessage} `content` field is normally a
 * `string`, but provider SDKs occasionally surface the raw `ContentBlock[]`
 * array on the same field (or alongside it). This function handles both:
 *
 * 1. **String content** — inspects `message.opaqueBlocks` if the caller
 *    explicitly annotated them, or searches the raw string for known opaque
 *    type sentinels via a lightweight regex scan (false-positive-safe: we only
 *    match the exact JSON key `"type":"compaction"` pattern).
 * 2. **Array content** — iterates every block and delegates to
 *    {@link isOpaqueBlock}.
 *
 * @param message - Message to inspect.
 * @param extraOpaqueTypes - Additional opaque type strings to honour.
 */
export function messageIsImmutable(
  message: ContextMessage,
  extraOpaqueTypes: readonly string[] = [],
): boolean {
  // Fast path: caller explicitly flagged the message.
  if (message.containsOpaqueBlocks === true) return true;

  const content = message.content as unknown;

  // Array-of-blocks path (raw SDK response shape).
  if (Array.isArray(content)) {
    for (const block of content as OpaqueContentBlock[]) {
      if (typeof block === 'object' && block !== null && 'type' in block) {
        if (isOpaqueBlock(block as OpaqueContentBlock, extraOpaqueTypes)) return true;
      }
    }
    return false;
  }

  // String path — scan for known sentinel JSON patterns.
  if (typeof content === 'string') {
    for (const typeName of BUILTIN_OPAQUE_TYPES) {
      // Match both compact and spaced JSON: "type":"compaction"
      // or "type": "compaction"
      if (content.includes(`"type":"${typeName}"`) ||
          content.includes(`"type": "${typeName}"`)) {
        return true;
      }
    }
    for (const typeName of extraOpaqueTypes) {
      if (content.includes(`"type":"${typeName}"`) ||
          content.includes(`"type": "${typeName}"`)) {
        return true;
      }
    }
  }

  return false;
}

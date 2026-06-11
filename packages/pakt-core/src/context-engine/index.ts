/**
 * @module context-engine
 * PAKT Context Engine — unified context window optimizer.
 *
 * Manages the entire LLM input pipeline: system prompts, conversation
 * history, tool results, and token budgets. Compresses, summarizes,
 * deduplicates, and prunes to minimize tokens while maximizing signal.
 *
 * Less context = less noise = better attention = better answers.
 *
 * @example
 * ```ts
 * import { createContextEngine } from '@sriinnu/pakt';
 *
 * const engine = createContextEngine({ maxContextTokens: 50_000 });
 * engine.addMessage({ role: 'user', content: 'fix the auth bug' });
 * engine.addToolResult('read_file', bigJsonBlob);
 *
 * const { messages, savings } = engine.optimize();
 * // messages: compressed array ready for LLM API
 * // savings: { savedTokens: 1200, savedPercent: 35 }
 * ```
 */

export { ContextEngine, createContextEngine } from './engine.js';
export {
  isOpaqueBlock,
  messageIsImmutable,
  BUILTIN_OPAQUE_TYPES,
} from './opaque-blocks.js';
export type { OpaqueContentBlock } from './opaque-blocks.js';
export type {
  CompressionStrategy,
  ContextEngineConfig,
  ContextEngineStats,
  ContextFact,
  ContextIndex,
  ContextMessage,
  ContextSavings,
  OptimizedContext,
} from './types.js';

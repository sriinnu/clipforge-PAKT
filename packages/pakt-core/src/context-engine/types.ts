/**
 * @module context-engine/types
 * Types for the PAKT Context Engine — unified context window optimizer.
 *
 * The context engine manages the entire input pipeline:
 * system prompt, conversation history, tool results, and token budgets.
 * It compresses, summarizes, and prunes to minimize tokens while
 * maximizing signal — because less context means better accuracy.
 */

// ---------------------------------------------------------------------------
// Message types (API-agnostic)
// ---------------------------------------------------------------------------

/** A single message in the conversation. */
export interface ContextMessage {
  /** Message role. */
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** Text content of the message. */
  content: string;
  /** Optional tool name (for role=tool). */
  toolName?: string;
  /** Turn number this message belongs to (auto-assigned). */
  turn?: number;
  /** Original token count before any compression. */
  originalTokens?: number;
  /** Current token count (after compression, if any). */
  currentTokens?: number;
  /** Whether this message has been PAKT-compressed. */
  paktCompressed?: boolean;
  /** Whether this message has been summarized. */
  summarized?: boolean;
  /** Timestamp when this message was added. */
  addedAt?: number;
  /**
   * When `true`, the message contains one or more provider-owned opaque
   * content blocks (e.g. Anthropic `compaction` or `clear_tool_uses`).
   * The engine treats the entire message as immutable: it is never
   * compressed, deduped, aged, or summarised — and is passed through
   * byte-identical to the API.
   */
  containsOpaqueBlocks?: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Compression strategy for old conversation turns. */
export type CompressionStrategy = 'progressive' | 'aggressive' | 'minimal';

/** Context engine configuration. */
export interface ContextEngineConfig {
  /**
   * Target maximum context size in tokens.
   * When total context exceeds this, compression kicks in.
   * @default 100_000
   */
  maxContextTokens?: number;

  /**
   * Number of recent turns to keep at full fidelity (no compression).
   * @default 5
   */
  recentTurns?: number;

  /**
   * Compression strategy for older turns.
   * - `progressive`: gradually increase compression with age
   * - `aggressive`: compress everything beyond recentTurns immediately
   * - `minimal`: only compress tool results, keep prose verbatim
   * @default 'progressive'
   */
  strategy?: CompressionStrategy;

  /**
   * Minimum tokens for a tool result to be worth compressing.
   * @default 100
   */
  minToolResultTokens?: number;

  /**
   * When the running token total exceeds `maxContextTokens`, older tool
   * results are truncated to keep their last N lines (with a marker for
   * elided lines). Mirrors the Gemini-CLI back-to-front aging pattern:
   * the cutoff is snapped to the nearest user-message boundary so a
   * user → assistant → tool turn never splits mid-call. Set to 0 to
   * disable aging entirely.
   * @default 30
   */
  toolResultTailLines?: number;

  /**
   * Optional async function that summarizes a batch of old turns.
   * If not provided, the engine uses heuristic fact extraction (no LLM needed).
   * When provided, enables higher-quality summarization via a cheap LLM.
   *
   * @example
   * ```ts
   * summarizer: async (turns) => {
   *   const response = await anthropic.messages.create({
   *     model: 'claude-haiku-4-5-20251001',
   *     messages: [{ role: 'user', content: `Summarize these conversation turns into key facts, decisions, and actions. Be concise:\n\n${turns}` }],
   *     max_tokens: 500,
   *   });
   *   return response.content[0].text;
   * }
   * ```
   */
  summarizer?: (turns: string) => Promise<string>;

  /** Model identifier for token counting. @default 'gpt-4o' */
  model?: string;

  /**
   * When set, the engine treats this value as the provider's lossy compaction
   * trigger (tokens). PAKT's own lossless optimisation is targeted to keep the
   * total context **below** this threshold so server-side compaction never
   * fires. The remaining gap is reported as `headroomTokens` in
   * {@link ContextSavings}.
   *
   * Anthropic's default trigger for `compact-2026-01-12` is approximately
   * **150 000 input tokens**. Set this to `150_000` (or lower for safety
   * margin) to align PAKT's budget to fire before Anthropic's lossy pass.
   *
   * When `providerCompactionThresholdTokens` is set and is less than
   * `maxContextTokens`, the engine uses it as the effective ceiling instead of
   * `maxContextTokens` for aging and summarisation decisions.
   *
   * @see https://platform.claude.com/docs/en/build-with-claude/compaction
   * @default undefined (disabled)
   */
  providerCompactionThresholdTokens?: number;

  /**
   * Additional block `type` strings (beyond the built-in `compaction` /
   * `clear_tool_uses`) that the engine should treat as provider-owned and
   * immutable. Useful for custom or future provider content-block types.
   *
   * @example `['my_provider_summary']`
   * @default []
   */
  extraOpaqueTypes?: string[];
}

// ---------------------------------------------------------------------------
// Context index (structured memory)
// ---------------------------------------------------------------------------

/** A single fact/decision extracted from conversation history. */
export interface ContextFact {
  /** The fact or decision. */
  text: string;
  /** Which turn this was extracted from. */
  fromTurn: number;
  /** Category of the fact. */
  category: 'decision' | 'fact' | 'action' | 'requirement' | 'error';
  /** When this fact was recorded. */
  recordedAt: number;
}

/** The structured context index — replaces verbose old turns. */
export interface ContextIndex {
  /** Key facts and decisions from the conversation. */
  facts: ContextFact[];
  /** Total tokens the index consumes. */
  indexTokens: number;
  /** Total tokens of original turns this index replaces. */
  replacedTokens: number;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/** Result of context optimization. */
export interface OptimizedContext {
  /** Optimized messages array, ready for the LLM API. */
  messages: ContextMessage[];
  /** Total tokens in the optimized context. */
  totalTokens: number;
  /** Savings breakdown. */
  savings: ContextSavings;
  /** The context index (if any facts were extracted). */
  index: ContextIndex | null;
}

/** Savings breakdown from context optimization. */
export interface ContextSavings {
  /** Total tokens before optimization. */
  originalTokens: number;
  /** Total tokens after optimization. */
  optimizedTokens: number;
  /** Tokens saved. */
  savedTokens: number;
  /** Savings percentage. */
  savedPercent: number;
  /**
   * Tokens remaining before the provider's lossy compaction trigger fires.
   * Only present when `providerCompactionThresholdTokens` is configured.
   * A negative value means the current context already exceeds the threshold.
   *
   * Example: if `providerCompactionThresholdTokens = 150_000` and the
   * optimised context is 120 000 tokens, `headroomTokens = 30_000`.
   */
  headroomTokens?: number;
  /** Breakdown by source. */
  breakdown: {
    /** Tokens saved by compressing tool results. */
    toolResults: number;
    /** Tokens saved by compressing old turns. */
    historyCompression: number;
    /** Tokens saved by summarization. */
    summarization: number;
    /** Tokens saved by deduplication. */
    deduplication: number;
    /** Tokens saved by tail-truncating older tool results (Gemini-CLI aging). */
    toolResultAging: number;
  };
}

/** Cumulative stats across all optimizations in a session. */
export interface ContextEngineStats {
  /** Total optimize() calls. */
  totalOptimizations: number;
  /** Total tokens saved across all optimizations. */
  totalTokensSaved: number;
  /** Total original tokens processed. */
  totalOriginalTokens: number;
  /** Average savings percentage. */
  avgSavingsPercent: number;
  /** Number of turns currently summarized. */
  summarizedTurns: number;
  /** Number of facts in the context index. */
  indexedFacts: number;
  /** Number of tool results compressed. */
  compressedToolResults: number;
}

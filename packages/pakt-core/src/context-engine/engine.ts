/**
 * @module context-engine/engine
 * PAKT Context Engine — unified context window optimizer.
 * Manages the LLM input pipeline: tool compression, history compression,
 * deduplication, fact extraction, and provider-compaction safety.
 */

import { compress } from '../compress.js';
import { detect } from '../detect.js';
import { countTokens } from '../tokens/index.js';
import {
  buildIndexMessage,
  runFactExtraction,
  shouldSummarize,
} from './fact-extraction.js';
import {
  compressHistory,
  deduplicateContent,
} from './history-strategies.js';
import { compactCode, looksLikeCode } from '../layers/code-compact.js';
import { extractRelevant } from './extractive.js';
import { messageIsImmutable } from './opaque-blocks.js';
import { buildSharedDictionary } from './shared-dictionary.js';
import { ageSingleToolResult, clampToolResult, computeAgingCutoff } from './tool-aging.js';
import type {
  ContextEngineConfig,
  ContextEngineStats,
  ContextIndex,
  ContextMessage,
  ContextSavings,
  OptimizedContext,
} from './types.js';

/**
 * Hard cap on the byte size of any single tool result accepted by
 * `addToolResult`. Above this, the content is char-truncated to the
 * tail with a marker. Protects the engine from adversarial or
 * runaway tool output that would otherwise OOM the worker via
 * `split('\n')` materialization in `ageToolResults` or via the
 * tokenizer's per-call allocation cost.
 */
const MAX_TOOL_RESULT_BYTES = 1_048_576; // 1 MiB

const DEFAULT_CONFIG: Required<
  Omit<ContextEngineConfig, 'summarizer' | 'providerCompactionThresholdTokens' | 'query'>
> & {
  summarizer: ContextEngineConfig['summarizer'];
  providerCompactionThresholdTokens: number | undefined;
  query: string | undefined;
} = {
  maxContextTokens: 100_000,
  recentTurns: 5,
  strategy: 'progressive',
  minToolResultTokens: 100,
  summarizer: undefined,
  model: 'gpt-4o',
  toolResultTailLines: 30,
  providerCompactionThresholdTokens: undefined,
  extraOpaqueTypes: [],
  extractive: false,
  query: undefined,
  compactCode: false,
  sharedDictionary: true,
};

/**
 * Unified context window optimizer.
 *
 * Feed messages as they arrive. When you need the context for an API call,
 * call `optimize()` to get a compressed messages array.
 *
 * @example
 * ```ts
 * const engine = new ContextEngine({ maxContextTokens: 50_000 });
 *
 * engine.addMessage({ role: 'user', content: 'fix the auth bug' });
 * engine.addMessage({ role: 'assistant', content: 'I see the issue...' });
 * engine.addToolResult('read_file', bigJsonContent);
 *
 * const { messages, savings } = engine.optimize();
 * // messages is ready for the LLM API
 * // savings tells you how much was saved
 * ```
 */
export class ContextEngine {
  private config: typeof DEFAULT_CONFIG;
  private messages: ContextMessage[] = [];
  private currentTurn = 0;
  private contextIndex: ContextIndex = { facts: [], indexTokens: 0, replacedTokens: 0 };
  private contentHashes = new Map<string, number>(); // hash → first turn seen
  private stats: ContextEngineStats = {
    totalOptimizations: 0,
    totalTokensSaved: 0,
    totalOriginalTokens: 0,
    avgSavingsPercent: 0,
    summarizedTurns: 0,
    indexedFacts: 0,
    compressedToolResults: 0,
  };

  constructor(config?: ContextEngineConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Add a message to the conversation. */
  addMessage(msg: ContextMessage): void {
    // Auto-assign turn number on user messages (new turn starts with each user msg)
    if (msg.role === 'user') this.currentTurn++;

    // Detect provider opaque blocks at ingestion time so every downstream path
    // can check `containsOpaqueBlocks` without re-scanning the content.
    const hasOpaque =
      msg.containsOpaqueBlocks === true ||
      messageIsImmutable(msg, this.config.extraOpaqueTypes);

    const enriched: ContextMessage = {
      ...msg,
      turn: msg.turn ?? this.currentTurn,
      originalTokens: countTokens(msg.content, this.config.model),
      currentTokens: countTokens(msg.content, this.config.model),
      addedAt: Date.now(),
      containsOpaqueBlocks: hasOpaque || undefined,
    };

    this.messages.push(enriched);
  }

  /**
   * Add a tool result. Automatically detects format and compresses
   * if it's structured data above the token threshold. Large inputs are
   * clamped to {@link MAX_TOOL_RESULT_BYTES} before processing to prevent
   * OOM on `split('\n')` or tokeniser allocation.
   */
  addToolResult(toolName: string, content: string): void {
    const safeContent = clampToolResult(content, MAX_TOOL_RESULT_BYTES);
    const tokens = countTokens(safeContent, this.config.model);
    const detected = detect(safeContent);
    let finalContent = safeContent;
    let compressed = false;

    // Compress structured tool results above threshold
    if (
      tokens >= this.config.minToolResultTokens &&
      (detected.format === 'json' || detected.format === 'yaml' || detected.format === 'csv')
    ) {
      const result = compress(safeContent, { fromFormat: detected.format });
      if (result.compressedTokens < tokens) {
        finalContent = result.compressed;
        compressed = true;
        this.stats.compressedToolResults++;
      }
    }

    const msg: ContextMessage = {
      role: 'tool',
      content: finalContent,
      toolName,
      turn: this.currentTurn,
      originalTokens: tokens,
      currentTokens: countTokens(finalContent, this.config.model),
      paktCompressed: compressed,
      addedAt: Date.now(),
    };

    this.messages.push(msg);
  }

  /**
   * Optimize the conversation context for an API call.
   *
   * Returns a compressed messages array with savings metadata.
   * Does NOT mutate the internal message history — you can call
   * this multiple times as the conversation grows.
   */
  optimize(): OptimizedContext {
    const originalTokens = this.messages.reduce(
      (sum, m) => sum + (m.originalTokens ?? 0),
      0,
    );

    // Clone messages for optimization (don't mutate originals)
    let optimized = this.messages.map((m) => ({ ...m }));

    // Layer 0: Tool results already compressed during addToolResult()
    const toolSavings = optimized.reduce(
      (sum, m) =>
        sum + (m.paktCompressed ? (m.originalTokens ?? 0) - (m.currentTokens ?? 0) : 0),
      0,
    );

    // Layer 1: Deduplicate identical content across turns
    const dedupSavings = this.runDedup(optimized);

    // Layer 2: Progressive history compression
    const historySavings = this.runCompressHistory(optimized);

    // Layer 3: Tool-result aging — back-to-front walk, snap cutoff to
    // user-message boundary, tail-truncate older tool results when
    // running total exceeds budget. Less destructive than summarization,
    // and the truncation tail keeps the prefix-cache region monotonic.
    const agingSavings = this.ageToolResults(optimized);

    // Layer 4: Summarize old turns (if summarizer provided or heuristic)
    let summarySavings = 0;
    if (shouldSummarize(optimized, this.effectiveCeiling())) {
      summarySavings = this.extractFacts(optimized);
    }

    // Layer 4.5: Query-aware extractive selection (lossy, opt-in). Reduce older
    // large tool results to the lines relevant to the current query. Recent
    // turns are preserved at full fidelity; opaque/summarized are skipped.
    const extractiveSavings = this.runExtractive(optimized);

    // Layer 4.6: Code compaction (opt-in). Strip comments and redundant blank
    // lines from tool results that confidently look like source code.
    const codeCompactionSavings = this.runCodeCompaction(optimized);

    // Layer 5: Cross-message shared dictionary — mine lines recurring across
    // the whole (non-summarized, non-opaque) message set and amortize their
    // cost into a single `@shared` preamble. Runs last so it operates on the
    // already-compressed surface and never double-counts other layers.
    let sharedDictSavings = 0;
    let sharedPreamble: ContextMessage | null = null;
    if (this.config.sharedDictionary) {
      const shared = buildSharedDictionary(
        optimized.filter((m) => !m.summarized),
        this.config.model,
      );
      sharedDictSavings = shared.savedTokens;
      sharedPreamble = shared.preamble;
    }

    // Build the optimized context index preamble
    const indexMessage = buildIndexMessage(this.contextIndex, this.config.model);

    // Assemble final messages
    const finalMessages: ContextMessage[] = [];
    if (indexMessage) finalMessages.push(indexMessage);
    if (sharedPreamble) finalMessages.push(sharedPreamble);
    finalMessages.push(...optimized.filter((m) => !m.summarized));

    const optimizedTokens = finalMessages.reduce(
      (sum, m) => sum + (m.currentTokens ?? countTokens(m.content, this.config.model)),
      0,
    );

    const savedTokens = originalTokens - optimizedTokens;
    const savedPercent = originalTokens > 0 ? Math.round((savedTokens / originalTokens) * 100) : 0;

    // Update cumulative stats
    this.stats.totalOptimizations++;
    this.stats.totalOriginalTokens += originalTokens;
    this.stats.totalTokensSaved += Math.max(0, savedTokens);
    this.stats.avgSavingsPercent =
      this.stats.totalOriginalTokens > 0
        ? Math.round((this.stats.totalTokensSaved / this.stats.totalOriginalTokens) * 100)
        : 0;
    this.stats.indexedFacts = this.contextIndex.facts.length;

    // Compute headroom against the provider compaction threshold (if set).
    const threshold = this.config.providerCompactionThresholdTokens;
    const headroomTokens =
      threshold !== undefined ? threshold - optimizedTokens : undefined;

    const savings: ContextSavings = {
      originalTokens,
      optimizedTokens,
      savedTokens: Math.max(0, savedTokens),
      savedPercent: Math.max(0, savedPercent),
      ...(headroomTokens !== undefined ? { headroomTokens } : {}),
      breakdown: {
        toolResults: toolSavings,
        historyCompression: historySavings,
        summarization: summarySavings,
        deduplication: dedupSavings,
        toolResultAging: agingSavings,
        sharedDictionary: sharedDictSavings,
        extractive: extractiveSavings,
        codeCompaction: codeCompactionSavings,
      },
    };

    return {
      messages: finalMessages,
      totalTokens: optimizedTokens,
      savings,
      index: this.contextIndex.facts.length > 0 ? { ...this.contextIndex } : null,
    };
  }

  /**
   * Effective token ceiling: the lower of `maxContextTokens` and
   * `providerCompactionThresholdTokens` (when set). Using the provider
   * threshold as the ceiling ensures PAKT's lossless layers fire *before*
   * the provider's lossy compaction would trigger.
   */
  private effectiveCeiling(): number {
    const base = this.config.maxContextTokens;
    const threshold = this.config.providerCompactionThresholdTokens;
    return threshold !== undefined ? Math.min(base, threshold) : base;
  }

  /** Get cumulative engine stats. */
  getStats(): ContextEngineStats {
    return { ...this.stats };
  }

  /** Get the current turn number. */
  getCurrentTurn(): number {
    return this.currentTurn;
  }

  /**
   * Set the current query used by the extractive layer to decide which
   * tool-result lines are relevant. No effect unless `extractive` is enabled.
   */
  setQuery(query: string): void {
    this.config.query = query;
  }

  /** Get the raw message count. */
  getMessageCount(): number {
    return this.messages.length;
  }

  /** Reset all state. */
  reset(): void {
    this.messages = [];
    this.currentTurn = 0;
    this.contextIndex = { facts: [], indexTokens: 0, replacedTokens: 0 };
    this.contentHashes.clear();
    this.stats = {
      totalOptimizations: 0,
      totalTokensSaved: 0,
      totalOriginalTokens: 0,
      avgSavingsPercent: 0,
      summarizedTurns: 0,
      indexedFacts: 0,
      compressedToolResults: 0,
    };
  }

  /**
   * Replace duplicate content across turns with a reference note.
   * Delegates to {@link deduplicateContent} (history-strategies module).
   */
  private runDedup(messages: ContextMessage[]): number {
    return deduplicateContent(messages, this.contentHashes, this.config.model);
  }

  /**
   * Compress structured content in older turns using PAKT compression.
   * Delegates to {@link compressHistory} (history-strategies module).
   */
  private runCompressHistory(messages: ContextMessage[]): number {
    return compressHistory(
      messages,
      this.currentTurn,
      this.config.recentTurns,
      this.config.strategy,
    );
  }

  /**
   * Tail-truncate older tool results when total tokens exceed the effective
   * ceiling. Opaque messages are always skipped. Delegates to
   * {@link computeAgingCutoff} and {@link ageSingleToolResult}.
   */
  private ageToolResults(messages: ContextMessage[]): number {
    const tailLines = this.config.toolResultTailLines;
    if (tailLines <= 0) return 0;
    if (messages.length === 0) return 0;

    const snapped = computeAgingCutoff(messages, this.effectiveCeiling());
    if (snapped < 0) return 0;

    let saved = 0;
    for (let i = 0; i < snapped; i++) {
      const msg = messages[i];
      if (!msg) continue;
      if (msg.role !== 'tool') continue;
      if (msg.summarized) continue;
      // SAFETY: never age a message that carries provider opaque blocks.
      if (msg.containsOpaqueBlocks) continue;

      saved += ageSingleToolResult(msg, tailLines, this.config.model);
    }

    return saved;
  }

  /**
   * Query-aware extractive selection over older, large tool results.
   *
   * No-op unless `extractive` is enabled and a `query` is set. Recent turns
   * (within `recentTurns` of the current turn) are preserved at full fidelity;
   * opaque, summarized, and below-threshold results are skipped. Lossy but
   * faithful — kept lines are verbatim; dropped runs become elision markers.
   */
  private runExtractive(messages: ContextMessage[]): number {
    const query = this.config.query;
    if (!this.config.extractive || !query) return 0;

    const cutoff = this.currentTurn - this.config.recentTurns;
    if (cutoff <= 0) return 0;

    let saved = 0;
    for (const msg of messages) {
      if (msg.role !== 'tool') continue;
      if ((msg.turn ?? 0) > cutoff) continue; // preserve recent turns verbatim
      if (msg.summarized) continue;
      if (msg.containsOpaqueBlocks) continue;
      if ((msg.currentTokens ?? 0) < this.config.minToolResultTokens) continue;

      const result = extractRelevant(msg.content, { query, model: this.config.model });
      if (result.savedTokens > 0) {
        msg.content = result.text;
        msg.currentTokens = countTokens(result.text, this.config.model);
        saved += result.savedTokens;
      }
    }
    return saved;
  }

  /**
   * Code compaction over older tool results that confidently look like source
   * code. No-op unless `compactCode` is enabled. Skips JSON/YAML/CSV (handled
   * by structural compression) and Markdown (whose `#` headings must never be
   * treated as comments); recent turns, opaque, and summarized are skipped.
   */
  private runCodeCompaction(messages: ContextMessage[]): number {
    if (!this.config.compactCode) return 0;

    const cutoff = this.currentTurn - this.config.recentTurns;
    if (cutoff <= 0) return 0;

    let saved = 0;
    for (const msg of messages) {
      if (msg.role !== 'tool') continue;
      if ((msg.turn ?? 0) > cutoff) continue;
      if (msg.summarized) continue;
      if (msg.containsOpaqueBlocks) continue;
      if (msg.paktCompressed) continue; // already a structural PAKT payload
      if ((msg.currentTokens ?? 0) < this.config.minToolResultTokens) continue;

      const fmt = detect(msg.content).format;
      if (fmt === 'json' || fmt === 'yaml' || fmt === 'csv' || fmt === 'markdown') continue;
      if (!looksLikeCode(msg.content)) continue;

      const result = compactCode(msg.content, { model: this.config.model });
      if (result.savedTokens > 0) {
        msg.content = result.text;
        msg.currentTokens = countTokens(result.text, this.config.model);
        saved += result.savedTokens;
      }
    }
    return saved;
  }

  /**
   * Extract key facts from old turns and mark them as summarised.
   * Delegates to {@link runFactExtraction}; opaque messages are skipped there.
   */
  private extractFacts(messages: ContextMessage[]): number {
    const cutoff = this.currentTurn - this.config.recentTurns - 2;
    return runFactExtraction(
      messages,
      cutoff,
      this.contextIndex,
      this.config.model,
      () => { this.stats.summarizedTurns++; },
    );
  }
}

/**
 * Create a new PAKT Context Engine.
 *
 * @example
 * ```ts
 * import { createContextEngine } from '@sriinnu/pakt';
 *
 * const engine = createContextEngine({
 *   maxContextTokens: 50_000,
 *   recentTurns: 5,
 *   strategy: 'progressive',
 * });
 *
 * engine.addMessage({ role: 'user', content: 'fix the auth bug' });
 * engine.addToolResult('read_file', bigJson);
 *
 * const { messages, savings } = engine.optimize();
 * console.log(`Saved ${savings.savedPercent}% (${savings.savedTokens} tokens)`);
 * ```
 */
export function createContextEngine(config?: ContextEngineConfig): ContextEngine {
  return new ContextEngine(config);
}

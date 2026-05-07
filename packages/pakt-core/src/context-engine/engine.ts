/**
 * @module context-engine/engine
 * PAKT Context Engine — unified context window optimizer.
 *
 * Manages the entire input pipeline for LLM conversations:
 * - Compresses tool results with PAKT structural compression
 * - Progressively compresses older conversation turns
 * - Extracts key facts into a structured context index
 * - Deduplicates repeated content across turns
 * - Allocates token budget based on recency and relevance
 *
 * The result: fewer tokens, lower cost, AND better accuracy
 * (because context rot means less noise = better attention).
 */

import { compress } from '../compress.js';
import { detect } from '../detect.js';
import { countTokens } from '../tokens/index.js';
import type {
  ContextEngineConfig,
  ContextEngineStats,
  ContextFact,
  ContextIndex,
  ContextMessage,
  ContextSavings,
  OptimizedContext,
} from './types.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Required<Omit<ContextEngineConfig, 'summarizer'>> & {
  summarizer: ContextEngineConfig['summarizer'];
} = {
  maxContextTokens: 100_000,
  recentTurns: 5,
  strategy: 'progressive',
  minToolResultTokens: 100,
  summarizer: undefined,
  model: 'gpt-4o',
  toolResultTailLines: 30,
};

// ---------------------------------------------------------------------------
// ContextEngine
// ---------------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Public API: Adding messages
  // -----------------------------------------------------------------------

  /** Add a message to the conversation. */
  addMessage(msg: ContextMessage): void {
    // Auto-assign turn number on user messages (new turn starts with each user msg)
    if (msg.role === 'user') this.currentTurn++;

    const enriched: ContextMessage = {
      ...msg,
      turn: msg.turn ?? this.currentTurn,
      originalTokens: countTokens(msg.content, this.config.model),
      currentTokens: countTokens(msg.content, this.config.model),
      addedAt: Date.now(),
    };

    this.messages.push(enriched);
  }

  /**
   * Add a tool result. Automatically detects format and compresses
   * if it's structured data above the token threshold.
   */
  addToolResult(toolName: string, content: string): void {
    const tokens = countTokens(content, this.config.model);
    const detected = detect(content);
    let finalContent = content;
    let compressed = false;

    // Compress structured tool results above threshold
    if (
      tokens >= this.config.minToolResultTokens &&
      (detected.format === 'json' || detected.format === 'yaml' || detected.format === 'csv')
    ) {
      const result = compress(content, { fromFormat: detected.format });
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

  // -----------------------------------------------------------------------
  // Public API: Optimize context
  // -----------------------------------------------------------------------

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
    const dedupSavings = this.deduplicateContent(optimized);

    // Layer 2: Progressive history compression
    const historySavings = this.compressHistory(optimized);

    // Layer 3: Tool-result aging — back-to-front walk, snap cutoff to
    // user-message boundary, tail-truncate older tool results when
    // running total exceeds budget. Less destructive than summarization,
    // and the truncation tail keeps the prefix-cache region monotonic.
    const agingSavings = this.ageToolResults(optimized);

    // Layer 4: Summarize old turns (if summarizer provided or heuristic)
    let summarySavings = 0;
    if (this.shouldSummarize(optimized)) {
      summarySavings = this.extractFacts(optimized);
    }

    // Build the optimized context index preamble
    const indexMessage = this.buildIndexMessage();

    // Assemble final messages
    const finalMessages: ContextMessage[] = [];
    if (indexMessage) finalMessages.push(indexMessage);
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

    const savings: ContextSavings = {
      originalTokens,
      optimizedTokens,
      savedTokens: Math.max(0, savedTokens),
      savedPercent: Math.max(0, savedPercent),
      breakdown: {
        toolResults: toolSavings,
        historyCompression: historySavings,
        summarization: summarySavings,
        deduplication: dedupSavings,
        toolResultAging: agingSavings,
      },
    };

    return {
      messages: finalMessages,
      totalTokens: optimizedTokens,
      savings,
      index: this.contextIndex.facts.length > 0 ? { ...this.contextIndex } : null,
    };
  }

  /** Get cumulative engine stats. */
  getStats(): ContextEngineStats {
    return { ...this.stats };
  }

  /** Get the current turn number. */
  getCurrentTurn(): number {
    return this.currentTurn;
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

  // -----------------------------------------------------------------------
  // Internal: Deduplication
  // -----------------------------------------------------------------------

  /** Replace duplicate content across turns with a reference note. */
  private deduplicateContent(messages: ContextMessage[]): number {
    let saved = 0;

    for (const msg of messages) {
      if (msg.role === 'system') continue;
      if ((msg.currentTokens ?? 0) < 50) continue;

      // Simple content hash (first 200 chars + length)
      const hash = `${msg.content.slice(0, 200)}:${String(msg.content.length)}`;

      const firstSeen = this.contentHashes.get(hash);
      if (firstSeen !== undefined && firstSeen < (msg.turn ?? 0)) {
        // This content was seen before — replace with reference
        const originalTokens = msg.currentTokens ?? 0;
        msg.content = `[Same as turn ${String(firstSeen)}: ${msg.content.slice(0, 60)}...]`;
        msg.currentTokens = countTokens(msg.content, this.config.model);
        saved += originalTokens - msg.currentTokens;
      } else {
        this.contentHashes.set(hash, msg.turn ?? 0);
      }
    }

    return Math.max(0, saved);
  }

  // -----------------------------------------------------------------------
  // Internal: Progressive history compression
  // -----------------------------------------------------------------------

  /** Compress older turns with PAKT structural compression. */
  private compressHistory(messages: ContextMessage[]): number {
    if (this.config.strategy === 'minimal') return 0;

    const cutoff = this.currentTurn - this.config.recentTurns;
    if (cutoff <= 0) return 0;

    let saved = 0;

    for (const msg of messages) {
      // Skip recent turns, system messages, and already-compressed
      if ((msg.turn ?? 0) > cutoff) continue;
      if (msg.role === 'system') continue;
      if (msg.paktCompressed) continue;
      if ((msg.currentTokens ?? 0) < 50) continue;

      // Try to compress the message content
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

  // -----------------------------------------------------------------------
  // Internal: Tool-result aging (Gemini-CLI back-to-front pattern)
  // -----------------------------------------------------------------------

  /**
   * When running token total exceeds budget, truncate older tool results
   * to their last N lines. Walk back-to-front to find the cutoff, snap
   * it forward to the next user-message boundary so a turn is never
   * split mid-tool-call. Recent messages stay whole; only tool messages
   * earlier than the cutoff get tail-truncated.
   */
  private ageToolResults(messages: ContextMessage[]): number {
    const tailLines = this.config.toolResultTailLines;
    if (tailLines <= 0) return 0;
    if (messages.length === 0) return 0;

    // Walk back-to-front, accumulate tokens, find the index where we
    // first exceed budget.
    let running = 0;
    let cutoffIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!m) continue;
      running += m.currentTokens ?? 0;
      if (running > this.config.maxContextTokens) {
        cutoffIdx = i;
        break;
      }
    }
    if (cutoffIdx < 0) return 0; // Within budget — nothing to age.

    // Snap cutoff FORWARD to the nearest user-message boundary. A
    // user → assistant → tool sequence stays atomic; we only age
    // messages that belong to a fully-completed earlier turn.
    let snapped = cutoffIdx;
    while (snapped < messages.length && messages[snapped]?.role !== 'user') {
      snapped++;
    }
    if (snapped >= messages.length) return 0; // No earlier turn boundary.

    /* When the tool result is heavy enough to matter but has too few
       newlines for line-based aging (e.g. minified JSON dumped from a
       command), fall back to character-tail truncation. Threshold: if
       we'd otherwise leave more than this many tokens untouched, we
       still age. */
    const SINGLE_LINE_TOKEN_THRESHOLD = 1000;
    const TAIL_CHAR_BUDGET = 4000;

    let saved = 0;
    for (let i = 0; i < snapped; i++) {
      const msg = messages[i];
      if (!msg) continue;
      if (msg.role !== 'tool') continue;
      if (msg.summarized) continue;

      const lines = msg.content.split('\n');
      const before = msg.currentTokens ?? 0;

      let aged: string | null = null;
      if (lines.length > tailLines) {
        const elided = lines.length - tailLines;
        const tail = lines.slice(-tailLines).join('\n');
        aged = `[... ${String(elided)} earlier lines elided by tool-result aging ...]\n${tail}`;
      } else if (before > SINGLE_LINE_TOKEN_THRESHOLD && msg.content.length > TAIL_CHAR_BUDGET) {
        /* Too few lines to truncate by-line, but the message is heavy
           enough to be worth char-truncating. Keep the trailing slice. */
        const elidedChars = msg.content.length - TAIL_CHAR_BUDGET;
        const tail = msg.content.slice(-TAIL_CHAR_BUDGET);
        aged = `[... ${String(elidedChars)} earlier characters elided by tool-result aging ...]\n${tail}`;
      } else {
        continue;
      }

      const after = countTokens(aged, this.config.model);
      if (after >= before) continue; // Aging didn't help (rare).

      msg.content = aged;
      msg.currentTokens = after;
      saved += before - after;
    }

    return saved;
  }

  // -----------------------------------------------------------------------
  // Internal: Fact extraction (heuristic, no LLM needed)
  // -----------------------------------------------------------------------

  /** Decide whether we should summarize old turns. */
  private shouldSummarize(messages: ContextMessage[]): boolean {
    const totalTokens = messages.reduce(
      (sum, m) => sum + (m.currentTokens ?? 0),
      0,
    );
    // Summarize when context exceeds 60% of max budget
    return totalTokens > this.config.maxContextTokens * 0.6;
  }

  /**
   * Extract key facts from old turns and mark them as summarized.
   * Uses heuristic extraction — no LLM call needed.
   */
  private extractFacts(messages: ContextMessage[]): number {
    const cutoff = this.currentTurn - this.config.recentTurns - 2;
    if (cutoff <= 0) return 0;

    let saved = 0;

    for (const msg of messages) {
      if ((msg.turn ?? 0) > cutoff) continue;
      if (msg.summarized) continue;
      if (msg.role === 'system') continue;

      // Extract facts from the message
      const facts = extractFactsHeuristic(msg.content, msg.turn ?? 0);
      if (facts.length > 0) {
        this.contextIndex.facts.push(...facts);
      }

      // Mark as summarized (will be filtered out in final assembly)
      const before = msg.currentTokens ?? 0;
      msg.summarized = true;
      this.stats.summarizedTurns++;
      saved += before;
    }

    // Update index token count
    const indexContent = this.contextIndex.facts.map((f) => f.text).join('\n');
    this.contextIndex.indexTokens = countTokens(indexContent, this.config.model);
    this.contextIndex.replacedTokens += saved;

    // Net savings = removed turn tokens - index tokens added
    return Math.max(0, saved - this.contextIndex.indexTokens);
  }

  /** Build a context index message to prepend to the conversation. */
  private buildIndexMessage(): ContextMessage | null {
    if (this.contextIndex.facts.length === 0) return null;

    const grouped = new Map<string, ContextFact[]>();
    for (const fact of this.contextIndex.facts) {
      const arr = grouped.get(fact.category) ?? [];
      arr.push(fact);
      grouped.set(fact.category, arr);
    }

    const lines: string[] = ['[Context from earlier turns]'];
    for (const [category, facts] of grouped) {
      lines.push(`${category}:`);
      for (const f of facts) {
        lines.push(`- ${f.text}`);
      }
    }

    const content = lines.join('\n');
    return {
      role: 'system',
      content,
      turn: 0,
      currentTokens: countTokens(content, this.config.model),
      summarized: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Heuristic fact extraction (no LLM needed)
// ---------------------------------------------------------------------------

/** Patterns that indicate a key fact or decision. */
const FACT_PATTERNS: Array<{ pattern: RegExp; category: ContextFact['category'] }> = [
  { pattern: /(?:decided|chose|picked|selected|going with|let's use)\s+(.{10,80})/i, category: 'decision' },
  { pattern: /(?:the (?:bug|issue|error|problem) (?:is|was))\s+(.{10,80})/i, category: 'error' },
  { pattern: /(?:fixed|resolved|solved)\s+(.{10,80})/i, category: 'action' },
  { pattern: /(?:created|added|built|implemented|wrote)\s+(.{10,80})/i, category: 'action' },
  { pattern: /(?:must|should|need to|requires?|has to)\s+(.{10,80})/i, category: 'requirement' },
  { pattern: /(?:budget|deadline|constraint|limit)\s*(?:is|:)\s*(.{5,40})/i, category: 'fact' },
  { pattern: /(?:using|running|version)\s+(.{5,40})/i, category: 'fact' },
];

/**
 * Extract key facts from a message using pattern matching.
 * Returns an array of ContextFacts. No LLM call needed.
 */
function extractFactsHeuristic(content: string, turn: number): ContextFact[] {
  const facts: ContextFact[] = [];
  const now = Date.now();

  for (const { pattern, category } of FACT_PATTERNS) {
    const match = pattern.exec(content);
    if (match?.[1]) {
      facts.push({
        text: match[1].trim().replace(/[.!,;]+$/, ''),
        fromTurn: turn,
        category,
        recordedAt: now,
      });
    }
  }

  return facts;
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

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

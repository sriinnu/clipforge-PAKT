/**
 * @module context-engine/fact-extraction
 * Heuristic key-fact extraction and context-index utilities.
 *
 * Runs fully offline — no LLM call required. Uses pattern matching to
 * identify decisions, errors, actions, requirements, and facts from
 * assistant or user message text. Also provides the index-message builder
 * and the summarisation-trigger check so engine.ts stays under the LOC cap.
 */

import { countTokens } from '../tokens/index.js';
import type { ContextFact, ContextIndex, ContextMessage } from './types.js';

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/**
 * Regex-category pairs used to identify key facts in message content.
 * Ordered roughly by specificity; the first match per pattern wins.
 */
const FACT_PATTERNS: Array<{ pattern: RegExp; category: ContextFact['category'] }> = [
  { pattern: /(?:decided|chose|picked|selected|going with|let's use)\s+(.{10,80})/i, category: 'decision' },
  { pattern: /(?:the (?:bug|issue|error|problem) (?:is|was))\s+(.{10,80})/i, category: 'error' },
  { pattern: /(?:fixed|resolved|solved)\s+(.{10,80})/i, category: 'action' },
  { pattern: /(?:created|added|built|implemented|wrote)\s+(.{10,80})/i, category: 'action' },
  { pattern: /(?:must|should|need to|requires?|has to)\s+(.{10,80})/i, category: 'requirement' },
  { pattern: /(?:budget|deadline|constraint|limit)\s*(?:is|:)\s*(.{5,40})/i, category: 'fact' },
  { pattern: /(?:using|running|version)\s+(.{5,40})/i, category: 'fact' },
];

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extract key facts from a single message using heuristic pattern matching.
 *
 * Returns an array of {@link ContextFact} objects. Each call is idempotent
 * and allocates a fresh timestamp, so facts extracted from repeated calls
 * will carry different `recordedAt` values.
 *
 * @param content - Raw message text to scan.
 * @param turn    - Turn number of the originating message.
 */
export function extractFactsHeuristic(content: string, turn: number): ContextFact[] {
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
// Summarisation trigger
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the current total token count of `messages` exceeds
 * 60% of `ceiling`, signalling that old turns should be summarised.
 *
 * @param messages - Current (post-other-optimisations) message array.
 * @param ceiling  - Effective token ceiling (min of maxContextTokens and any
 *                   provider compaction threshold).
 */
export function shouldSummarize(messages: ContextMessage[], ceiling: number): boolean {
  const total = messages.reduce((sum, m) => sum + (m.currentTokens ?? 0), 0);
  return total > ceiling * 0.6;
}

// ---------------------------------------------------------------------------
// Batch fact extraction with summarisation marking
// ---------------------------------------------------------------------------

/**
 * Walk `messages`, extract facts from old turns (beyond `cutoff`), mark them
 * as summarised, and update `index` in place. Returns the net token saving:
 * tokens removed from messages minus tokens added to the index.
 *
 * Opaque messages (provider compaction blocks) are always skipped.
 *
 * @param messages         - Message array (mutated: `summarized` flag set).
 * @param cutoff           - Only messages with turn ≤ cutoff are processed.
 * @param index            - Context index to append extracted facts to.
 * @param model            - Model identifier for token counting.
 * @param onSummarized     - Callback invoked once per summarised message
 *                           (allows the engine to increment its own counter).
 */
export function runFactExtraction(
  messages: ContextMessage[],
  cutoff: number,
  index: ContextIndex,
  model: string,
  onSummarized: () => void,
): number {
  if (cutoff <= 0) return 0;

  let saved = 0;

  for (const msg of messages) {
    if ((msg.turn ?? 0) > cutoff) continue;
    if (msg.summarized) continue;
    if (msg.role === 'system') continue;
    if (msg.containsOpaqueBlocks) continue;

    const facts = extractFactsHeuristic(msg.content, msg.turn ?? 0);
    if (facts.length > 0) index.facts.push(...facts);

    const before = msg.currentTokens ?? 0;
    msg.summarized = true;
    onSummarized();
    saved += before;
  }

  const indexContent = index.facts.map((f) => f.text).join('\n');
  index.indexTokens = countTokens(indexContent, model);
  index.replacedTokens += saved;

  return Math.max(0, saved - index.indexTokens);
}

// ---------------------------------------------------------------------------
// Context index message builder
// ---------------------------------------------------------------------------

/**
 * Build a synthetic `system` message that summarises the context index facts
 * extracted from old turns, ready to be prepended to the message array.
 * Returns `null` when the index is empty.
 *
 * @param index - Current context index.
 * @param model - Model identifier for token counting.
 */
export function buildIndexMessage(
  index: ContextIndex,
  model: string,
): ContextMessage | null {
  if (index.facts.length === 0) return null;

  const grouped = new Map<string, ContextFact[]>();
  for (const fact of index.facts) {
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
    currentTokens: countTokens(content, model),
    summarized: false,
  };
}

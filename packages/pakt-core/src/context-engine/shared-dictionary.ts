/**
 * @module context-engine/shared-dictionary
 * Cross-message shared dictionary — whole-prompt LZ over recurring lines.
 *
 * L2 (`L2-dictionary`) and L3.5 (`L3-5-metatoken`) deduplicate repeated
 * spans **within a single payload**. They never see across message
 * boundaries, so a line that recurs in three different tool results — an
 * import statement, a log prefix, a JSON schema row, a stack frame — is
 * paid for in full every time.
 *
 * This layer closes that gap. It mines full-line spans that recur across
 * the **entire** optimized message set, defines each once in a single
 * `@shared` preamble block, and rewrites every occurrence with a compact
 * `§N` alias. The definition cost is amortized once across all messages
 * instead of once per payload — the cross-message win L2 cannot reach.
 *
 * ### Why whole lines (not arbitrary substrings)
 * Line-granular exact matching is lossless by construction and cannot
 * corrupt a parse: rewriting and expansion both operate on `split('\n')`
 * boundaries, so an alias can never partially match inside another line.
 * Lines are also the natural unit of repetition in agent contexts (logs,
 * code, pretty-printed JSON). Sub-line spans remain L2/L3.5's job.
 *
 * ### Lossless-by-construction gate
 * After rewriting, {@link expandSharedDictionary} reconstructs each message
 * and the result is compared against the original. On any mismatch the
 * entire pass is abandoned and the messages are left untouched.
 *
 * ### Alias namespace
 * `§1`, `§2`, … The section sign is rare in code/logs and distinct from
 * L2/L3.5's `$a` namespace, so the two layers compose without collision.
 * If a chosen alias string already occurs anywhere in the corpus, the pass
 * is abandoned (collision-safe rather than clever).
 */

import { countTokens } from '../tokens/index.js';
import type { ContextMessage } from './types.js';

/** One entry in the shared dictionary. */
export interface SharedDictEntry {
  /** Alias token written into message bodies, e.g. `§1`. */
  alias: string;
  /** The exact line text the alias expands back to. */
  expansion: string;
  /** Number of full-line occurrences replaced across all messages. */
  occurrences: number;
}

/** Result of {@link buildSharedDictionary}. */
export interface SharedDictResult {
  /** Preamble message defining the dictionary, or null when nothing was aliased. */
  preamble: ContextMessage | null;
  /** Net tokens saved (always >= 0; 0 means the pass was a no-op). */
  savedTokens: number;
  /** The selected entries (empty on no-op). */
  entries: SharedDictEntry[];
}

/** Minimum full-line occurrences across the corpus to justify an alias. */
const MIN_OCCURRENCES = 2;

/** A candidate line must carry at least this many tokens to be worth aliasing. */
const MIN_LINE_TOKENS = 4;

/** Hard cap on entries so the preamble stays small and the legend readable. */
const MAX_ENTRIES = 64;

/** Block markers for the shared-dictionary preamble. */
const BLOCK_OPEN = '@shared';
const BLOCK_CLOSE = '@end';

/** Map a 1-based index to its alias string. */
function aliasForIndex(index: number): string {
  return `§${String(index)}`;
}

/**
 * Whether a message may be mined and rewritten by this layer.
 * Opaque (provider-owned) and already-summarized messages are off-limits.
 */
function isEligible(msg: ContextMessage): boolean {
  if (msg.containsOpaqueBlocks) return false;
  if (msg.summarized) return false;
  return true;
}

/**
 * Render the preamble body for a set of entries. Each entry is one line:
 * `  §N: <expansion>`. The leading `@shared` / trailing `@end` frame it so
 * the model reads it as a legend, mirroring PAKT's existing `@dict` idiom.
 */
function renderPreamble(entries: SharedDictEntry[]): string {
  const lines = [BLOCK_OPEN];
  for (const e of entries) lines.push(`  ${e.alias}: ${e.expansion}`);
  lines.push(BLOCK_CLOSE);
  return lines.join('\n');
}

/**
 * Expand a `§N`-aliased text back to its original form using `entries`.
 *
 * Operates strictly on full-line boundaries: a line equal to an alias token
 * is replaced by that alias's expansion. This is the exact inverse of the
 * rewrite performed by {@link buildSharedDictionary} and is exported for the
 * decompression path and for round-trip verification.
 */
export function expandSharedDictionary(
  text: string,
  entries: ReadonlyArray<SharedDictEntry>,
): string {
  if (entries.length === 0) return text;
  const byAlias = new Map<string, string>();
  for (const e of entries) byAlias.set(e.alias, e.expansion);

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const expansion = byAlias.get(lines[i] ?? '');
    if (expansion !== undefined) lines[i] = expansion;
  }
  return lines.join('\n');
}

/**
 * Build a shared dictionary across `messages`, rewriting eligible message
 * bodies in place and returning a preamble message that defines the aliases.
 *
 * The pass is committed only when it yields a net token reduction **and**
 * every rewritten message expands back byte-identically. Otherwise the
 * messages are left untouched and a no-op result is returned.
 *
 * @param messages - Optimized messages (mutated in place on commit).
 * @param model    - Model identifier for token counting.
 * @returns {@link SharedDictResult}
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: cohesive single pass — mine, gate, verify, commit
export function buildSharedDictionary(messages: ContextMessage[], model: string): SharedDictResult {
  const noOp: SharedDictResult = { preamble: null, savedTokens: 0, entries: [] };

  const eligible = messages.filter(isEligible);
  if (eligible.length === 0) return noOp;

  // -- 1. Count full-line occurrences across the whole corpus --
  // `allLines` doubles as the collision oracle for alias assignment below.
  const lineFreq = new Map<string, number>();
  const allLines = new Set<string>();
  for (const msg of eligible) {
    for (const line of msg.content.split('\n')) {
      allLines.add(line);
      if (line.trim().length === 0) continue;
      lineFreq.set(line, (lineFreq.get(line) ?? 0) + 1);
    }
  }

  // -- 2. Score candidates by net token savings --
  const aliasTokenCost = countTokens(aliasForIndex(1), model); // ~ stable across small N
  interface Candidate {
    line: string;
    occ: number;
    net: number;
  }
  const candidates: Candidate[] = [];
  for (const [line, occ] of lineFreq) {
    if (occ < MIN_OCCURRENCES) continue;
    const lineTokens = countTokens(line, model);
    if (lineTokens < MIN_LINE_TOKENS) continue;
    // Savings: every occurrence drops `lineTokens` and gains `aliasTokenCost`;
    // the single definition costs `lineTokens` + a few tokens of framing.
    const perOcc = lineTokens - aliasTokenCost;
    if (perOcc <= 0) continue;
    const defCost = lineTokens + 3; // `  §N: ` framing + newline
    const net = perOcc * occ - defCost;
    if (net <= 0) continue;
    candidates.push({ line, occ, net });
  }
  if (candidates.length === 0) return noOp;

  // Highest-value first; cap entry count to keep the legend small.
  candidates.sort((a, b) => b.net - a.net || b.occ - a.occ);
  const chosen = candidates.slice(0, MAX_ENTRIES);

  // -- 3. Assign aliases; bail on any collision with existing content --
  const entries: SharedDictEntry[] = [];
  const expansionToAlias = new Map<string, string>();
  for (let i = 0; i < chosen.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index is within bounds
    const c = chosen[i]!;
    const alias = aliasForIndex(i + 1);
    // Collision guard: the alias token must not already appear as a standalone
    // line anywhere, or expansion would be ambiguous.
    if (allLines.has(alias)) return noOp;
    entries.push({ alias, expansion: c.line, occurrences: c.occ });
    expansionToAlias.set(c.line, alias);
  }

  // -- 4. Rewrite eligible bodies (staged, not yet committed) --
  const rewrites = new Map<ContextMessage, string>();
  for (const msg of eligible) {
    const lines = msg.content.split('\n');
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      const alias = expansionToAlias.get(lines[i] ?? '');
      if (alias !== undefined) {
        lines[i] = alias;
        changed = true;
      }
    }
    if (changed) rewrites.set(msg, lines.join('\n'));
  }
  if (rewrites.size === 0) return noOp;

  // -- 5. Lossless-by-construction gate: every rewrite must round-trip --
  for (const [msg, rewritten] of rewrites) {
    if (expandSharedDictionary(rewritten, entries) !== msg.content) return noOp;
  }

  // -- 6. Net-savings gate against real (not estimated) token counts --
  const preambleText = renderPreamble(entries);
  let saved = 0;
  for (const [msg, rewritten] of rewrites) {
    saved += countTokens(msg.content, model) - countTokens(rewritten, model);
  }
  const preambleCost = countTokens(preambleText, model);
  const net = saved - preambleCost;
  if (net <= 0) return noOp;

  // -- 7. Commit --
  for (const [msg, rewritten] of rewrites) {
    msg.content = rewritten;
    msg.currentTokens = countTokens(rewritten, model);
  }

  const preamble: ContextMessage = {
    role: 'system',
    content: preambleText,
    turn: 0,
    originalTokens: preambleCost,
    currentTokens: preambleCost,
    addedAt: 0,
  };

  return { preamble, savedTokens: Math.max(0, net), entries };
}

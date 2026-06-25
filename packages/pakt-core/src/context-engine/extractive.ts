/**
 * @module context-engine/extractive
 * Query-aware extractive selection — keep the lines of a tool result that are
 * relevant to the current query, drop the rest, leave a retrievable marker.
 *
 * This is the one **lossy** layer in the engine, but it is *faithful*: every
 * kept line is verbatim from the source (selection, not generation), so it
 * cannot hallucinate. Dropped runs are replaced by a single marker that names
 * how many lines were elided and that they were not relevant to the query —
 * an explicit, source-anchored signal the agent can act on (re-read the file)
 * rather than a silent truncation.
 *
 * Research basis: extractive compression consistently beats token-pruning and
 * abstractive summarization on faithfulness and accuracy retention
 * (Jha et al. 2024, hf.co/papers/2407.08892), and source-anchored selection
 * avoids the hallucination that free-form summaries introduce
 * (hf.co/papers/2512.14244).
 *
 * Scoring is deterministic and model-free: query terms are weighted by inverse
 * document frequency across the result's own lines, so a rare identifier the
 * query mentions pulls its line in while ubiquitous boilerplate does not.
 */

import { countTokens } from '../tokens/index.js';

/** Options for {@link extractRelevant}. */
export interface ExtractiveOptions {
  /** The query whose relevant lines should be kept. */
  query: string;
  /** Model identifier for token counting. */
  model: string;
  /**
   * Keep a line when its relevance score is at least this fraction of the top
   * line's score. 0 keeps every line with any query-term overlap; higher values
   * prune more aggressively. @default 0
   */
  minScoreRatio?: number;
  /** Always keep at least this many highest-scoring lines. @default 3 */
  minKeep?: number;
  /** Never keep more than this many lines (0 = unlimited). @default 0 */
  maxKeep?: number;
}

/** Result of {@link extractRelevant}. */
export interface ExtractiveResult {
  /** Reduced content with elision markers, or the original if nothing was dropped. */
  text: string;
  /** Total candidate lines considered. */
  unitsTotal: number;
  /** Lines kept verbatim. */
  unitsKept: number;
  /** Lines dropped (folded into markers). */
  unitsDropped: number;
  /** Net tokens saved (>= 0; 0 means no reduction was applied). */
  savedTokens: number;
}

/** Common words that carry no retrieval signal. */
const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'to',
  'in',
  'on',
  'for',
  'and',
  'or',
  'is',
  'are',
  'was',
  'were',
  'be',
  'this',
  'that',
  'it',
  'as',
  'at',
  'by',
  'with',
  'what',
  'which',
  'who',
  'how',
  'many',
  'does',
  'do',
  'did',
  'has',
  'have',
  'from',
  'into',
  'about',
  'there',
  'any',
  'all',
  'show',
  'me',
  'find',
  'get',
  'list',
]);

/** Tokenize text into lowercase salient terms (alphanumeric, length >= 2, no stopwords). */
function termsOf(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9_]+/)) {
    if (raw.length < 2) continue;
    if (STOPWORDS.has(raw)) continue;
    out.push(raw);
  }
  return out;
}

/**
 * Score each line by the IDF-weighted overlap of its terms with the query.
 *
 * IDF is computed over the result's own lines: a query term that appears in
 * few lines is highly discriminative and weighted up; a term in every line
 * (boilerplate) contributes almost nothing. Returns one score per input line.
 */
function scoreLines(lines: string[], queryTerms: Set<string>): number[] {
  const n = lines.length;
  const lineTerms = lines.map((l) => termsOf(l));

  // Document frequency of each query term across lines.
  const df = new Map<string, number>();
  for (const term of queryTerms) df.set(term, 0);
  for (const terms of lineTerms) {
    const seen = new Set<string>();
    for (const t of terms) {
      if (queryTerms.has(t) && !seen.has(t)) {
        seen.add(t);
        df.set(t, (df.get(t) ?? 0) + 1);
      }
    }
  }

  // idf(term) = ln(1 + N / (1 + df)); rare terms score higher.
  const idf = new Map<string, number>();
  for (const [term, freq] of df) idf.set(term, Math.log(1 + n / (1 + freq)));

  return lineTerms.map((terms) => {
    let score = 0;
    const counted = new Set<string>();
    for (const t of terms) {
      if (queryTerms.has(t) && !counted.has(t)) {
        counted.add(t);
        score += idf.get(t) ?? 0;
      }
    }
    return score;
  });
}

/** Render an elision marker for a contiguous run of `count` dropped lines. */
function elisionMarker(count: number): string {
  return `… ${String(count)} line${count === 1 ? '' : 's'} elided (not relevant to query; re-read source to retrieve) …`;
}

/**
 * Keep the query-relevant lines of `content`, dropping the rest into elision
 * markers. Lossy but faithful — kept lines are verbatim from the source.
 *
 * Returns the original content unchanged when the query has no salient terms,
 * when nothing can be dropped, or when the reduction would not save tokens.
 *
 * @param content - The tool-result text to reduce.
 * @param opts - {@link ExtractiveOptions}.
 * @returns {@link ExtractiveResult}
 */
export function extractRelevant(content: string, opts: ExtractiveOptions): ExtractiveResult {
  const { query, model } = opts;
  const minScoreRatio = opts.minScoreRatio ?? 0;
  const minKeep = opts.minKeep ?? 3;
  const maxKeep = opts.maxKeep ?? 0;

  const lines = content.split('\n');
  const noOp: ExtractiveResult = {
    text: content,
    unitsTotal: lines.length,
    unitsKept: lines.length,
    unitsDropped: 0,
    savedTokens: 0,
  };

  const queryTerms = new Set(termsOf(query));
  if (queryTerms.size === 0) return noOp;
  if (lines.length <= minKeep) return noOp;

  const scores = scoreLines(lines, queryTerms);
  const topScore = Math.max(...scores);
  if (topScore <= 0) return noOp; // query is orthogonal to the content — keep all

  // Decide which line indices to keep: any line above the relative threshold,
  // then top up to `minKeep` by score, then cap at `maxKeep` if set.
  const threshold = topScore * minScoreRatio;
  const keep = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (
      scores[i] !== undefined &&
      (scores[i] as number) > 0 &&
      (scores[i] as number) >= threshold
    ) {
      keep.add(i);
    }
  }
  // Top up to minKeep using the highest remaining scores.
  if (keep.size < minKeep) {
    const order = lines
      .map((_, i) => i)
      .filter((i) => !keep.has(i))
      .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
    for (const i of order) {
      if (keep.size >= minKeep) break;
      keep.add(i);
    }
  }
  // Cap at maxKeep (keep the highest-scoring), if configured.
  if (maxKeep > 0 && keep.size > maxKeep) {
    const ranked = Array.from(keep).sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
    keep.clear();
    for (const i of ranked.slice(0, maxKeep)) keep.add(i);
  }

  if (keep.size >= lines.length) return noOp; // nothing dropped

  // Rebuild, folding contiguous dropped runs into a single marker.
  const out: string[] = [];
  let run = 0;
  let dropped = 0;
  for (let i = 0; i < lines.length; i++) {
    if (keep.has(i)) {
      if (run > 0) {
        out.push(elisionMarker(run));
        dropped += run;
        run = 0;
      }
      out.push(lines[i] ?? '');
    } else {
      run++;
    }
  }
  if (run > 0) {
    out.push(elisionMarker(run));
    dropped += run;
  }

  const text = out.join('\n');
  const savedTokens = countTokens(content, model) - countTokens(text, model);
  if (savedTokens <= 0) return noOp; // markers cost more than they saved

  return {
    text,
    unitsTotal: lines.length,
    unitsKept: keep.size,
    unitsDropped: dropped,
    savedTokens,
  };
}

/**
 * @module layers/compress-text-phrases
 * Word n-gram phrase detection + alias assignment for plain-text compression.
 *
 * Split out of `compress-text.ts` to keep each file under the 400-line cap.
 * Pure helpers — only consumed by `compress-text.ts`.
 */

import { replaceAll } from '../utils/replace-all.js';
import { aliasForIndex, estimateTokens } from './L2-scoring.js';

/** Minimum occurrences for a phrase to be considered. */
const MIN_PHRASE_OCCURRENCES = 2;

/** N-gram sizes to scan, longest first for greedy dominance. */
const NGRAM_SIZES = [8, 7, 6, 5, 4, 3, 2] as const;

/** Maximum aliases we can assign (`$a`-`$z`, `$aa`-`$az`). */
const MAX_ALIASES = 52;

/** A candidate phrase with its score and occurrence count. */
export interface PhraseCandidate {
  /** The literal phrase string (joined words with spaces). */
  phrase: string;
  /** How many times the phrase appears in the text. */
  occurrences: number;
  /** Estimated net token savings (pre-screening score). */
  score: number;
}

/** Word-with-source-index from {@link extractWords}. */
interface WordRef {
  word: string;
  index: number;
}

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

/**
 * Split text into interleaved word + whitespace tokens.
 *
 * Reassembling all tokens in order reproduces the original text exactly.
 *
 * @param text - Raw input text
 * @returns Array of token strings (words and whitespace interleaved)
 */
export function tokenizeWords(text: string): string[] {
  const tokens: string[] = [];
  for (const m of text.matchAll(/(\S+|\s+)/g)) {
    tokens.push(m[0]);
  }
  return tokens;
}

/**
 * Extract only the word tokens (non-whitespace) with their original indices.
 *
 * @param tokens - Full token array from {@link tokenizeWords}
 * @returns Array of `{ word, index }` where `index` is into the tokens array
 */
export function extractWords(tokens: string[]): WordRef[] {
  const words: WordRef[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t && t.trim().length > 0) {
      words.push({ word: t, index: i });
    }
  }
  return words;
}

// ---------------------------------------------------------------------------
// Alias collision detection
// ---------------------------------------------------------------------------

/**
 * Scan text for existing `$[a-z]{1,2}` patterns so we don't collide.
 *
 * Two-character matches also reserve their single-char prefix (so a literal
 * `$abc` blocks both `$ab` and `$a`).
 *
 * @param text - The input text to scan
 * @returns Set of alias strings already present (e.g. `$a`, `$ab`)
 */
export function findExistingAliases(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(/\$[a-z]{1,2}/g)) {
    found.add(m[0]);
    if (m[0].length === 3) {
      found.add(m[0].slice(0, 2));
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Candidate detection
// ---------------------------------------------------------------------------

/** Count word n-grams of size `n`. Returns `phrase -> occurrences`. */
function countNgrams(words: WordRef[], n: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i <= words.length - n; i++) {
    const phraseWords = words.slice(i, i + n).map((w) => w.word);
    const phrase = phraseWords.join(' ');
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  return counts;
}

/**
 * Score one phrase: net token savings if aliased, accounting for dict overhead.
 *
 * `(estimateTokens(phrase) - 1) * occurrences - (estimateTokens(phrase) + 3)`
 *  - `-1`: alias token replaces the phrase
 *  - `+3`: dict entry overhead (`alias: phrase\n`)
 */
function scorePhrase(phrase: string, occurrences: number): number {
  const phraseToks = estimateTokens(phrase);
  return (phraseToks - 1) * occurrences - (phraseToks + 3);
}

/**
 * Build word n-grams and score them for alias potential.
 *
 * For each n-gram size (8 down to 2), extracts all consecutive word
 * sequences, counts occurrences, and scores by estimated token savings.
 *
 * @param text - The full input text
 * @param words - Word tokens extracted from the text
 * @returns Sorted candidate list (highest score first)
 */
export function buildCandidates(text: string, words: WordRef[]): PhraseCandidate[] {
  const candidates: PhraseCandidate[] = [];

  for (const n of NGRAM_SIZES) {
    if (words.length < n) continue;
    const counts = countNgrams(words, n);

    for (const [phrase, occurrences] of counts) {
      if (occurrences < MIN_PHRASE_OCCURRENCES) continue;
      // Phrase joined with single space may not match the original
      // whitespace; verify it actually appears as-is before keeping it.
      if (text.indexOf(phrase) === -1) continue;
      const score = scorePhrase(phrase, occurrences);
      if (score > 0) {
        candidates.push({ phrase, occurrences, score });
      }
    }
  }

  // Sort by score descending, then by phrase length descending for stability.
  candidates.sort((a, b) => b.score - a.score || b.phrase.length - a.phrase.length);
  return candidates;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Remove shorter phrases dominated by longer phrases with `>=` occurrences.
 *
 * A shorter candidate is "dominated" if a longer already-selected phrase
 * contains it as a substring and appears at least as often.
 *
 * @param candidates - Scored candidates sorted by score
 * @returns Deduplicated list, re-sorted by score for greedy selection
 */
export function deduplicateCandidates(candidates: PhraseCandidate[]): PhraseCandidate[] {
  // Sort by phrase length descending first for dominance checks.
  const byLength = [...candidates].sort(
    (a, b) => b.phrase.length - a.phrase.length || b.score - a.score,
  );

  const kept: PhraseCandidate[] = [];
  for (const c of byLength) {
    let dominated = false;
    for (const longer of kept) {
      if (
        longer.phrase.length > c.phrase.length &&
        longer.phrase.includes(c.phrase) &&
        longer.occurrences >= c.occurrences
      ) {
        dominated = true;
        break;
      }
    }
    if (!dominated) kept.push(c);
  }

  kept.sort((a, b) => b.score - a.score || b.phrase.length - a.phrase.length);
  return kept;
}

// ---------------------------------------------------------------------------
// Greedy selection + application
// ---------------------------------------------------------------------------

/** A selected `alias -> phrase` mapping. */
export interface AliasEntry {
  alias: string;
  phrase: string;
}

/**
 * Greedily select and apply phrase aliases to the text.
 *
 * Walks through deduplicated candidates in score order, assigns an alias
 * for each, and replaces all occurrences in the working text. Skips
 * candidates whose alias would collide with an existing pattern.
 *
 * @param text - The working text
 * @param candidates - Deduplicated phrase candidates
 * @param reserved - Aliases already present in the text
 * @returns Object with the transformed text and the alias definitions
 */
export function applyAliases(
  text: string,
  candidates: PhraseCandidate[],
  reserved: Set<string>,
): { text: string; aliases: AliasEntry[] } {
  const aliases: AliasEntry[] = [];
  let working = text;
  let aliasIdx = 0;

  for (const c of candidates) {
    if (aliases.length >= MAX_ALIASES) break;

    // Skip to a non-colliding alias index.
    while (aliasIdx < MAX_ALIASES && reserved.has(aliasForIndex(aliasIdx))) {
      aliasIdx++;
    }
    if (aliasIdx >= MAX_ALIASES) break;

    // Verify the phrase still exists in the working text — earlier
    // replacements may have consumed overlapping occurrences.
    if (working.indexOf(c.phrase) === -1) continue;

    const alias = aliasForIndex(aliasIdx);
    working = replaceAll(working, c.phrase, alias);
    aliases.push({ alias, phrase: c.phrase });
    aliasIdx++;
  }

  return { text: working, aliases };
}

// ---------------------------------------------------------------------------
// Header builder
// ---------------------------------------------------------------------------

/**
 * Build the alias definition header block.
 *
 * Format:
 * ```
 * @dict
 *   $a: The engineering team
 *   $b: machine learning
 * @end
 * ```
 *
 * @param aliases - Alias definitions in assignment order
 * @returns The header string (with trailing newline)
 */
export function buildHeader(aliases: AliasEntry[]): string {
  const lines = ['@dict'];
  for (const { alias, phrase } of aliases) {
    lines.push(`  ${alias}: ${phrase}`);
  }
  lines.push('@end');
  return `${lines.join('\n')}\n`;
}

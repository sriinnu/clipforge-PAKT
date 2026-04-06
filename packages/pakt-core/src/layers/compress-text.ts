/**
 * @module layers/compress-text
 * Word-boundary-aligned phrase compression for plain text.
 *
 * Detects repeated word n-grams (2-8 words) across the input, assigns
 * short `$a`-`$az` aliases, and produces a header block + compressed body.
 * Uses {@link estimateTokens} for fast candidate pre-screening and
 * {@link countTokens} for final savings validation.
 *
 * Public API: {@link compressText} — same contract as the structural
 * compression pipeline but operates on raw text instead of parsed AST.
 */

import { countTokens } from '../tokens/index.js';
import { replaceAll } from '../utils/replace-all.js';
import { aliasForIndex, estimateTokens } from './L2-scoring.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum input size (100 KB). Inputs beyond this are returned as-is. */
export const MAX_TEXT_INPUT_SIZE = 100 * 1024;

/** Minimum occurrences for a phrase to be considered. */
const MIN_PHRASE_OCCURRENCES = 2;

/** Marker for deduplicated lines: @L<first-occurrence-line-number> */
const LINE_DEDUP_PREFIX = '@L';

// ---------------------------------------------------------------------------
// Pre-processing: line dedup + whitespace normalization
// ---------------------------------------------------------------------------

/** Metadata needed to restore original whitespace exactly. */
interface WhitespaceMetadata {
  /** Lines that had trailing whitespace: [lineNum, trailingChars] */
  trailing: Array<[number, string]>;
  /** Consecutive blank line groups: [startLine, count] */
  blankRuns: Array<[number, number]>;
}

/**
 * Normalize whitespace and deduplicate identical lines.
 * Returns the normalized text + metadata needed for lossless restoration.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: preprocessing combines whitespace normalization, blank line collapsing, and line dedup in a single pass
function preprocess(input: string): {
  text: string;
  wsMeta: WhitespaceMetadata | null;
  lineMap: Map<number, number> | null;
  originalLines: string[];
} {
  const originalLines = input.split('\n');

  // Step 1: Whitespace normalization — strip trailing whitespace per line
  const trailing: Array<[number, string]> = [];
  const stripped: string[] = [];
  for (let i = 0; i < originalLines.length; i++) {
    const line = originalLines[i] ?? '';
    const trimmed = line.replace(/\s+$/, '');
    if (trimmed.length < line.length) {
      trailing.push([i, line.slice(trimmed.length)]);
    }
    stripped.push(trimmed);
  }

  // Step 2: Collapse consecutive blank lines to single blank line
  const blankRuns: Array<[number, number]> = [];
  const collapsed: string[] = [];
  let i = 0;
  while (i < stripped.length) {
    const line = stripped[i] ?? '';
    if (line === '' && i + 1 < stripped.length && stripped[i + 1] === '') {
      // Start of a blank run
      const start = collapsed.length;
      let count = 0;
      while (i < stripped.length && stripped[i] === '') {
        count++;
        i++;
      }
      blankRuns.push([start, count]);
      collapsed.push(''); // Single blank line represents the run
    } else {
      collapsed.push(line);
      i++;
    }
  }

  // Step 3: Line dedup — find duplicate lines, replace with @L<N> reference
  const firstOccurrence = new Map<string, number>();
  const lineMap = new Map<number, number>(); // dedupedLine → firstOccurrenceLine
  const deduped: string[] = [];

  for (let j = 0; j < collapsed.length; j++) {
    const line = collapsed[j] ?? '';
    // Skip blank lines and very short lines (not worth deduping)
    if (line.length < 10) {
      deduped.push(line);
      continue;
    }
    const existing = firstOccurrence.get(line);
    if (existing !== undefined) {
      deduped.push(`${LINE_DEDUP_PREFIX}${existing}`);
      lineMap.set(j, existing);
    } else {
      firstOccurrence.set(line, j);
      deduped.push(line);
    }
  }

  const hasWsChanges = trailing.length > 0 || blankRuns.length > 0;
  const hasDedup = lineMap.size > 0;

  if (!hasWsChanges && !hasDedup) {
    return { text: input, wsMeta: null, lineMap: null, originalLines };
  }

  return {
    text: deduped.join('\n'),
    wsMeta: hasWsChanges ? { trailing, blankRuns } : null,
    lineMap: hasDedup ? lineMap : null,
    originalLines,
  };
}

/** N-gram sizes to scan, longest first for greedy dominance. */
const NGRAM_SIZES = [8, 7, 6, 5, 4, 3, 2] as const;

/** Maximum aliases we can assign ($a-$z, $aa-$az). */
const MAX_ALIASES = 52;

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * Result of plain-text compression.
 *
 * `null` is returned when compression yields no token savings.
 */
export interface TextCompressResult {
  /** The compressed text with alias header prepended. */
  compressed: string;
  /** Alias definitions mapping alias -> phrase. */
  aliases: Array<{ alias: string; phrase: string }>;
  /** Original token count. */
  originalTokens: number;
  /** Compressed token count. */
  compressedTokens: number;
}

// ---------------------------------------------------------------------------
// Alias collision detection
// ---------------------------------------------------------------------------

/**
 * Scan text for existing `$[a-z]{1,2}` patterns so we don't collide.
 *
 * @param text - The input text to scan
 * @returns Set of alias strings already present (e.g. `$a`, `$ab`)
 */
function findExistingAliases(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(/\$[a-z]{1,2}/g)) {
    found.add(m[0]);
    // Also reserve the single-char prefix to prevent $a matching inside $abc
    if (m[0].length === 3) {
      found.add(m[0].slice(0, 2));
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Word tokenization
// ---------------------------------------------------------------------------

/**
 * Split text into words and whitespace tokens.
 *
 * Each token is either a word (non-whitespace) or a delimiter (whitespace).
 * Reassembling all tokens reproduces the original text exactly.
 *
 * @param text - Raw input text
 * @returns Array of token strings (words and whitespace interleaved)
 */
function tokenizeWords(text: string): string[] {
  const tokens: string[] = [];
  for (const m of text.matchAll(/(\S+|\s+)/g)) {
    tokens.push(m[0]);
  }
  return tokens;
}

/**
 * Extract only the word tokens (non-whitespace) with their indices.
 *
 * @param tokens - Full token array from {@link tokenizeWords}
 * @returns Array of `{ word, index }` where index is into the tokens array
 */
function extractWords(tokens: string[]): Array<{ word: string; index: number }> {
  const words: Array<{ word: string; index: number }> = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t && t.trim().length > 0) {
      words.push({ word: t, index: i });
    }
  }
  return words;
}

// ---------------------------------------------------------------------------
// Phrase candidate detection
// ---------------------------------------------------------------------------

/** A candidate phrase with its score and occurrence count. */
interface PhraseCandidate {
  /** The literal phrase string (joined words with spaces). */
  phrase: string;
  /** How many times the phrase appears in the text. */
  occurrences: number;
  /** Estimated net token savings (pre-screening score). */
  score: number;
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
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: n-gram extraction requires nested iteration
function buildCandidates(
  text: string,
  words: Array<{ word: string; index: number }>,
): PhraseCandidate[] {
  const candidates: PhraseCandidate[] = [];

  for (const n of NGRAM_SIZES) {
    if (words.length < n) continue;

    // I count how many times each word n-gram appears by hashing the phrase.
    const counts = new Map<string, number>();
    for (let i = 0; i <= words.length - n; i++) {
      const phraseWords = words.slice(i, i + n).map((w) => w.word);
      const phrase = phraseWords.join(' ');
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }

    for (const [phrase, occurrences] of counts) {
      if (occurrences < MIN_PHRASE_OCCURRENCES) continue;

      // Quick check: phrase must actually appear in the original text as-is.
      // Word n-grams joined with single space might not match the original
      // whitespace, so I verify with indexOf.
      if (text.indexOf(phrase) === -1) continue;

      // Score: (estimateTokens(phrase) - 1) * occurrences - (estimateTokens(phrase) + 3)
      // The -1 accounts for the alias token replacing the phrase.
      // The +3 accounts for the dict entry overhead (alias: phrase\n).
      const phraseToks = estimateTokens(phrase);
      const score = (phraseToks - 1) * occurrences - (phraseToks + 3);
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
 * Remove shorter phrases dominated by longer phrases with >= occurrences.
 *
 * A shorter candidate is "dominated" if a longer already-selected phrase
 * contains it as a substring and appears at least as often.
 *
 * @param candidates - Scored candidates sorted by score
 * @returns Deduplicated list
 */
function deduplicateCandidates(candidates: PhraseCandidate[]): PhraseCandidate[] {
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

  // Re-sort by score for greedy selection.
  kept.sort((a, b) => b.score - a.score || b.phrase.length - a.phrase.length);
  return kept;
}

// ---------------------------------------------------------------------------
// Greedy selection + application
// ---------------------------------------------------------------------------

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
function applyAliases(
  text: string,
  candidates: PhraseCandidate[],
  reserved: Set<string>,
): { text: string; aliases: Array<{ alias: string; phrase: string }> } {
  const aliases: Array<{ alias: string; phrase: string }> = [];
  let working = text;
  let aliasIdx = 0;

  for (const c of candidates) {
    if (aliases.length >= MAX_ALIASES) break;

    // Skip to a non-colliding alias index.
    while (aliasIdx < MAX_ALIASES && reserved.has(aliasForIndex(aliasIdx))) {
      aliasIdx++;
    }
    if (aliasIdx >= MAX_ALIASES) break;

    // Verify the phrase still exists in the working text (previous
    // replacements may have consumed overlapping occurrences).
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
function buildHeader(aliases: Array<{ alias: string; phrase: string }>): string {
  const lines = ['@dict'];
  for (const { alias, phrase } of aliases) {
    lines.push(`  ${alias}: ${phrase}`);
  }
  lines.push('@end');
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compress plain text by detecting and aliasing repeated word n-gram phrases.
 *
 * Algorithm:
 * 1. Tokenize input into words (preserving whitespace for reconstruction).
 * 2. For n-gram sizes 8 down to 2, extract all word n-grams and count.
 * 3. Score candidates by estimated token savings; keep score > 0.
 * 4. Deduplicate: longer phrases containing shorter ones with >= occurrences dominate.
 * 5. Greedy selection: apply top candidates, skip colliding aliases.
 * 6. Final validation: use real tokenizer to confirm savings.
 *
 * Returns `null` when compression yields no token savings.
 *
 * @param input - Raw text to compress
 * @param format - Source format label (used in `@from` header)
 * @returns Compression result or `null` if no savings
 *
 * @example
 * ```ts
 * const result = compressText(longText, 'text');
 * if (result) {
 *   console.log(`Saved ${result.originalTokens - result.compressedTokens} tokens`);
 * }
 * ```
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: text compression orchestrates preprocessing, detection, and application
export function compressText(input: string, format: string): TextCompressResult | null {
  // Guard: empty or oversized input
  if (!input || input.length === 0 || input.length > MAX_TEXT_INPUT_SIZE) {
    return null;
  }

  const originalTokens = countTokens(input);

  // Pre-processing: whitespace normalization + line dedup
  const pp = preprocess(input);

  // Build metadata header for lossless restoration
  const metaLines: string[] = [];
  if (pp.wsMeta) {
    if (pp.wsMeta.trailing.length > 0) {
      metaLines.push(
        `@ws-trail ${pp.wsMeta.trailing.map(([l, s]) => `${l}:${encodeWs(s)}`).join(',')}`,
      );
    }
    if (pp.wsMeta.blankRuns.length > 0) {
      metaLines.push(`@ws-blanks ${pp.wsMeta.blankRuns.map(([l, c]) => `${l}:${c}`).join(',')}`);
    }
  }

  // Try dictionary compression on the preprocessed text
  const textForDict = pp.text;
  const allTokens = tokenizeWords(textForDict);
  const words = extractWords(allTokens);

  let aliases: Array<{ alias: string; phrase: string }> = [];
  let body = textForDict;

  if (words.length >= 2) {
    const reserved = findExistingAliases(textForDict);
    const raw = buildCandidates(textForDict, words);
    if (raw.length > 0) {
      const deduped = deduplicateCandidates(raw);
      if (deduped.length > 0) {
        const result = applyAliases(textForDict, deduped, reserved);
        if (result.aliases.length > 0) {
          aliases = result.aliases;
          body = result.text;
        }
      }
    }
  }

  // If no compression layers produced any changes, bail
  const hasDict = aliases.length > 0;
  const hasMeta = metaLines.length > 0;
  const hasLineDedup = pp.lineMap !== null && pp.lineMap.size > 0;
  if (!hasDict && !hasMeta && !hasLineDedup) return null;

  // Assemble compressed output
  const headerParts: string[] = [`@from ${format}`];
  if (hasMeta) headerParts.push(...metaLines);
  if (hasDict) headerParts.push(buildHeader(aliases).trimEnd());
  const header = headerParts.join('\n');
  const compressed = `${header}\n${body}`;

  // Final validation with real tokenizer
  const compressedTokens = countTokens(compressed);
  if (compressedTokens >= originalTokens) return null;

  return { compressed, aliases, originalTokens, compressedTokens };
}

/** Encode whitespace characters for the @ws-trail metadata line. */
function encodeWs(ws: string): string {
  return ws.replace(/ /g, 's').replace(/\t/g, 't').replace(/\r/g, 'r');
}

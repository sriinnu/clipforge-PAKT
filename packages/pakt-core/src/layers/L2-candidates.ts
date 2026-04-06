/**
 * @module layers/L2-candidates
 * Pattern detection for L2 dictionary compression.
 *
 * Implements four detection strategies:
 * - **Prefix**: sorted-adjacency scan for shared string starts
 * - **Suffix**: reverse-sort scan for shared string ends
 * - **Substring**: sliding-window n-gram mining for arbitrary shared fragments
 *
 * Each strategy produces {@link AliasCandidate} entries scored by net token
 * savings. The candidates feed into the greedy selection pass in L2-dictionary.
 */

import {
  MIN_PREFIX_LENGTH,
  MIN_PREFIX_OCCURRENCES,
  MIN_SUFFIX_LENGTH,
  MIN_SUFFIX_OCCURRENCES,
  SUBSTRING_WINDOW_SIZES,
  estimateTokens,
} from './L2-scoring.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Candidate for dictionary aliasing.
 *
 * candidateType determines how the pattern is applied:
 * - `exact`:     whole-value replacement ($alias)
 * - `prefix`:    start-of-value replacement (${alias}rest)
 * - `suffix`:    end-of-value replacement (rest${alias})
 * - `substring`: arbitrary-position replacement (before${alias}after)
 *
 * All inline types (prefix/suffix/substring) use the same ${alias} syntax
 * and share decompression logic.
 */
export interface AliasCandidate {
  value: string;
  occurrences: number;
  netSavings: number;
  candidateType: 'exact' | 'prefix' | 'suffix' | 'substring';
}

// ---------------------------------------------------------------------------
// Prefix detection
// ---------------------------------------------------------------------------

/**
 * Find common prefixes among string values that would benefit from aliasing.
 * Values that already have exact-match duplicates are excluded.
 * Uses sorted-adjacency comparison to efficiently find shared prefixes.
 *
 * @param values - All string values (may include duplicates)
 * @param exactDups - Values already handled by exact dedup
 * @param minSavings - Minimum net token savings threshold
 * @returns Array of prefix alias candidates
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: prefix detection uses sorted-adjacency scan with dominance pruning
export function findPrefixCandidates(
  values: string[],
  exactDups: ReadonlySet<string>,
  minSavings: number,
): AliasCandidate[] {
  // Filter out values already handled by exact dedup, and values too short
  const unique = [
    ...new Set(values.filter((v) => !exactDups.has(v) && v.length >= MIN_PREFIX_LENGTH)),
  ];
  if (unique.length < MIN_PREFIX_OCCURRENCES) return [];

  // Sort values to bring similar strings adjacent
  unique.sort();

  // Find common prefixes between adjacent sorted values
  const prefixCounts = new Map<string, number>();
  for (let i = 0; i < unique.length - 1; i++) {
    const a = unique[i];
    const b = unique[i + 1];
    if (a === undefined || b === undefined) continue;
    let len = 0;
    while (len < a.length && len < b.length && a[len] === b[len]) len++;
    if (len >= MIN_PREFIX_LENGTH) {
      const prefix = a.slice(0, len);
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }
  }

  // Now count actual occurrences of each prefix across ALL values (not just unique)
  // and pick the best (longest, most frequent)
  const prefixOccurrences = new Map<string, number>();
  for (const [prefix] of prefixCounts) {
    let count = 0;
    for (const v of values) {
      if (!exactDups.has(v) && v.startsWith(prefix) && v.length > prefix.length) count++;
    }
    if (count >= MIN_PREFIX_OCCURRENCES) {
      prefixOccurrences.set(prefix, count);
    }
  }

  // Remove shorter prefixes subsumed by longer ones with equal-or-greater coverage.
  // A shorter prefix is only dominated if a longer prefix covers at least as many
  // values — otherwise the shorter prefix serves the uncovered majority.
  const sortedPrefixes = [...prefixOccurrences.entries()].sort((a, b) => b[0].length - a[0].length);
  const kept = new Map<string, number>();
  for (const [prefix, count] of sortedPrefixes) {
    let dominated = false;
    for (const [keptPrefix, keptCount] of kept) {
      if (keptPrefix.startsWith(prefix) && keptCount >= count) {
        dominated = true;
        break;
      }
    }
    if (!dominated) kept.set(prefix, count);
  }

  // Score candidates: each occurrence saves (prefixTokens - aliasTokens) tokens
  // Cost: dict entry line = aliasTokens + prefixTokens + ~3 tokens overhead
  const candidates: AliasCandidate[] = [];
  for (const [prefix, occurrences] of kept) {
    const prefixTok = estimateTokens(prefix);
    // Each occurrence: original value includes prefix tokens, with alias it's ~2 tokens (${a})
    const perOccSaved = prefixTok - 1; // save prefixTok tokens, add ~1 for ${a}
    const dictCost = prefixTok + 3; // alias definition cost
    const netSavings = perOccSaved * occurrences - dictCost;
    if (netSavings >= minSavings) {
      candidates.push({ value: prefix, occurrences, netSavings, candidateType: 'prefix' });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Suffix detection
// ---------------------------------------------------------------------------

/**
 * Find common suffixes among string values that would benefit from aliasing.
 * Mirrors prefix detection: reverses all strings, sorts, finds shared
 * prefixes of reversed strings (= shared suffixes of originals).
 *
 * @param values - All string values (may include duplicates)
 * @param exactDups - Values already handled by exact dedup
 * @param otherPatterns - Patterns already discovered (to avoid overlap)
 * @param minSavings - Minimum net token savings threshold
 * @returns Array of suffix alias candidates
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: suffix detection mirrors prefix with reverse-sort scan
export function findSuffixCandidates(
  values: string[],
  exactDups: ReadonlySet<string>,
  otherPatterns: ReadonlySet<string>,
  minSavings: number,
): AliasCandidate[] {
  const unique = [
    ...new Set(values.filter((v) => !exactDups.has(v) && v.length >= MIN_SUFFIX_LENGTH)),
  ];
  if (unique.length < MIN_SUFFIX_OCCURRENCES) return [];

  // Reverse strings and sort to bring shared suffixes adjacent
  const reversed = unique.map((v) => ({ original: v, rev: [...v].reverse().join('') }));
  reversed.sort((a, b) => a.rev.localeCompare(b.rev));

  // Find common suffixes (= common prefixes of reversed strings)
  const suffixCounts = new Map<string, number>();
  for (let i = 0; i < reversed.length - 1; i++) {
    const a = reversed[i]?.rev;
    const b = reversed[i + 1]?.rev;
    let len = 0;
    while (len < a.length && len < b.length && a[len] === b[len]) len++;
    if (len >= MIN_SUFFIX_LENGTH) {
      const suffix = [...a.slice(0, len)].reverse().join('');
      suffixCounts.set(suffix, (suffixCounts.get(suffix) ?? 0) + 1);
    }
  }

  // Count actual occurrences across ALL values
  const suffixOccurrences = new Map<string, number>();
  for (const [suffix] of suffixCounts) {
    if (otherPatterns.has(suffix)) continue;
    let count = 0;
    for (const v of values) {
      if (!exactDups.has(v) && v.endsWith(suffix) && v.length > suffix.length) count++;
    }
    if (count >= MIN_SUFFIX_OCCURRENCES) {
      suffixOccurrences.set(suffix, count);
    }
  }

  // Remove dominated suffixes (shorter ones subsumed by longer ones with equal coverage)
  const sortedSuffixes = [...suffixOccurrences.entries()].sort((a, b) => b[0].length - a[0].length);
  const kept = new Map<string, number>();
  for (const [suffix, count] of sortedSuffixes) {
    let dominated = false;
    for (const [keptSuffix, keptCount] of kept) {
      if (keptSuffix.endsWith(suffix) && keptCount >= count) {
        dominated = true;
        break;
      }
    }
    if (!dominated) kept.set(suffix, count);
  }

  const candidates: AliasCandidate[] = [];
  for (const [suffix, occurrences] of kept) {
    const suffixTok = estimateTokens(suffix);
    const perOccSaved = suffixTok - 1;
    const dictCost = suffixTok + 3;
    const netSavings = perOccSaved * occurrences - dictCost;
    if (netSavings >= minSavings) {
      candidates.push({ value: suffix, occurrences, netSavings, candidateType: 'suffix' });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Substring detection
// ---------------------------------------------------------------------------

/**
 * Find frequent substrings across string values using sliding-window mining.
 *
 * For each window size in SUBSTRING_WINDOW_SIZES, extracts all substrings
 * and counts how many distinct values contain them. Uses a dynamic threshold
 * derived from information theory:
 *
 *   minOccurrences = ceil((tokens + 3) / (tokens - 1))
 *
 * where `tokens = ceil(length / 4)`. This ensures each alias saves more
 * than it costs (dictionary entry overhead).
 *
 * Substrings already discovered as prefix/suffix/exact are skipped.
 * Shorter substrings dominated by longer ones (same or higher frequency)
 * are pruned.
 *
 * @param values - All string values
 * @param existingPatterns - Patterns already discovered (exact/prefix/suffix)
 * @param minSavings - Minimum net token savings threshold
 * @returns Array of substring alias candidates
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: substring mining uses multi-window sliding scan
export function findSubstringCandidates(
  values: string[],
  existingPatterns: ReadonlySet<string>,
  minSavings: number,
): AliasCandidate[] {
  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length < 2) return [];

  // Count how many distinct values contain each substring.
  // "Value-level" frequency is the correct metric: it tells us how many
  // alias replacements we'll make (one per value per substring occurrence).
  const substringFreq = new Map<string, number>();

  for (const value of uniqueValues) {
    const seen = new Set<string>();
    for (const winSize of SUBSTRING_WINDOW_SIZES) {
      if (value.length < winSize) continue;
      for (let i = 0; i <= value.length - winSize; i++) {
        const sub = value.slice(i, i + winSize);
        if (seen.has(sub)) continue;
        seen.add(sub);
        substringFreq.set(sub, (substringFreq.get(sub) ?? 0) + 1);
      }
    }
  }

  // Filter by dynamic threshold and score
  const viable: AliasCandidate[] = [];
  for (const [sub, count] of substringFreq) {
    if (existingPatterns.has(sub)) continue;
    const subTok = estimateTokens(sub);
    const perOccSaved = subTok - 1;
    if (perOccSaved <= 0) continue;
    const dictCost = subTok + 3;
    // Information-theoretic break-even: ceil(dictCost / perOccSaved)
    const minOcc = Math.max(2, Math.ceil(dictCost / perOccSaved));
    if (count < minOcc) continue;
    const netSavings = perOccSaved * count - dictCost;
    if (netSavings >= minSavings) {
      viable.push({ value: sub, occurrences: count, netSavings, candidateType: 'substring' });
    }
  }

  // Remove dominated substrings: shorter ones that are always part of a longer one
  viable.sort((a, b) => b.value.length - a.value.length || b.netSavings - a.netSavings);
  const kept: AliasCandidate[] = [];
  for (const candidate of viable) {
    let dominated = false;
    for (const longer of kept) {
      if (longer.value.includes(candidate.value) && longer.occurrences >= candidate.occurrences) {
        dominated = true;
        break;
      }
    }
    if (!dominated) kept.push(candidate);
  }

  return kept;
}

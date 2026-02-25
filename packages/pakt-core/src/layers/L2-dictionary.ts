/**
 * @module layers/L2-dictionary
 * Layer 2: Dictionary-based pattern deduplication for PAKT AST.
 *
 * Detects four types of repeating patterns in scalar string values:
 *
 * 1. **Exact duplicates** — whole values that appear >=3 times -> `$alias`
 * 2. **Common prefixes** — shared string starts (e.g. URL bases) -> `${alias}suffix`
 * 3. **Common suffixes** — shared string ends (e.g. file extensions) -> `prefix${alias}`
 * 4. **Frequent substrings** — repeated n-grams at any position -> `before${alias}after`
 *
 * Scoring and candidate detection are in L2-scoring.ts and L2-candidates.ts.
 * Cloning utilities live in L2-clone.ts.
 * This module handles the greedy selection pass and public API.
 */

import type { DictBlockNode, DictEntryNode, DocumentNode, SourcePosition } from '../parser/ast.js';
import type { DictEntry } from '../types.js';
import type { AliasCandidate } from './L2-candidates.js';
import {
  findPrefixCandidates,
  findSubstringCandidates,
  findSuffixCandidates,
} from './L2-candidates.js';
import { cloneBody, cloneBodyIdentity, collectStringScalars } from './L2-clone.js';
import {
  DEFAULT_MIN_SAVINGS,
  MAX_ALIASES,
  MIN_OCCURRENCES,
  MIN_VALUE_LENGTH,
  aliasForIndex,
  estimateTokens,
} from './L2-scoring.js';

/** Synthetic source position for generated nodes. */
const synPos: SourcePosition = { line: 0, column: 0, offset: 0 };

// ---------------------------------------------------------------------------
// Main compression
// ---------------------------------------------------------------------------

/**
 * Compress a DocumentNode using L2 dictionary deduplication.
 *
 * Scans all unquoted string scalar values in the body, identifies repeated
 * values that would benefit from aliasing, creates a `@dict` block with
 * short aliases (`$a`-`$z`, `$aa`-`$az`), and replaces matched values
 * in the body with their aliases. Does NOT mutate the input.
 *
 * @param doc - The DocumentNode to compress (typically after L1)
 * @param minSavings - Minimum net token savings to create an alias (default 3)
 * @returns A new DocumentNode with dictionary block and aliased body values
 */
export function compressL2(
  doc: DocumentNode,
  minSavings: number = DEFAULT_MIN_SAVINGS,
): DocumentNode {
  const scalars = collectStringScalars(doc.body);
  const allScalars = collectStringScalars(doc.body, true);

  // -- 1. Exact-match candidates (unquoted only) --
  const freq = new Map<string, number>();
  for (const sc of scalars) {
    freq.set(sc.value, (freq.get(sc.value) ?? 0) + 1);
  }

  const candidates: AliasCandidate[] = [];
  const exactDups = new Set<string>();
  for (const [value, occurrences] of freq) {
    if (occurrences < MIN_OCCURRENCES || value.length < MIN_VALUE_LENGTH) continue;
    const vTok = estimateTokens(value);
    const netSavings = (vTok - 1) * occurrences - (vTok + 3);
    if (netSavings >= minSavings) {
      candidates.push({ value, occurrences, netSavings, candidateType: 'exact' });
      exactDups.add(value);
    }
  }

  // -- 2. Prefix candidates --
  const allValues = allScalars.map((sc) => sc.value);
  const prefixCandidates = findPrefixCandidates(allValues, exactDups, minSavings);
  candidates.push(...prefixCandidates);
  const prefixValues = new Set(prefixCandidates.map((c) => c.value));

  // -- 3. Suffix candidates --
  const suffixCandidates = findSuffixCandidates(allValues, exactDups, prefixValues, minSavings);
  candidates.push(...suffixCandidates);
  const suffixValues = new Set(suffixCandidates.map((c) => c.value));

  // -- 4. General substring candidates --
  const existingPatterns = new Set([...exactDups, ...prefixValues, ...suffixValues]);
  const substringCandidates = findSubstringCandidates(allValues, existingPatterns, minSavings);
  candidates.push(...substringCandidates);

  // -- No candidates -> passthrough clone --
  if (candidates.length === 0) {
    return {
      type: 'document',
      headers: [...doc.headers],
      dictionary: doc.dictionary,
      body: cloneBodyIdentity(doc.body),
      position: doc.position,
    };
  }

  // -- Global dedup: remove patterns subsumed by longer ones --
  candidates.sort((a, b) => b.value.length - a.value.length);
  const deduped: AliasCandidate[] = [];
  for (const c of candidates) {
    let dominated = false;
    for (const longer of deduped) {
      if (
        longer.value.length > c.value.length &&
        longer.value.includes(c.value) &&
        longer.occurrences >= c.occurrences
      ) {
        dominated = true;
        break;
      }
    }
    if (!dominated) deduped.push(c);
  }

  // -- Greedy simulation: select aliases that actually save tokens --
  deduped.sort((a, b) => b.netSavings - a.netSavings);
  const simValues = allValues.map((v) => v);
  const selected: AliasCandidate[] = [];
  for (const c of deduped) {
    if (selected.length >= MAX_ALIASES) break;
    if (c.candidateType === 'exact') {
      let effectiveOcc = 0;
      for (const v of simValues) {
        if (v === c.value) effectiveOcc++;
      }
      if (effectiveOcc < MIN_OCCURRENCES) continue;
      const tok = estimateTokens(c.value);
      const eff = (tok - 1) * effectiveOcc - (tok + 3);
      if (eff < minSavings) continue;
      selected.push({ ...c, occurrences: effectiveOcc, netSavings: eff });
      const placeholder = aliasForIndex(selected.length - 1);
      for (let i = 0; i < simValues.length; i++) {
        if (simValues[i] === c.value) simValues[i] = placeholder;
      }
    } else {
      let effectiveOcc = 0;
      for (const v of simValues) {
        if (v.includes(c.value)) effectiveOcc++;
      }
      if (effectiveOcc < 2) continue;
      const tok = estimateTokens(c.value);
      const perOccSaved = tok - 1;
      if (perOccSaved <= 0) continue;
      const eff = perOccSaved * effectiveOcc - (tok + 3);
      if (eff < minSavings) continue;
      selected.push({ ...c, occurrences: effectiveOcc, netSavings: eff });
      const placeholder = `\${${aliasForIndex(selected.length - 1).slice(1)}}`;
      for (let i = 0; i < simValues.length; i++) {
        if (simValues[i]!.includes(c.value)) {
          simValues[i] = simValues[i]!.split(c.value).join(placeholder);
        }
      }
    }
  }

  if (selected.length === 0) {
    return {
      type: 'document',
      headers: [...doc.headers],
      dictionary: doc.dictionary,
      body: cloneBodyIdentity(doc.body),
      position: doc.position,
    };
  }

  // -- Build replacement maps --
  const valueToAlias = new Map<string, string>();
  const substringToAlias = new Map<string, string>();
  const entries: DictEntryNode[] = [];
  for (let i = 0; i < selected.length; i++) {
    const c = selected[i]!;
    const alias = aliasForIndex(i);
    if (c.candidateType === 'exact') {
      valueToAlias.set(c.value, alias);
    } else {
      substringToAlias.set(c.value, alias);
    }
    entries.push({ type: 'dictEntry', alias, expansion: c.value, position: synPos });
  }

  const dictBlock: DictBlockNode = { type: 'dictBlock', entries, position: synPos };

  return {
    type: 'document',
    headers: [...doc.headers],
    dictionary: dictBlock,
    body: cloneBody(
      doc.body,
      valueToAlias,
      false,
      substringToAlias.size > 0 ? substringToAlias : undefined,
    ),
    position: doc.position,
  };
}

// ---------------------------------------------------------------------------
// Decompression
// ---------------------------------------------------------------------------

/**
 * Decompress a DocumentNode by expanding all L2 dictionary aliases.
 *
 * If no dictionary block is present, returns a clone unchanged.
 * Does NOT mutate the input.
 *
 * @param doc - The DocumentNode to decompress
 * @returns New DocumentNode with aliases expanded and dictionary set to null
 */
export function decompressL2(doc: DocumentNode): DocumentNode {
  if (doc.dictionary === null || doc.dictionary.entries.length === 0) {
    return {
      type: 'document',
      headers: [...doc.headers],
      dictionary: null,
      body: cloneBodyIdentity(doc.body),
      position: doc.position,
    };
  }

  const expansionMap = new Map<string, string>();
  for (const entry of doc.dictionary.entries) {
    expansionMap.set(entry.alias, entry.expansion);
  }

  return {
    type: 'document',
    headers: [...doc.headers],
    dictionary: null,
    body: cloneBody(doc.body, expansionMap, true),
    position: doc.position,
  };
}

// ---------------------------------------------------------------------------
// Dictionary extraction
// ---------------------------------------------------------------------------

/**
 * Extract DictEntry[] from a DocumentNode's dictionary block.
 *
 * Converts internal DictEntryNode[] to the public DictEntry[] type
 * (with `occurrences` and `tokensSaved`). Returns empty array if no dictionary.
 *
 * @param doc - A DocumentNode (typically after compressL2)
 * @returns Array of DictEntry with alias, expansion, occurrences, tokensSaved
 */
export function extractDictEntries(doc: DocumentNode): DictEntry[] {
  if (doc.dictionary === null || doc.dictionary.entries.length === 0) return [];

  // Collect both quoted and unquoted scalars to count all alias usages
  const scalars = collectStringScalars(doc.body, true);
  const aliasCount = new Map<string, number>();
  for (const sc of scalars) {
    // Exact alias usage ($a, $b, ...)
    if (sc.value.startsWith('$') && !sc.value.includes('{')) {
      aliasCount.set(sc.value, (aliasCount.get(sc.value) ?? 0) + 1);
    }
    // Inline alias usage (${a}, ${b}, ... at any position)
    if (sc.value.includes('${')) {
      for (const m of sc.value.matchAll(/\$\{([a-z]{1,2})\}/g)) {
        const alias = `$${m[1]!}`;
        aliasCount.set(alias, (aliasCount.get(alias) ?? 0) + 1);
      }
    }
  }

  return doc.dictionary.entries.map((entry): DictEntry => {
    const occ = aliasCount.get(entry.alias) ?? 0;
    const vTok = estimateTokens(entry.expansion);
    const saved = (vTok - 1) * occ - (vTok + 3);
    return {
      alias: entry.alias,
      expansion: entry.expansion,
      occurrences: occ,
      tokensSaved: Math.max(0, saved),
    };
  });
}

/**
 * @module layers/L2-dictionary
 * Layer 2: Dictionary-based pattern deduplication for PAKT AST.
 *
 * Detects four types of repeating patterns in scalar string values:
 *
 * 1. **Exact duplicates** — whole values that appear ≥3 times → `$alias`
 * 2. **Common prefixes** — shared string starts (e.g. URL bases) → `${alias}suffix`
 * 3. **Common suffixes** — shared string ends (e.g. file extensions) → `prefix${alias}`
 * 4. **Frequent substrings** — repeated n-grams at any position → `before${alias}after`
 *
 * Thresholds are derived from information theory: a pattern is worth an alias
 * when `occurrences × savings_per_use > dictionary_overhead`. The break-even
 * formula `min_occ = ceil((tokens + 3) / (tokens - 1))` ensures every alias
 * pays for itself.
 *
 * All inline patterns share the `${alias}` syntax and the same decompression
 * logic (global regex expansion), making this a lossless compression layer.
 */

import type {
  DocumentNode,
  BodyNode,
  ScalarNode,
  StringScalar,
  TabularRowNode,
  ListItemNode,
  DictBlockNode,
  DictEntryNode,
  SourcePosition,
} from '../parser/ast.js';
import type { DictEntry } from '../types.js';

const MAX_ALIASES = 52;
const DEFAULT_MIN_SAVINGS = 3;
const MIN_OCCURRENCES = 3;
const MIN_VALUE_LENGTH = 2;
const MIN_PREFIX_LENGTH = 8;
const MIN_PREFIX_OCCURRENCES = 3;
const MIN_SUFFIX_LENGTH = 6;
const MIN_SUFFIX_OCCURRENCES = 3;
/**
 * Window sizes for substring detection. Checked from longest to shortest.
 * Skipping intermediate sizes keeps complexity manageable while catching
 * the most impactful patterns (BPE-style heuristic).
 */
const SUBSTRING_WINDOW_SIZES = [32, 24, 20, 16, 12, 10, 8, 6];

/** Synthetic source position for generated nodes. */
const synPos: SourcePosition = { line: 0, column: 0, offset: 0 };

/**
 * Estimate BPE token count via heuristic: `ceil(length / 4)`.
 * @param value - String to estimate
 * @returns Estimated token count (>= 1)
 * @example
 * ```ts
 * estimateTokens('Engineering'); // 3
 * ```
 */
function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

/**
 * Generate alias string for index 0..51.
 * 0-25 => `$a`-`$z`, 26-51 => `$aa`-`$az`.
 * @example
 * ```ts
 * aliasForIndex(0);  // '$a'
 * aliasForIndex(26); // '$aa'
 * ```
 */
function aliasForIndex(index: number): string {
  if (index < 26) return '$' + String.fromCharCode(97 + index);
  return '$a' + String.fromCharCode(97 + (index - 26));
}

/**
 * Collect StringScalar nodes from body, recursively.
 * @param nodes - Body nodes to walk
 * @param includeQuoted - When true, also collect quoted strings (for prefix analysis)
 * @returns StringScalar references
 */
function collectStringScalars(
  nodes: readonly BodyNode[], includeQuoted: boolean = false,
): StringScalar[] {
  const result: StringScalar[] = [];
  function visitScalar(sc: ScalarNode): void {
    if (sc.scalarType === 'string' && (!sc.quoted || includeQuoted)) result.push(sc);
  }
  function visitBody(body: readonly BodyNode[]): void {
    for (const node of body) {
      switch (node.type) {
        case 'keyValue': visitScalar(node.value); break;
        case 'object': visitBody(node.children); break;
        case 'tabularArray':
          for (const r of node.rows) for (const v of r.values) visitScalar(v);
          break;
        case 'inlineArray':
          for (const v of node.values) visitScalar(v);
          break;
        case 'listArray':
          for (const li of node.items) visitBody(li.children);
          break;
        case 'comment': break;
      }
    }
  }
  visitBody(nodes);
  return result;
}

/**
 * Clone a ScalarNode, replacing string values via the map.
 *
 * Compression modes (substringMap provided):
 * 1. **Exact**: value matches a map key entirely → replaced with $alias
 * 2. **Substring** (prefix/suffix/infix): value contains a substring in
 *    substringMap → each occurrence replaced with ${alias}. Longest
 *    substrings are replaced first to avoid partial overlaps.
 *
 * Decompression mode (includeQuoted=true, no substringMap):
 * 3. Expand all ${alias} patterns in the value.
 */
function cloneScalar(
  sc: ScalarNode, map: ReadonlyMap<string, string>,
  includeQuoted: boolean = false,
  substringMap?: ReadonlyMap<string, string>,
): ScalarNode {
  if (sc.scalarType === 'string') {
    // 1. Exact replacement (unquoted only, or all if includeQuoted)
    if (!sc.quoted || includeQuoted) {
      const replacement = map.get(sc.value);
      if (replacement !== undefined) {
        return { type: 'scalar', scalarType: 'string', value: replacement,
          quoted: false, position: sc.position };
      }
    }
    // 2. Substring replacement (compression): handles prefix, suffix, and
    //    infix patterns. Process longest substrings first so shorter ones
    //    only fire on remaining (non-overlapping) text.
    if (substringMap && substringMap.size > 0) {
      // Sort by length descending so longest match wins
      const sorted = [...substringMap.entries()]
        .sort((a, b) => b[0].length - a[0].length);
      let newValue = sc.value;
      let changed = false;
      for (const [substr, alias] of sorted) {
        if (newValue.includes(substr)) {
          const placeholder = `\${${alias.slice(1)}}`;
          // split+join for global replacement (all occurrences)
          newValue = newValue.split(substr).join(placeholder);
          changed = true;
        }
      }
      if (changed) {
        return { type: 'scalar', scalarType: 'string', value: newValue,
          quoted: true, position: sc.position };
      }
    }
    // 3. Expansion (decompression): expand ${alias} patterns at any position
    if (includeQuoted && sc.value.includes('${')) {
      const expanded = sc.value.replace(
        /\$\{([a-z]{1,2})\}/g,
        (match, name: string) => {
          const exp = map.get('$' + name);
          return exp !== undefined ? exp : match;
        },
      );
      if (expanded !== sc.value) {
        return { type: 'scalar', scalarType: 'string', value: expanded,
          quoted: false, position: sc.position };
      }
    }
  }
  return { ...sc } as ScalarNode;
}

/** Deep-clone a TabularRowNode, applying replacements. */
function cloneRow(
  r: TabularRowNode, map: ReadonlyMap<string, string>,
  includeQuoted: boolean = false,
  substringMap?: ReadonlyMap<string, string>,
): TabularRowNode {
  return { type: 'tabularRow',
    values: r.values.map(v => cloneScalar(v, map, includeQuoted, substringMap)),
    position: r.position };
}

/** Deep-clone a ListItemNode, applying replacements. */
function cloneListItem(
  li: ListItemNode, map: ReadonlyMap<string, string>,
  includeQuoted: boolean = false,
  substringMap?: ReadonlyMap<string, string>,
): ListItemNode {
  return { type: 'listItem',
    children: cloneBody(li.children, map, includeQuoted, substringMap),
    position: li.position };
}

/**
 * Deep-clone body nodes, replacing string values via the map.
 * Used for both compression (value->alias) and decompression (alias->value).
 * @param includeQuoted - When true, also replace quoted strings (for decompression)
 * @param substringMap - Optional map of substring→alias for inline compression
 */
function cloneBody(
  nodes: readonly BodyNode[], map: ReadonlyMap<string, string>,
  includeQuoted: boolean = false,
  substringMap?: ReadonlyMap<string, string>,
): BodyNode[] {
  return nodes.map((node): BodyNode => {
    switch (node.type) {
      case 'keyValue':
        return { type: 'keyValue', key: node.key,
          value: cloneScalar(node.value, map, includeQuoted, substringMap),
          position: node.position };
      case 'object':
        return { type: 'object', key: node.key,
          children: cloneBody(node.children, map, includeQuoted, substringMap),
          position: node.position };
      case 'tabularArray':
        return { type: 'tabularArray', key: node.key, count: node.count,
          fields: [...node.fields],
          rows: node.rows.map(r => cloneRow(r, map, includeQuoted, substringMap)),
          position: node.position };
      case 'inlineArray':
        return { type: 'inlineArray', key: node.key, count: node.count,
          values: node.values.map(v => cloneScalar(v, map, includeQuoted, substringMap)),
          position: node.position };
      case 'listArray':
        return { type: 'listArray', key: node.key, count: node.count,
          items: node.items.map(li => cloneListItem(li, map, includeQuoted, substringMap)),
          position: node.position };
      case 'comment':
        return { ...node };
    }
  });
}

/** Deep-clone body nodes without replacements. */
function cloneBodyIdentity(nodes: readonly BodyNode[]): BodyNode[] {
  return cloneBody(nodes, new Map<string, string>());
}

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
interface AliasCandidate {
  value: string;
  occurrences: number;
  netSavings: number;
  candidateType: 'exact' | 'prefix' | 'suffix' | 'substring';
}

/**
 * Find common prefixes among string values that would benefit from aliasing.
 * Values that already have exact-match duplicates are excluded.
 * Uses sorted-adjacency comparison to efficiently find shared prefixes.
 */
function findPrefixCandidates(
  values: string[],
  exactDups: ReadonlySet<string>,
  minSavings: number,
): AliasCandidate[] {
  // Filter out values already handled by exact dedup, and values too short
  const unique = [...new Set(values.filter(v =>
    !exactDups.has(v) && v.length >= MIN_PREFIX_LENGTH
  ))];
  if (unique.length < MIN_PREFIX_OCCURRENCES) return [];

  // Sort values to bring similar strings adjacent
  unique.sort();

  // Find common prefixes between adjacent sorted values
  const prefixCounts = new Map<string, number>();
  for (let i = 0; i < unique.length - 1; i++) {
    const a = unique[i]!, b = unique[i + 1]!;
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

  // Remove shorter prefixes that are substrings of longer ones with equal coverage
  const sortedPrefixes = [...prefixOccurrences.entries()]
    .sort((a, b) => b[0].length - a[0].length);
  const kept = new Map<string, number>();
  for (const [prefix, count] of sortedPrefixes) {
    // Only keep if no longer prefix already covers the same values
    let dominated = false;
    for (const [keptPrefix] of kept) {
      if (keptPrefix.startsWith(prefix)) { dominated = true; break; }
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

/**
 * Find common suffixes among string values that would benefit from aliasing.
 * Mirrors prefix detection: reverses all strings, sorts, finds shared
 * prefixes of reversed strings (= shared suffixes of originals).
 *
 * @param values - All string values (may include duplicates)
 * @param exactDups - Values already handled by exact dedup
 * @param otherPatterns - Patterns already discovered (to avoid overlap)
 * @param minSavings - Minimum net token savings threshold
 */
function findSuffixCandidates(
  values: string[],
  exactDups: ReadonlySet<string>,
  otherPatterns: ReadonlySet<string>,
  minSavings: number,
): AliasCandidate[] {
  const unique = [...new Set(values.filter(v =>
    !exactDups.has(v) && v.length >= MIN_SUFFIX_LENGTH
  ))];
  if (unique.length < MIN_SUFFIX_OCCURRENCES) return [];

  // Reverse strings and sort to bring shared suffixes adjacent
  const reversed = unique.map(v => ({ original: v, rev: [...v].reverse().join('') }));
  reversed.sort((a, b) => a.rev.localeCompare(b.rev));

  // Find common suffixes (= common prefixes of reversed strings)
  const suffixCounts = new Map<string, number>();
  for (let i = 0; i < reversed.length - 1; i++) {
    const a = reversed[i]!.rev, b = reversed[i + 1]!.rev;
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

  // Remove dominated suffixes (shorter ones subsumed by longer ones)
  const sortedSuffixes = [...suffixOccurrences.entries()]
    .sort((a, b) => b[0].length - a[0].length);
  const kept = new Map<string, number>();
  for (const [suffix, count] of sortedSuffixes) {
    let dominated = false;
    for (const [keptSuffix] of kept) {
      if (keptSuffix.endsWith(suffix)) { dominated = true; break; }
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
 */
function findSubstringCandidates(
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
      if (longer.value.includes(candidate.value)
          && longer.occurrences >= candidate.occurrences) {
        dominated = true;
        break;
      }
    }
    if (!dominated) kept.push(candidate);
  }

  return kept;
}

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
 * @example
 * ```ts
 * const compressed = compressL2(myDoc);
 * // compressed.dictionary contains alias definitions
 * // compressed.body has values replaced with $a, $b, etc.
 * ```
 */
export function compressL2(
  doc: DocumentNode, minSavings: number = DEFAULT_MIN_SAVINGS,
): DocumentNode {
  const scalars = collectStringScalars(doc.body);
  const allScalars = collectStringScalars(doc.body, true);

  // ── 1. Exact-match candidates (unquoted only) ──────────────────────
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

  // ── 2. Prefix candidates ───────────────────────────────────────────
  const allValues = allScalars.map(sc => sc.value);
  const prefixCandidates = findPrefixCandidates(allValues, exactDups, minSavings);
  candidates.push(...prefixCandidates);
  const prefixValues = new Set(prefixCandidates.map(c => c.value));

  // ── 3. Suffix candidates ───────────────────────────────────────────
  const suffixCandidates = findSuffixCandidates(
    allValues, exactDups, prefixValues, minSavings,
  );
  candidates.push(...suffixCandidates);
  const suffixValues = new Set(suffixCandidates.map(c => c.value));

  // ── 4. General substring candidates ────────────────────────────────
  const existingPatterns = new Set([...exactDups, ...prefixValues, ...suffixValues]);
  const substringCandidates = findSubstringCandidates(
    allValues, existingPatterns, minSavings,
  );
  candidates.push(...substringCandidates);

  // ── No candidates → passthrough clone ──────────────────────────────
  if (candidates.length === 0) {
    return { type: 'document', headers: [...doc.headers],
      dictionary: doc.dictionary, body: cloneBodyIdentity(doc.body),
      position: doc.position };
  }

  // ── Global dedup: remove patterns subsumed by longer ones ──────────
  // Candidates from different detection methods (prefix/suffix/substring)
  // may overlap. A shorter candidate that is a substring of a longer one
  // with equal or greater frequency is dominated and would waste an alias.
  candidates.sort((a, b) => b.value.length - a.value.length);
  const deduped: AliasCandidate[] = [];
  for (const c of candidates) {
    let dominated = false;
    for (const longer of deduped) {
      if (longer.value.length > c.value.length
          && longer.value.includes(c.value)
          && longer.occurrences >= c.occurrences) {
        dominated = true;
        break;
      }
    }
    if (!dominated) deduped.push(c);
  }

  // ── Greedy simulation: select aliases that actually save tokens ─────
  // After applying a longer pattern, shorter overlapping patterns may
  // have zero remaining matches. This BPE-style greedy pass simulates
  // replacements on a copy of the values to find effective occurrences.
  deduped.sort((a, b) => b.netSavings - a.netSavings);
  const simValues = allValues.map(v => v);
  const selected: AliasCandidate[] = [];
  for (const c of deduped) {
    if (selected.length >= MAX_ALIASES) break;
    if (c.candidateType === 'exact') {
      // Exact: count values that still match exactly
      let effectiveOcc = 0;
      for (const v of simValues) {
        if (v === c.value) effectiveOcc++;
      }
      if (effectiveOcc < MIN_OCCURRENCES) continue;
      const tok = estimateTokens(c.value);
      const eff = (tok - 1) * effectiveOcc - (tok + 3);
      if (eff < minSavings) continue;
      selected.push({ ...c, occurrences: effectiveOcc, netSavings: eff });
      // Simulate: replace exact matches
      const placeholder = aliasForIndex(selected.length - 1);
      for (let i = 0; i < simValues.length; i++) {
        if (simValues[i] === c.value) simValues[i] = placeholder;
      }
    } else {
      // Inline pattern: count values that still contain the substring
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
      // Simulate: replace all occurrences in values
      const placeholder = `\${${aliasForIndex(selected.length - 1).slice(1)}}`;
      for (let i = 0; i < simValues.length; i++) {
        if (simValues[i]!.includes(c.value)) {
          simValues[i] = simValues[i]!.split(c.value).join(placeholder);
        }
      }
    }
  }

  if (selected.length === 0) {
    return { type: 'document', headers: [...doc.headers],
      dictionary: doc.dictionary, body: cloneBodyIdentity(doc.body),
      position: doc.position };
  }

  // ── Build replacement maps ─────────────────────────────────────────
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

  return { type: 'document', headers: [...doc.headers],
    dictionary: dictBlock,
    body: cloneBody(doc.body, valueToAlias, false,
      substringToAlias.size > 0 ? substringToAlias : undefined),
    position: doc.position };
}

/**
 * Decompress a DocumentNode by expanding all L2 dictionary aliases.
 *
 * If no dictionary block is present, returns a clone unchanged.
 * Does NOT mutate the input.
 *
 * @param doc - The DocumentNode to decompress
 * @returns New DocumentNode with aliases expanded and dictionary set to null
 * @example
 * ```ts
 * const expanded = decompressL2(compressedDoc);
 * // expanded.dictionary is null
 * // expanded.body has $a, $b replaced with original values
 * ```
 */
export function decompressL2(doc: DocumentNode): DocumentNode {
  if (doc.dictionary === null || doc.dictionary.entries.length === 0) {
    return { type: 'document', headers: [...doc.headers], dictionary: null,
      body: cloneBodyIdentity(doc.body), position: doc.position };
  }

  const expansionMap = new Map<string, string>();
  for (const entry of doc.dictionary.entries) {
    expansionMap.set(entry.alias, entry.expansion);
  }

  return { type: 'document', headers: [...doc.headers], dictionary: null,
    body: cloneBody(doc.body, expansionMap, true), position: doc.position };
}

/**
 * Extract DictEntry[] from a DocumentNode's dictionary block.
 *
 * Converts internal DictEntryNode[] to the public DictEntry[] type
 * (with `occurrences` and `tokensSaved`). Returns empty array if no dictionary.
 *
 * @param doc - A DocumentNode (typically after compressL2)
 * @returns Array of DictEntry with alias, expansion, occurrences, tokensSaved
 * @example
 * ```ts
 * const entries = extractDictEntries(compressedDoc);
 * // [{ alias: '$a', expansion: 'Engineering', occurrences: 6, tokensSaved: 9 }]
 * ```
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
        const alias = '$' + m[1]!;
        aliasCount.set(alias, (aliasCount.get(alias) ?? 0) + 1);
      }
    }
  }

  return doc.dictionary.entries.map((entry): DictEntry => {
    const occ = aliasCount.get(entry.alias) ?? 0;
    const vTok = estimateTokens(entry.expansion);
    const saved = (vTok - 1) * occ - (vTok + 3);
    return { alias: entry.alias, expansion: entry.expansion,
      occurrences: occ, tokensSaved: Math.max(0, saved) };
  });
}

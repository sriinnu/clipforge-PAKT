/**
 * @module layers/L2-dictionary
 * Layer 2: Dictionary-based deduplication for PAKT AST.
 *
 * Scans all scalar string values in a PAKT AST, identifies repeated values,
 * and replaces them with short aliases (`$a`, `$b`, ...) defined in a
 * `@dict` block. This is a lossless compression layer -- decompressL2
 * perfectly reverses compressL2.
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
 * Supports both exact replacement and prefix replacement:
 * - Exact: value matches a map key entirely → replaced with the mapped value
 * - Prefix (compress): value starts with a prefix in prefixMap → prefix replaced with ${alias}
 * - Prefix (decompress): value contains ${alias} pattern → expanded
 */
function cloneScalar(
  sc: ScalarNode, map: ReadonlyMap<string, string>,
  includeQuoted: boolean = false,
  prefixMap?: ReadonlyMap<string, string>,
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
    // 2. Prefix replacement (compression): works on both quoted and unquoted
    if (prefixMap && prefixMap.size > 0) {
      let bestPrefix = '';
      let bestAlias = '';
      for (const [prefix, alias] of prefixMap) {
        if (sc.value.startsWith(prefix) && sc.value.length > prefix.length
            && prefix.length > bestPrefix.length) {
          bestPrefix = prefix;
          bestAlias = alias;
        }
      }
      if (bestPrefix) {
        const suffix = sc.value.slice(bestPrefix.length);
        return { type: 'scalar', scalarType: 'string',
          value: `\${${bestAlias.slice(1)}}${suffix}`,
          quoted: true, position: sc.position };
      }
    }
    // 3. Prefix expansion (decompression): expand ${alias} patterns
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
  prefixMap?: ReadonlyMap<string, string>,
): TabularRowNode {
  return { type: 'tabularRow',
    values: r.values.map(v => cloneScalar(v, map, includeQuoted, prefixMap)),
    position: r.position };
}

/** Deep-clone a ListItemNode, applying replacements. */
function cloneListItem(
  li: ListItemNode, map: ReadonlyMap<string, string>,
  includeQuoted: boolean = false,
  prefixMap?: ReadonlyMap<string, string>,
): ListItemNode {
  return { type: 'listItem',
    children: cloneBody(li.children, map, includeQuoted, prefixMap),
    position: li.position };
}

/**
 * Deep-clone body nodes, replacing string values via the map.
 * Used for both compression (value->alias) and decompression (alias->value).
 * @param includeQuoted - When true, also replace quoted strings (for decompression)
 * @param prefixMap - Optional map of prefix→alias for prefix compression
 */
function cloneBody(
  nodes: readonly BodyNode[], map: ReadonlyMap<string, string>,
  includeQuoted: boolean = false,
  prefixMap?: ReadonlyMap<string, string>,
): BodyNode[] {
  return nodes.map((node): BodyNode => {
    switch (node.type) {
      case 'keyValue':
        return { type: 'keyValue', key: node.key,
          value: cloneScalar(node.value, map, includeQuoted, prefixMap),
          position: node.position };
      case 'object':
        return { type: 'object', key: node.key,
          children: cloneBody(node.children, map, includeQuoted, prefixMap),
          position: node.position };
      case 'tabularArray':
        return { type: 'tabularArray', key: node.key, count: node.count,
          fields: [...node.fields],
          rows: node.rows.map(r => cloneRow(r, map, includeQuoted, prefixMap)),
          position: node.position };
      case 'inlineArray':
        return { type: 'inlineArray', key: node.key, count: node.count,
          values: node.values.map(v => cloneScalar(v, map, includeQuoted, prefixMap)),
          position: node.position };
      case 'listArray':
        return { type: 'listArray', key: node.key, count: node.count,
          items: node.items.map(li => cloneListItem(li, map, includeQuoted, prefixMap)),
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

/** Candidate for dictionary aliasing. */
interface AliasCandidate {
  value: string;
  occurrences: number;
  netSavings: number;
  isPrefix?: boolean;
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
      candidates.push({ value: prefix, occurrences, netSavings, isPrefix: true });
    }
  }

  return candidates;
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
  const allScalars = collectStringScalars(doc.body, true); // includes quoted for prefix

  // Count frequencies for exact-match candidates (unquoted only)
  const freq = new Map<string, number>();
  for (const sc of scalars) {
    freq.set(sc.value, (freq.get(sc.value) ?? 0) + 1);
  }

  // Filter and score exact-match candidates
  const candidates: AliasCandidate[] = [];
  const exactDups = new Set<string>();
  for (const [value, occurrences] of freq) {
    if (occurrences < MIN_OCCURRENCES || value.length < MIN_VALUE_LENGTH) continue;
    const vTok = estimateTokens(value);
    const netSavings = (vTok - 1) * occurrences - (vTok + 3);
    if (netSavings >= minSavings) {
      candidates.push({ value, occurrences, netSavings });
      exactDups.add(value);
    }
  }

  // Find prefix candidates among ALL values (including quoted)
  const allValues = allScalars.map(sc => sc.value);
  const prefixCandidates = findPrefixCandidates(allValues, exactDups, minSavings);
  candidates.push(...prefixCandidates);

  // No candidates => passthrough clone
  if (candidates.length === 0) {
    return { type: 'document', headers: [...doc.headers],
      dictionary: doc.dictionary, body: cloneBodyIdentity(doc.body),
      position: doc.position };
  }

  // Sort by savings descending, cap at MAX_ALIASES
  candidates.sort((a, b) => b.netSavings - a.netSavings);
  const selected = candidates.slice(0, MAX_ALIASES);

  // Build maps and DictBlockNode
  const valueToAlias = new Map<string, string>();
  const prefixToAlias = new Map<string, string>();
  const entries: DictEntryNode[] = [];
  for (let i = 0; i < selected.length; i++) {
    const c = selected[i]!;
    const alias = aliasForIndex(i);
    if (c.isPrefix) {
      prefixToAlias.set(c.value, alias);
    } else {
      valueToAlias.set(c.value, alias);
    }
    entries.push({ type: 'dictEntry', alias, expansion: c.value, position: synPos });
  }

  const dictBlock: DictBlockNode = { type: 'dictBlock', entries, position: synPos };

  return { type: 'document', headers: [...doc.headers],
    dictionary: dictBlock,
    body: cloneBody(doc.body, valueToAlias, false,
      prefixToAlias.size > 0 ? prefixToAlias : undefined),
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

  const scalars = collectStringScalars(doc.body);
  const aliasCount = new Map<string, number>();
  for (const sc of scalars) {
    if (sc.value.startsWith('$')) {
      aliasCount.set(sc.value, (aliasCount.get(sc.value) ?? 0) + 1);
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

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
 * Collect all unquoted StringScalar nodes from body, recursively.
 * @param nodes - Body nodes to walk
 * @returns Unquoted StringScalar references
 */
function collectStringScalars(nodes: readonly BodyNode[]): StringScalar[] {
  const result: StringScalar[] = [];
  function visitScalar(sc: ScalarNode): void {
    if (sc.scalarType === 'string' && !sc.quoted) result.push(sc);
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
 * @param sc - Scalar node to clone
 * @param map - Replacement map (value -> replacement)
 * @param includeQuoted - When true, also replace quoted strings (needed for
 *   decompression, since aliases like `$a` get quoted by the serializer)
 */
function cloneScalar(
  sc: ScalarNode, map: ReadonlyMap<string, string>,
  includeQuoted: boolean = false,
): ScalarNode {
  if (sc.scalarType === 'string' && (!sc.quoted || includeQuoted)) {
    const replacement = map.get(sc.value);
    if (replacement !== undefined) {
      return { type: 'scalar', scalarType: 'string', value: replacement,
        quoted: false, position: sc.position };
    }
  }
  return { ...sc } as ScalarNode;
}

/** Deep-clone a TabularRowNode, applying replacements. */
function cloneRow(
  r: TabularRowNode, map: ReadonlyMap<string, string>,
  includeQuoted: boolean = false,
): TabularRowNode {
  return { type: 'tabularRow', values: r.values.map(v => cloneScalar(v, map, includeQuoted)),
    position: r.position };
}

/** Deep-clone a ListItemNode, applying replacements. */
function cloneListItem(
  li: ListItemNode, map: ReadonlyMap<string, string>,
  includeQuoted: boolean = false,
): ListItemNode {
  return { type: 'listItem', children: cloneBody(li.children, map, includeQuoted),
    position: li.position };
}

/**
 * Deep-clone body nodes, replacing string values via the map.
 * Used for both compression (value->alias) and decompression (alias->value).
 * @param includeQuoted - When true, also replace quoted strings (for decompression)
 */
function cloneBody(
  nodes: readonly BodyNode[], map: ReadonlyMap<string, string>,
  includeQuoted: boolean = false,
): BodyNode[] {
  return nodes.map((node): BodyNode => {
    switch (node.type) {
      case 'keyValue':
        return { type: 'keyValue', key: node.key,
          value: cloneScalar(node.value, map, includeQuoted), position: node.position };
      case 'object':
        return { type: 'object', key: node.key,
          children: cloneBody(node.children, map, includeQuoted), position: node.position };
      case 'tabularArray':
        return { type: 'tabularArray', key: node.key, count: node.count,
          fields: [...node.fields],
          rows: node.rows.map(r => cloneRow(r, map, includeQuoted)),
          position: node.position };
      case 'inlineArray':
        return { type: 'inlineArray', key: node.key, count: node.count,
          values: node.values.map(v => cloneScalar(v, map, includeQuoted)),
          position: node.position };
      case 'listArray':
        return { type: 'listArray', key: node.key, count: node.count,
          items: node.items.map(li => cloneListItem(li, map, includeQuoted)),
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

  // Count frequencies
  const freq = new Map<string, number>();
  for (const sc of scalars) {
    freq.set(sc.value, (freq.get(sc.value) ?? 0) + 1);
  }

  // Filter and score candidates
  const candidates: AliasCandidate[] = [];
  for (const [value, occurrences] of freq) {
    if (occurrences < MIN_OCCURRENCES || value.length < MIN_VALUE_LENGTH) continue;
    const vTok = estimateTokens(value);
    const netSavings = (vTok - 1) * occurrences - (vTok + 3);
    if (netSavings >= minSavings) {
      candidates.push({ value, occurrences, netSavings });
    }
  }

  // No candidates => passthrough clone
  if (candidates.length === 0) {
    return { type: 'document', headers: [...doc.headers],
      dictionary: doc.dictionary, body: cloneBodyIdentity(doc.body),
      position: doc.position };
  }

  // Sort by savings descending, cap at MAX_ALIASES
  candidates.sort((a, b) => b.netSavings - a.netSavings);
  const selected = candidates.slice(0, MAX_ALIASES);

  // Build value->alias map and DictBlockNode
  const valueToAlias = new Map<string, string>();
  const entries: DictEntryNode[] = [];
  for (let i = 0; i < selected.length; i++) {
    const c = selected[i]!;
    const alias = aliasForIndex(i);
    valueToAlias.set(c.value, alias);
    entries.push({ type: 'dictEntry', alias, expansion: c.value, position: synPos });
  }

  const dictBlock: DictBlockNode = { type: 'dictBlock', entries, position: synPos };

  return { type: 'document', headers: [...doc.headers],
    dictionary: dictBlock, body: cloneBody(doc.body, valueToAlias),
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

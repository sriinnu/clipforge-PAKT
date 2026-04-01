/**
 * @module layers/L2-clone
 * Pure utility functions for deep-cloning PAKT AST body nodes.
 *
 * These functions are used by both L2 compression and decompression to
 * traverse and copy the AST while optionally replacing string scalar
 * values via alias maps. All functions are side-effect free: they never
 * mutate inputs, always returning fresh node trees.
 *
 * **Exported utilities:**
 *
 * - {@link collectStringScalars} - Walk body nodes and gather StringScalar refs
 * - {@link cloneScalar} - Clone a single ScalarNode with optional replacement
 * - {@link cloneRow} - Clone a TabularRowNode with replacements
 * - {@link cloneListItem} - Clone a ListItemNode with replacements
 * - {@link cloneBody} - Recursively clone an entire BodyNode array
 * - {@link cloneBodyIdentity} - Clone body nodes without any replacements
 */

import type {
  BodyNode,
  ListItemNode,
  ScalarNode,
  StringScalar,
  TabularRowNode,
} from '../parser/ast.js';

/**
 * Pattern matching values that must be quoted to avoid misinterpretation.
 * Specifically, bare `~` is the delta sentinel — expanded values that equal
 * `~` must be force-quoted to prevent false delta detection on re-encode.
 */
const NEEDS_QUOTE_AFTER_EXPAND_RE = /^~$/;

// ---------------------------------------------------------------------------
// Scalar collection
// ---------------------------------------------------------------------------

/**
 * Recursively collect all {@link StringScalar} nodes from a body tree.
 *
 * Walks every BodyNode type (keyValue, object, tabularArray, inlineArray,
 * listArray) and gathers references to their string scalar values.
 *
 * @param nodes - Body nodes to walk
 * @param includeQuoted - When `true`, also collect quoted strings
 *   (needed for prefix/suffix analysis and decompression expansion).
 *   Defaults to `false` (unquoted only).
 * @returns Array of StringScalar references found in the tree
 */
export function collectStringScalars(
  nodes: readonly BodyNode[],
  includeQuoted = false,
): StringScalar[] {
  const result: StringScalar[] = [];

  /** Visit a single scalar, pushing it if it qualifies. */
  function visitScalar(sc: ScalarNode): void {
    if (sc.scalarType === 'string' && (!sc.quoted || includeQuoted)) result.push(sc);
  }

  /** Recursively visit all body nodes. */
  function visitBody(body: readonly BodyNode[]): void {
    for (const node of body) {
      switch (node.type) {
        case 'keyValue':
          visitScalar(node.value);
          break;
        case 'object':
          visitBody(node.children);
          break;
        case 'tabularArray':
          for (const r of node.rows) for (const v of r.values) visitScalar(v);
          break;
        case 'inlineArray':
          for (const v of node.values) visitScalar(v);
          break;
        case 'listArray':
          for (const li of node.items) visitBody(li.children);
          break;
        case 'comment':
          break;
      }
    }
  }

  visitBody(nodes);
  return result;
}

// ---------------------------------------------------------------------------
// Scalar cloning
// ---------------------------------------------------------------------------

/**
 * Clone a {@link ScalarNode}, optionally replacing string values via maps.
 *
 * Supports three replacement modes:
 *
 * 1. **Exact** (compression): If the scalar's value is a key in `map`,
 *    the entire value is replaced with the alias (e.g. `$a`).
 *    Only unquoted strings by default; set `includeQuoted` for all.
 *
 * 2. **Substring** (compression): If `substringMap` is provided, each
 *    occurrence of a substring key is replaced with `${alias}`.
 *    Longest substrings are processed first to prevent partial overlaps.
 *
 * 3. **Expansion** (decompression): When `includeQuoted` is `true` and
 *    the value contains `${...}` patterns, each `${alias}` is expanded
 *    by looking up `$alias` in the map.
 *
 * @param sc - The ScalarNode to clone
 * @param map - Map of value-to-alias (compression) or alias-to-expansion (decompression)
 * @param includeQuoted - Process quoted strings too (default `false`)
 * @param substringMap - Optional substring-to-alias map for inline compression
 * @returns A fresh ScalarNode (never the same reference)
 */
export function cloneScalar(
  sc: ScalarNode,
  map: ReadonlyMap<string, string>,
  includeQuoted = false,
  substringMap?: ReadonlyMap<string, string>,
): ScalarNode {
  if (sc.scalarType === 'string') {
    /* Mode 1: Exact replacement (unquoted only, or all if includeQuoted) */
    if (!sc.quoted || includeQuoted) {
      const replacement = map.get(sc.value);
      if (replacement !== undefined) {
        return {
          type: 'scalar',
          scalarType: 'string',
          value: replacement,
          /* Preserve original quoting intent, but also force-quote `~` expansions
             to prevent false delta sentinels. During compression the replacement
             is an alias (e.g. `$a`) so sc.quoted is typically false; during
             decompression (includeQuoted=true) we honour the original flag. */
          quoted: (includeQuoted && sc.quoted) || NEEDS_QUOTE_AFTER_EXPAND_RE.test(replacement),
          position: sc.position,
        };
      }
    }

    /* Mode 2: Substring replacement (compression). Process longest
       substrings first so shorter ones only fire on remaining text. */
    if (substringMap && substringMap.size > 0) {
      const sorted = [...substringMap.entries()].sort((a, b) => b[0].length - a[0].length);
      let newValue = sc.value;
      let changed = false;
      for (const [substr, alias] of sorted) {
        if (newValue.includes(substr)) {
          const placeholder = `\${${alias.slice(1)}}`;
          newValue = newValue.split(substr).join(placeholder);
          changed = true;
        }
      }
      if (changed) {
        return {
          type: 'scalar',
          scalarType: 'string',
          value: newValue,
          quoted: true,
          position: sc.position,
        };
      }
    }

    /* Mode 3: Expansion (decompression) — expand ${alias} patterns */
    if (includeQuoted && sc.value.includes('${')) {
      const expanded = sc.value.replace(/\$\{([a-z]{1,2})\}/g, (match, name: string) => {
        const exp = map.get(`$${name}`);
        return exp !== undefined ? exp : match;
      });
      if (expanded !== sc.value) {
        return {
          type: 'scalar',
          scalarType: 'string',
          value: expanded,
          /* After expansion the value is restored to its original form.
             Only force-quote if the expanded result is `~` (delta sentinel).
             Do NOT blindly preserve sc.quoted here — the compression step
             sets quoted=true for substring placeholders, but expanded values
             should revert to unquoted so downstream consumers see them
             correctly (e.g. collectStringScalars, delta sentinel detection). */
          quoted: NEEDS_QUOTE_AFTER_EXPAND_RE.test(expanded),
          position: sc.position,
        };
      }
    }
  }
  return { ...sc } as ScalarNode;
}

// ---------------------------------------------------------------------------
// Row / list-item cloning
// ---------------------------------------------------------------------------

/**
 * Deep-clone a {@link TabularRowNode}, applying scalar replacements.
 *
 * @param r - The row to clone
 * @param map - Replacement map forwarded to {@link cloneScalar}
 * @param includeQuoted - Forward to {@link cloneScalar}
 * @param substringMap - Forward to {@link cloneScalar}
 * @returns A fresh TabularRowNode with cloned values
 */
export function cloneRow(
  r: TabularRowNode,
  map: ReadonlyMap<string, string>,
  includeQuoted = false,
  substringMap?: ReadonlyMap<string, string>,
): TabularRowNode {
  return {
    type: 'tabularRow',
    values: r.values.map((v) => cloneScalar(v, map, includeQuoted, substringMap)),
    position: r.position,
  };
}

/**
 * Deep-clone a {@link ListItemNode}, applying scalar replacements.
 *
 * Delegates to {@link cloneBody} for recursive child processing.
 *
 * @param li - The list item to clone
 * @param map - Replacement map forwarded to {@link cloneBody}
 * @param includeQuoted - Forward to {@link cloneBody}
 * @param substringMap - Forward to {@link cloneBody}
 * @returns A fresh ListItemNode with cloned children
 */
export function cloneListItem(
  li: ListItemNode,
  map: ReadonlyMap<string, string>,
  includeQuoted = false,
  substringMap?: ReadonlyMap<string, string>,
): ListItemNode {
  return {
    type: 'listItem',
    children: cloneBody(li.children, map, includeQuoted, substringMap),
    position: li.position,
  };
}

// ---------------------------------------------------------------------------
// Body cloning
// ---------------------------------------------------------------------------

/**
 * Recursively deep-clone an array of {@link BodyNode}, replacing string
 * scalar values via the provided maps.
 *
 * Used for both compression (value -> alias) and decompression
 * (alias -> expansion). Each node type is handled:
 *
 * - `keyValue` — clone the value scalar
 * - `object` — recurse into children
 * - `tabularArray` — clone fields and each row
 * - `inlineArray` — clone each value scalar
 * - `listArray` — clone each list item (which recurses)
 * - `comment` — shallow copy (no scalars)
 *
 * @param nodes - The body nodes to clone
 * @param map - Replacement map: value->alias (compress) or alias->value (decompress)
 * @param includeQuoted - When `true`, also replace quoted strings (decompression)
 * @param substringMap - Optional substring->alias map for inline compression
 * @returns A fresh array of cloned BodyNode
 */
export function cloneBody(
  nodes: readonly BodyNode[],
  map: ReadonlyMap<string, string>,
  includeQuoted = false,
  substringMap?: ReadonlyMap<string, string>,
): BodyNode[] {
  return nodes.map((node): BodyNode => {
    switch (node.type) {
      case 'keyValue':
        return {
          type: 'keyValue',
          key: node.key,
          value: cloneScalar(node.value, map, includeQuoted, substringMap),
          position: node.position,
        };
      case 'object':
        return {
          type: 'object',
          key: node.key,
          children: cloneBody(node.children, map, includeQuoted, substringMap),
          position: node.position,
        };
      case 'tabularArray':
        return {
          type: 'tabularArray',
          key: node.key,
          count: node.count,
          fields: [...node.fields],
          rows: node.rows.map((r) => cloneRow(r, map, includeQuoted, substringMap)),
          position: node.position,
        };
      case 'inlineArray':
        return {
          type: 'inlineArray',
          key: node.key,
          count: node.count,
          values: node.values.map((v) => cloneScalar(v, map, includeQuoted, substringMap)),
          position: node.position,
        };
      case 'listArray':
        return {
          type: 'listArray',
          key: node.key,
          count: node.count,
          items: node.items.map((li) => cloneListItem(li, map, includeQuoted, substringMap)),
          position: node.position,
        };
      case 'comment':
        return { ...node };
    }
  });
}

/**
 * Deep-clone body nodes without performing any replacements.
 *
 * Convenience wrapper around {@link cloneBody} with an empty map,
 * used when the AST needs to be copied but no alias substitution
 * is required (e.g. passthrough when no candidates are found).
 *
 * @param nodes - The body nodes to clone
 * @returns A fresh, unchanged copy of the body tree
 */
export function cloneBodyIdentity(nodes: readonly BodyNode[]): BodyNode[] {
  return cloneBody(nodes, new Map<string, string>());
}

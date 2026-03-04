/**
 * @module layers/L4-semantic
 * L4 semantic compression layer — budget-aware lossy compression.
 *
 * Unlike L1-L3 (all lossless), L4 is intentionally irreversible.
 * It uses heuristic/rule-based transforms (no LLM required) to
 * reduce token count when the document exceeds a target budget.
 *
 * Capabilities:
 * - **Value truncation**: long string values shortened to key prefix
 * - **Array truncation**: large arrays summarised with head + tail
 * - **Field dropping**: low-information fields pruned from objects
 * - **Redundancy collapse**: consecutive identical items merged
 * - **Text-level transforms**: whitespace, abbreviation, precision
 *
 * Signals lossy output via `@compress semantic` + `@warning lossy` headers.
 *
 * @see {@link ./L4-strategies.ts} for individual AST strategies
 * @see {@link ./L4-text-transforms.ts} for text-level transforms
 */

import type {
  CompressHeaderNode,
  DocumentNode,
  HeaderNode,
  SourcePosition,
  WarningHeaderNode,
} from '../parser/ast.js';
import { serialize } from '../serializer/serialize.js';
import { countTokens } from '../tokens/counter.js';
import {
  strategyArrayTruncation,
  strategyFieldDropping,
  strategyRedundancyCollapse,
  strategyValueTruncation,
} from './L4-strategies.js';
import { applyTextTransforms } from './L4-text-transforms.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default position for synthetic header nodes. */
const POS: SourcePosition = { line: 0, column: 0, offset: 0 };

// ---------------------------------------------------------------------------
// Header helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a header of the given type and value already exists.
 * @param headers - The document's header array
 * @param headerType - The header type to find
 * @param value      - The header value to match
 * @returns True if the header already exists
 */
function hasHeader(
  headers: HeaderNode[],
  headerType: string,
  value: string,
): boolean {
  return headers.some((h) => h.headerType === headerType && h.value === value);
}

/**
 * Add `@compress semantic` and `@warning lossy` headers to a document
 * if they are not already present.
 *
 * @param doc - The document to annotate
 * @returns A new document with the headers added
 */
function addL4Headers(doc: DocumentNode): DocumentNode {
  const newHeaders = [...doc.headers];

  if (!hasHeader(newHeaders, 'compress', 'semantic')) {
    const compressHeader: CompressHeaderNode = {
      type: 'header',
      headerType: 'compress',
      value: 'semantic',
      position: POS,
    };
    newHeaders.push(compressHeader);
  }

  if (!hasHeader(newHeaders, 'warning', 'lossy')) {
    const warningHeader: WarningHeaderNode = {
      type: 'header',
      headerType: 'warning',
      value: 'lossy',
      position: POS,
    };
    newHeaders.push(warningHeader);
  }

  return { ...doc, headers: newHeaders };
}

/**
 * Remove `@compress semantic` and `@warning lossy` headers from a document.
 * Returns the original doc reference if no L4 headers are present.
 *
 * @param doc - The document to strip
 * @returns A new document with L4 headers removed, or the original if unchanged
 */
function stripL4Headers(doc: DocumentNode): DocumentNode {
  const hasL4Headers = doc.headers.some(
    (h) =>
      (h.headerType === 'compress' && h.value === 'semantic') ||
      (h.headerType === 'warning' && h.value === 'lossy'),
  );

  // Return original reference when no L4 headers exist (preserves identity)
  if (!hasL4Headers) return doc;

  const filtered = doc.headers.filter(
    (h) =>
      !(h.headerType === 'compress' && h.value === 'semantic') &&
      !(h.headerType === 'warning' && h.value === 'lossy'),
  );
  return { ...doc, headers: filtered };
}

// ---------------------------------------------------------------------------
// Budget-aware strategy runner
// ---------------------------------------------------------------------------

/**
 * Type definition for an AST compression strategy function.
 * Each strategy accepts a document and returns the mutated document.
 */
type Strategy = (doc: DocumentNode) => DocumentNode;

/**
 * Apply AST strategies in order, stopping when within budget.
 *
 * After each strategy, the document is serialized and its token count
 * is measured. If the count is at or below `budget`, processing stops.
 *
 * @param doc        - The document AST to compress
 * @param budget     - Target token budget
 * @param strategies - Ordered list of strategy functions
 * @returns Object with the compressed doc and whether any changes were made
 */
function applyStrategiesUntilBudget(
  doc: DocumentNode,
  budget: number,
  strategies: Strategy[],
): { doc: DocumentNode; changed: boolean } {
  let changed = false;

  for (const strategy of strategies) {
    // Check if already within budget before applying
    const preText = serialize(doc);
    const preTokens = countTokens(preText);
    if (preTokens <= budget) break;

    // Snapshot body length to detect changes
    const preSerialized = preText;
    doc = strategy(doc);
    const postSerialized = serialize(doc);

    if (postSerialized !== preSerialized) {
      changed = true;
    }

    // Check if now within budget
    if (countTokens(postSerialized) <= budget) break;
  }

  return { doc, changed };
}

// ---------------------------------------------------------------------------
// AST-level compression
// ---------------------------------------------------------------------------

/**
 * Apply L4 semantic compression to a parsed PAKT document.
 *
 * Walks the document AST and applies budget-aware lossy transforms
 * -- value truncation, array truncation, field dropping, and
 * redundancy collapse -- until the estimated token count of the
 * serialized output is at or below `budget`. Adds `@compress semantic`
 * and `@warning lossy` headers when transforms are applied.
 *
 * When `budget` is 0 or negative the function is a no-op.
 *
 * @param doc    - The parsed document AST to compress
 * @param budget - Target token budget for the compressed output
 * @returns A (potentially modified) document node
 *
 * @example
 * ```ts
 * import { compressL4 } from './layers/L4-semantic.js';
 *
 * const compressed = compressL4(doc, 500);
 * // compressed.headers includes @compress semantic + @warning lossy
 * ```
 */
export function compressL4(doc: DocumentNode, budget: number): DocumentNode {
  // No-op for non-positive budget
  if (budget <= 0) return doc;

  // Check if already within budget
  const initialText = serialize(doc);
  const initialTokens = countTokens(initialText);
  if (initialTokens <= budget) return doc;

  // Apply AST strategies progressively
  const strategies: Strategy[] = [
    strategyValueTruncation,
    strategyArrayTruncation,
    strategyFieldDropping,
    strategyRedundancyCollapse,
  ];

  const result = applyStrategiesUntilBudget(doc, budget, strategies);

  // Add L4 headers if any changes were made
  if (result.changed) {
    return addL4Headers(result.doc);
  }

  return result.doc;
}

// ---------------------------------------------------------------------------
// AST-level decompression
// ---------------------------------------------------------------------------

/**
 * Reverse L4 semantic compression on a document AST.
 *
 * Because L4 is lossy, true reversal is impossible. This function
 * strips the `@compress semantic` and `@warning lossy` headers so
 * downstream layers can proceed, but the content itself remains
 * in its compressed (summarised) form.
 *
 * @param doc - The document AST to "decompress"
 * @returns The document with L4 headers removed (content unchanged)
 *
 * @example
 * ```ts
 * import { decompressL4 } from './layers/L4-semantic.js';
 *
 * const cleaned = decompressL4(doc);
 * // cleaned.headers no longer contains @compress semantic or @warning lossy
 * ```
 */
export function decompressL4(doc: DocumentNode): DocumentNode {
  return stripL4Headers(doc);
}

// ---------------------------------------------------------------------------
// Text-level transform
// ---------------------------------------------------------------------------

/**
 * Apply L4 semantic transforms to a serialized PAKT string.
 *
 * Delegates to the text-level transform pipeline which applies
 * whitespace normalization, value abbreviation, and numeric
 * precision reduction progressively until within budget.
 *
 * When `budget` is 0 or negative, returns the text unchanged.
 *
 * @param text   - Serialized PAKT string
 * @param budget - Target token budget (0 or negative = no-op)
 * @returns The (possibly shortened) PAKT string
 *
 * @example
 * ```ts
 * import { applyL4Transforms } from './layers/L4-semantic.js';
 *
 * const result = applyL4Transforms(paktString, 200);
 * ```
 */
export function applyL4Transforms(text: string, budget: number): string {
  return applyTextTransforms(text, budget);
}

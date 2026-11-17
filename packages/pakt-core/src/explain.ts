/**
 * @module explain
 * Explain analysis for PAKT compression — generates human-readable
 * breakdowns of what happened during compression and why.
 *
 * Provides three analysis functions:
 * - {@link analyzeStructure} — counts keys, arrays, nesting, overhead
 * - {@link analyzeDictionary} — summarizes L2 dictionary candidates
 * - {@link generateRecommendation} — produces human-readable advice
 *
 * These are consumed by the `pakt_explain` MCP tool handler to build
 * educational explanations of the compression pipeline.
 */

import type { CompressibilityResult } from './compressibility.js';
import type { DictEntry, PaktFormat, PaktResult } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-layer breakdown entry returned by the explain tool. */
export interface LayerBreakdownEntry {
  /** Human-readable layer name (e.g. "L1 Structural") */
  layer: string;
  /** Tokens saved by this layer */
  saved: number;
  /** Human-readable explanation of what this layer did */
  explanation: string;
}

/** Structural analysis of the input data. */
export interface StructuralAnalysis {
  /** Total key occurrences across all objects */
  totalKeys: number;
  /** Number of distinct keys */
  uniqueKeys: number;
  /** Ratio of repeated keys (1 - unique/total). Higher = more compressible */
  keyRepetitionRatio: number;
  /** Number of arrays in the input */
  arrayCount: number;
  /** Number of arrays converted to tabular (pipe) format */
  tabularArrays: number;
  /** Maximum nesting depth */
  nestingDepth: number;
  /** Percentage of input tokens that were structural syntax */
  structuralOverhead: string;
}

/** Dictionary analysis of L2 compression results. */
export interface DictionaryAnalysis {
  /** Total candidate patterns found */
  candidatesFound: number;
  /** Number of aliases actually created */
  aliasesCreated: number;
  /** Top patterns by tokens saved */
  topPatterns: Array<{
    value: string;
    occurrences: number;
    tokensSaved: number;
    type: 'exact' | 'prefix' | 'suffix' | 'substring';
  }>;
}

// ---------------------------------------------------------------------------
// Structural analysis
// ---------------------------------------------------------------------------

/**
 * Analyze the structural properties of the input to explain L1 compression.
 *
 * Parses the input (JSON only — other formats get a simpler analysis) and
 * walks the tree to count keys, arrays, nesting depth, and structural overhead.
 *
 * @param input - Raw input text
 * @param detectedFormat - Format detected by the pipeline
 * @param originalTokens - Token count of the original input
 * @param l1Saved - Tokens saved by L1 structural compression
 * @returns Structural analysis object
 */
export function analyzeStructure(
  input: string,
  detectedFormat: PaktFormat,
  originalTokens: number,
  l1Saved: number,
): StructuralAnalysis {
  const result: StructuralAnalysis = {
    totalKeys: 0,
    uniqueKeys: 0,
    keyRepetitionRatio: 0,
    arrayCount: 0,
    tabularArrays: 0,
    nestingDepth: 0,
    structuralOverhead: '0%',
  };

  // Calculate structural overhead from L1 savings
  if (originalTokens > 0) {
    const overheadPct = Math.round((l1Saved / originalTokens) * 100);
    result.structuralOverhead = `${overheadPct}%`;
  }

  // Deep analysis only for JSON — we can safely parse it
  if (detectedFormat === 'json') {
    try {
      const parsed = JSON.parse(input);
      const stats = walkTree(parsed, 0);
      result.totalKeys = stats.totalKeys;
      result.uniqueKeys = stats.uniqueKeys.size;
      result.keyRepetitionRatio =
        stats.totalKeys > 0
          ? Math.round((1 - stats.uniqueKeys.size / stats.totalKeys) * 100) / 100
          : 0;
      result.arrayCount = stats.arrayCount;
      result.tabularArrays = stats.tabularArrays;
      result.nestingDepth = stats.maxDepth;
    } catch {
      // Parse failed — keep defaults
    }
  } else if (detectedFormat === 'csv') {
    // CSV: count columns as "keys", all rows are tabular
    const lines = input.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length > 0) {
      const headerLine = lines[0] ?? '';
      const cols = headerLine.split(/[,\t|;]/).length;
      result.totalKeys = cols * (lines.length - 1);
      result.uniqueKeys = cols;
      result.keyRepetitionRatio =
        result.totalKeys > 0
          ? Math.round((1 - result.uniqueKeys / result.totalKeys) * 100) / 100
          : 0;
      result.arrayCount = 1;
      result.tabularArrays = 1;
      result.nestingDepth = 1;
    }
  }

  return result;
}

/** Internal tree-walking stats accumulator. */
interface TreeStats {
  totalKeys: number;
  uniqueKeys: Set<string>;
  arrayCount: number;
  tabularArrays: number;
  maxDepth: number;
}

/**
 * Recursively walk a parsed JS value to collect structural stats.
 *
 * @param data - Parsed JS value
 * @param depth - Current nesting depth
 * @returns Accumulated stats
 */
function walkTree(data: unknown, depth: number): TreeStats {
  const stats: TreeStats = {
    totalKeys: 0,
    uniqueKeys: new Set(),
    arrayCount: 0,
    tabularArrays: 0,
    maxDepth: depth,
  };

  if (data === null || data === undefined || typeof data !== 'object') {
    return stats;
  }

  if (Array.isArray(data)) {
    stats.arrayCount = 1;

    // Check if tabular (array of uniform objects with scalar values)
    if (data.length > 0 && isTabularArray(data)) {
      stats.tabularArrays = 1;
    }

    for (const item of data) {
      const childStats = walkTree(item, depth + 1);
      mergeStats(stats, childStats);
    }
    return stats;
  }

  // Plain object
  const entries = Object.entries(data as Record<string, unknown>);
  for (const [key, value] of entries) {
    stats.totalKeys++;
    stats.uniqueKeys.add(key);
    const childStats = walkTree(value, depth + 1);
    mergeStats(stats, childStats);
  }

  return stats;
}

/** Check if an array is tabular (uniform objects with only scalar values). */
function isTabularArray(arr: unknown[]): boolean {
  const first = arr[0];
  if (first === null || typeof first !== 'object' || Array.isArray(first)) return false;

  const keys = Object.keys(first as Record<string, unknown>);
  if (keys.length === 0) return false;

  // All values in first object must be scalar
  for (const k of keys) {
    const v = (first as Record<string, unknown>)[k];
    if (v !== null && typeof v === 'object') return false;
  }

  // All other items must have the exact same keys and scalar values
  for (let i = 1; i < arr.length; i++) {
    const item = arr[i];
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return false;
    const itemKeys = Object.keys(item as Record<string, unknown>);
    if (itemKeys.length !== keys.length) return false;
    for (const k of keys) {
      if (!(k in (item as Record<string, unknown>))) return false;
      const v = (item as Record<string, unknown>)[k];
      if (v !== null && typeof v === 'object') return false;
    }
  }

  return true;
}

/** Merge child tree stats into the parent accumulator. */
function mergeStats(parent: TreeStats, child: TreeStats): void {
  parent.totalKeys += child.totalKeys;
  for (const key of child.uniqueKeys) parent.uniqueKeys.add(key);
  parent.arrayCount += child.arrayCount;
  parent.tabularArrays += child.tabularArrays;
  if (child.maxDepth > parent.maxDepth) parent.maxDepth = child.maxDepth;
}

// ---------------------------------------------------------------------------
// Dictionary analysis
// ---------------------------------------------------------------------------

/**
 * Analyze L2 dictionary results to explain what patterns were found.
 *
 * @param dictEntries - Dictionary entries from the compression result
 * @returns Dictionary analysis object
 */
export function analyzeDictionary(dictEntries: DictEntry[]): DictionaryAnalysis {
  const topPatterns = dictEntries
    .filter((e) => e.tokensSaved > 0)
    .sort((a, b) => b.tokensSaved - a.tokensSaved)
    .slice(0, 10)
    .map((e) => ({
      value: e.expansion,
      occurrences: e.occurrences,
      tokensSaved: e.tokensSaved,
      type: inferPatternType(e) as 'exact' | 'prefix' | 'suffix' | 'substring',
    }));

  return {
    candidatesFound: dictEntries.length,
    aliasesCreated: dictEntries.filter((e) => e.tokensSaved > 0).length,
    topPatterns,
  };
}

/**
 * Infer whether a dictionary entry was an exact, prefix, suffix, or
 * substring match based on the expansion value characteristics.
 *
 * @param entry - A dictionary entry
 * @returns Pattern type string
 */
function inferPatternType(entry: DictEntry): string {
  const v = entry.expansion;
  // URL-like prefixes (http://, https://, etc.)
  if (/^https?:\/\//.test(v) && v.endsWith('/')) return 'prefix';
  // File extension-like suffixes
  if (v.startsWith('.') && v.length <= 6) return 'suffix';
  // Path-like prefixes
  if (v.endsWith('/') || v.endsWith('\\')) return 'prefix';
  // Default to exact for whole-value matches
  return 'exact';
}

// ---------------------------------------------------------------------------
// Layer breakdown
// ---------------------------------------------------------------------------

/**
 * Build per-layer breakdown with human-readable explanations.
 *
 * @param result - Compression result from the pipeline
 * @param structural - Structural analysis from {@link analyzeStructure}
 * @param dictionary - Dictionary analysis from {@link analyzeDictionary}
 * @returns Array of layer breakdown entries
 */
export function buildLayerBreakdown(
  result: PaktResult,
  structural: StructuralAnalysis,
  dictionary: DictionaryAnalysis,
): LayerBreakdownEntry[] {
  const layers: LayerBreakdownEntry[] = [];
  const byLayer = result.savings.byLayer;

  // L1 Structural
  layers.push({
    layer: 'L1 Structural',
    saved: byLayer.structural,
    explanation: buildL1Explanation(byLayer.structural, structural, result.detectedFormat),
  });

  // L2 Dictionary
  layers.push({
    layer: 'L2 Dictionary',
    saved: byLayer.dictionary,
    explanation: buildL2Explanation(byLayer.dictionary, dictionary),
  });

  // L3 Tokenizer (only include if it contributed)
  if (byLayer.tokenizer > 0) {
    layers.push({
      layer: 'L3 Tokenizer',
      saved: byLayer.tokenizer,
      explanation: `Optimized delimiter encoding for the target tokenizer, saving ${byLayer.tokenizer} tokens.`,
    });
  }

  // L4 Semantic (only include if it contributed)
  if (byLayer.semantic > 0) {
    layers.push({
      layer: 'L4 Semantic',
      saved: byLayer.semantic,
      explanation: `Lossy semantic compression reduced content by ${byLayer.semantic} tokens. This is NOT reversible.`,
    });
  }

  // L5 Content (only include if it contributed)
  if (byLayer.content > 0) {
    layers.push({
      layer: 'L5 Content',
      saved: byLayer.content,
      explanation: `Content-aware transforms (abbreviations, URL compression, boolean shorthand) saved ${byLayer.content} tokens. This is NOT reversible.`,
    });
  }

  return layers;
}

/**
 * Build a human-readable explanation for L1 structural compression.
 *
 * @param saved - Tokens saved by L1
 * @param analysis - Structural analysis
 * @param format - Detected input format
 * @returns Explanation string
 */
function buildL1Explanation(
  saved: number,
  analysis: StructuralAnalysis,
  format: PaktFormat,
): string {
  if (saved === 0) {
    return 'No structural savings achieved (input may already be minimal).';
  }

  const parts: string[] = [];

  // Format-specific opener
  if (format === 'json') {
    parts.push('Stripped JSON braces, brackets, quotes, and commas.');
  } else if (format === 'yaml') {
    parts.push('Converted YAML key-value structure to compact PAKT syntax.');
  } else if (format === 'csv') {
    parts.push('Converted CSV tabular data to compact PAKT pipe-delimited format.');
  } else {
    parts.push('Converted structure to compact PAKT syntax.');
  }

  // Tabular arrays
  if (analysis.tabularArrays > 0) {
    const cols = analysis.uniqueKeys > 0 ? analysis.uniqueKeys : '?';
    parts.push(
      `Converted ${analysis.tabularArrays} array${analysis.tabularArrays > 1 ? 's' : ''} to tabular format (${cols} columns).`,
    );
  }

  // Key repetition
  if (analysis.keyRepetitionRatio > 0.5) {
    parts.push(
      `Key repetition ratio of ${analysis.keyRepetitionRatio} means keys were written once as headers instead of repeated per object.`,
    );
  }

  // Overhead
  parts.push(`Structural overhead was ${analysis.structuralOverhead} of total tokens.`);

  return parts.join(' ');
}

/**
 * Build a human-readable explanation for L2 dictionary compression.
 *
 * @param saved - Tokens saved by L2
 * @param analysis - Dictionary analysis
 * @returns Explanation string
 */
function buildL2Explanation(saved: number, analysis: DictionaryAnalysis): string {
  if (saved === 0 || analysis.aliasesCreated === 0) {
    return 'No repeated values met the aliasing threshold.';
  }

  const parts: string[] = [];

  parts.push(
    `Found ${analysis.candidatesFound} repeated pattern${analysis.candidatesFound > 1 ? 's' : ''}. Created ${analysis.aliasesCreated} alias${analysis.aliasesCreated > 1 ? 'es' : ''}.`,
  );

  // Top patterns summary
  const top3 = analysis.topPatterns.slice(0, 3);
  if (top3.length > 0) {
    const patternDescs = top3.map((p) => {
      const truncated = p.value.length > 30 ? `${p.value.slice(0, 27)}...` : p.value;
      return `'${truncated}' (${p.occurrences}x, saved ${p.tokensSaved} tokens)`;
    });
    parts.push(`Top patterns: ${patternDescs.join(', ')}.`);
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

/**
 * Generate a human-readable recommendation based on compression results.
 *
 * @param result - Compression result from the pipeline
 * @param compressibility - Compressibility score analysis
 * @returns Recommendation string
 */
export function generateRecommendation(
  result: PaktResult,
  compressibility: CompressibilityResult,
): string {
  const parts: string[] = [];
  const savings = result.savings.totalPercent;

  // Overall assessment
  if (compressibility.score >= 0.8) {
    parts.push(`This input is highly compressible (score: ${compressibility.score}).`);
  } else if (compressibility.score >= 0.6) {
    parts.push(`This input has good compressibility (score: ${compressibility.score}).`);
  } else if (compressibility.score >= 0.4) {
    parts.push(`This input has moderate compressibility (score: ${compressibility.score}).`);
  } else {
    parts.push(`This input has low compressibility (score: ${compressibility.score}).`);
  }

  // What drove the savings
  if (savings > 0) {
    parts.push(`Achieved ${savings}% savings (${result.savings.totalTokens} tokens).`);
  } else {
    parts.push('No token savings achieved — input is already near-optimal for its format.');
  }

  // Format-specific advice
  if (compressibility.breakdown.schemaUniformity > 0.8) {
    parts.push('The uniform array structure makes it ideal for PAKT tabular compression.');
  }
  if (compressibility.breakdown.repetitionDensity > 0.5 && result.dictionary.length > 0) {
    parts.push('High value repetition means the dictionary layer is pulling its weight.');
  }

  // L3 suggestion when not yet applied
  if (result.savings.byLayer.tokenizer === 0 && savings > 0) {
    parts.push(
      'Consider enabling L3 tokenizer-aware compression for an additional ~2-3% savings on some models.',
    );
  }

  // Reversibility note
  if (!result.reversible) {
    parts.push('Warning: L4 semantic compression was applied — this output is NOT reversible.');
  }

  return parts.join(' ');
}

/**
 * @module compressibility
 * Pre-compression analysis — estimates how well PAKT will compress an input
 * before actually running the pipeline.
 *
 * Inspired by "Data Distribution Matters" (arXiv:2602.01778, Lv et al. 2026)
 * and Compactor's context-calibrated compression (arXiv:2507.08143).
 *
 * The score is a weighted combination of four structural signals:
 * - Repetition density: ratio of repeated values to total values
 * - Structural overhead: ratio of syntax tokens to data content
 * - Schema uniformity: how consistent object shapes are across arrays
 * - Value brevity: average value length (shorter = less compressible)
 *
 * Performance: for inputs larger than {@link MAX_SAMPLE_SIZE}, only a prefix
 * sample is analyzed. JSON parsing is skipped for inputs over {@link MAX_PARSE_BYTES}.
 * Extracted values capped at {@link MAX_VALUES} via a single merged tree walk.
 *
 * @see docs/articles/compressibility-scoring.md
 */

import { detect } from './detect.js';
import type { PaktFormat, PaktLayerProfileId } from './types.js';

// ---- Types ----------------------------------------------------------------

/** Human-readable compressibility label derived from the numeric score. */
export type CompressibilityLabel = 'low' | 'moderate' | 'good' | 'high' | 'excellent';

/** Breakdown of individual scoring dimensions. */
export interface CompressibilityBreakdown {
  /** Ratio of repeated values to total values (0.0-1.0) */
  repetitionDensity: number;
  /** Ratio of syntax characters to total length (0.0-1.0) */
  structuralOverhead: number;
  /** Consistency of object shapes across arrays (0.0-1.0) */
  schemaUniformity: number;
  /** Penalty/bonus based on average value length (0.0-1.0) */
  valueLengthScore: number;
}

/**
 * Result from {@link estimateCompressibility}. Contains the overall score,
 * a human-readable label, a recommended layer profile, and a per-dimension
 * breakdown for diagnostics.
 *
 * @example
 * ```ts
 * const r: CompressibilityResult = estimateCompressibility(input);
 * if (r.score < 0.2) console.log('Skip compression — low compressibility');
 * ```
 */
export interface CompressibilityResult {
  /** Overall compressibility score (0.0 = incompressible, 1.0 = maximally compressible) */
  score: number;
  /** Human-readable label: low | moderate | good | high | excellent */
  label: CompressibilityLabel;
  /** Recommended PAKT layer profile based on the score */
  profile: PaktLayerProfileId;
  /** Detected input format */
  format: PaktFormat;
  /** Per-dimension breakdown for diagnostics */
  breakdown: CompressibilityBreakdown;
}

// ---- Sampling constants ---------------------------------------------------

/** Max characters to scan for structure scoring and text splitting. */
const MAX_SAMPLE_SIZE = 32768;

/** Max leaf values to collect from parsed JSON/YAML trees. */
const MAX_VALUES = 2000;

/** Max CSV lines to process for value extraction. */
const MAX_CSV_LINES = 200;

/** Max input bytes before skipping JSON.parse deep analysis (DoS guard). */
const MAX_PARSE_BYTES = 10_000_000;

/** Max cells to retain per CSV line (prevents spread-explosion on pathological input). */
const MAX_CELLS_PER_LINE = 500;

// ---- Scoring weights (sum to 1.0) -----------------------------------------

/** Weight for repetition density in the final score. */
const W_REPETITION = 0.35;
/** Weight for structural overhead in the final score. */
const W_STRUCTURE = 0.3;
/** Weight for schema uniformity in the final score. */
const W_SCHEMA = 0.2;
/** Weight for value length bonus/penalty in the final score. */
const W_VALUE_LEN = 0.15;

// ---- Syntax char-code lookup (ASCII only) ---------------------------------

/** Lookup table: charCode -> 1 if syntax char. Uses charCodeAt for hot-loop perf. */
const SYNTAX_LOOKUP = new Uint8Array(128);
/* { } [ ] " , : \n \r \t space */
for (const ch of [123, 125, 91, 93, 34, 44, 58, 10, 13, 9, 32]) {
  SYNTAX_LOOKUP[ch] = 1;
}

// ---- Merged tree walk (values + schemas in one pass) ----------------------

/** Result from {@link analyzeStructure}: values + schemas from a single walk. */
interface StructureAnalysis {
  /** Leaf values (strings, stringified numbers/booleans, and object keys) */
  values: string[];
  /** Array-level schema fingerprints: each entry is the key-set strings for one array */
  schemas: string[][];
}

/**
 * Walk a parsed JSON/YAML tree once, collecting both leaf values and
 * array-level schema fingerprints. Caps collected values at {@link MAX_VALUES}
 * for large inputs — once hit, still walks arrays for schema data but skips
 * value collection.
 *
 * @param data - Parsed JS value (from JSON.parse or YAML.parse)
 * @returns Combined values + schemas from a single pass
 */
function analyzeStructure(data: unknown): StructureAnalysis {
  const values: string[] = [];
  const schemas: string[][] = [];
  let valuesFull = false;

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: recursive walk collects values and schemas in a single pass
  function walk(node: unknown): void {
    if (node === null || node === undefined) return;

    if (typeof node === 'string') {
      if (!valuesFull) {
        values.push(node);
        if (values.length >= MAX_VALUES) valuesFull = true;
      }
      return;
    }
    if (typeof node === 'number' || typeof node === 'boolean') {
      if (!valuesFull) {
        values.push(String(node));
        if (values.length >= MAX_VALUES) valuesFull = true;
      }
      return;
    }

    if (Array.isArray(node)) {
      /* Collect schema fingerprints for arrays of objects */
      if (node.length > 0) {
        const fingerprints: string[] = [];
        for (const item of node) {
          if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
            fingerprints.push(
              Object.keys(item as Record<string, unknown>)
                .sort()
                .join(','),
            );
          }
        }
        if (fingerprints.length > 1) schemas.push(fingerprints);
      }
      /* Recurse into array elements */
      for (const item of node) walk(item);
      return;
    }

    if (typeof node === 'object') {
      /* Collect keys as values too — they're part of the token budget */
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
        if (!valuesFull) {
          values.push(key);
          if (values.length >= MAX_VALUES) valuesFull = true;
        }
        walk(val);
      }
    }
  }

  walk(data);
  return { values, schemas };
}

// ---- Dimension scorers ----------------------------------------------------

/**
 * Compute repetition density: ratio of duplicated values to total values.
 * Higher = more repetition = more compressible (L2 dictionary benefits).
 *
 * @param values - All extracted leaf values
 * @returns Score from 0.0 (all unique) to 1.0 (all identical)
 */
function scoreRepetition(values: string[]): number {
  if (values.length === 0) return 0;
  const unique = new Set(values).size;
  /* 1 - (unique / total): 0 when all unique, approaches 1 with many dupes */
  return 1 - unique / values.length;
}

/**
 * Compute structural overhead: ratio of syntax characters to total length.
 * Higher = more overhead = more compressible (L1 strips these).
 *
 * Uses charCodeAt + lookup table for hot-loop performance. For large inputs,
 * only scans up to {@link MAX_SAMPLE_SIZE} characters and extrapolates the
 * ratio — representative for homogeneous formats like JSON/CSV.
 *
 * @param input - Raw input string
 * @returns Score from 0.0 (no syntax) to 1.0 (all syntax)
 */
function scoreStructure(input: string): number {
  if (input.length === 0) return 0;
  const len = Math.min(input.length, MAX_SAMPLE_SIZE);
  let syntaxCount = 0;
  for (let i = 0; i < len; i++) {
    const code = input.charCodeAt(i);
    /* Only ASCII chars can be syntax; skip lookup for code >= 128 */
    if (code < 128 && SYNTAX_LOOKUP[code] === 1) syntaxCount++;
  }
  /* Ratio over sampled length — representative for homogeneous formats */
  return syntaxCount / len;
}

/**
 * Compute schema uniformity across arrays of objects.
 * Higher = more uniform = better tabular compression.
 *
 * @param schemas - Array of key-set fingerprint arrays
 * @returns Score from 0.0 (no arrays / all different shapes) to 1.0 (all identical shapes)
 */
function scoreSchema(schemas: string[][]): number {
  if (schemas.length === 0) return 0; // no arrays → no evidence of tabular compressibility

  let totalItems = 0;
  let maxCountSum = 0;

  for (const fingerprints of schemas) {
    if (fingerprints.length < 2) continue;
    /* Majority-vote: find the most common fingerprint */
    const counts = new Map<string, number>();
    let localMax = 0;
    for (const fp of fingerprints) {
      const c = (counts.get(fp) ?? 0) + 1;
      counts.set(fp, c);
      if (c > localMax) localMax = c;
    }
    totalItems += fingerprints.length;
    maxCountSum += localMax;
  }

  return totalItems === 0 ? 0 : maxCountSum / totalItems;
}

/**
 * Compute value length score: bonus for long values (good L2 candidates),
 * penalty for very short values (little to compress).
 *
 * @param values - All extracted leaf values
 * @returns Score from 0.0 (all single-char) to 1.0 (all long strings)
 */
function scoreValueLength(values: string[]): number {
  if (values.length === 0) return 0;
  const avgLen = values.reduce((sum, v) => sum + v.length, 0) / values.length;

  /* Sigmoid-like curve: score rises quickly from 0-10 chars, plateaus after 20 */
  if (avgLen <= 1) return 0.1;
  if (avgLen <= 3) return 0.3;
  if (avgLen <= 8) return 0.5;
  if (avgLen <= 20) return 0.7;
  return 0.9;
}

// ---- Label and profile mapping --------------------------------------------

/**
 * Map a numeric score to a human-readable compressibility label.
 *
 * @param score - Compressibility score (0.0-1.0)
 * @returns Label string
 */
function scoreToLabel(score: number): CompressibilityLabel {
  if (score < 0.2) return 'low';
  if (score < 0.4) return 'moderate';
  if (score < 0.6) return 'good';
  if (score < 0.8) return 'high';
  return 'excellent';
}

/**
 * Recommend a layer profile based on the compressibility score.
 * Higher scores warrant more aggressive compression layers.
 *
 * @param score - Compressibility score (0.0-1.0)
 * @returns Recommended profile identifier
 */
function scoreToProfile(score: number): PaktLayerProfileId {
  if (score < 0.4) return 'structure';
  if (score < 0.6) return 'standard';
  if (score < 0.8) return 'tokenizer';
  return 'semantic';
}

// ---- Public API -----------------------------------------------------------

/**
 * Estimate how well PAKT will compress an input string, without actually
 * running the compression pipeline.
 *
 * Returns a 0.0-1.0 score, a human-readable label, a recommended layer
 * profile, and a per-dimension breakdown. Use this to decide whether
 * compression is worth the overhead, or to auto-select a profile.
 *
 * For large inputs (> 32KB), only a representative sample is analyzed to
 * keep the estimator lightweight — O(min(N, 32K)) for structure scoring,
 * capped value extraction for JSON, and limited line counts for CSV.
 *
 * @param input - Raw input text (JSON, YAML, CSV, markdown, or plain text)
 * @returns Compressibility analysis result
 *
 * @example
 * ```ts
 * import { estimateCompressibility } from '@sriinnu/pakt';
 *
 * const r = estimateCompressibility(JSON.stringify(apiResponse));
 * if (r.score < 0.2) {
 *   console.log('Low compressibility — skip compression');
 * } else {
 *   console.log(`Recommended profile: ${r.profile}`);
 * }
 * ```
 *
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: compressibility scoring combines multiple weighted factors
export function estimateCompressibility(input: string): CompressibilityResult {
  const detection = detect(input);

  /* Try to parse structured data for deep analysis */
  let values: string[] = [];
  let schemas: string[][] = [];

  if (detection.format === 'json') {
    if (input.length > MAX_PARSE_BYTES) {
      /* Skip deep JSON analysis for oversized inputs (DoS guard) */
      const sample = input.length > MAX_SAMPLE_SIZE ? input.slice(0, MAX_SAMPLE_SIZE) : input;
      values = sample.split(/\s+/).filter((w) => w.length > 0);
    } else {
      try {
        /* JSON.parse needs the full input; analyzeStructure caps values internally */
        const parsed = JSON.parse(input);
        const analysis = analyzeStructure(parsed);
        values = analysis.values;
        schemas = analysis.schemas;
      } catch {
        /* Fall back to text-level analysis on sampled prefix */
        const sample = input.length > MAX_SAMPLE_SIZE ? input.slice(0, MAX_SAMPLE_SIZE) : input;
        values = sample.split(/\s+/).filter((w) => w.length > 0);
      }
    }
  } else if (detection.format === 'csv') {
    /* CSV: split lines into cells, cap at MAX_CSV_LINES */
    const lines = input.split('\n').filter((l) => l.trim().length > 0);
    const capped = lines.length > MAX_CSV_LINES ? lines.slice(0, MAX_CSV_LINES) : lines;
    for (const line of capped) {
      const cells = line
        .split(/[,\t|;]/)
        .slice(0, MAX_CELLS_PER_LINE)
        .map((c) => c.trim());
      values.push(...cells);
    }
    /* CSV is inherently uniform — boost schema score */
    if (capped.length > 1) schemas = [capped.map(() => 'csv-row')];
  } else {
    /* Text/markdown/YAML: use word-level tokenization on sampled prefix */
    const sample = input.length > MAX_SAMPLE_SIZE ? input.slice(0, MAX_SAMPLE_SIZE) : input;
    values = sample.split(/\s+/).filter((w) => w.length > 0);
  }

  /* Compute each dimension */
  const repetitionDensity = scoreRepetition(values);
  const structuralOverhead = scoreStructure(input);
  const schemaUniformity = scoreSchema(schemas);
  const valueLengthScore = scoreValueLength(values);

  /* Weighted sum → final score, clamped to [0, 1] */
  const raw =
    W_REPETITION * repetitionDensity +
    W_STRUCTURE * structuralOverhead +
    W_SCHEMA * schemaUniformity +
    W_VALUE_LEN * valueLengthScore;
  const score = Math.round(Math.min(1, Math.max(0, raw)) * 100) / 100;

  return {
    score,
    label: scoreToLabel(score),
    profile: scoreToProfile(score),
    format: detection.format,
    breakdown: {
      repetitionDensity: Math.round(repetitionDensity * 100) / 100,
      structuralOverhead: Math.round(structuralOverhead * 100) / 100,
      schemaUniformity: Math.round(schemaUniformity * 100) / 100,
      valueLengthScore: Math.round(valueLengthScore * 100) / 100,
    },
  };
}

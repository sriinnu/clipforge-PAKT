/**
 * @module types
 * All shared types, interfaces, and constants for the PAKT library.
 * This is the single source of truth — never duplicate type definitions.
 */

import type { PIIMode } from './layers/L4-pii.js';
import type { PIIKind, PIIMatch } from './pii/detector.js';

// ---------------------------------------------------------------------------
// PII re-exports
// ---------------------------------------------------------------------------

export type { PIIKind, PIIMatch, PIIMode };

// ---------------------------------------------------------------------------
// Format types
// ---------------------------------------------------------------------------

/**
 * Supported input/output formats that PAKT can convert between.
 * @example
 * ```ts
 * const fmt: PaktFormat = 'json';
 * ```
 */
export type PaktFormat = 'json' | 'yaml' | 'csv' | 'markdown' | 'pakt' | 'text';

// ---------------------------------------------------------------------------
// Compression layers
// ---------------------------------------------------------------------------

/**
 * Compression layers available in the PAKT pipeline.
 * - L1 (structural): Converts format structure to PAKT syntax
 * - L2 (dictionary): N-gram deduplication with aliases
 * - L3 (tokenizer): Model-specific delimiter optimization (gated)
 * - L4 (semantic): Lossy compression (opt-in, flagged)
 * @example
 * ```ts
 * const layers: PaktLayers = {
 *   structural: true, dictionary: true,
 *   tokenizerAware: false, semantic: false, contentAware: false,
 * };
 * ```
 */
export interface PaktLayers {
  /** L1 -- structural conversion to PAKT syntax */
  structural: boolean;
  /** L2 -- dictionary-based n-gram deduplication */
  dictionary: boolean;
  /** L3 -- model-specific tokenizer optimization (gated) */
  tokenizerAware: boolean;
  /** L4 -- lossy semantic compression (opt-in, flagged) */
  semantic: boolean;
  /** L5 -- content-aware compression: abbreviations, URL compression, etc. (opt-in) */
  contentAware: boolean;
  /**
   * L3.5 -- meta-token compression: aliases for recurring BPE token spans that
   * cross word boundaries (the gap L2 substring mining misses). OFF by default.
   * Requires L2 (dictionary) to be active. Lossless; uses the same @dict alias
   * mechanism as L2 so decompression needs zero additional logic.
   */
  metatoken?: boolean;
}

/**
 * Canonical layer profile identifiers exposed across CLI, apps, and MCP-adjacent
 * tooling.
 */
export type PaktLayerProfileId = 'structure' | 'standard' | 'tokenizer' | 'semantic';

/**
 * Shared metadata for a named layer profile.
 */
export interface PaktLayerProfile {
  /** Stable identifier for persistence and API wiring. */
  id: PaktLayerProfileId;
  /** Human-readable label. */
  label: string;
  /** Short chip-friendly label. */
  shortLabel: string;
  /** Concise description of what the profile enables. */
  description: string;
  /** Which layers are active in this profile. */
  layers: PaktLayers;
  /** False when the profile requires L4 semantic compression. */
  reversible: boolean;
  /** True when a positive semantic budget must be supplied. */
  requiresSemanticBudget: boolean;
}

// ---------------------------------------------------------------------------
// Compression options
// ---------------------------------------------------------------------------

/**
 * Options for the compress() function. All fields optional; defaults
 * are applied via {@link DEFAULT_OPTIONS}.
 * @example
 * ```ts
 * const opts: PaktOptions = {
 *   layers: { structural: true, dictionary: true },
 *   fromFormat: 'json',
 *   dictMinSavings: 5,
 * };
 * const result = compress(myJson, opts);
 * ```
 */
export interface PaktOptions {
  /** Which compression layers to apply. Default: L1+L2 enabled */
  layers?: Partial<PaktLayers>;
  /** Input format. Auto-detected if not provided */
  fromFormat?: PaktFormat;
  /**
   * Target model for L3 tokenizer optimization and token counting.
   *
   * The model string is resolved to a tokenizer family via
   * `getTokenizerFamily(model)`:
   * - `gpt-4o*`, `gpt-4.1`, `o1`, `o3`, `o4`, `chatgpt-4o*` -> `o200k_base`
   * - `gpt-4`, `gpt-3.5` -> `cl100k_base`
   * - `claude-*`, `llama-*`, unknown -> `cl100k_base` (approximate;
   *   Claude's tokenizer is proprietary and Llama's 128k vocab is not
   *   shipped by `gpt-tokenizer`)
   *
   * L3's savings gate (`compress-helpers.ts`) uses the family-resolved
   * counter, so L3 will make the right merge decisions for the target.
   */
  targetModel?: string;
  /** Min net token savings to create a dict alias. @default 3 */
  dictMinSavings?: number;
  /** Token budget for L4 semantic compression. @default 0 */
  semanticBudget?: number;
  /**
   * Hard cap on input size in UTF-8 bytes. Inputs larger than this are
   * returned untouched (0% savings) to protect against OOM / CPU DoS
   * on direct library consumers. MCP and CLI entry points have their
   * own tighter caps. @default 10_000_000 (10 MB)
   */
  maxInputBytes?: number;
  /**
   * L4 PII strategy. Controls personally-identifiable information
   * handling on the compressed output:
   *
   * - `'off'` (default) — no scanning.
   * - `'flag'` — detect and emit an `@warning pii` header; lossless.
   * - `'redact'` — detect AND substitute placeholders like `[EMAIL]`;
   *   lossy. Forces `reversible: false` on the result.
   */
  piiMode?: PIIMode;
  /**
   * Optional whitelist of PII kinds to detect. Defaults to all kinds.
   * Ignored when `piiMode === 'off'`.
   */
  piiKinds?: readonly PIIKind[];
  /**
   * When `piiMode === 'redact'`, also return the placeholder→original
   * mapping on the result (stored in `PaktResult.piiMapping`). The
   * PAKT output itself never carries the mapping. Default: `false`.
   */
  piiReversible?: boolean;
  /**
   * Target LLM provider. When set, `compress()` returns a
   * `cacheBreakpoint` hint on the result identifying where the
   * cacheable prefix ends (right after the `@dict ... @end` block) and
   * what TTL the target accepts. PAKT itself does not call the SDK —
   * consumers translate the hint into the provider's `cache_control`
   * field. Bedrock supports a 1-hour TTL (Jan 2026) while Anthropic's
   * default dropped to 5 minutes (Mar 2026), so the prefix-stable
   * `@dict` work matters more on Bedrock today. Leave unset to skip the
   * hint entirely.
   *
   * Setting a target also injects a `@cache prefix-end` directive after
   * the `@dict ... @end` block (when a dictionary was emitted) so the
   * boundary is visible in the output itself. The directive is a no-op
   * header — `decompress()` strips it before parsing.
   */
  target?: CacheTarget;
  /**
   * Emit the `@cache prefix-end` directive after the `@dict ... @end`
   * block without choosing a provider {@link target} (no
   * `cacheBreakpoint` hint is computed). Useful when the consumer wants
   * the boundary marked in-band but resolves TTLs itself. No-op when no
   * dictionary block was emitted. @default false
   */
  cacheDirective?: boolean;
  /**
   * Where the L2 dictionary lives in the output. `'inline'` (default)
   * keeps the `@dict` block at the top of `compressed`; `'system'`
   * removes it from the body and returns it on
   * {@link PaktResult.dictBlock} so it can be pinned into a cached
   * system prompt. See {@link DictPlacement}.
   */
  dictPlacement?: DictPlacement;
}

// ---------------------------------------------------------------------------
// Cache types — see `./types-cache.ts`
// ---------------------------------------------------------------------------

export type { CacheBreakpoint, CacheTarget, DictPlacement } from './types-cache.js';
import type { CacheBreakpoint, CacheTarget, DictPlacement } from './types-cache.js';

/**
 * Extended options including internal pipeline plumbing.
 * Used by the MCP handler to pass rolling dictionary seeds through the pipeline.
 * Not part of the public API — consumers use {@link PaktOptions}.
 */
export interface PaktPipelineOptions extends PaktOptions {
  /** Set of expansion strings known from prior turns for cross-turn alias reuse. */
  seedAliases?: Set<string>;
}

// ---------------------------------------------------------------------------
// Compression result
// ---------------------------------------------------------------------------

/**
 * Result from compress(). Contains the compressed PAKT string
 * and metadata about savings.
 * @example
 * ```ts
 * const result: PaktResult = compress('{"name":"Alice"}');
 * console.log(result.compressed);
 * console.log(`Saved ${result.savings.totalPercent}% tokens`);
 * ```
 */
export interface PaktResult {
  /** The compressed PAKT string */
  compressed: string;
  /** Token count of the original input */
  originalTokens: number;
  /** Token count of the compressed output */
  compressedTokens: number;
  /** Savings breakdown */
  savings: PaktSavings;
  /** False only when L4 (semantic) was applied */
  reversible: boolean;
  /** The detected or specified input format */
  detectedFormat: PaktFormat;
  /** Dictionary entries created (empty if L2 not applied) */
  dictionary: DictEntry[];
  /**
   * Per-kind PII counts when {@link PaktOptions.piiMode} is `'flag'` or
   * `'redact'`. Absent when `piiMode === 'off'` or no PII was found.
   */
  piiCounts?: Partial<Record<PIIKind, number>>;
  /**
   * Placeholder → original value map, populated only when
   * `piiMode === 'redact'` AND `piiReversible === true`. Callers are
   * expected to store this locally (e.g. to restore originals after an
   * LLM round-trip). The compressed PAKT string itself never contains
   * the mapping.
   */
  piiMapping?: Record<string, string>;
  /**
   * Cache-control hint when {@link PaktOptions.target} is set. Identifies
   * the byte offset in `compressed` where the cacheable prefix ends so
   * consumers can place the provider's `cache_control` breakpoint there.
   * Absent when no `target` was specified, and also absent when
   * `dictPlacement: 'system'` extracted the dictionary — in that case the
   * entire {@link dictBlock} is the cacheable unit.
   */
  cacheBreakpoint?: CacheBreakpoint;
  /**
   * The standalone dictionary block (`@dict ... @end`, plus the
   * `@cache prefix-end` directive when one was emitted), present only
   * when {@link PaktOptions.dictPlacement} is `'system'` AND a dictionary
   * was actually emitted. `compressed` then omits the inline `@dict`
   * section and references aliases only. Token accounting note:
   * `compressedTokens` still counts dict + body together, since the dict
   * must reach the model once (amortized via the system-prompt cache).
   * Round-trip with `decompress(compressed, { dict: dictBlock })`.
   */
  dictBlock?: string;
}

// ---------------------------------------------------------------------------
// Savings breakdown
// ---------------------------------------------------------------------------

/**
 * Savings breakdown by layer and total.
 * @example
 * ```ts
 * const s: PaktSavings = {
 *   totalPercent: 42, totalTokens: 120,
 *   byLayer: { structural: 60, dictionary: 45, tokenizer: 15, semantic: 0, content: 0 },
 * };
 * ```
 */
export interface PaktSavings {
  /** Total savings percentage (0-100) */
  totalPercent: number;
  /** Total tokens saved */
  totalTokens: number;
  /** Per-layer breakdown of tokens saved */
  byLayer: {
    structural: number;
    dictionary: number;
    tokenizer: number;
    semantic: number;
    content: number;
  };
}

// ---------------------------------------------------------------------------
// Dictionary entry
// ---------------------------------------------------------------------------

/**
 * A dictionary entry mapping an alias to its expansion.
 * @example
 * ```ts
 * const entry: DictEntry = {
 *   alias: '$a', expansion: 'developer', occurrences: 5, tokensSaved: 8,
 * };
 * ```
 */
export interface DictEntry {
  /** The alias (e.g., "$a", "$b") */
  alias: string;
  /** The full expansion string */
  expansion: string;
  /** How many times this value appeared in the data */
  occurrences: number;
  /** Net tokens saved by this alias */
  tokensSaved: number;
}

// ---------------------------------------------------------------------------
// Decompression — see `./types-decompress.ts`
// ---------------------------------------------------------------------------

export type { DecompressOptions, DecompressResult } from './types-decompress.js';

// ---------------------------------------------------------------------------
// Format detection — see `./types-detect.ts`
// ---------------------------------------------------------------------------

export type { DetectionResult, EnvelopeInfo } from './types-detect.js';

// ---------------------------------------------------------------------------
// Savings report — see `./types-savings.ts`
// ---------------------------------------------------------------------------

export type { ModelPricing, SavingsReport } from './types-savings.js';

// ---------------------------------------------------------------------------
// Validation — see `./types-validation.ts`
// ---------------------------------------------------------------------------

export type {
  ValidationError,
  ValidationResult,
  ValidationWarning,
} from './types-validation.js';

// ---------------------------------------------------------------------------
// Model output interpretation — see `./types-model-output.ts`
// ---------------------------------------------------------------------------

export type {
  ModelOutputAction,
  ModelOutputOptions,
  ModelOutputResult,
} from './types-model-output.js';

// ---------------------------------------------------------------------------
// Parser mode
// ---------------------------------------------------------------------------

/**
 * Parser mode: strict rejects malformed input, lenient does best-effort.
 * @example
 * ```ts
 * const mode: ParserMode = 'strict';
 * ```
 */
export type ParserMode = 'strict' | 'lenient';

// ---------------------------------------------------------------------------
// Header types
// ---------------------------------------------------------------------------

/**
 * Valid header types in a PAKT document (prefixed with `@`).
 * @example
 * ```ts
 * const h: HeaderType = 'from'; // -> @from json
 * ```
 */
export type HeaderType = 'from' | 'target' | 'dict' | 'compress' | 'warning' | 'version';

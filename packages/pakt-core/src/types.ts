/**
 * @module types
 * All shared types, interfaces, and constants for the PAKT library.
 * This is the single source of truth — never duplicate type definitions.
 */

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
 *   tokenizerAware: false, semantic: false,
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
  /** Target model for L3 tokenizer optimization */
  targetModel?: string;
  /** Min net token savings to create a dict alias. @default 3 */
  dictMinSavings?: number;
  /** Token budget for L4 semantic compression. @default 0 */
  semanticBudget?: number;
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
 *   byLayer: { structural: 60, dictionary: 45, tokenizer: 15, semantic: 0 },
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
// Decompression result
// ---------------------------------------------------------------------------

/**
 * Result from decompress(). Contains decompressed data in both
 * structured and string form.
 * @example
 * ```ts
 * const result: DecompressResult = decompress(paktStr, 'json');
 * console.log(result.text);     // formatted JSON
 * console.log(result.data);     // parsed JS object
 * console.log(result.wasLossy); // false
 * ```
 */
export interface DecompressResult {
  /** Parsed structured data */
  data: unknown;
  /** Formatted output string in the requested format */
  text: string;
  /** Original format from @from header */
  originalFormat: PaktFormat;
  /** Whether lossy compression (L4) was applied */
  wasLossy: boolean;
  /** Recovered envelope preamble lines (e.g. HTTP headers), if present */
  envelope?: string[];
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/**
 * Result from detect(). Identifies the format of input text.
 * @example
 * ```ts
 * const r: DetectionResult = detect('{"key": "value"}');
 * // { format: 'json', confidence: 0.99, reason: 'Valid JSON parse' }
 * ```
 */
/**
 * Information about a detected envelope wrapping the body content.
 * For example, an HTTP response with headers wrapping a JSON body.
 * @example
 * ```ts
 * const env: EnvelopeInfo = {
 *   type: 'http',
 *   preamble: ['HTTP/1.1 200 OK', 'Content-Type: application/json'],
 *   bodyOffset: 52,
 * };
 * ```
 */
export interface EnvelopeInfo {
  /** Type of envelope detected */
  type: 'http';
  /** The preamble lines (status line, headers) before the body */
  preamble: string[];
  /** Character offset where the body starts in the original input */
  bodyOffset: number;
}

export interface DetectionResult {
  /** Detected format */
  format: PaktFormat;
  /** Confidence score (0 = none, 1 = certain) */
  confidence: number;
  /** Human-readable reasoning */
  reason: string;
  /** If present, the input has an envelope (e.g. HTTP headers) wrapping the body */
  envelope?: EnvelopeInfo;
}

// ---------------------------------------------------------------------------
// Savings report
// ---------------------------------------------------------------------------

/**
 * Token count and savings report for cost estimation.
 * @example
 * ```ts
 * const report: SavingsReport = {
 *   originalTokens: 500, compressedTokens: 280,
 *   savedTokens: 220, savedPercent: 44, model: 'gpt-4o',
 *   costSaved: { input: 0.00055, output: 0.0022, currency: 'USD' },
 * };
 * ```
 */
export interface SavingsReport {
  originalTokens: number;
  compressedTokens: number;
  savedTokens: number;
  /** Savings as percentage (0-100) */
  savedPercent: number;
  /** Model used for token counting */
  model: string;
  /** Estimated cost savings (present when model pricing is known) */
  costSaved?: { input: number; output: number; currency: string };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validation result from validate().
 * @example
 * ```ts
 * const r: ValidationResult = {
 *   valid: true, errors: [],
 *   warnings: [{ line: 3, column: 1, message: 'Unused alias $c', code: 'W001' }],
 * };
 * ```
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * A validation error with source location.
 * @example
 * ```ts
 * const err: ValidationError = { line: 5, column: 12, message: 'Undefined alias $z', code: 'E001' };
 * ```
 */
export interface ValidationError {
  line: number;
  column: number;
  message: string;
  /** Machine-readable code (e.g., "E001") */
  code: string;
}

/**
 * A non-fatal validation warning with source location.
 * @example
 * ```ts
 * const w: ValidationWarning = { line: 2, column: 1, message: 'Missing @from header', code: 'W002' };
 * ```
 */
export interface ValidationWarning {
  line: number;
  column: number;
  message: string;
  code: string;
}

// ---------------------------------------------------------------------------
// Model output interpretation
// ---------------------------------------------------------------------------

/**
 * Final action taken when interpreting an LLM response.
 */
export type ModelOutputAction =
  | 'passthrough'
  | 'invalid-pakt'
  | 'decompressed'
  | 'repaired-decompressed';

/**
 * Options for `interpretModelOutput()`.
 *
 * Use this helper when an LLM may respond with raw prose, JSON, or valid PAKT.
 * It auto-detects PAKT responses, optionally repairs minor syntax issues, and
 * decompresses them back to structured output.
 */
export interface ModelOutputOptions {
  /** Requested output format when decompression succeeds. Defaults to the `@from` header format. */
  outputFormat?: PaktFormat;
  /** Attempt best-effort repair before giving up on malformed PAKT. @default true */
  attemptRepair?: boolean;
  /** Search fenced code blocks for embedded PAKT. @default true */
  extractFenced?: boolean;
}

/**
 * Result from `interpretModelOutput()`.
 *
 * `text` is always the safest value to feed downstream:
 * - raw model response for passthrough / invalid PAKT
 * - decompressed output for valid PAKT
 */
export interface ModelOutputResult {
  /** Action taken by the interpreter. */
  action: ModelOutputAction;
  /** Final text for downstream consumers. */
  text: string;
  /** Structured data when decompression succeeds; otherwise the raw response text. */
  data: unknown;
  /** Original raw model response before any extraction or decompression. */
  originalText: string;
  /** Extracted PAKT candidate when one was found. */
  candidateText?: string;
  /** Format detected for the original model response. */
  responseFormat: PaktFormat;
  /** Original structured format declared inside PAKT, when decompressed. */
  originalFormat?: PaktFormat;
  /** True when the decompressed PAKT had `@warning lossy`. */
  wasLossy: boolean;
  /** True when best-effort repair was required before decompression. */
  repaired: boolean;
  /** True when the PAKT candidate came from a fenced code block instead of the full response. */
  extractedFromFence: boolean;
  /** Validation report for the chosen PAKT candidate, when applicable. */
  validation?: ValidationResult;
}

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

// ---------------------------------------------------------------------------
// Model pricing
// ---------------------------------------------------------------------------

/**
 * Model pricing for cost estimates.
 * @example
 * ```ts
 * const p: ModelPricing = { model: 'gpt-4o', inputPerMTok: 2.5, outputPerMTok: 10 };
 * ```
 */
export interface ModelPricing {
  model: string;
  /** Cost per million input tokens in USD */
  inputPerMTok: number;
  /** Cost per million output tokens in USD */
  outputPerMTok: number;
}

/**
 * @sriinnu/pakt — PAKT compression engine
 *
 * Lossless-first structured compression for LLM token optimization.
 * Core layers L1-L3 preserve round-trip fidelity; optional L4 is
 * budgeted and lossy. Compresses JSON, YAML, CSV, and Markdown
 * into a compact pipe-delimited format that often uses 30-50% fewer tokens.
 *
 * @packageDocumentation
 *
 * @example
 * ```ts
 * import { compress, decompress, detect } from '@sriinnu/pakt';
 *
 * // Compress JSON to PAKT
 * const result = compress('{"users": [{"name": "Alice"}, {"name": "Bob"}]}');
 * console.log(result.compressed);
 * console.log(`Saved ${result.savings.totalPercent}% tokens`);
 *
 * // Decompress back to JSON
 * const original = decompress(result.compressed, 'json');
 * console.log(original.text);
 *
 * // Detect input format
 * const detected = detect('name,role\nAlice,dev');
 * console.log(detected.format); // 'csv'
 * ```
 */

/** Library version */
export const VERSION = '0.10.0';

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

export { compress } from './compress.js';
export { decompress } from './decompress.js';
export { detect } from './detect.js';
export { validate, repair } from './utils/validate.js';

// ---------------------------------------------------------------------------
// Async & batch API
// ---------------------------------------------------------------------------

export { compressAsync, decompressAsync } from './async.js';
export { compressBatch } from './batch.js';
export type { BatchOptions, BatchItemResult } from './batch.js';

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

export { prettyPrint } from './serializer/index.js';
export type { PrettyOptions } from './serializer/index.js';

// ---------------------------------------------------------------------------
// Layer functions (advanced)
// ---------------------------------------------------------------------------

export { compressL4, decompressL4, applyL4Transforms } from './layers/index.js';
export {
  applyDeltaEncoding,
  revertDeltaEncoding,
  DELTA_SENTINEL,
  isNumericDeltaSentinel,
  needsNumericDeltaQuote,
  isTemporalDeltaSentinel,
  needsTemporalDeltaQuote,
  temporalDeltaEncodeTabular,
  temporalDeltaDecodeTabular,
} from './layers/index.js';

// ---------------------------------------------------------------------------
// PII detection / redaction (L4 strategy)
// ---------------------------------------------------------------------------

export { applyPIILayer } from './layers/index.js';
export type { L4PIIOptions, L4PIIResult, PIIMode } from './layers/index.js';
export { compactCode, detectCodeFamily, looksLikeCode } from './layers/index.js';
export type { CodeFamily, CompactCodeOptions, CompactCodeResult } from './layers/index.js';
export { detectPII, redactPII } from './pii/index.js';
export type {
  PIIKind,
  PIIMatch,
  PIIDetectionOptions,
  RedactPIIOptions,
  RedactPIIResult,
} from './pii/index.js';

// ---------------------------------------------------------------------------
// Mixed-content compression
// ---------------------------------------------------------------------------

export { compressMixed, decompressMixed, extractBlocks } from './mixed/index.js';
export type { MixedCompressResult, MixedBlockResult, ExtractedBlock } from './mixed/index.js';

// ---------------------------------------------------------------------------
// Token utilities
// ---------------------------------------------------------------------------

export { countTokens, compareSavings } from './tokens/index.js';

// ---------------------------------------------------------------------------
// Pluggable tokenizer
// ---------------------------------------------------------------------------

export {
  GptTokenCounter,
  O200kTokenCounter,
  o200kFactory,
  getModelEncoding,
} from './tokens/index.js';
export {
  registerTokenCounter,
  getTokenCounter,
  resetTokenCounterRegistry,
} from './tokens/index.js';
export type { TokenCounter, TokenCounterFactory, BpeEncoding } from './tokens/index.js';

// ---------------------------------------------------------------------------
// Tokenizer family awareness
// ---------------------------------------------------------------------------

export { getTokenizerFamily, getTokenizerFamilyInfo } from './tokens/index.js';
export type { TokenizerFamily, TokenizerFamilyInfo } from './tokens/index.js';

// ---------------------------------------------------------------------------
// Shared layer profiles
// ---------------------------------------------------------------------------

export {
  DEFAULT_SEMANTIC_BUDGET,
  PAKT_LAYER_PROFILES,
  getPaktLayerProfile,
  createProfiledPaktOptions,
} from './layer-profiles.js';

// ---------------------------------------------------------------------------
// Context Window Packer
// ---------------------------------------------------------------------------

export { pack } from './packer/index.js';
export type {
  PackerItem,
  PackerOptions,
  PackerResult,
  PackedItem,
  DroppedItem,
  PackerStats,
} from './packer/index.js';

// ---------------------------------------------------------------------------
// LLM Integration
// ---------------------------------------------------------------------------

export { PAKT_SYSTEM_PROMPT } from './prompt.js';
export { interpretModelOutput } from './model-output.js';

// ---------------------------------------------------------------------------
// MCP (Model Context Protocol) tools
// ---------------------------------------------------------------------------

export {
  PAKT_AUTO_CONTRACT,
  PAKT_COMPRESS_CONTRACT,
  PAKT_DASHBOARD_CONTRACT,
  PAKT_EXPLAIN_CONTRACT,
  PAKT_INSPECT_CONTRACT,
  PAKT_SAVINGS_CONTRACT,
  PAKT_STATS_CONTRACT,
  PAKT_MCP_CONTRACTS,
  PAKT_MCP_TOOLS,
  registerPaktTools,
  handlePaktTool,
  PaktToolInputError,
  recordCall,
  getSessionStats,
  resetSessionStats,
  setSessionId,
  getSessionId,
  dedupCache,
  resetDedupCache,
  rollingDict,
  resetRollingDict,
} from './mcp/index.js';
export type {
  PaktMcpContract,
  McpToolDefinition,
  McpToolInputSchema,
  McpToolProperty,
  PaktCompressArgs,
  PaktCompressResult,
  PaktAutoArgs,
  PaktAutoResult,
  PaktExplainArgs,
  PaktExplainResult,
  PaktInspectArgs,
  PaktInspectResult,
  PaktSavingsArgs,
  PaktSavingsResult,
  PaktDashboardArgs,
  PaktDashboardResult,
  PaktStatsArgs,
  PaktStatsResult,
  PaktToolName,
  PaktToolArgs,
  PaktToolResult,
  CallRecord,
  SessionStatsResult,
  FormatStats,
  DedupEntry,
  DedupStats,
  RollingEntry,
  RollingDictStats,
  PaktToolOptions,
} from './mcp/index.js';

// ---------------------------------------------------------------------------
// Persistent stats
// ---------------------------------------------------------------------------

export {
  generateSessionId,
  initSession,
  appendRecord,
  finalizeSession,
  readAllRecords,
  readProjectStats,
  readLifetimeStats,
  getActiveSessions,
  compactSessions,
  detectProject,
  resetAll,
  getStatsDir,
  resetStatsDir,
  setDisabled,
} from './stats/index.js';
export type {
  SessionHeader,
  SessionFooter,
  RawRecord,
  DailySummary,
  StatsLine,
  ReadOptions,
  SessionMeta,
  ActiveSession,
  ProjectStats,
  LifetimeStats,
} from './stats/index.js';

// ---------------------------------------------------------------------------
// Middleware interceptor & proxy
// ---------------------------------------------------------------------------

export { createPaktInterceptor, optimizeMessages } from './middleware/index.js';
export { startProxy } from './cli-proxy.js';
export type {
  PaktInterceptor,
  InterceptorConfig,
  InterceptorResult,
  InterceptorStats,
  OptimizeResult,
  ToolResultMessage,
} from './middleware/index.js';

// ---------------------------------------------------------------------------
// Proxy tool-catalog optimization (slim mode + search facade)
// ---------------------------------------------------------------------------

export { slimTool, slimTools, applySlimMode, truncateAtSentence, ToolCatalog, FACADE_TOOL_DEFINITIONS, handleFacadeRequest } from './proxy/index.js';
export type { FacadeHandleResult } from './proxy/index.js';
export type {
  ProviderTool,
  ToolInputSchema,
  ToolSchemaProperty,
  SlimToolOptions,
  ToolSlimSavings,
  CatalogEntry,
  CatalogSearchResult,
  FacadeToolName,
} from './proxy/index.js';

// ---------------------------------------------------------------------------
// Context engine
// ---------------------------------------------------------------------------

export { ContextEngine, createContextEngine } from './context-engine/index.js';
// Re-export opaque-block guards (append-only block — context engine consumers
// need these to detect provider compaction blocks without importing internals).
export {
  isOpaqueBlock,
  messageIsImmutable,
  BUILTIN_OPAQUE_TYPES,
} from './context-engine/index.js';
export type { OpaqueContentBlock } from './context-engine/index.js';
export {
  buildSharedDictionary,
  expandSharedDictionary,
} from './context-engine/index.js';
export type { SharedDictEntry, SharedDictResult } from './context-engine/index.js';
export { extractRelevant } from './context-engine/index.js';
export type { ExtractiveOptions, ExtractiveResult } from './context-engine/index.js';
export type {
  CompressionStrategy,
  ContextEngineConfig,
  ContextEngineStats,
  ContextFact,
  ContextIndex,
  ContextMessage,
  ContextSavings,
  OptimizedContext,
} from './context-engine/index.js';

// ---------------------------------------------------------------------------
// Prompt-cache synergy (cache directive + external dictionaries)
// ---------------------------------------------------------------------------

export { computeCacheBreakpoint, findCacheDirectiveOffset } from './cache-breakpoint.js';
export {
  CACHE_DIRECTIVE,
  extractDictBlock,
  injectCacheDirective,
  mergeExternalDict,
  stripCacheDirectives,
} from './dict-external.js';
export type { DictBlockSplit } from './dict-external.js';

// ---------------------------------------------------------------------------
// Compressibility scoring
// ---------------------------------------------------------------------------

export { estimateCompressibility } from './compressibility.js';
export type {
  CompressibilityResult,
  CompressibilityBreakdown,
  CompressibilityLabel,
} from './compressibility.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  PaktOptions,
  PaktPipelineOptions,
  PaktResult,
  PaktFormat,
  PaktLayers,
  PaktLayerProfileId,
  PaktLayerProfile,
  PaktSavings,
  CacheTarget,
  CacheBreakpoint,
  DictPlacement,
  DecompressOptions,
  DecompressResult,
  DetectionResult,
  DictEntry,
  SavingsReport,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ModelPricing,
  ParserMode,
  HeaderType,
  EnvelopeInfo,
  ModelOutputAction,
  ModelOutputOptions,
  ModelOutputResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Re-export constants from the dedicated constants module. */
export { DEFAULT_OPTIONS, DEFAULT_LAYERS, MODEL_PRICING } from './constants.js';

// ---------------------------------------------------------------------------
// Provider cache adapters
// ---------------------------------------------------------------------------

export {
  buildAnthropicCacheHints,
  buildOpenAICacheHints,
} from './middleware/provider-adapter.js';
export type {
  AnthropicCacheControl,
  AnthropicContentBlock,
  AnthropicCacheHints,
  AnthropicCacheHintsOptions,
  OpenAICacheHints,
  OpenAICacheHintsOptions,
} from './middleware/provider-adapter.js';

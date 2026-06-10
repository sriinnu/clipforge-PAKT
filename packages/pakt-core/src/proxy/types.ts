/**
 * @module proxy/types
 * Shared TypeScript types for the PAKT proxy tool-catalog modes.
 *
 * Two modes are supported:
 * - `slim`: lossless-in-spirit compression of tool JSON schemas sent to providers
 * - `search`: 3-tool facade (search_tools / get_tool_schema / call_tool) over the real catalog
 */

// ---------------------------------------------------------------------------
// Raw tool shapes (provider-agnostic subset)
// ---------------------------------------------------------------------------

/**
 * A JSON Schema property entry inside a tool's inputSchema.
 * Mirrors the subset used by Anthropic / OpenAI tool definitions.
 */
export interface ToolSchemaProperty {
  type?: string;
  description?: string;
  enum?: unknown[];
  items?: Record<string, unknown>;
  properties?: Record<string, ToolSchemaProperty>;
  required?: string[];
  /** Any extra keys we don't specifically handle. */
  [key: string]: unknown;
}

/**
 * The inputSchema block of an LLM provider tool definition.
 * At minimum it has `type: "object"` and `properties`.
 */
export interface ToolInputSchema {
  type?: string;
  properties?: Record<string, ToolSchemaProperty>;
  required?: string[];
  additionalProperties?: unknown;
  /** Any extra keys we don't specifically handle. */
  [key: string]: unknown;
}

/**
 * One tool entry as it appears in an LLM provider API request body
 * (Anthropic, OpenAI, and most MCP-derived formats share this shape).
 */
export interface ProviderTool {
  /** Tool name. Required. */
  name: string;
  /** Human-readable description. May be very long for some MCP servers. */
  description?: string;
  /** JSON Schema for the tool's input parameters. */
  input_schema?: ToolInputSchema;
  /** Alias used by some providers (e.g. OpenAI). Kept pass-through. */
  parameters?: ToolInputSchema;
  /** Any other provider-specific fields. */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Slim mode
// ---------------------------------------------------------------------------

/** Configuration for slim-mode tool compression. */
export interface SlimToolOptions {
  /**
   * Maximum character length for description fields before they are
   * truncated at a sentence boundary.
   * @default 1024
   */
  descriptionCap?: number;
}

/** Per-tool savings recorded during a slim-mode pass. */
export interface ToolSlimSavings {
  /** Original token count across all tool definitions. */
  originalTokens: number;
  /** Token count after slimming. */
  slimmedTokens: number;
  /** Absolute tokens saved. */
  savedTokens: number;
  /** Percentage saved (0–100). */
  savedPercent: number;
}

// ---------------------------------------------------------------------------
// Search facade
// ---------------------------------------------------------------------------

/**
 * One entry in the proxy's in-memory tool catalog, built at session start
 * from the real server's tool list.
 */
export interface CatalogEntry {
  /** Tool name. */
  name: string;
  /** Full description for keyword search. */
  description: string;
  /** The complete original tool definition for schema retrieval. */
  tool: ProviderTool;
}

/**
 * The 3-tool search-facade set injected in place of the real catalog.
 * These are the ONLY tools the upstream LLM client sees in `search` mode.
 */
export type FacadeToolName = 'search_tools' | 'get_tool_schema' | 'call_tool';

/**
 * Result of a catalog keyword search.
 */
export interface CatalogSearchResult {
  /** Matching tool name. */
  name: string;
  /** Tool description (possibly truncated). */
  description: string;
  /** Simple relevance score (higher = better match). */
  score: number;
}

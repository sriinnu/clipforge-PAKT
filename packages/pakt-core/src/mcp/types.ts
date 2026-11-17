/**
 * @module mcp/types
 * TypeScript types for the PAKT MCP (Model Context Protocol) tool interface.
 *
 * These types define the public JSON-schema tool metadata plus the input/output
 * contracts for the PAKT MCP tools.
 *
 * @see {@link https://modelcontextprotocol.io/docs/concepts/tools MCP Tools Spec}
 */

import type {
  PaktAutoArgsFromContract,
  PaktAutoResultFromContract,
  PaktCompressArgsFromContract,
  PaktCompressResultFromContract,
  PaktContractToolName,
  PaktDashboardArgsFromContract,
  PaktDashboardResultFromContract,
  PaktExplainArgsFromContract,
  PaktInspectArgsFromContract,
  PaktInspectResultFromContract,
  PaktMcpContract,
  PaktSavingsArgsFromContract,
  PaktSavingsResultFromContract,
  PaktStatsArgsFromContract,
} from './contract.js';

/**
 * JSON Schema property descriptor for MCP tool input parameters.
 * Used to describe each parameter in the tool's `inputSchema`.
 */
export interface McpToolProperty {
  /** JSON Schema type (e.g., 'string', 'number', 'boolean'). */
  type: string;
  /** Human-readable description of the parameter. */
  description: string;
  /** Allowed values for enum-style parameters. */
  enum?: readonly string[];
}

/**
 * JSON Schema input definition for an MCP tool.
 * Follows the JSON Schema subset used by the MCP spec.
 */
export interface McpToolInputSchema {
  /** Always 'object' for MCP tool inputs. */
  type: 'object';
  /** Map of parameter names to their JSON Schema definitions. */
  properties: Record<string, McpToolProperty>;
  /** List of required parameter names. */
  required: string[];
  /** Whether keys outside `properties` are allowed. */
  additionalProperties?: boolean;
}

/**
 * An MCP tool definition. Describes the tool's name, purpose,
 * and expected input shape for registration with an MCP server.
 */
export interface McpToolDefinition {
  /** Unique tool name (e.g., 'pakt_compress', 'pakt_auto'). */
  name: string;
  /** Human-readable description of what the tool does. */
  description: string;
  /** JSON Schema describing the tool's input parameters. */
  inputSchema: McpToolInputSchema;
}

export type PaktCompressArgs = PaktCompressArgsFromContract;
export type PaktCompressResult = PaktCompressResultFromContract;
export type PaktAutoArgs = PaktAutoArgsFromContract;
export type PaktAutoResult = PaktAutoResultFromContract;
export type PaktInspectArgs = PaktInspectArgsFromContract;
export type PaktInspectResult = PaktInspectResultFromContract;
export type PaktExplainArgs = PaktExplainArgsFromContract;
export type PaktStatsArgs = PaktStatsArgsFromContract;
export type PaktSavingsArgs = PaktSavingsArgsFromContract;
export type PaktSavingsResult = PaktSavingsResultFromContract;
export type PaktDashboardArgs = PaktDashboardArgsFromContract;
export type PaktDashboardResult = PaktDashboardResultFromContract;
/**
 * MCP-facing explain result. Nested objects (layerBreakdown, structuralAnalysis,
 * dictionaryAnalysis) are serialized as JSON strings to conform to the flat
 * contract outputSchema.
 */
export interface PaktExplainResult {
  /** Detected input format */
  detectedFormat: string;
  /** Overall savings percentage (0-100) */
  savings: number;
  /** Absolute tokens saved */
  savedTokens: number;
  /** JSON array of per-layer breakdown entries */
  layerBreakdown: string;
  /** JSON object with structural analysis */
  structuralAnalysis: string;
  /** JSON object with dictionary analysis */
  dictionaryAnalysis: string;
  /** Human-readable recommendation */
  recommendation: string;
}

/**
 * MCP-facing stats result. Nested objects are serialized as JSON strings
 * to conform to the flat contract outputSchema.
 */
export interface PaktStatsResult {
  sessionDuration: string;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalSavedTokens: number;
  overallSavingsPercent: number;
  callsByAction: string;
  byFormat: string;
  topFormat?: string;
  estimatedCostSaved?: string;
  lastCallAt?: string;
  dedupHits?: number;
  dedupEntries?: number;
  totalCompoundingSavings?: number;
  /** Rolling dictionary size (cross-turn alias reuse). */
  rollingDictSize?: number;
  /** Number of times a seeded alias was reused across turns. */
  rollingDictReuses?: number;
  /** Estimated tokens saved by rolling dictionary seeding. */
  rollingDictSavings?: number;
}

/** Union of all valid MCP tool names exposed by PAKT. */
export type PaktToolName = PaktContractToolName;

/** Union of all valid MCP tool argument types. */
export type PaktToolArgs =
  | PaktCompressArgs
  | PaktAutoArgs
  | PaktInspectArgs
  | PaktStatsArgs
  | PaktExplainArgs
  | PaktSavingsArgs
  | PaktDashboardArgs;

/** Union of all valid MCP tool result types. */
export type PaktToolResult =
  | PaktCompressResult
  | PaktAutoResult
  | PaktInspectResult
  | PaktStatsResult
  | PaktExplainResult
  | PaktSavingsResult
  | PaktDashboardResult;
export type { PaktMcpContract };

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
  PaktInspectArgsFromContract,
  PaktInspectResultFromContract,
  PaktMcpContract,
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

/** Union of all valid MCP tool names exposed by PAKT. */
export type PaktToolName = PaktContractToolName;

/** Union of all valid MCP tool argument types. */
export type PaktToolArgs = PaktCompressArgs | PaktAutoArgs | PaktInspectArgs;

/** Union of all valid MCP tool result types. */
export type PaktToolResult = PaktCompressResult | PaktAutoResult | PaktInspectResult;
export type { PaktMcpContract };

/**
 * @module mcp/types
 * TypeScript types for the PAKT MCP (Model Context Protocol) tool interface.
 *
 * These types define the input/output contracts for `pakt_compress` and
 * `pakt_auto` tools, following the MCP tool specification. All types are
 * fully typed -- no `any` usage.
 *
 * @see {@link https://modelcontextprotocol.io/docs/concepts/tools MCP Tools Spec}
 */

import type { PaktFormat } from '../types.js';

// ---------------------------------------------------------------------------
// MCP tool schema definition
// ---------------------------------------------------------------------------

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
}

/**
 * An MCP tool definition. Describes the tool's name, purpose,
 * and expected input shape for registration with an MCP server.
 *
 * @example
 * ```ts
 * const tool: McpToolDefinition = {
 *   name: 'pakt_compress',
 *   description: 'Compress text using PAKT format',
 *   inputSchema: {
 *     type: 'object',
 *     properties: { text: { type: 'string', description: 'Input text' } },
 *     required: ['text'],
 *   },
 * };
 * ```
 */
export interface McpToolDefinition {
  /** Unique tool name (e.g., 'pakt_compress', 'pakt_auto'). */
  name: string;
  /** Human-readable description of what the tool does. */
  description: string;
  /** JSON Schema describing the tool's input parameters. */
  inputSchema: McpToolInputSchema;
}

// ---------------------------------------------------------------------------
// pakt_compress types
// ---------------------------------------------------------------------------

/**
 * Input arguments for the `pakt_compress` tool.
 *
 * @example
 * ```ts
 * const args: PaktCompressArgs = {
 *   text: '{"name": "Alice", "role": "dev"}',
 *   format: 'json',
 * };
 * ```
 */
export interface PaktCompressArgs {
  /** The text content to compress. */
  text: string;
  /**
   * Optional format hint. When provided, skips auto-detection
   * and treats the input as this format.
   */
  format?: PaktFormat;
}

/**
 * Output from the `pakt_compress` tool.
 *
 * @example
 * ```ts
 * const result: PaktCompressResult = {
 *   compressed: '@from json\nname: Alice\nrole: dev',
 *   savings: 42,
 *   format: 'json',
 * };
 * ```
 */
export interface PaktCompressResult {
  /** The compressed PAKT string. */
  compressed: string;
  /** Savings percentage (0-100). */
  savings: number;
  /** The detected or specified input format. */
  format: PaktFormat;
}

// ---------------------------------------------------------------------------
// pakt_auto types
// ---------------------------------------------------------------------------

/**
 * Input arguments for the `pakt_auto` tool.
 *
 * @example
 * ```ts
 * const args: PaktAutoArgs = { text: '@from json\nname: Alice' };
 * ```
 */
export interface PaktAutoArgs {
  /** The text to auto-process (compress if raw, decompress if PAKT). */
  text: string;
}

/**
 * Output from the `pakt_auto` tool.
 *
 * @example
 * ```ts
 * const result: PaktAutoResult = {
 *   result: '{"name": "Alice"}',
 *   action: 'decompressed',
 * };
 * ```
 */
export interface PaktAutoResult {
  /** The processed text (compressed PAKT or decompressed original). */
  result: string;
  /** Whether the input was compressed or decompressed. */
  action: 'compressed' | 'decompressed';
  /** Savings percentage (only present when action is 'compressed'). */
  savings?: number;
}

// ---------------------------------------------------------------------------
// Handler union types
// ---------------------------------------------------------------------------

/** Union of all valid MCP tool names exposed by PAKT. */
export type PaktToolName = 'pakt_compress' | 'pakt_auto';

/** Union of all valid MCP tool argument types. */
export type PaktToolArgs = PaktCompressArgs | PaktAutoArgs;

/** Union of all valid MCP tool result types. */
export type PaktToolResult = PaktCompressResult | PaktAutoResult;

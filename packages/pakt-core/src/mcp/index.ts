/**
 * @module mcp
 * PAKT MCP (Model Context Protocol) integration.
 *
 * Provides MCP-compatible tool definitions and a handler function
 * for integrating PAKT compression into AI agent workflows.
 *
 * Exports:
 * - {@link PAKT_MCP_TOOLS} -- Array of MCP tool definitions to register with a server.
 * - {@link handlePaktTool} -- Dispatch function that routes tool calls to pakt-core.
 * - All types from `./types.js` for consumers who need to type-check arguments/results.
 *
 * @example
 * ```ts
 * import { PAKT_MCP_TOOLS, handlePaktTool } from '@sriinnu/pakt';
 *
 * // Register tools with an MCP server
 * for (const tool of PAKT_MCP_TOOLS) {
 *   server.registerTool(tool.name, tool.inputSchema, (args) =>
 *     handlePaktTool(tool.name, args),
 *   );
 * }
 * ```
 */

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export { PAKT_MCP_TOOLS } from './tools.js';

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

export { handlePaktTool } from './handler.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  McpToolDefinition,
  McpToolInputSchema,
  McpToolProperty,
  PaktAutoArgs,
  PaktAutoResult,
  PaktCompressArgs,
  PaktCompressResult,
  PaktToolArgs,
  PaktToolName,
  PaktToolResult,
} from './types.js';

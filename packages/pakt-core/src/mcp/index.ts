/**
 * @module mcp
 * PAKT MCP (Model Context Protocol) integration.
 *
 * Provides MCP-compatible tool definitions, a canonical contract source,
 * SDK registration helpers, and a handler function for integrating PAKT
 * compression into AI agent workflows.
 *
 * Exports:
 * - {@link PAKT_MCP_TOOLS} -- Array of MCP tool definitions to register with a server.
 * - {@link PAKT_MCP_CONTRACTS} -- Canonical tool contracts used by metadata and SDK wiring.
 * - {@link registerPaktTools} -- Register PAKT tools on an SDK McpServer instance.
 * - {@link handlePaktTool} -- Dispatch function that routes tool calls to pakt-core.
 * - All types from `./types.js` for consumers who need to type-check arguments/results.
 *
 * @example
 * ```ts
 * import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
 * import { registerPaktTools } from '@sriinnu/pakt';
 *
 * const server = new McpServer({ name: 'my-agent', version: '1.0.0' });
 * registerPaktTools(server);
 * ```
 */

export { PAKT_MCP_TOOLS } from './tools.js';
export {
  PAKT_AUTO_CONTRACT,
  PAKT_COMPRESS_CONTRACT,
  PAKT_INSPECT_CONTRACT,
  PAKT_MCP_CONTRACTS,
} from './contract.js';

export { registerPaktTools } from './server.js';
export { handlePaktTool, PaktToolInputError } from './handler.js';

export type {
  PaktMcpContract,
  McpToolDefinition,
  McpToolInputSchema,
  McpToolProperty,
  PaktAutoArgs,
  PaktAutoResult,
  PaktInspectArgs,
  PaktInspectResult,
  PaktCompressArgs,
  PaktCompressResult,
  PaktToolArgs,
  PaktToolName,
  PaktToolResult,
} from './types.js';

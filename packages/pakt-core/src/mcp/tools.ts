/**
 * @module mcp/tools
 * Public JSON-style MCP tool definitions derived from the canonical contracts.
 */

import { PAKT_MCP_CONTRACTS } from './contract.js';
import type { McpToolDefinition } from './types.js';

/**
 * All PAKT MCP tool definitions.
 *
 * These JSON-style definitions are useful for docs, registries, and hosts that
 * need the tool names, descriptions, and input schemas without the SDK helper.
 */
export const PAKT_MCP_TOOLS: readonly McpToolDefinition[] = PAKT_MCP_CONTRACTS.map(
  ({ name, description, inputJsonSchema }) => ({
    name,
    description,
    inputSchema: inputJsonSchema,
  }),
);

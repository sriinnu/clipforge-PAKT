/**
 * @module mcp/server
 * SDK-backed MCP server registration helpers for PAKT tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PAKT_AUTO_CONTRACT, PAKT_COMPRESS_CONTRACT, PAKT_INSPECT_CONTRACT } from './contract.js';
import { PaktToolInputError, handlePaktTool } from './handler.js';
import type { PaktToolName, PaktToolResult } from './types.js';

function toTextResult(result: PaktToolResult) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    structuredContent: result as unknown as Record<string, unknown>,
  };
}

function toSafeToolMessage(error: unknown): string {
  if (error instanceof PaktToolInputError) {
    return error.message;
  }

  return 'Tool execution failed';
}

function executeTool(name: PaktToolName, args: Record<string, unknown>) {
  try {
    const result = handlePaktTool(name, args);
    return toTextResult(result);
  } catch (error: unknown) {
    return {
      content: [{ type: 'text' as const, text: toSafeToolMessage(error) }],
      isError: true as const,
    };
  }
}

export function registerPaktTools(server: McpServer): void {
  server.registerTool(
    'pakt_compress',
    {
      description: PAKT_COMPRESS_CONTRACT.description,
      inputSchema: PAKT_COMPRESS_CONTRACT.inputSchema,
      outputSchema: PAKT_COMPRESS_CONTRACT.outputSchema,
    },
    async (args) => executeTool('pakt_compress', args),
  );

  server.registerTool(
    'pakt_auto',
    {
      description: PAKT_AUTO_CONTRACT.description,
      inputSchema: PAKT_AUTO_CONTRACT.inputSchema,
      outputSchema: PAKT_AUTO_CONTRACT.outputSchema,
    },
    async (args) => executeTool('pakt_auto', args),
  );

  server.registerTool(
    'pakt_inspect',
    {
      description: PAKT_INSPECT_CONTRACT.description,
      inputSchema: PAKT_INSPECT_CONTRACT.inputSchema,
      outputSchema: PAKT_INSPECT_CONTRACT.outputSchema,
    },
    async (args) => executeTool('pakt_inspect', args),
  );
}

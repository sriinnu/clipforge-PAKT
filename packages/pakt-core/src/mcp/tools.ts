/**
 * @module mcp/tools
 * MCP tool definitions for the PAKT compression engine.
 *
 * Exports a `PAKT_MCP_TOOLS` array containing two tool definitions
 * that follow the Model Context Protocol (MCP) specification:
 *
 * - **pakt_compress** -- Compresses text into PAKT format with savings metadata.
 * - **pakt_auto** -- Auto-detects direction: compresses raw text or decompresses PAKT.
 *
 * These definitions can be registered with any MCP-compatible server or agent
 * framework (e.g., Chitragupta, Claude Desktop, Cursor).
 *
 * @see {@link https://modelcontextprotocol.io/docs/concepts/tools MCP Tools Spec}
 *
 * @example
 * ```ts
 * import { PAKT_MCP_TOOLS } from '@sriinnu/pakt';
 *
 * // Register with an MCP server
 * for (const tool of PAKT_MCP_TOOLS) {
 *   server.registerTool(tool);
 * }
 * ```
 */

import type { McpToolDefinition } from './types.js';

// ---------------------------------------------------------------------------
// Tool: pakt_compress
// ---------------------------------------------------------------------------

/**
 * MCP tool definition for `pakt_compress`.
 *
 * Compresses input text into PAKT format. Supports optional format hints
 * to skip auto-detection when the caller knows the input format.
 *
 * Input: `{ text: string, format?: PaktFormat, semanticBudget?: number }`
 * Output: `{ compressed: string, savings: number, format: string }`
 */
const PAKT_COMPRESS_TOOL: McpToolDefinition = {
  name: 'pakt_compress',
  description: [
    'Compress text into PAKT format for LLM token optimization.',
    'Supports JSON, YAML, CSV, Markdown, and mixed content.',
    'Returns the compressed string and savings percentage.',
    'Use the optional `format` parameter to skip auto-detection.',
    'Use `semanticBudget` to opt into lossy L4 semantic compression.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text content to compress (JSON, YAML, CSV, Markdown, or mixed).',
      },
      format: {
        type: 'string',
        description:
          'Optional format hint. Skips auto-detection when provided. ' +
          'Valid values: json, yaml, csv, markdown, text.',
        enum: ['json', 'yaml', 'csv', 'markdown', 'text'],
      },
      semanticBudget: {
        type: 'number',
        description: 'Optional positive token budget for opt-in lossy L4 semantic compression.',
      },
    },
    required: ['text'],
  },
};

// ---------------------------------------------------------------------------
// Tool: pakt_auto
// ---------------------------------------------------------------------------

/**
 * MCP tool definition for `pakt_auto`.
 *
 * Automatically detects whether the input is already PAKT-compressed
 * or raw text, then routes accordingly:
 * - PAKT input is decompressed to human-readable format.
 * - Raw input is compressed to PAKT format.
 *
 * Input: `{ text: string, semanticBudget?: number }`
 * Output: `{ result: string, action: 'compressed' | 'decompressed', savings?: number }`
 */
const PAKT_AUTO_TOOL: McpToolDefinition = {
  name: 'pakt_auto',
  description: [
    'Auto-detect and process text: if input is PAKT, decompress it;',
    'if input is raw text/JSON/YAML/CSV/Markdown, compress it to PAKT.',
    'Returns the result string, the action taken, and savings (when compressing).',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to process. PAKT input is decompressed; raw input is compressed.',
      },
      semanticBudget: {
        type: 'number',
        description:
          'Optional positive token budget for opt-in lossy L4 semantic compression on the compress path.',
      },
    },
    required: ['text'],
  },
};

// ---------------------------------------------------------------------------
// Exported tools array
// ---------------------------------------------------------------------------

/**
 * All PAKT MCP tool definitions.
 *
 * Register these with an MCP server to expose PAKT compression
 * and auto-detection capabilities to AI agents.
 *
 * @example
 * ```ts
 * import { PAKT_MCP_TOOLS, handlePaktTool } from '@sriinnu/pakt';
 *
 * for (const tool of PAKT_MCP_TOOLS) {
 *   server.registerTool(tool.name, tool.inputSchema, (args) =>
 *     handlePaktTool(tool.name, args),
 *   );
 * }
 * ```
 */
export const PAKT_MCP_TOOLS: readonly McpToolDefinition[] = [
  PAKT_COMPRESS_TOOL,
  PAKT_AUTO_TOOL,
] as const;

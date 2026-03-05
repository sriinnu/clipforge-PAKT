/**
 * @module cli-serve
 * Minimal MCP stdio server for PAKT compression tools.
 *
 * Implements the Model Context Protocol over stdin/stdout using JSON-RPC 2.0.
 * Zero external dependencies — no `@modelcontextprotocol/sdk` required.
 *
 * Usage:
 *   pakt serve --stdio
 *   npx @sriinnu/pakt serve --stdio
 *
 * The server exposes two tools: `pakt_compress` and `pakt_auto`.
 * Compatible with Claude Desktop, Cursor, Continue.dev, and any MCP client.
 */

import { VERSION } from './index.js';
import { handlePaktTool } from './mcp/handler.js';
import { PAKT_MCP_TOOLS } from './mcp/tools.js';
import type { PaktToolName } from './mcp/types.js';

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 types (minimal subset for MCP)
// ---------------------------------------------------------------------------

/** JSON-RPC 2.0 request envelope. */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 response envelope (success). */
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result: unknown;
}

/** JSON-RPC 2.0 response envelope (error). */
interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

// ---------------------------------------------------------------------------
// MCP protocol constants
// ---------------------------------------------------------------------------

const SERVER_INFO = {
  name: 'pakt',
  version: VERSION,
};

const CAPABILITIES = {
  tools: {},
};

// ---------------------------------------------------------------------------
// Request handlers
// ---------------------------------------------------------------------------

/**
 * Build the tools/list response from PAKT_MCP_TOOLS.
 * Maps internal tool definitions to the MCP tools/list schema.
 */
function handleToolsList(): { tools: unknown[] } {
  const tools = PAKT_MCP_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
  return { tools };
}

/**
 * Dispatch a tools/call request to the PAKT handler.
 * Returns MCP-formatted content array.
 *
 * @param params - The tools/call params with `name` and `arguments`
 * @returns MCP tool result with content array
 */
function handleToolsCall(params: Record<string, unknown>): { content: unknown[] } {
  const toolName = params.name as string;
  const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;

  const validNames = new Set(PAKT_MCP_TOOLS.map((t) => t.name));
  if (!validNames.has(toolName)) {
    throw new Error(`Unknown tool: "${toolName}"`);
  }

  const result = handlePaktTool(toolName as PaktToolName, toolArgs);
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
  };
}

/**
 * Route a JSON-RPC method to the appropriate handler.
 *
 * @param method - The JSON-RPC method name
 * @param params - The method parameters
 * @returns The result payload, or undefined for notifications
 */
function dispatch(method: string, params: Record<string, unknown> | undefined): unknown {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: '2024-11-05',
        serverInfo: SERVER_INFO,
        capabilities: CAPABILITIES,
      };
    case 'notifications/initialized':
      return undefined; // notification — no response
    case 'tools/list':
      return handleToolsList();
    case 'tools/call':
      return handleToolsCall(params ?? {});
    case 'ping':
      return {};
    default:
      throw Object.assign(new Error(`Method not found: ${method}`), {
        code: -32601,
      });
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC message processing
// ---------------------------------------------------------------------------

/**
 * Build a success response envelope.
 * @param id - The request ID to echo back
 * @param result - The result payload
 */
function successResponse(id: string | number, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

/**
 * Build an error response envelope.
 * @param id - The request ID (or null for parse errors)
 * @param code - JSON-RPC error code
 * @param message - Human-readable error message
 */
function errorResponse(id: string | number | null, code: number, message: string): JsonRpcError {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Process a single JSON-RPC message line.
 * Parses, dispatches, and returns the response (or null for notifications).
 *
 * @param line - A single line of JSON-RPC input
 * @returns The JSON-RPC response string, or null for notifications
 */
function processMessage(line: string): string | null {
  let request: JsonRpcRequest;

  try {
    request = JSON.parse(line);
  } catch {
    const resp = errorResponse(null, -32700, 'Parse error');
    return JSON.stringify(resp);
  }

  try {
    const result = dispatch(request.method, request.params);

    // Notifications (no id) and void results don't get responses
    if (result === undefined) return null;

    const resp = successResponse(request.id, result);
    return JSON.stringify(resp);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: number }).code ?? -32603;
    const resp = errorResponse(request.id, code, message);
    return JSON.stringify(resp);
  }
}

// ---------------------------------------------------------------------------
// Stdio transport
// ---------------------------------------------------------------------------

/**
 * Start the MCP stdio server.
 *
 * Reads newline-delimited JSON-RPC 2.0 messages from stdin and writes
 * responses to stdout. Runs until stdin closes.
 *
 * @example
 * ```bash
 * pakt serve --stdio
 * ```
 */
export function startServe(): void {
  let buffer = '';

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;

    // Process complete lines
    let newlineIdx = buffer.indexOf('\n');
    while (newlineIdx !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);

      if (line.length > 0) {
        const response = processMessage(line);
        if (response !== null) {
          process.stdout.write(`${response}\n`);
        }
      }

      newlineIdx = buffer.indexOf('\n');
    }
  });

  process.stdin.on('end', () => {
    process.exit(0);
  });

  // Keep the process alive
  process.stdin.resume();
}

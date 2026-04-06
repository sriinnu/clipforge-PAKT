/**
 * @module mcp/server
 * SDK-backed MCP server registration helpers for PAKT tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PaktFormat } from '../types.js';
import {
  PAKT_AUTO_CONTRACT,
  PAKT_COMPRESS_CONTRACT,
  PAKT_INSPECT_CONTRACT,
  PAKT_STATS_CONTRACT,
} from './contract.js';
import { PaktToolInputError, handlePaktTool } from './handler.js';
import { recordCall } from './session-stats.js';
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

/** Safe number extraction from result fields. */
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' ? v : fallback;
}

/**
 * Extract stats-relevant fields from a tool result and record them.
 * Only called for compress/auto/inspect — never for pakt_stats itself.
 *
 * We access result properties via Record<string, unknown> because the
 * Zod-inferred contract types resolve to unknown for dynamically-built schemas.
 */
function recordCallFromResult(name: PaktToolName, result: PaktToolResult): void {
  const r = result as unknown as Record<string, unknown>;
  const now = Date.now();

  switch (name) {
    case 'pakt_compress':
      recordCall({
        action: 'compress',
        format: r['format'] as PaktFormat,
        inputTokens: num(r['originalTokens']),
        outputTokens: num(r['compressedTokens']),
        savedTokens: num(r['savedTokens']),
        savingsPercent: num(r['savings']),
        reversible: r['reversible'] === true,
        timestamp: now,
      });
      break;
    case 'pakt_auto': {
      const hasTokenMetrics =
        typeof r['inputTokens'] === 'number' &&
        typeof r['outputTokens'] === 'number' &&
        typeof r['savedTokens'] === 'number' &&
        typeof r['savings'] === 'number';

      if (!hasTokenMetrics) {
        break;
      }

      recordCall({
        action: r['action'] === 'compressed' ? 'compress' : 'decompress',
        format: (r['detectedFormat'] as PaktFormat) ?? 'text',
        inputTokens: r['inputTokens'],
        outputTokens: r['outputTokens'],
        savedTokens: r['savedTokens'],
        savingsPercent: r['savings'],
        reversible: r['reversible'] !== false,
        timestamp: now,
      });
      break;
    }
    case 'pakt_inspect':
      recordCall({
        action: 'inspect',
        format: (r['detectedFormat'] as PaktFormat) ?? 'text',
        inputTokens: num(r['inputTokens']),
        outputTokens: num(r['estimatedOutputTokens'], num(r['inputTokens'])),
        savedTokens: num(r['estimatedSavedTokens']),
        savingsPercent: num(r['estimatedSavings']),
        reversible: r['reversible'] !== false,
        timestamp: now,
      });
      break;
    case 'pakt_stats':
      break;
  }
}

function executeTool(name: PaktToolName, args: Record<string, unknown>) {
  try {
    const result = handlePaktTool(name, args);

    if (name !== 'pakt_stats') {
      recordCallFromResult(name, result);
    }

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

  server.registerTool(
    'pakt_stats',
    {
      description: PAKT_STATS_CONTRACT.description,
      inputSchema: PAKT_STATS_CONTRACT.inputSchema,
      outputSchema: PAKT_STATS_CONTRACT.outputSchema,
    },
    async (args) => executeTool('pakt_stats', args),
  );
}

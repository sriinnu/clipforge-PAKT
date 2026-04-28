/**
 * @module mcp/handler
 * MCP tool handler for PAKT compression tools.
 *
 * Provides {@link handlePaktTool}, the main dispatch function that routes
 * incoming MCP tool calls to the appropriate per-tool handler. Per-tool
 * handlers and validators live in sibling modules to keep each file under
 * the 400-line cap:
 *
 *  - `handler-validation.ts`      — input validators + PII helpers + `PaktToolInputError`
 *  - `handler-compress.ts`        — `pakt_compress`
 *  - `handler-auto.ts`            — `pakt_auto`
 *  - `handler-inspect-stats.ts`   — `pakt_inspect`, `pakt_stats`
 *
 * @example
 * ```ts
 * import { handlePaktTool } from '@sriinnu/pakt';
 *
 * // Handle a pakt_compress call
 * const result = handlePaktTool('pakt_compress', {
 *   text: '{"users": [{"name": "Alice"}]}',
 *   format: 'json',
 * });
 * console.log(result.compressed); // PAKT output
 * console.log(result.savings);    // e.g. 35
 * ```
 */

import { handleAuto } from './handler-auto.js';
import { handleCompress } from './handler-compress.js';
import { handleInspect, handleStats } from './handler-inspect-stats.js';
import { PaktToolInputError } from './handler-validation.js';
import type {
  PaktAutoArgs,
  PaktCompressArgs,
  PaktInspectArgs,
  PaktStatsArgs,
  PaktToolName,
  PaktToolResult,
} from './types.js';

// Re-export the error class so existing `import { PaktToolInputError } from './handler.js'`
// consumers (e.g. `mcp/server.ts`, package barrel) keep working unchanged.
export { PaktToolInputError };

/**
 * Dispatch an MCP tool call to the appropriate PAKT handler.
 *
 * @param name - Tool name from the MCP client
 * @param args - Raw arguments object (each handler does its own validation)
 * @returns The handler's typed result
 * @throws {@link PaktToolInputError} for user-fixable input problems
 */
export function handlePaktTool(name: PaktToolName, args: Record<string, unknown>): PaktToolResult {
  switch (name) {
    case 'pakt_compress':
      return handleCompress(args as unknown as PaktCompressArgs);
    case 'pakt_auto':
      return handleAuto(args as unknown as PaktAutoArgs);
    case 'pakt_inspect':
      return handleInspect(args as unknown as PaktInspectArgs);
    case 'pakt_stats':
      return handleStats(args as unknown as PaktStatsArgs);
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown PAKT MCP tool: "${String(_exhaustive)}"`);
    }
  }
}

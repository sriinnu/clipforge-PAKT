/**
 * @module cli-serve
 * MCP stdio server entrypoint for PAKT compression tools.
 *
 * Uses the official Model Context Protocol SDK transport so the server speaks
 * standard MCP stdio framing and behaves consistently across compatible CLI
 * and desktop clients.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VERSION } from './index.js';
import { registerPaktTools } from './mcp/server.js';
import { getSessionStats, setSessionId } from './mcp/session-stats.js';
import {
  compactSessions,
  finalizeSession,
  generateSessionId,
  initSession,
} from './stats/persister.js';

function installShutdownHandlers(server: McpServer, sessionId: string): void {
  let closing = false;

  const shutdown = (exitCode: number) => {
    if (closing) {
      return;
    }
    closing = true;

    // Finalize the session stats file before exiting
    try {
      const stats = getSessionStats();
      finalizeSession(sessionId, {
        endedAt: Date.now(),
        totalCalls: stats.totalCalls,
      });

      // Lazy compaction: ~10% chance on shutdown to keep files tidy
      if (Math.random() < 0.1) {
        compactSessions();
      }
    } catch {
      // Best effort — don't block shutdown
    }

    void server
      .close()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Error during MCP shutdown: ${message}\n`);
      })
      .finally(() => {
        process.exit(exitCode);
      });
  };

  process.once('SIGINT', () => shutdown(0));
  process.once('SIGTERM', () => shutdown(0));
}

/**
 * Start the MCP stdio server using the official SDK transport.
 *
 * @param agentName - Optional name for this agent session (used in stats file naming).
 */
export async function startServe(agentName?: string): Promise<void> {
  const server = new McpServer({
    name: 'pakt',
    version: VERSION,
  });

  // Initialize persistent session stats
  const sessionId = generateSessionId(agentName);
  setSessionId(sessionId);
  initSession(sessionId, {
    agent: agentName ?? 'agent',
    pid: process.pid,
    startedAt: Date.now(),
  });

  registerPaktTools(server);
  installShutdownHandlers(server, sessionId);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

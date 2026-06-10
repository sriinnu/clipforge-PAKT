/**
 * @module cli-serve
 * MCP stdio server entrypoint for PAKT.
 *
 * Two modes:
 * 1. `pakt serve --stdio` — standalone PAKT tools server
 * 2. `pakt serve --stdio --wrap "command"` — proxy mode: wraps another MCP
 *    server, auto-compresses all its tool results with PAKT, AND registers
 *    PAKT's own tools. One process, full coverage.
 *
 * In proxy mode, every tool result from the wrapped server passes through
 * the PAKT interceptor. Structured data (JSON, YAML, CSV) above 100 tokens
 * gets compressed automatically. Results that would expand are returned
 * unchanged. Savings are logged to stderr and tracked in session stats.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VERSION } from './index.js';
import { createPaktInterceptor } from './middleware/interceptor.js';
import type { PaktInterceptor } from './middleware/interceptor.js';
import { registerPaktTools } from './mcp/server.js';
import { getSessionStats, setSessionId } from './mcp/session-stats.js';
import {
  compactSessions,
  detectProject,
  finalizeSession,
  generateSessionId,
  initSession,
} from './stats/persister.js';

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

function installShutdownHandlers(
  server: McpServer,
  sessionId: string,
  client?: Client,
  interceptor?: PaktInterceptor,
): void {
  let closing = false;

  const shutdown = (exitCode: number) => {
    if (closing) return;
    closing = true;

    try {
      const stats = getSessionStats();
      finalizeSession(sessionId, {
        endedAt: Date.now(),
        totalCalls: stats.totalCalls,
      });

      if (interceptor) {
        const is = interceptor.getStats();
        if (is.totalSavedTokens > 0) {
          process.stderr.write(
            `\npakt: ${String(is.compressedCalls)}/${String(is.totalCalls)} tool results compressed, ${String(is.totalSavedTokens)} tokens saved\n`,
          );
        }
      }

      if (Math.random() < 0.1) compactSessions();
    } catch {
      // Best effort
    }

    const closePromises: Promise<void>[] = [
      server.close().catch(() => {}),
    ];
    if (client) closePromises.push(client.close().catch(() => {}));

    void Promise.all(closePromises).finally(() => process.exit(exitCode));
  };

  process.once('SIGINT', () => shutdown(0));
  process.once('SIGTERM', () => shutdown(0));
}

// ---------------------------------------------------------------------------
// Proxy: wrap another MCP server
// ---------------------------------------------------------------------------

async function wrapServer(
  server: McpServer,
  wrapCommand: string,
  interceptor: PaktInterceptor,
  wrapEnv?: Record<string, string>,
): Promise<Client> {
  const parts = wrapCommand.split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  if (!cmd) {
    throw new Error('--wrap requires a command (e.g., --wrap "npx chitragupta")');
  }

  const clientTransport = new StdioClientTransport({
    command: cmd,
    args,
    env: wrapEnv ? { ...process.env, ...wrapEnv } : undefined,
  });
  const client = new Client({ name: 'pakt-proxy', version: VERSION });
  await client.connect(clientTransport);

  const { tools } = await client.listTools();
  process.stderr.write(`pakt: wrapping ${String(tools.length)} tools from "${wrapCommand}"\n`);

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description ?? '' },
      async (toolArgs: Record<string, unknown>) => {
        try {
          const result = await client.callTool({ name: tool.name, arguments: toolArgs });
          const content = result.content as Array<{ type: string; text?: string }>;
          const compressed: Array<{ type: 'text'; text: string }> = [];

          for (const block of content) {
            if (block.type === 'text' && typeof block.text === 'string') {
              const r = interceptor.processToolResult(tool.name, block.text);
              compressed.push({ type: 'text', text: r.text });
              if (r.wasPaktCompressed) {
                process.stderr.write(
                  `pakt: ${tool.name} → ${String(r.savings.totalPercent)}% saved (${String(r.savings.totalTokens)} tokens)\n`,
                );
              }
            } else {
              compressed.push({ type: 'text', text: String(block.text ?? '') });
            }
          }

          return { content: compressed, isError: result.isError === true ? true : undefined };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { content: [{ type: 'text', text: `pakt proxy error: ${msg}` }], isError: true };
        }
      },
    );
  }

  return client;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ServeOptions {
  /** Name for this agent session (used in stats). */
  agentName?: string;
  /** Command to wrap as an MCP proxy (e.g., "npx chitragupta"). */
  wrap?: string;
  /** Tool name patterns to skip compression on (e.g., ["health_*"]). */
  passthrough?: string[];
  /** Environment variables to pass to the wrapped process. */
  wrapEnv?: Record<string, string>;
}

/**
 * Start the PAKT MCP server.
 *
 * Without `--wrap`: standalone server with PAKT's 7 tools.
 * With `--wrap`: proxy mode — wraps another MCP server, auto-compresses
 * all its tool results, AND registers PAKT's own tools.
 */
export async function startServe(options?: ServeOptions | string): Promise<void> {
  // Backward compat: old signature was startServe(agentName?: string)
  const opts: ServeOptions =
    typeof options === 'string' ? { agentName: options } : options ?? {};

  const server = new McpServer({ name: 'pakt', version: VERSION });

  // Session stats
  const sessionId = generateSessionId(opts.agentName);
  setSessionId(sessionId);
  initSession(sessionId, {
    agent: opts.agentName ?? 'agent',
    pid: process.pid,
    startedAt: Date.now(),
    project: detectProject(),
  });

  // Interceptor (used in proxy mode, also available for stats)
  const interceptor = createPaktInterceptor({
    minTokens: 100,
    passthrough: ['pakt_*', ...(opts.passthrough ?? [])],
  });

  // If wrapping another server, proxy its tools with auto-compression
  let client: Client | undefined;
  if (opts.wrap) {
    client = await wrapServer(server, opts.wrap, interceptor, opts.wrapEnv);
  }

  // Always register PAKT's own tools
  registerPaktTools(server);

  installShutdownHandlers(server, sessionId, client, interceptor);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

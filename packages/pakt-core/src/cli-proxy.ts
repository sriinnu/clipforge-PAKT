/**
 * @module cli-proxy
 * MCP proxy that wraps any MCP server and auto-compresses tool results.
 *
 * Usage:
 *   pakt proxy --wrap "npx my-mcp-server" --stdio
 *
 * Spawns the wrapped server as a child process, connects to it as an MCP
 * client, and exposes a new MCP server on stdio. All tool calls are proxied
 * through — results are auto-compressed with PAKT when beneficial.
 *
 * Zero code changes required from the wrapped server.
 */

import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VERSION } from './index.js';
import { createPaktInterceptor } from './middleware/interceptor.js';
import type { PaktInterceptor } from './middleware/interceptor.js';

// ---------------------------------------------------------------------------
// Proxy
// ---------------------------------------------------------------------------

/**
 * Start the MCP proxy.
 *
 * 1. Spawns the wrapped command as a child process
 * 2. Connects to it as an MCP client (stdio transport)
 * 3. Lists its tools
 * 4. Re-registers them on a new MCP server exposed to the parent
 * 5. On each tool call: proxies to child → compresses result → returns
 *
 * @param wrapCommand - The command to wrap (e.g., "npx my-server --stdio")
 * @param passthroughTools - Tool name patterns to skip compression on
 */
export async function startProxy(wrapCommand: string, passthroughTools: string[] = []): Promise<void> {
  const interceptor = createPaktInterceptor({
    minTokens: 100,
    passthrough: ['pakt_*', ...passthroughTools],
  });

  // --- 1. Spawn the wrapped server ---
  const parts = wrapCommand.split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  if (!cmd) {
    throw new Error('--wrap requires a command (e.g., --wrap "npx my-mcp-server")');
  }

  const child = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'inherit'], // stdin/stdout piped, stderr inherited
  });

  child.on('error', (err) => {
    process.stderr.write(`Failed to start wrapped server: ${err.message}\n`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.stderr.write(`Wrapped server exited with code ${String(code)}\n`);
    process.exit(code ?? 1);
  });

  // --- 2. Connect to the child as an MCP client ---
  const clientTransport = new StdioClientTransport({
    command: cmd,
    args,
  });

  const client = new Client({ name: 'pakt-proxy', version: VERSION });

  // Kill our manually spawned child since StdioClientTransport spawns its own
  child.kill();

  await client.connect(clientTransport);

  // --- 3. List the child's tools ---
  const { tools } = await client.listTools();

  process.stderr.write(
    `pakt proxy: wrapping ${String(tools.length)} tools from "${wrapCommand}"\n`,
  );

  // --- 4. Create our server and re-register all tools ---
  const server = new McpServer({ name: 'pakt-proxy', version: VERSION });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description ?? '' },
      async (toolArgs: Record<string, unknown>) => {
        return proxyToolCall(client, interceptor, tool.name, toolArgs);
      },
    );
  }

  // Also register PAKT's own tools on the proxy
  const { registerPaktTools } = await import('./mcp/server.js');
  registerPaktTools(server);

  // --- 5. Expose on stdio ---
  const serverTransport = new StdioServerTransport();

  installProxyShutdown(server, client, interceptor);

  await server.connect(serverTransport);
}

// ---------------------------------------------------------------------------
// Tool call proxy
// ---------------------------------------------------------------------------

async function proxyToolCall(
  client: Client,
  interceptor: PaktInterceptor,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    const result = await client.callTool({ name: toolName, arguments: args });

    // Extract text content from the result
    const content = result.content as Array<{ type: string; text?: string }>;
    const compressed: Array<{ type: 'text'; text: string }> = [];

    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        const intercepted = interceptor.processToolResult(toolName, block.text);
        compressed.push({ type: 'text', text: intercepted.text });

        if (intercepted.wasPaktCompressed) {
          process.stderr.write(
            `pakt proxy: ${toolName} → ${String(intercepted.savings.totalPercent)}% saved (${String(intercepted.savings.totalTokens)} tokens)\n`,
          );
        }
      } else {
        compressed.push({ type: 'text', text: String(block.text ?? '') });
      }
    }

    return { content: compressed, isError: result.isError === true ? true : undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Proxy error calling ${toolName}: ${message}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

function installProxyShutdown(
  server: McpServer,
  client: Client,
  interceptor: PaktInterceptor,
): void {
  let closing = false;

  const shutdown = () => {
    if (closing) return;
    closing = true;

    const stats = interceptor.getStats();
    if (stats.totalSavedTokens > 0) {
      process.stderr.write(
        `\npakt proxy stats: ${String(stats.compressedCalls)}/${String(stats.totalCalls)} calls compressed, ${String(stats.totalSavedTokens)} tokens saved\n`,
      );
    }

    void Promise.all([server.close(), client.close()])
      .catch(() => {})
      .finally(() => process.exit(0));
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

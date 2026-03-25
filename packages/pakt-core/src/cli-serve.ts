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

function installShutdownHandlers(server: McpServer): void {
  let closing = false;

  const shutdown = (exitCode: number) => {
    if (closing) {
      return;
    }
    closing = true;
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
 */
export async function startServe(): Promise<void> {
  const server = new McpServer({
    name: 'pakt',
    version: VERSION,
  });

  registerPaktTools(server);
  installShutdownHandlers(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

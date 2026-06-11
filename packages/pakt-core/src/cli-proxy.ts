/**
 * @module cli-proxy
 * MCP proxy that wraps any MCP server, auto-compresses tool results, and
 * optionally optimises the tool-definition catalog sent to the LLM client.
 *
 * Usage:
 *   pakt proxy --wrap "npx my-mcp-server" --stdio
 *   pakt proxy --wrap "npx my-mcp-server" --stdio --tools slim
 *   pakt proxy --wrap "npx my-mcp-server" --stdio --tools search
 *
 * Spawns the wrapped server as a child process, connects to it as an MCP
 * client, and exposes a new MCP server on stdio. All tool calls are proxied
 * through — results are auto-compressed with PAKT when beneficial.
 *
 * ## --tools modes
 *
 * - `full` (default): re-registers every wrapped tool verbatim.
 * - `slim`: re-registers tools with descriptions truncated at `descriptionCap`
 *   (default 1 024 chars) and redundant JSON-schema boilerplate stripped.
 *   Token savings are logged per-request.
 * - `search`: exposes only 3 synthetic tools (search_tools / get_tool_schema /
 *   call_tool) backed by an in-proxy BM25 catalog. search_tools and
 *   get_tool_schema are answered locally. call_tool returns a documented proxy
 *   error — see {@link module:proxy/catalog} for the rationale.
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
import { ToolCatalog, FACADE_TOOL_DEFINITIONS, slimTool, slimTools } from './proxy/index.js';
import type { ProviderTool } from './proxy/index.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Tool-catalog mode for the proxy. */
export type ToolsMode = 'full' | 'slim' | 'search';

/** Options for {@link startProxy}. */
export interface ProxyOptions {
  /** Tool passthrough patterns (default: `['pakt_*']`). */
  passthroughTools?: string[];
  /**
   * Tool-catalog mode.
   * - `full`: verbatim re-registration (original behaviour).
   * - `slim`: strip schema boilerplate + truncate descriptions.
   * - `search`: 3-tool facade (search_tools / get_tool_schema / call_tool).
   */
  toolsMode?: ToolsMode;
  /**
   * Maximum characters for tool descriptions in `slim` mode before truncation
   * at the last sentence boundary. Defaults to 1024.
   */
  descriptionCap?: number;
}

// ---------------------------------------------------------------------------
// Quote-aware command tokenizer
// ---------------------------------------------------------------------------

/**
 * Split a shell-style command string into an argument array, respecting
 * double-quoted and single-quoted substrings. Quoted segments may contain
 * spaces without being split. Backslash-escape inside double quotes is
 * supported for `\"` and `\\`.
 *
 * Examples:
 *   `'npx my-server'`              → `['npx', 'my-server']`
 *   `'cmd "path with spaces"'`     → `['cmd', 'path with spaces']`
 *   `"cmd '/opt/my tool' --flag"`  → `['cmd', '/opt/my tool', '--flag']`
 *
 * @param cmd - Raw command string (e.g. from `--wrap "npx chitragupta"`).
 * @returns Array of individual argument tokens.
 */
export function tokenizeCommand(cmd: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let i = 0;

  while (i < cmd.length) {
    const ch = cmd[i];

    if (ch === '"') {
      // Double-quoted region: consume until closing `"`, handle `\"` and `\\`.
      i++;
      while (i < cmd.length && cmd[i] !== '"') {
        if (cmd[i] === '\\' && i + 1 < cmd.length) {
          const next = cmd[i + 1];
          if (next === '"' || next === '\\') {
            current += next;
            i += 2;
            continue;
          }
        }
        current += cmd[i];
        i++;
      }
      i++; // skip closing `"`
    } else if (ch === "'") {
      // Single-quoted region: consume verbatim until closing `'` (no escaping).
      i++;
      while (i < cmd.length && cmd[i] !== "'") {
        current += cmd[i];
        i++;
      }
      i++; // skip closing `'`
    } else if (ch === ' ' || ch === '\t') {
      // Whitespace outside quotes: token boundary.
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      i++;
    } else {
      current += ch;
      i++;
    }
  }

  if (current.length > 0) tokens.push(current);
  return tokens;
}

// ---------------------------------------------------------------------------
// Proxy
// ---------------------------------------------------------------------------

/**
 * Start the MCP proxy.
 *
 * 1. Spawns the wrapped command as a child process
 * 2. Connects to it as an MCP client (stdio transport)
 * 3. Lists its tools
 * 4. Re-registers them on a new MCP server (with optional catalog optimisation)
 * 5. On each tool call: proxies to child → compresses result → returns
 *
 * @param wrapCommand - The command to wrap (e.g., "npx my-server --stdio")
 * @param options - Proxy options including tool passthrough and catalog mode.
 */
export async function startProxy(wrapCommand: string, options: ProxyOptions = {}): Promise<void> {
  const {
    passthroughTools = [],
    toolsMode = 'full',
    descriptionCap = 1024,
  } = options;

  const interceptor = createPaktInterceptor({
    minTokens: 100,
    passthrough: ['pakt_*', ...passthroughTools],
  });

  // --- 1. Spawn the wrapped server ---
  const parts = tokenizeCommand(wrapCommand);
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
  const clientTransport = new StdioClientTransport({ command: cmd, args });
  const client = new Client({ name: 'pakt-proxy', version: VERSION });

  // Kill our manually spawned child since StdioClientTransport spawns its own
  child.kill();

  await client.connect(clientTransport);

  // --- 3. List the child's tools ---
  const { tools } = await client.listTools();

  process.stderr.write(
    `pakt proxy: wrapping ${String(tools.length)} tools from "${wrapCommand}" (--tools ${toolsMode})\n`,
  );

  // --- 4. Create server and register tools based on mode ---
  const server = new McpServer({ name: 'pakt-proxy', version: VERSION });
  const catalog = new ToolCatalog();

  if (toolsMode === 'search') {
    // Build the catalog and expose only the 3 facade tools.
    catalog.load(tools as ProviderTool[]);
    registerSearchFacade(server, client, interceptor, catalog);
    process.stderr.write(
      `pakt proxy: search facade active — ${String(catalog.size)} tools indexed, 3 facade tools exposed\n`,
    );
  } else {
    // full or slim: register all real tools (possibly slimmed).
    registerRealTools(server, client, interceptor, tools as ProviderTool[], toolsMode, descriptionCap);
    if (toolsMode === 'slim') {
      logSlimSavings(tools as ProviderTool[], descriptionCap);
    }
  }

  // Register PAKT's own tools on the proxy
  const { registerPaktTools } = await import('./mcp/server.js');
  registerPaktTools(server);

  // --- 5. Expose on stdio ---
  const serverTransport = new StdioServerTransport();
  installProxyShutdown(server, client, interceptor);
  await server.connect(serverTransport);
}

// ---------------------------------------------------------------------------
// Tool registration helpers
// ---------------------------------------------------------------------------

/**
 * Register all real wrapped tools, optionally slimming their definitions.
 *
 * @param server - The MCP server to register tools on.
 * @param client - The upstream MCP client (to forward calls to).
 * @param interceptor - PAKT result interceptor.
 * @param tools - The real tool list from the wrapped server.
 * @param mode - `full` or `slim`.
 * @param descriptionCap - Max description characters (slim mode).
 */
function registerRealTools(
  server: McpServer,
  client: Client,
  interceptor: PaktInterceptor,
  tools: ProviderTool[],
  mode: ToolsMode,
  descriptionCap: number,
): void {
  for (const tool of tools) {
    const effective = mode === 'slim'
      ? slimTool(tool, { descriptionCap })
      : tool;

    server.registerTool(
      effective.name,
      { description: effective.description ?? '' },
      async (toolArgs: Record<string, unknown>) =>
        proxyToolCall(client, interceptor, tool.name, toolArgs),
    );
  }
}

/**
 * Register the 3-tool search facade on the proxy server.
 *
 * `search_tools` and `get_tool_schema` are answered locally from the catalog.
 * `call_tool` returns a documented proxy-limitation error (TRUTH RULE).
 *
 * @param server - The MCP server to register facade tools on.
 * @param client - The upstream MCP client (used for regular tool calls).
 * @param interceptor - PAKT result interceptor.
 * @param catalog - The populated in-memory tool catalog.
 */
function registerSearchFacade(
  server: McpServer,
  client: Client,
  interceptor: PaktInterceptor,
  catalog: ToolCatalog,
): void {
  for (const facadeDef of FACADE_TOOL_DEFINITIONS) {
    server.registerTool(
      facadeDef.name,
      { description: facadeDef.description ?? '' },
      async (toolArgs: Record<string, unknown>) => {
        if (facadeDef.name === 'search_tools') {
          const query = typeof toolArgs['query'] === 'string' ? toolArgs['query'] : '';
          const limit = typeof toolArgs['limit'] === 'number' ? toolArgs['limit'] : 10;
          const results = catalog.search(query, limit);
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ results, totalInCatalog: catalog.size }, null, 2),
            }],
          };
        }

        if (facadeDef.name === 'get_tool_schema') {
          const name = typeof toolArgs['name'] === 'string' ? toolArgs['name'] : '';
          const schema = catalog.getSchema(name);
          const payload = schema
            ? { tool: schema }
            : { error: `Tool "${name}" not found.`, availableCount: catalog.size };
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
          };
        }

        if (facadeDef.name === 'call_tool') {
          // DOCUMENTED LIMITATION — see module JSDoc.
          const name = typeof toolArgs['name'] === 'string' ? toolArgs['name'] : '(unknown)';
          const schema = catalog.getSchema(name);
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: 'pakt-proxy search-facade limitation: transparent call_tool rewriting ' +
                  'requires bidirectional tool-result interception not available in the current ' +
                  'stdio proxy architecture. Restart with --tools slim or --tools full to call ' +
                  `"${name}" directly.`,
                toolName: name,
                toolSchema: schema ?? null,
                hint: schema
                  ? `Schema retrieved. Use --tools slim to invoke "${name}" directly.`
                  : `"${name}" not in catalog. Use search_tools to find the correct name.`,
              }, null, 2),
            }],
            isError: true,
          };
        }

        // Fallback: forward as a real tool call (should not reach here).
        return proxyToolCall(client, interceptor, facadeDef.name, toolArgs);
      },
    );
  }
}

/**
 * Log slim-mode token savings at startup by comparing slim vs verbatim.
 *
 * @param tools - The original tool list.
 * @param descriptionCap - Cap used for slimming.
 */
function logSlimSavings(tools: ProviderTool[], descriptionCap: number): void {
  const { savings } = slimTools(tools, { descriptionCap });
  if (savings.savedTokens > 0) {
    process.stderr.write(
      `pakt proxy slim: catalog ${String(savings.originalTokens)} → ${String(savings.slimmedTokens)} tokens` +
      ` (−${String(savings.savedTokens)}, ${String(savings.savedPercent)}% saved)\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tool call proxy
// ---------------------------------------------------------------------------

/**
 * Proxy a single tool call to the upstream MCP client, then PAKT-compress
 * the result when beneficial.
 *
 * @param client - The upstream MCP client.
 * @param interceptor - PAKT result interceptor.
 * @param toolName - Real tool name to call on the upstream server.
 * @param args - Tool arguments.
 * @returns MCP-shaped content array (may be PAKT-compressed).
 */
async function proxyToolCall(
  client: Client,
  interceptor: PaktInterceptor,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    const result = await client.callTool({ name: toolName, arguments: args });
    const content = result.content as Array<{ type: string; text?: string }>;
    const compressed: Array<{ type: 'text'; text: string }> = [];

    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        const intercepted = interceptor.processToolResult(toolName, block.text);
        compressed.push({ type: 'text', text: intercepted.text });
        if (intercepted.wasPaktCompressed) {
          process.stderr.write(
            `pakt proxy: ${toolName} → ${String(intercepted.savings.totalPercent)}% saved` +
            ` (${String(intercepted.savings.totalTokens)} tokens)\n`,
          );
        }
      } else {
        // Non-text block: coerce to empty text (behaviour unchanged).
        // Emit one stderr warn per block type so the operator knows content was dropped.
        process.stderr.write(
          `pakt proxy: non-text content block type "${block.type}" from ${toolName} coerced to empty text\n`,
        );
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

/**
 * Install SIGINT/SIGTERM handlers that log final stats and cleanly close
 * the MCP server and upstream client.
 *
 * @param server - The proxy MCP server.
 * @param client - The upstream MCP client.
 * @param interceptor - PAKT interceptor (for final stats).
 */
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
        `\npakt proxy stats: ${String(stats.compressedCalls)}/${String(stats.totalCalls)} calls compressed,` +
        ` ${String(stats.totalSavedTokens)} tokens saved\n`,
      );
    }

    void Promise.all([server.close(), client.close()])
      .catch(() => {})
      .finally(() => process.exit(0));
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

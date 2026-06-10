/**
 * @module proxy/catalog
 * Search-facade catalog for the PAKT proxy.
 *
 * Exposes 3 synthetic tools in place of the full catalog:
 * `search_tools` / `get_tool_schema` / `call_tool`.
 *
 * `search_tools` and `get_tool_schema` are answered locally.
 *
 * ## call_tool limitation
 * Full transparent call_tool rewriting requires bidirectional tool-result
 * interception (outgoing tool-use block + incoming tool-result block in a
 * stateful pair). That is not available in the current `StdioClientTransport`
 * / `McpServer` stdio proxy without forking the SDK transport layer.
 * `call_tool` therefore returns a structured proxy error with the real tool
 * name + schema so the client can retry directly. Never silently corrupt.
 */

import type { CatalogEntry, CatalogSearchResult, ProviderTool } from './types.js';

// ---------------------------------------------------------------------------
// BM25-lite keyword scorer
// ---------------------------------------------------------------------------

/**
 * Simple tokenizer: lowercase, split on non-alphanumeric, deduplicate.
 * Good enough for a small tool catalog (< 1000 tools).
 *
 * @param text - Text to tokenize.
 * @returns Array of lowercase word tokens.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((w) => w.length > 1);
}

/**
 * Score a catalog entry against tokenized query terms (TF, no IDF).
 * Name hits are weighted 3×. Only matches when a catalog token equals or
 * starts with a query token (or vice-versa with min length 4), preventing
 * short stop-words ("or","for") from matching unrelated query tokens.
 *
 * @param entry - Catalog entry to score.
 * @param queryTokens - Tokenized query words.
 * @returns Numeric relevance score (higher = better match).
 */
function scoreEntry(entry: CatalogEntry, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const nameTokens = tokenize(entry.name);
  const descTokens = tokenize(entry.description);
  let score = 0;
  for (const qt of queryTokens) {
    // Name match is weighted 3×, description 1×.
    // Only match when a catalog token contains the query token (prefix/exact),
    // never the reverse — prevents short stop-words from scoring everything.
    const nameHits = nameTokens.filter((t) => t === qt || t.startsWith(qt) || qt.startsWith(t) && qt.length >= 4).length;
    const descHits = descTokens.filter((t) => t === qt || t.startsWith(qt) || qt.startsWith(t) && qt.length >= 4).length;
    score += nameHits * 3 + descHits;
  }
  return score;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/**
 * An in-memory, session-scoped tool catalog for the search facade.
 *
 * Built once at proxy startup from the wrapped server's tool list.
 * Provides keyword search (BM25-lite) and full-schema retrieval.
 */
export class ToolCatalog {
  private readonly entries: Map<string, CatalogEntry> = new Map();

  /**
   * Populate (or replace) the catalog from a list of provider tool definitions.
   *
   * @param tools - The real tool list from the wrapped MCP server.
   */
  load(tools: ProviderTool[]): void {
    this.entries.clear();
    for (const tool of tools) {
      this.entries.set(tool.name, {
        name: tool.name,
        description: tool.description ?? '',
        tool,
      });
    }
  }

  /**
   * Return the total number of tools in the catalog.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Keyword search over tool names and descriptions.
   *
   * Uses a lightweight BM25-style scorer (no corpus statistics — catalog is
   * small). Results are sorted by descending score; ties keep insertion order.
   *
   * @param query - Free-text query string.
   * @param limit - Maximum number of results to return (default 10).
   * @returns Sorted array of matching entries with scores.
   */
  search(query: string, limit = 10): CatalogSearchResult[] {
    const qt = tokenize(query);
    const scored: CatalogSearchResult[] = [];
    for (const entry of this.entries.values()) {
      const score = scoreEntry(entry, qt);
      if (score > 0) {
        scored.push({
          name: entry.name,
          description: entry.description.slice(0, 200),
          score,
        });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * Retrieve the full tool definition for a given name.
   *
   * @param name - Exact tool name.
   * @returns The original `ProviderTool`, or `undefined` if not found.
   */
  getSchema(name: string): ProviderTool | undefined {
    return this.entries.get(name)?.tool;
  }

  /**
   * Return all tool names in catalog insertion order.
   */
  names(): string[] {
    return Array.from(this.entries.keys());
  }
}

// ---------------------------------------------------------------------------
// Facade tool definitions
// ---------------------------------------------------------------------------

/**
 * The 3 synthetic tool definitions injected by the search facade.
 * These replace the entire `tools` array in the proxied request.
 */
export const FACADE_TOOL_DEFINITIONS: ProviderTool[] = [
  {
    name: 'search_tools',
    description:
      'Search the available tool catalog by keyword. Returns matching tool names and short descriptions. Use this before calling get_tool_schema or call_tool.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keyword(s) describing what you want to do.',
        },
        limit: {
          type: 'number',
          description: 'Max results to return. Defaults to 10.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_tool_schema',
    description:
      'Return the full JSON input schema for a specific tool by exact name. Call search_tools first if you do not know the exact name.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Exact tool name as returned by search_tools.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'call_tool',
    description:
      'Request to call a specific tool with the given arguments. NOTE: Direct transparent rewriting is not available in this proxy mode — the proxy will return a structured response explaining how to invoke the real tool directly.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Exact tool name to call.',
        },
        arguments: {
          type: 'object',
          description: 'Arguments to pass to the tool.',
        },
      },
      required: ['name'],
    },
  },
];

// ---------------------------------------------------------------------------
// Facade handler — answers search_tools / get_tool_schema / call_tool locally
// ---------------------------------------------------------------------------

/**
 * Result from the local facade handler.
 * `handled: true` means the proxy answered locally; no forwarding needed.
 * `handled: false` means the request should pass through unchanged.
 */
export type FacadeHandleResult =
  | { handled: true; responseBody: Record<string, unknown> }
  | { handled: false };

/**
 * Try to handle a parsed request body as a facade tool call.
 *
 * Intercepts `search_tools`, `get_tool_schema`, and `call_tool` calls and
 * answers them from the local catalog without forwarding to the provider.
 *
 * For `call_tool`: returns a structured error explaining the proxy limitation
 * rather than silently corrupting the request (TRUTH RULE).
 *
 * @param body - Parsed JSON request body.
 * @param catalog - The proxy's in-memory tool catalog.
 * @returns `FacadeHandleResult` — handled locally or pass-through.
 */
export function handleFacadeRequest(
  body: Record<string, unknown>,
  catalog: ToolCatalog,
): FacadeHandleResult {
  // We inspect the "last" user message for tool_use / function_call patterns.
  // This is a best-effort heuristic — if the body shape is unexpected we pass
  // through unchanged (TRUTH RULE).
  const toolCall = extractToolCall(body);
  if (!toolCall) return { handled: false };

  const { name, args } = toolCall;

  if (name === 'search_tools') {
    const query = typeof args['query'] === 'string' ? args['query'] : '';
    const limit = typeof args['limit'] === 'number' ? args['limit'] : 10;
    const results = catalog.search(query, limit);
    return {
      handled: true,
      responseBody: buildFacadeResponse(name, {
        results,
        totalInCatalog: catalog.size,
      }),
    };
  }

  if (name === 'get_tool_schema') {
    const toolName = typeof args['name'] === 'string' ? args['name'] : '';
    const schema = catalog.getSchema(toolName);
    if (!schema) {
      return {
        handled: true,
        responseBody: buildFacadeResponse(name, {
          error: `Tool "${toolName}" not found. Call search_tools to list available tools.`,
          availableCount: catalog.size,
        }),
      };
    }
    return {
      handled: true,
      responseBody: buildFacadeResponse(name, { tool: schema }),
    };
  }

  if (name === 'call_tool') {
    const toolName = typeof args['name'] === 'string' ? args['name'] : '(unknown)';
    const schema = catalog.getSchema(toolName);
    // DOCUMENTED LIMITATION: bidirectional tool-result interception is not
    // available in the current StdioClientTransport / McpServer setup.
    // Return a structured error so the client can retry directly.
    return {
      handled: true,
      responseBody: buildFacadeResponse(name, {
        error:
          'pakt-proxy search-facade limitation: transparent call_tool rewriting requires ' +
          'bidirectional tool-result interception which is not available in the current ' +
          'stdio proxy architecture. To invoke this tool, add it directly to your client ' +
          'session (run pakt proxy with --tools full or --tools slim) or call it via its ' +
          'native MCP server.',
        toolName,
        toolSchema: schema ?? null,
        hint: schema
          ? `Tool schema retrieved. Restart with --tools slim to call "${toolName}" directly.`
          : `Tool "${toolName}" not found in catalog. Use search_tools to verify the name.`,
      }),
    };
  }

  return { handled: false };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extracted tool call from a provider request body. */
interface ExtractedToolCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Extract the last tool-use / function-call from a provider request body.
 * Supports Anthropic (`tool_use` blocks) and OpenAI (`tool_calls`).
 * Returns `null` if no recognisable call is found (TRUTH RULE: pass-through).
 *
 * @param body - Parsed provider request body.
 * @returns Extracted call or null.
 */
function extractToolCall(body: Record<string, unknown>): ExtractedToolCall | null {
  if (!Array.isArray(body['messages'])) return null;
  const msgs = body['messages'] as Array<Record<string, unknown>>;

  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    if (!msg) continue;

    // Anthropic: content blocks with type:"tool_use"
    if (Array.isArray(msg['content'])) {
      for (const block of msg['content'] as Array<Record<string, unknown>>) {
        if (block['type'] === 'tool_use' && typeof block['name'] === 'string') {
          return { name: block['name'], args: (block['input'] as Record<string, unknown>) ?? {} };
        }
      }
    }

    // OpenAI: tool_calls[].function
    if (Array.isArray(msg['tool_calls'])) {
      const calls = msg['tool_calls'] as Array<Record<string, unknown>>;
      const last = calls[calls.length - 1];
      if (last) {
        const fn = last['function'] as Record<string, unknown> | undefined;
        if (fn && typeof fn['name'] === 'string') {
          let args: Record<string, unknown> = {};
          if (typeof fn['arguments'] === 'string') {
            try { args = JSON.parse(fn['arguments']) as Record<string, unknown>; } catch { /* pass */ }
          } else if (fn['arguments'] && typeof fn['arguments'] === 'object') {
            args = fn['arguments'] as Record<string, unknown>;
          }
          return { name: fn['name'], args };
        }
      }
    }
  }
  return null;
}

/**
 * Wrap a local facade result in a minimal provider-shaped response body.
 * The wrapper is intentionally minimal — the client reads `.content` or
 * `.choices[0].message.content` depending on provider.
 *
 * @param toolName - The facade tool that was called.
 * @param result - The structured result to embed.
 * @returns A response body the client can parse.
 */
function buildFacadeResponse(
  toolName: string,
  result: Record<string, unknown>,
): Record<string, unknown> {
  const text = JSON.stringify({ tool: toolName, ...result }, null, 2);
  return {
    id: `pakt-facade-${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    // OpenAI-style alias
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: 'stop',
      },
    ],
    _pakt_facade: true,
    _pakt_tool: toolName,
  };
}

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetDedupCache } from '../src/mcp/dedup-cache.js';
import { registerPaktTools } from '../src/mcp/server.js';
import { resetSessionStats } from '../src/mcp/session-stats.js';

type Harness = {
  close: () => Promise<void>;
  client: Client;
};

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_PATH = join(PACKAGE_ROOT, 'dist/cli.js');
const openHarnesses: Harness[] = [];

async function createInMemoryHarness(): Promise<Harness> {
  const server = new McpServer({
    name: 'pakt-test-server',
    version: '0.0.0-test',
  });
  registerPaktTools(server);

  const client = new Client(
    {
      name: 'pakt-test-client',
      version: '0.0.0-test',
    },
    {
      capabilities: {},
    },
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const harness = {
    client,
    close: async () => {
      await Promise.allSettled([client.close(), server.close()]);
    },
  };
  openHarnesses.push(harness);
  return harness;
}

async function createStdioHarness(): Promise<Harness> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI_PATH, 'serve', '--stdio'],
    cwd: PACKAGE_ROOT,
    stderr: 'pipe',
  });

  const client = new Client(
    {
      name: 'pakt-stdio-test-client',
      version: '0.0.0-test',
    },
    {
      capabilities: {},
    },
  );

  await client.connect(transport);

  const harness = {
    client,
    close: async () => {
      await Promise.allSettled([client.close(), transport.close()]);
    },
  };
  openHarnesses.push(harness);
  return harness;
}

function extractJsonText(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const textContent = result.content.find(
    (item) => item.type === 'text' && typeof item.text === 'string',
  );
  expect(textContent?.text).toBeTruthy();
  return JSON.parse(textContent!.text!);
}

beforeEach(() => {
  resetSessionStats();
  resetDedupCache();
});

afterEach(async () => {
  while (openHarnesses.length > 0) {
    const harness = openHarnesses.pop();
    if (!harness) {
      continue;
    }
    await harness.close();
  }
});

describe('cli-serve MCP transport', () => {
  it('lists PAKT tools through the official MCP client flow', async () => {
    const { client } = await createInMemoryHarness();
    const result = await client.listTools();
    const names = result.tools.map((tool) => tool.name).sort();

    expect(names).toEqual(['pakt_auto', 'pakt_compress', 'pakt_inspect', 'pakt_stats']);
  });

  it('returns structured tool results over the SDK transport', async () => {
    const { client } = await createInMemoryHarness();
    const result = await client.callTool({
      name: 'pakt_compress',
      arguments: {
        text: '{"user":{"name":"Alice","role":"dev"}}',
        format: 'json',
      },
    });

    const parsed = extractJsonText(result) as {
      compressed: string;
      savings: number;
      format: string;
      savedTokens: number;
    };

    expect(result.isError).not.toBe(true);
    expect(parsed.format).toBe('json');
    expect(parsed.compressed).toContain('@from json');
    expect(Number.isFinite(parsed.savedTokens)).toBe(true);
  });

  it('returns tool errors without crashing the protocol session', async () => {
    const { client } = await createInMemoryHarness();
    const result = await client.callTool({
      name: 'pakt_compress',
      arguments: {
        text: '',
      },
    });

    const text = result.content.find(
      (item) => item.type === 'text' && typeof item.text === 'string',
    )?.text;

    expect(result.isError).toBe(true);
    expect(text).toContain('text must be a non-empty string');
  });

  it('rejects unexpected tool arguments via schema validation', async () => {
    const { client } = await createInMemoryHarness();
    const result = await client.callTool({
      name: 'pakt_auto',
      arguments: {
        text: 'hello',
        extra: 'nope',
      },
    });

    const text = result.content.find(
      (item) => item.type === 'text' && typeof item.text === 'string',
    )?.text;

    expect(result.isError).toBe(true);
    expect(text).toBeTruthy();
  });

  it('supports inspect leave-as-is guidance for low-value inputs', async () => {
    const { client } = await createInMemoryHarness();
    const result = await client.callTool({
      name: 'pakt_inspect',
      arguments: {
        text: 'hi',
      },
    });

    const parsed = extractJsonText(result) as {
      recommendedAction: string;
      estimatedSavedTokens?: number;
    };

    expect(result.isError).not.toBe(true);
    expect(parsed.recommendedAction).toBe('leave-as-is');
    expect(parsed.estimatedSavedTokens).toBeLessThanOrEqual(0);
  });

  it('boots the real stdio server entrypoint and serves tools', async () => {
    const { client } = await createStdioHarness();
    const listed = await client.listTools();
    const toolNames = listed.tools.map((tool) => tool.name).sort();

    expect(toolNames).toEqual(['pakt_auto', 'pakt_compress', 'pakt_inspect', 'pakt_stats']);

    const result = await client.callTool({
      name: 'pakt_inspect',
      arguments: {
        text: 'hi',
      },
    });
    const parsed = extractJsonText(result) as {
      recommendedAction: string;
    };

    expect(result.isError).not.toBe(true);
    expect(parsed.recommendedAction).toBe('leave-as-is');
  }, 40_000);

  it('returns empty stats when no calls have been made', async () => {
    const { client } = await createInMemoryHarness();
    const result = await client.callTool({
      name: 'pakt_stats',
      arguments: {},
    });

    expect(result.isError).not.toBe(true);

    const parsed = extractJsonText(result) as {
      totalCalls: number;
      totalSavedTokens: number;
      lastCallAt?: string;
    };

    expect(parsed.totalCalls).toBe(0);
    expect(parsed.totalSavedTokens).toBe(0);
    expect(parsed.lastCallAt).toBeUndefined();
  });

  it('accumulates stats across compress calls then reports via pakt_stats', async () => {
    const { client } = await createInMemoryHarness();

    // Make two compress calls
    await client.callTool({
      name: 'pakt_compress',
      arguments: {
        text: '{"users":[{"name":"Alice","role":"dev"},{"name":"Bob","role":"pm"}]}',
        format: 'json',
      },
    });
    await client.callTool({
      name: 'pakt_compress',
      arguments: {
        text: 'id,name,role\n1,Alice,dev\n2,Bob,pm',
        format: 'csv',
      },
    });

    // Query stats
    const result = await client.callTool({
      name: 'pakt_stats',
      arguments: {},
    });

    expect(result.isError).not.toBe(true);

    const parsed = extractJsonText(result) as {
      totalCalls: number;
      callsByAction: string;
      totalInputTokens: number;
      totalSavedTokens: number;
      overallSavingsPercent: number;
      byFormat: string;
      topFormat?: string;
      lastCallAt?: string;
    };

    expect(parsed.totalCalls).toBe(2);
    expect(parsed.totalInputTokens).toBeGreaterThan(0);

    const callsByAction = JSON.parse(parsed.callsByAction) as { compress: number };
    expect(callsByAction.compress).toBe(2);

    const byFormat = JSON.parse(parsed.byFormat) as Record<string, { calls: number }>;
    expect(byFormat.json?.calls).toBe(1);
    expect(byFormat.csv?.calls).toBe(1);

    expect(parsed.topFormat).toBeTruthy();
    expect(parsed.lastCallAt).toBeTruthy();
  });

  it('returns belowThreshold for tiny inputs via pakt_auto', async () => {
    const { client } = await createInMemoryHarness();
    const result = await client.callTool({
      name: 'pakt_auto',
      arguments: { text: 'hi' },
    });

    expect(result.isError).not.toBe(true);

    const parsed = extractJsonText(result) as {
      action: string;
      savings: number;
      belowThreshold?: boolean;
    };

    expect(parsed.action).toBe('compressed');
    expect(parsed.savings).toBe(0);
    expect(parsed.belowThreshold).toBe(true);
  });

  it('returns dedupHit on second identical pakt_auto call', async () => {
    const { client } = await createInMemoryHarness();
    const largeJson =
      '[{"id":1,"name":"Alice Johnson","role":"developer","dept":"Engineering","salary":95000},' +
      '{"id":2,"name":"Bob Smith","role":"pm","dept":"Engineering","salary":105000},' +
      '{"id":3,"name":"Carol Williams","role":"designer","dept":"Design","salary":88000},' +
      '{"id":4,"name":"Dave Brown","role":"qa","dept":"QA","salary":87000},' +
      '{"id":5,"name":"Eve Davis","role":"lead","dept":"Engineering","salary":120000}]';

    // First call — compression pipeline runs
    const first = await client.callTool({
      name: 'pakt_auto',
      arguments: { text: largeJson },
    });
    expect(first.isError).not.toBe(true);
    const firstParsed = extractJsonText(first) as { result: string; dedupHit?: boolean };
    expect(firstParsed.dedupHit).toBeUndefined();

    // Second call with identical input — dedup cache hit
    const second = await client.callTool({
      name: 'pakt_auto',
      arguments: { text: largeJson },
    });
    expect(second.isError).not.toBe(true);
    const secondParsed = extractJsonText(second) as { result: string; dedupHit?: boolean };
    expect(secondParsed.dedupHit).toBe(true);
    expect(secondParsed.result).toBe(firstParsed.result);
  });

  it('pakt_stats includes compounding savings after pakt_auto calls', async () => {
    const { client } = await createInMemoryHarness();
    const largeJson =
      '[{"id":1,"name":"Alice","role":"dev","salary":95000},' +
      '{"id":2,"name":"Bob","role":"pm","salary":105000},' +
      '{"id":3,"name":"Carol","role":"designer","salary":88000}]';

    // Make a few calls to build up turns
    await client.callTool({ name: 'pakt_auto', arguments: { text: largeJson } });
    await client.callTool({
      name: 'pakt_auto',
      arguments: { text: 'just a short text for turn count' },
    });
    await client.callTool({ name: 'pakt_auto', arguments: { text: 'another turn' } });

    const result = await client.callTool({
      name: 'pakt_stats',
      arguments: {},
    });

    expect(result.isError).not.toBe(true);
    const parsed = extractJsonText(result) as {
      dedupHits?: number;
      dedupEntries?: number;
      totalCompoundingSavings?: number;
    };

    expect(parsed.dedupEntries).toBeGreaterThanOrEqual(1);
    expect(typeof parsed.totalCompoundingSavings).toBe('number');
  });
});

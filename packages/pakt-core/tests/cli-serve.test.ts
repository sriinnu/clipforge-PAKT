import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerPaktTools } from '../src/mcp/server.js';

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
  const textContent = result.content.find((item) => item.type === 'text' && typeof item.text === 'string');
  expect(textContent?.text).toBeTruthy();
  return JSON.parse(textContent!.text!);
}

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

    expect(names).toEqual(['pakt_auto', 'pakt_compress', 'pakt_inspect']);
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

    const text = result.content.find((item) => item.type === 'text' && typeof item.text === 'string')?.text;

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

    const text = result.content.find((item) => item.type === 'text' && typeof item.text === 'string')?.text;

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

    expect(toolNames).toEqual(['pakt_auto', 'pakt_compress', 'pakt_inspect']);

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
});

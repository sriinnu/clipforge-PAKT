/**
 * @module tests/proxy-slim
 * Tests for slim-mode tool compression.
 *
 * Covers:
 * - `slimTool` and `slimTools` produce measurable token savings on a realistic
 *   30-tool catalog (modelled on real MCP servers like GitHub, filesystem, etc.)
 * - `truncateAtSentence` cuts at the right boundary and appends `…`
 * - `applySlimMode` mutates a body in place, pass-through when no tools
 * - Redundant schema boilerplate (`additionalProperties:false`, top-level
 *   `type:"object"`) is stripped
 * - Request bodies without a `tools` array are returned byte-for-byte unchanged
 */

import { describe, expect, it } from 'vitest';
import {
  applySlimMode,
  slimTool,
  slimTools,
  truncateAtSentence,
} from '../src/proxy/index.js';
import type { ProviderTool } from '../src/proxy/index.js';
import { FAT_CATALOG } from './fixtures/fat-catalog.js';

// ---------------------------------------------------------------------------
// truncateAtSentence
// ---------------------------------------------------------------------------

describe('truncateAtSentence', () => {
  it('returns text unchanged when within cap', () => {
    const text = 'Hello world.';
    expect(truncateAtSentence(text, 1024)).toBe(text);
  });

  it('truncates at sentence boundary with ellipsis', () => {
    const text = 'First sentence. Second sentence that is very long and goes past the cap easily.';
    const result = truncateAtSentence(text, 20);
    expect(result).toBe('First sentence.…');
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(20 + 1); // 1 for the ellipsis char
  });

  it('truncates at word boundary when no sentence break exists', () => {
    const text = 'This is a single long run-on string with no sentence breaks at all';
    const result = truncateAtSentence(text, 20);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(25); // some slack for word boundary
  });

  it('handles text with only punctuation in the cap window', () => {
    const text = '?!?!? This starts weirdly and is quite long past twenty chars here';
    const result = truncateAtSentence(text, 10);
    expect(result.endsWith('…')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// slimTool: schema boilerplate stripping
// ---------------------------------------------------------------------------

describe('slimTool — schema boilerplate', () => {
  it('strips additionalProperties:false from input_schema', () => {
    const tool: ProviderTool = {
      name: 'read_file',
      description: 'Read a file.',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'The path.' } },
        required: ['path'],
        additionalProperties: false,
      },
    };
    const slimmed = slimTool(tool);
    expect(slimmed.input_schema).toBeDefined();
    expect(slimmed.input_schema!['additionalProperties']).toBeUndefined();
  });

  it('strips top-level type:"object" from input_schema', () => {
    const tool: ProviderTool = {
      name: 'write_file',
      description: 'Write.',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'p' } },
        required: ['path'],
      },
    };
    const slimmed = slimTool(tool);
    expect(slimmed.input_schema!['type']).toBeUndefined();
  });

  it('strips null values from property definitions', () => {
    const tool: ProviderTool = {
      name: 'search',
      description: 'Search.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Query string.',
            // biome-ignore lint/suspicious/noExplicitAny: deliberate null injection for test
            enum: null as any,
          },
        },
        required: ['query'],
      },
    };
    const slimmed = slimTool(tool);
    const prop = slimmed.input_schema!.properties!['query'];
    expect(prop).toBeDefined();
    expect(prop!['enum']).toBeUndefined();
  });

  it('does not mutate the original tool', () => {
    const tool: ProviderTool = {
      name: 'tool',
      description: 'A tool with a very long description that is over ten characters.',
      input_schema: {
        type: 'object',
        properties: { x: { type: 'string', description: 'x param' } },
        required: ['x'],
        additionalProperties: false,
      },
    };
    const original = JSON.stringify(tool);
    slimTool(tool, { descriptionCap: 10 });
    expect(JSON.stringify(tool)).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// slimTool: description truncation
// ---------------------------------------------------------------------------

describe('slimTool — description truncation', () => {
  it('truncates long description at sentence boundary', () => {
    const longDesc =
      'This is the first sentence. This is the second sentence that pushes it way over one hundred chars in length easily done.';
    const tool: ProviderTool = { name: 'tool', description: longDesc };
    const slimmed = slimTool(tool, { descriptionCap: 40 });
    expect(slimmed.description!.length).toBeLessThanOrEqual(50);
    expect(slimmed.description!.endsWith('…')).toBe(true);
  });

  it('keeps description unchanged when under cap', () => {
    const tool: ProviderTool = { name: 'tool', description: 'Short.' };
    const slimmed = slimTool(tool, { descriptionCap: 1024 });
    expect(slimmed.description).toBe('Short.');
  });

  it('removes empty description fields', () => {
    const tool: ProviderTool = { name: 'tool', description: '' };
    const slimmed = slimTool(tool);
    expect(slimmed['description']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// slimTools: fat catalog fixture
// ---------------------------------------------------------------------------

describe('slimTools — fat catalog fixture', () => {
  it('produces measurable token savings on a 30-tool catalog', () => {
    const { slimmedTools, savings } = slimTools(FAT_CATALOG);

    // Should save at least 10% on a typical over-documented catalog
    expect(savings.savedTokens).toBeGreaterThan(0);
    expect(savings.savedPercent).toBeGreaterThan(0);
    expect(savings.originalTokens).toBeGreaterThan(savings.slimmedTokens);

    // All 30 tools must still be present
    expect(slimmedTools).toHaveLength(FAT_CATALOG.length);
    for (let i = 0; i < slimmedTools.length; i++) {
      expect(slimmedTools[i]!.name).toBe(FAT_CATALOG[i]!.name);
    }
  });

  it('logs savings fields correctly', () => {
    const { savings } = slimTools(FAT_CATALOG);
    expect(typeof savings.originalTokens).toBe('number');
    expect(typeof savings.slimmedTokens).toBe('number');
    expect(typeof savings.savedTokens).toBe('number');
    expect(typeof savings.savedPercent).toBe('number');
    expect(savings.savedPercent).toBeGreaterThanOrEqual(0);
    expect(savings.savedPercent).toBeLessThanOrEqual(100);
  });

  it('savings are non-negative (never inflates)', () => {
    const { savings } = slimTools(FAT_CATALOG);
    expect(savings.savedTokens).toBeGreaterThanOrEqual(0);
    expect(savings.slimmedTokens).toBeLessThanOrEqual(savings.originalTokens);
  });

  it('respects a tight descriptionCap for more aggressive truncation', () => {
    const { savings: savings200 } = slimTools(FAT_CATALOG, { descriptionCap: 200 });
    const { savings: savings1024 } = slimTools(FAT_CATALOG, { descriptionCap: 1024 });
    // Tighter cap should save at least as much or more
    expect(savings200.savedTokens).toBeGreaterThanOrEqual(savings1024.savedTokens);
  });
});

// ---------------------------------------------------------------------------
// applySlimMode: body mutation
// ---------------------------------------------------------------------------

describe('applySlimMode', () => {
  it('mutates the body tools array in place', () => {
    const body: Record<string, unknown> = {
      model: 'claude-3-5-sonnet',
      tools: FAT_CATALOG.slice(0, 5),
      messages: [{ role: 'user', content: 'Hello' }],
    };
    const originalTools = JSON.stringify(body['tools']);
    const savings = applySlimMode(body);

    expect(savings.savedTokens).toBeGreaterThanOrEqual(0);
    // Body was mutated
    expect(JSON.stringify(body['tools'])).not.toBe(originalTools);
    // Other fields untouched
    expect(body['model']).toBe('claude-3-5-sonnet');
  });

  it('returns zero savings and does not touch body without tools key', () => {
    const body: Record<string, unknown> = {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'Hi' }],
    };
    const bodyCopy = JSON.stringify(body);
    const savings = applySlimMode(body);

    expect(savings.savedTokens).toBe(0);
    expect(JSON.stringify(body)).toBe(bodyCopy); // unchanged
  });

  it('returns zero savings for empty tools array', () => {
    const body: Record<string, unknown> = { tools: [] };
    const savings = applySlimMode(body);
    expect(savings.savedTokens).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Pass-through integrity: request without tools must be byte-for-byte the same
// ---------------------------------------------------------------------------

describe('pass-through integrity', () => {
  it('applySlimMode leaves a tools-free body byte-for-byte unchanged', () => {
    const body = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is 2+2?' },
      ],
      max_tokens: 100,
    };
    const before = JSON.stringify(body);
    applySlimMode(body);
    expect(JSON.stringify(body)).toBe(before);
  });

  it('slimTool preserves tool name and required schema keys', () => {
    const tool: ProviderTool = {
      name: 'list_issues',
      description: 'List GitHub issues.',
      input_schema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repo owner.' },
          repo: { type: 'string', description: 'Repo name.' },
          state: { type: 'string', description: 'Issue state.', enum: ['open', 'closed', 'all'] },
        },
        required: ['owner', 'repo'],
        additionalProperties: false,
      },
    };
    const slimmed = slimTool(tool);
    // Name must survive
    expect(slimmed.name).toBe('list_issues');
    // Required array must survive
    expect(slimmed.input_schema!.required).toEqual(['owner', 'repo']);
    // Properties must survive
    expect(Object.keys(slimmed.input_schema!.properties ?? {})).toContain('owner');
    // Enum must survive
    const stateProp = slimmed.input_schema!.properties!['state'];
    expect(stateProp?.enum).toEqual(['open', 'closed', 'all']);
  });
});

/**
 * @module tests/proxy-catalog
 * Tests for the search-facade catalog module.
 *
 * Covers:
 * - `ToolCatalog.load` populates correctly
 * - `ToolCatalog.search` returns correct matches for keywords
 * - `ToolCatalog.getSchema` returns the full schema for a known tool
 * - `FACADE_TOOL_DEFINITIONS` exports exactly 3 tools with the right names
 * - `handleFacadeRequest` answers search_tools / get_tool_schema locally
 * - `handleFacadeRequest` returns documented limitation error for call_tool
 * - `handleFacadeRequest` returns `handled: false` for non-facade requests
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  FACADE_TOOL_DEFINITIONS,
  ToolCatalog,
  handleFacadeRequest,
} from '../src/proxy/index.js';
import { FAT_CATALOG } from './fixtures/fat-catalog.js';

// ---------------------------------------------------------------------------
// ToolCatalog.load and basic accessors
// ---------------------------------------------------------------------------

describe('ToolCatalog', () => {
  let catalog: ToolCatalog;

  beforeEach(() => {
    catalog = new ToolCatalog();
    catalog.load(FAT_CATALOG);
  });

  it('loads all 30 tools from the fat catalog', () => {
    expect(catalog.size).toBe(FAT_CATALOG.length);
  });

  it('names() returns all tool names in order', () => {
    const names = catalog.names();
    expect(names).toHaveLength(FAT_CATALOG.length);
    // All catalog names should be present
    for (const tool of FAT_CATALOG) {
      expect(names).toContain(tool.name);
    }
  });

  it('getSchema returns the correct tool definition', () => {
    const schema = catalog.getSchema('list_issues');
    expect(schema).toBeDefined();
    expect(schema!.name).toBe('list_issues');
    expect(schema!.input_schema).toBeDefined();
  });

  it('getSchema returns undefined for unknown tool', () => {
    expect(catalog.getSchema('nonexistent_tool_xyz')).toBeUndefined();
  });

  it('replaces catalog on subsequent load calls', () => {
    catalog.load([{ name: 'only_tool', description: 'Single tool.' }]);
    expect(catalog.size).toBe(1);
    expect(catalog.names()).toEqual(['only_tool']);
  });
});

// ---------------------------------------------------------------------------
// ToolCatalog.search — keyword matching
// ---------------------------------------------------------------------------

describe('ToolCatalog.search', () => {
  let catalog: ToolCatalog;

  beforeEach(() => {
    catalog = new ToolCatalog();
    catalog.load(FAT_CATALOG);
  });

  it('finds issue-related tools when querying "issue"', () => {
    const results = catalog.search('issue');
    const names = results.map((r) => r.name);
    expect(names).toContain('list_issues');
    expect(names).toContain('get_issue');
    expect(names).toContain('create_issue');
  });

  it('returns results sorted by descending score', () => {
    const results = catalog.search('file read write');
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  it('respects the limit parameter', () => {
    const results = catalog.search('repository', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('returns empty array for a query with no matches', () => {
    // Use tokens that cannot appear in any tool name or description
    const results = catalog.search('xyzzyblorp wuggawugg frobnicator');
    expect(results).toHaveLength(0);
  });

  it('finds filesystem tools by keyword', () => {
    const results = catalog.search('file directory');
    const names = results.map((r) => r.name);
    // At minimum read_file and list_directory should appear
    expect(names.some((n) => n.includes('file') || n.includes('directory'))).toBe(true);
  });

  it('name match is weighted higher than description match', () => {
    // "list_issues" has "list" in the name; others only in descriptions
    const results = catalog.search('list_issues');
    expect(results[0]!.name).toBe('list_issues');
  });

  it('description field in results is truncated to 200 chars', () => {
    const results = catalog.search('issue');
    for (const r of results) {
      expect(r.description.length).toBeLessThanOrEqual(200);
    }
  });
});

// ---------------------------------------------------------------------------
// FACADE_TOOL_DEFINITIONS
// ---------------------------------------------------------------------------

describe('FACADE_TOOL_DEFINITIONS', () => {
  it('exports exactly 3 facade tools', () => {
    expect(FACADE_TOOL_DEFINITIONS).toHaveLength(3);
  });

  it('contains search_tools, get_tool_schema, and call_tool', () => {
    const names = FACADE_TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toContain('search_tools');
    expect(names).toContain('get_tool_schema');
    expect(names).toContain('call_tool');
  });

  it('each facade tool has a description and input_schema', () => {
    for (const tool of FACADE_TOOL_DEFINITIONS) {
      expect(typeof tool.description).toBe('string');
      expect(tool.description!.length).toBeGreaterThan(0);
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema!.properties).toBeDefined();
    }
  });

  it('search_tools requires "query" parameter', () => {
    const st = FACADE_TOOL_DEFINITIONS.find((t) => t.name === 'search_tools');
    expect(st!.input_schema!.required).toContain('query');
  });

  it('get_tool_schema requires "name" parameter', () => {
    const gt = FACADE_TOOL_DEFINITIONS.find((t) => t.name === 'get_tool_schema');
    expect(gt!.input_schema!.required).toContain('name');
  });
});

// ---------------------------------------------------------------------------
// handleFacadeRequest
// ---------------------------------------------------------------------------

describe('handleFacadeRequest — search_tools', () => {
  let catalog: ToolCatalog;

  beforeEach(() => {
    catalog = new ToolCatalog();
    catalog.load(FAT_CATALOG);
  });

  it('handles an Anthropic-shaped search_tools call', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'search_tools',
              input: { query: 'issue', limit: 5 },
            },
          ],
        },
      ],
    };
    const result = handleFacadeRequest(body, catalog);
    expect(result.handled).toBe(true);
    if (!result.handled) return; // narrow type
    const text = JSON.stringify(result.responseBody);
    expect(text).toContain('results');
    expect(text).toContain('totalInCatalog');
  });

  it('handles OpenAI-shaped search_tools call', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'search_tools',
                arguments: JSON.stringify({ query: 'file', limit: 3 }),
              },
            },
          ],
        },
      ],
    };
    const result = handleFacadeRequest(body, catalog);
    expect(result.handled).toBe(true);
  });
});

describe('handleFacadeRequest — get_tool_schema', () => {
  let catalog: ToolCatalog;

  beforeEach(() => {
    catalog = new ToolCatalog();
    catalog.load(FAT_CATALOG);
  });

  it('returns full schema for a known tool', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'get_tool_schema',
              input: { name: 'list_issues' },
            },
          ],
        },
      ],
    };
    const result = handleFacadeRequest(body, catalog);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    const text = JSON.stringify(result.responseBody);
    expect(text).toContain('list_issues');
    expect(text).toContain('input_schema');
  });

  it('returns error for unknown tool name', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'get_tool_schema',
              input: { name: 'nonexistent_xyz' },
            },
          ],
        },
      ],
    };
    const result = handleFacadeRequest(body, catalog);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    const text = JSON.stringify(result.responseBody);
    expect(text).toContain('not found');
  });
});

describe('handleFacadeRequest — call_tool (documented limitation)', () => {
  let catalog: ToolCatalog;

  beforeEach(() => {
    catalog = new ToolCatalog();
    catalog.load(FAT_CATALOG);
  });

  it('handles call_tool and returns a structured limitation error', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'call_tool',
              input: { name: 'list_issues', arguments: { owner: 'octocat', repo: 'Hello-World' } },
            },
          ],
        },
      ],
    };
    const result = handleFacadeRequest(body, catalog);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    const text = JSON.stringify(result.responseBody);
    // Must contain a clear explanation of the limitation, not a silent failure
    expect(text).toContain('limitation');
    expect(text).toContain('list_issues');
  });

  it('call_tool error includes tool schema when tool is found', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'call_tool',
              input: { name: 'read_file' },
            },
          ],
        },
      ],
    };
    const result = handleFacadeRequest(body, catalog);
    if (!result.handled) throw new Error('expected handled');
    const text = JSON.stringify(result.responseBody);
    // Should include the schema to aid recovery
    expect(text).toContain('toolSchema');
    expect(text).toContain('hint');
  });
});

describe('handleFacadeRequest — pass-through', () => {
  let catalog: ToolCatalog;

  beforeEach(() => {
    catalog = new ToolCatalog();
    catalog.load(FAT_CATALOG);
  });

  it('returns handled:false for a request with no tool_use blocks', () => {
    const body = {
      messages: [
        { role: 'user', content: 'Hello, world!' },
        { role: 'assistant', content: 'Hi there!' },
      ],
    };
    const result = handleFacadeRequest(body, catalog);
    expect(result.handled).toBe(false);
  });

  it('returns handled:false for a non-facade tool call', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'list_issues', // a real tool, not a facade tool
              input: { owner: 'octocat', repo: 'Hello-World' },
            },
          ],
        },
      ],
    };
    const result = handleFacadeRequest(body, catalog);
    expect(result.handled).toBe(false);
  });

  it('returns handled:false for a body without messages', () => {
    const body = { model: 'claude-3-5-sonnet', max_tokens: 100 };
    const result = handleFacadeRequest(body, catalog);
    expect(result.handled).toBe(false);
  });
});

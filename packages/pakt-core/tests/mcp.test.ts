import { describe, expect, it } from 'vitest';
import { PAKT_MCP_TOOLS, handlePaktTool } from '../src/index.js';

const STRUCTURED_JSON = JSON.stringify({
  employees: Array.from({ length: 18 }, (_, i) => ({
    id: i + 1,
    name: `employee_${String(i + 1)}`,
    department: 'engineering',
    status: 'active',
    level: 'senior',
  })),
});

describe('PAKT MCP tools', () => {
  it('exposes semanticBudget in both tool schemas', () => {
    const compressTool = PAKT_MCP_TOOLS.find((tool) => tool.name === 'pakt_compress');
    const autoTool = PAKT_MCP_TOOLS.find((tool) => tool.name === 'pakt_auto');

    expect(compressTool?.inputSchema.properties.semanticBudget).toMatchObject({
      type: 'number',
    });
    expect(autoTool?.inputSchema.properties.semanticBudget).toMatchObject({
      type: 'number',
    });
  });

  it('applies L4 semantic compression when semanticBudget is provided to pakt_compress', () => {
    const result = handlePaktTool('pakt_compress', {
      text: STRUCTURED_JSON,
      format: 'json',
      semanticBudget: 24,
    });

    expect(result.format).toBe('json');
    expect(result.compressed).toContain('@compress semantic');
    expect(result.compressed).toContain('@warning lossy');
  });

  it('applies L4 semantic compression on the auto compress path', () => {
    const result = handlePaktTool('pakt_auto', {
      text: STRUCTURED_JSON,
      semanticBudget: 24,
    });

    expect(result.action).toBe('compressed');
    expect(result.result).toContain('@compress semantic');
    expect(result.result).toContain('@warning lossy');
  });

  it('rejects invalid semanticBudget values', () => {
    expect(() =>
      handlePaktTool('pakt_compress', {
        text: STRUCTURED_JSON,
        format: 'json',
        semanticBudget: 0,
      }),
    ).toThrow('semanticBudget must be a positive integer');

    expect(() =>
      handlePaktTool('pakt_auto', {
        text: STRUCTURED_JSON,
        semanticBudget: -5,
      }),
    ).toThrow('semanticBudget must be a positive integer');
  });
});

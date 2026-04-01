import { describe, expect, it } from 'vitest';
import { PAKT_FORMAT_VALUES } from '../src/formats.js';
import {
  PAKT_AUTO_CONTRACT,
  PAKT_INSPECT_CONTRACT,
  PAKT_MCP_TOOLS,
  handlePaktTool,
} from '../src/index.js';

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
  it('exposes semanticBudget in all relevant tool schemas', () => {
    const compressTool = PAKT_MCP_TOOLS.find((tool) => tool.name === 'pakt_compress');
    const autoTool = PAKT_MCP_TOOLS.find((tool) => tool.name === 'pakt_auto');
    const inspectTool = PAKT_MCP_TOOLS.find((tool) => tool.name === 'pakt_inspect');

    expect(compressTool?.inputSchema.properties.semanticBudget).toMatchObject({
      type: 'number',
    });
    expect(autoTool?.inputSchema.properties.semanticBudget).toMatchObject({
      type: 'number',
    });
    expect(inspectTool?.inputSchema.properties.semanticBudget).toMatchObject({
      type: 'number',
    });
  });

  it('uses the canonical format list in MCP schemas and handler validation', () => {
    const compressTool = PAKT_MCP_TOOLS.find((tool) => tool.name === 'pakt_compress');

    expect(compressTool?.inputSchema.properties.format.enum).toEqual(PAKT_FORMAT_VALUES);
    expect(PAKT_AUTO_CONTRACT.outputJsonSchema.properties.detectedFormat.enum).toEqual(
      PAKT_FORMAT_VALUES,
    );
    expect(PAKT_INSPECT_CONTRACT.outputJsonSchema.properties.detectedFormat.enum).toEqual(
      PAKT_FORMAT_VALUES,
    );

    for (const format of PAKT_FORMAT_VALUES.filter((value) => value !== 'pakt')) {
      expect(() =>
        handlePaktTool('pakt_compress', {
          text: STRUCTURED_JSON,
          format,
        }),
      ).not.toThrow();
    }

    expect(() =>
      handlePaktTool('pakt_compress', {
        text: STRUCTURED_JSON,
        format: 'xml',
      }),
    ).toThrow('Invalid format "xml"');
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
    expect(result.originalTokens).toBeGreaterThan(result.compressedTokens);
    expect(result.savedTokens).toBeGreaterThan(0);
    expect(result.reversible).toBe(false);
  });

  it('applies L4 semantic compression on the auto compress path', () => {
    const result = handlePaktTool('pakt_auto', {
      text: STRUCTURED_JSON,
      semanticBudget: 24,
    });

    expect(result.action).toBe('compressed');
    expect(result.result).toContain('@compress semantic');
    expect(result.result).toContain('@warning lossy');
    expect(result.detectedFormat).toBe('json');
    expect(result.savedTokens).toBeGreaterThan(0);
    expect(result.reversible).toBe(false);
  });

  it('inspects content and recommends compression when it saves tokens', () => {
    const result = handlePaktTool('pakt_inspect', {
      text: STRUCTURED_JSON,
    });

    expect(result.detectedFormat).toBe('json');
    expect(result.recommendedAction).toBe('compress');
    expect(result.estimatedSavedTokens).toBeGreaterThan(0);
  });

  it('reports decompression guidance for existing PAKT payloads', () => {
    const compressed = handlePaktTool('pakt_compress', {
      text: STRUCTURED_JSON,
      format: 'json',
    });
    const inspected = handlePaktTool('pakt_inspect', {
      text: compressed.compressed,
    });

    expect(inspected.detectedFormat).toBe('pakt');
    expect(inspected.recommendedAction).toBe('decompress');
    expect(inspected.originalFormat).toBe('json');
  });

  it('recommends leaving tiny inputs as-is when compression is not worthwhile', () => {
    const result = handlePaktTool('pakt_inspect', {
      text: 'hi',
    });

    expect(result.recommendedAction).toBe('leave-as-is');
    expect(result.estimatedSavedTokens).toBeLessThanOrEqual(0);
  });

  it('does not claim invalid PAKT can be decompressed cleanly', () => {
    const malformed = ['@from json', '@dict', '  $a: dev', 'role: $a'].join('\n');
    const result = handlePaktTool('pakt_inspect', {
      text: malformed,
    });

    expect(result.detectedFormat).toBe('pakt');
    expect(result.recommendedAction).toBe('leave-as-is');
    expect(result.reason).toContain('invalid PAKT');
    expect(result.reversible).toBe(false);
  });

  it('rejects invalid PAKT on the auto path instead of reporting a fake round-trip', () => {
    const malformed = ['@from json', '@dict', '  $a: dev', 'role: $a'].join('\n');

    expect(() =>
      handlePaktTool('pakt_auto', {
        text: malformed,
      }),
    ).toThrow('Input looks like PAKT but failed validation');
  });

  it('rejects invalid PAKT on the compress passthrough path too', () => {
    const malformed = ['@from json', '@dict', '  $a: dev', 'role: $a'].join('\n');

    expect(() =>
      handlePaktTool('pakt_compress', {
        text: malformed,
        format: 'pakt',
      }),
    ).toThrow('Input looks like PAKT but failed validation');
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

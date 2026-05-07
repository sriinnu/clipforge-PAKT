import { beforeEach, describe, expect, it } from 'vitest';
import { PAKT_FORMAT_VALUES } from '../src/formats.js';
import {
  PAKT_AUTO_CONTRACT,
  PAKT_INSPECT_CONTRACT,
  PAKT_MCP_TOOLS,
  handlePaktTool,
  recordCall,
  resetSessionStats,
} from '../src/index.js';
import { PaktToolInputError } from '../src/mcp/handler.js';
import type {
  PaktDashboardResult,
  PaktExplainResult,
  PaktSavingsResult,
} from '../src/mcp/types.js';

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

  // -------------------------------------------------------------------------
  // Cross-turn rolling-dictionary on the auto path
  // -------------------------------------------------------------------------

  it('keeps the @dict prefix stable across turns on pakt_auto (prefix-cache friendly)', async () => {
    const { dedupCache } = await import('../src/mcp/dedup-cache.js');
    const { resetRollingDict } = await import('../src/mcp/rolling-dict.js');
    dedupCache.reset();
    resetRollingDict();

    /* Heterogeneous keyed records (not column-uniform arrays) so delta
       encoding can't subsume the repetition and the L2 dictionary kicks
       in. Two turns over distinct-but-overlapping payloads — the second
       turn's @dict prefix should be a superset of the first, never a
       reordering. */
    const buildPayload = (rows: Array<Record<string, string>>): string =>
      JSON.stringify(Object.fromEntries(rows.map((r, i) => [`row_${String(i)}`, r])));

    /* Each row mixes the three values into different columns so delta
       encoding can't subsume them. Counts per turn are tuned so the
       dictionary actually emits — L2 still requires net positive savings
       even for seeded entries. */
    const turn1Payload = buildPayload([
      { a: 'platform_engineering_team', b: 'platform_engineering_team', c: 'security_engineering_team' },
      { a: 'security_engineering_team', b: 'platform_engineering_team', c: 'platform_engineering_team' },
      { a: 'platform_engineering_team', b: 'security_engineering_team', c: 'platform_engineering_team' },
      { a: 'security_engineering_team', b: 'platform_engineering_team', c: 'security_engineering_team' },
      { a: 'platform_engineering_team', b: 'platform_engineering_team', c: 'security_engineering_team' },
      { a: 'security_engineering_team', b: 'security_engineering_team', c: 'platform_engineering_team' },
    ]);
    const turn2Payload = buildPayload([
      { a: 'platform_engineering_team', b: 'observability_squad_team', c: 'security_engineering_team' },
      { a: 'security_engineering_team', b: 'platform_engineering_team', c: 'observability_squad_team' },
      { a: 'observability_squad_team', b: 'security_engineering_team', c: 'platform_engineering_team' },
      { a: 'platform_engineering_team', b: 'observability_squad_team', c: 'security_engineering_team' },
      { a: 'observability_squad_team', b: 'platform_engineering_team', c: 'security_engineering_team' },
      { a: 'security_engineering_team', b: 'observability_squad_team', c: 'platform_engineering_team' },
    ]);

    const turn1 = handlePaktTool('pakt_auto', { text: turn1Payload });
    const turn2 = handlePaktTool('pakt_auto', { text: turn2Payload });

    const dict1 = extractDictBlock(turn1.result);
    const dict2 = extractDictBlock(turn2.result);

    expect(dict1.length).toBeGreaterThan(0);
    expect(dict2.length).toBeGreaterThan(0);

    // Every entry from turn 1 stays at the same position in turn 2.
    // New entries (e.g. observability_squad_team) append at the end.
    for (let i = 0; i < dict1.length; i++) {
      expect(dict2[i]).toBe(dict1[i]);
    }
  });
});

/** Extract the `@dict` block lines (alias→expansion) from a PAKT output. */
function extractDictBlock(pakt: string): string[] {
  const lines = pakt.split('\n');
  const start = lines.findIndex((l) => l.trim() === '@dict');
  if (start === -1) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '@end') break;
    out.push(line.trim());
  }
  return out;
}

// ---------------------------------------------------------------------------
// pakt_explain tests
// ---------------------------------------------------------------------------

describe('pakt_explain', () => {
  it('returns all required fields for a simple JSON input', () => {
    const result = handlePaktTool('pakt_explain', {
      text: STRUCTURED_JSON,
    }) as PaktExplainResult;

    expect(result.detectedFormat).toBe('json');
    expect(typeof result.savings).toBe('number');
    expect(result.savings).toBeGreaterThanOrEqual(0);
    expect(result.savings).toBeLessThanOrEqual(100);
    expect(typeof result.savedTokens).toBe('number');
    expect(typeof result.layerBreakdown).toBe('string');
    expect(typeof result.structuralAnalysis).toBe('string');
    expect(typeof result.dictionaryAnalysis).toBe('string');
    expect(typeof result.recommendation).toBe('string');
    expect(result.recommendation.length).toBeGreaterThan(0);
  });

  it('returns valid JSON in layerBreakdown', () => {
    const result = handlePaktTool('pakt_explain', {
      text: STRUCTURED_JSON,
    }) as PaktExplainResult;

    const layers = JSON.parse(result.layerBreakdown);
    expect(Array.isArray(layers)).toBe(true);
    expect(layers.length).toBeGreaterThanOrEqual(1);

    for (const entry of layers) {
      expect(typeof entry.layer).toBe('string');
      expect(typeof entry.saved).toBe('number');
      expect(typeof entry.explanation).toBe('string');
    }
  });

  it('returns valid JSON in structuralAnalysis and dictionaryAnalysis', () => {
    const result = handlePaktTool('pakt_explain', {
      text: STRUCTURED_JSON,
    }) as PaktExplainResult;

    const structural = JSON.parse(result.structuralAnalysis);
    expect(typeof structural.totalKeys).toBe('number');
    expect(typeof structural.uniqueKeys).toBe('number');
    expect(typeof structural.keyRepetitionRatio).toBe('number');
    expect(typeof structural.structuralOverhead).toBe('string');

    const dictionary = JSON.parse(result.dictionaryAnalysis);
    expect(typeof dictionary.candidatesFound).toBe('number');
    expect(typeof dictionary.aliasesCreated).toBe('number');
    expect(Array.isArray(dictionary.topPatterns)).toBe(true);
  });

  it('throws PaktToolInputError for empty input', () => {
    expect(() => handlePaktTool('pakt_explain', { text: '' })).toThrow(PaktToolInputError);
    expect(() => handlePaktTool('pakt_explain', { text: '' })).toThrow(
      'text must be a non-empty string',
    );
  });

  it('handles whitespace-only input gracefully without crashing', () => {
    // Whitespace passes assertNonEmptyString (length > 0) but compress()
    // returns an unchanged result — verify it doesn't crash
    const result = handlePaktTool('pakt_explain', { text: '   ' }) as PaktExplainResult;
    expect(typeof result.savings).toBe('number');
    expect(typeof result.recommendation).toBe('string');
  });

  it('handles non-JSON formats (YAML)', () => {
    const yaml = 'name: Alice\nrole: developer\nteam: engineering\nstatus: active\nlevel: senior';
    const result = handlePaktTool('pakt_explain', { text: yaml }) as PaktExplainResult;

    expect(typeof result.detectedFormat).toBe('string');
    expect(typeof result.savings).toBe('number');
    expect(typeof result.recommendation).toBe('string');
    // layerBreakdown should still be parseable JSON
    expect(() => JSON.parse(result.layerBreakdown)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// pakt_savings tests
// ---------------------------------------------------------------------------

describe('pakt_savings', () => {
  beforeEach(() => {
    resetSessionStats();
  });

  it('returns "No compression calls yet" when no calls have been made', () => {
    const result = handlePaktTool('pakt_savings', {}) as PaktSavingsResult;

    expect(result.summary).toContain('No compression calls yet');
    expect(result.totalSavedTokens).toBe(0);
    expect(result.totalCalls).toBe(0);
    expect(result.estimatedCostSaved).toBe('$0.00');
    expect(result.avgSavingsPercent).toBe(0);
  });

  it('returns correct totals after recording calls', () => {
    // Simulate some compression calls via recordCall
    recordCall({
      action: 'compress',
      format: 'json',
      inputTokens: 1000,
      outputTokens: 600,
      savedTokens: 400,
      savingsPercent: 40,
      reversible: true,
      timestamp: Date.now(),
    });
    recordCall({
      action: 'compress',
      format: 'json',
      inputTokens: 500,
      outputTokens: 350,
      savedTokens: 150,
      savingsPercent: 30,
      reversible: true,
      timestamp: Date.now(),
    });

    const result = handlePaktTool('pakt_savings', {}) as PaktSavingsResult;

    expect(result.totalCalls).toBe(2);
    expect(result.totalSavedTokens).toBe(550);
    expect(result.avgSavingsPercent).toBeGreaterThan(0);
    expect(result.summary).toContain('saved');
    expect(result.summary).toContain('$');
    // Dollar amount should be formatted as $X.XX
    expect(result.estimatedCostSaved).toMatch(/^\$\d+\.\d{2}$/);
    expect(result.topFormat).toBe('json');
  });

  it('distinguishes session vs all scope', () => {
    recordCall({
      action: 'compress',
      format: 'csv',
      inputTokens: 200,
      outputTokens: 100,
      savedTokens: 100,
      savingsPercent: 50,
      reversible: true,
      timestamp: Date.now(),
    });

    const sessionResult = handlePaktTool('pakt_savings', {
      scope: 'session',
    }) as PaktSavingsResult;
    expect(sessionResult.totalCalls).toBe(1);
    expect(sessionResult.totalSavedTokens).toBe(100);

    // 'all' scope reads from disk — may or may not have data, but shouldn't crash
    const allResult = handlePaktTool('pakt_savings', { scope: 'all' }) as PaktSavingsResult;
    expect(typeof allResult.totalCalls).toBe('number');
    expect(typeof allResult.totalSavedTokens).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// pakt_dashboard tests
// ---------------------------------------------------------------------------

describe('pakt_dashboard', () => {
  beforeEach(() => {
    resetSessionStats();
  });

  it('returns all required fields', () => {
    const result = handlePaktTool('pakt_dashboard', {}) as PaktDashboardResult;

    expect(typeof result.summary).toBe('string');
    expect(typeof result.totalSavedTokens).toBe('number');
    expect(typeof result.totalCalls).toBe('number');
    expect(typeof result.avgSavingsPercent).toBe('number');
    expect(typeof result.formatBreakdown).toBe('string');
    expect(typeof result.sessionDuration).toBe('string');
  });

  it('returns valid JSON in formatBreakdown', () => {
    // Record a call so formatBreakdown has data
    recordCall({
      action: 'compress',
      format: 'json',
      inputTokens: 800,
      outputTokens: 500,
      savedTokens: 300,
      savingsPercent: 37,
      reversible: true,
      timestamp: Date.now(),
    });

    const result = handlePaktTool('pakt_dashboard', {}) as PaktDashboardResult;
    const breakdown = JSON.parse(result.formatBreakdown);

    expect(typeof breakdown).toBe('object');
    expect(breakdown.json).toBeDefined();
    expect(breakdown.json.calls).toBe(1);
    expect(breakdown.json.savedTokens).toBe(300);
  });

  it('includes dedupEfficiency and rollingDictStats for session scope', () => {
    const result = handlePaktTool('pakt_dashboard', {
      scope: 'session',
    }) as PaktDashboardResult;

    // Session scope should always include dedup and rolling dict stats
    expect(result.dedupEfficiency).toBeDefined();
    expect(result.rollingDictStats).toBeDefined();

    const dedup = JSON.parse(result.dedupEfficiency!);
    expect(typeof dedup.hits).toBe('number');
    expect(typeof dedup.entries).toBe('number');
    expect(typeof dedup.hitRate).toBe('number');
    expect(typeof dedup.compoundingSavings).toBe('number');

    const dict = JSON.parse(result.rollingDictStats!);
    expect(typeof dict.size).toBe('number');
    expect(typeof dict.reuses).toBe('number');
    expect(typeof dict.estimatedSavings).toBe('number');
  });

  it('shows correct summary when no calls exist', () => {
    const result = handlePaktTool('pakt_dashboard', {}) as PaktDashboardResult;

    expect(result.summary).toContain('No compression calls yet');
    expect(result.totalCalls).toBe(0);
    expect(result.totalSavedTokens).toBe(0);
  });

  it('populates topFormat and estimatedCostSaved after calls', () => {
    recordCall({
      action: 'compress',
      format: 'yaml',
      inputTokens: 600,
      outputTokens: 400,
      savedTokens: 200,
      savingsPercent: 33,
      reversible: true,
      timestamp: Date.now(),
    });

    const result = handlePaktTool('pakt_dashboard', {}) as PaktDashboardResult;

    expect(result.topFormat).toBeDefined();
    const topFormat = JSON.parse(result.topFormat!);
    expect(topFormat.format).toBe('yaml');
    expect(topFormat.calls).toBe(1);

    expect(result.estimatedCostSaved).toBeDefined();
    const cost = JSON.parse(result.estimatedCostSaved!);
    expect(typeof cost.input).toBe('number');
    expect(typeof cost.output).toBe('number');
    expect(cost.currency).toBe('USD');
  });
});

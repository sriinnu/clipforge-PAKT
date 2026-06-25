import { describe, expect, it } from 'vitest';
import { createContextEngine } from '../src/context-engine/engine.js';
import { extractRelevant } from '../src/context-engine/extractive.js';

const MODEL = 'gpt-4o';

/** A multi-line log where only a few lines mention the queried identifier. */
function buildLog() {
  const noise = Array.from(
    { length: 30 },
    (_, i) => `2026-06-10 INFO heartbeat ok seq=${String(i)}`,
  );
  return [
    ...noise.slice(0, 15),
    'ERROR payment-service charge declined for invoice INV-9001',
    ...noise.slice(15, 25),
    'WARN payment-service retry scheduled for invoice INV-9001',
    ...noise.slice(25),
  ].join('\n');
}

describe('extractive: query-aware line selection', () => {
  it('keeps query-relevant lines verbatim and drops the rest', () => {
    const content = buildLog();
    const result = extractRelevant(content, {
      query: 'what happened with invoice INV-9001 in payment-service?',
      model: MODEL,
    });

    expect(result.savedTokens).toBeGreaterThan(0);
    expect(result.unitsKept).toBeLessThan(result.unitsTotal);
    // The two relevant lines survive verbatim.
    expect(result.text).toContain('charge declined for invoice INV-9001');
    expect(result.text).toContain('retry scheduled for invoice INV-9001');
    // Irrelevant runs are folded into an explicit, source-anchored marker.
    expect(result.text).toMatch(/line[s]? elided/);
    // Faithfulness: every non-marker line in the output exists in the source.
    const sourceLines = new Set(content.split('\n'));
    for (const line of result.text.split('\n')) {
      if (line.includes('elided')) continue;
      expect(sourceLines.has(line)).toBe(true);
    }
  });

  it('is a no-op when the query has no salient overlap with the content', () => {
    const content = buildLog();
    const result = extractRelevant(content, {
      query: 'unrelated quarterly revenue projections',
      model: MODEL,
    });
    // No query term matches any line → keep everything (orthogonal query).
    expect(result.savedTokens).toBe(0);
    expect(result.text).toBe(content);
  });

  it('returns the original for short content below minKeep', () => {
    const content = 'alpha\nbeta';
    const result = extractRelevant(content, { query: 'alpha', model: MODEL });
    expect(result.text).toBe(content);
    expect(result.savedTokens).toBe(0);
  });

  it('respects an empty query (no salient terms) as a no-op', () => {
    const content = buildLog();
    const result = extractRelevant(content, { query: 'the a of to', model: MODEL });
    expect(result.text).toBe(content);
  });
});

describe('extractive: engine integration', () => {
  it('reduces old tool results when extractive + query are set', () => {
    const engine = createContextEngine({
      maxContextTokens: 1_000_000,
      extractive: true,
      query: 'invoice INV-9001 payment-service',
      recentTurns: 1,
    });
    // Old turn with a big tool result, then several recent turns.
    engine.addMessage({ role: 'user', content: 'investigate the billing failure' });
    engine.addToolResult('read_logs', buildLog());
    for (let i = 0; i < 3; i++) {
      engine.addMessage({ role: 'user', content: `follow-up ${String(i)}` });
      engine.addMessage({ role: 'assistant', content: `noted ${String(i)}` });
    }

    const { savings, messages } = engine.optimize();
    expect(savings.breakdown.extractive).toBeGreaterThan(0);
    const log = messages.find((m) => m.role === 'tool');
    expect(log?.content).toMatch(/elided/);
    expect(log?.content).toContain('INV-9001');
  });

  it('does nothing when extractive is disabled (default)', () => {
    const engine = createContextEngine({ maxContextTokens: 1_000_000, query: 'INV-9001' });
    engine.addMessage({ role: 'user', content: 'investigate' });
    engine.addToolResult('read_logs', buildLog());
    for (let i = 0; i < 3; i++) {
      engine.addMessage({ role: 'user', content: `q${String(i)}` });
    }

    const { savings } = engine.optimize();
    expect(savings.breakdown.extractive).toBe(0);
  });

  it('preserves recent-turn tool results verbatim', () => {
    const engine = createContextEngine({
      maxContextTokens: 1_000_000,
      extractive: true,
      query: 'INV-9001',
      recentTurns: 5,
    });
    engine.addMessage({ role: 'user', content: 'investigate' });
    const log = buildLog();
    engine.addToolResult('read_logs', log);

    const { savings } = engine.optimize();
    // The only tool result is in the current/recent window → untouched.
    expect(savings.breakdown.extractive).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { CONTEXT_SAMPLES } from './context-samples';
import { optimizeContext } from './pakt-service';

function sample(id: string) {
  const s = CONTEXT_SAMPLES.find((x) => x.id === id);
  if (!s) throw new Error(`missing sample ${id}`);
  return s;
}

describe('optimizeContext (context engine demo)', () => {
  it('aliases shared lines and surfaces the @shared breakdown', async () => {
    const s = sample('refactor');
    const result = await optimizeContext(s.messages, { sharedDictionary: true });

    expect(result.optimizedTokens).toBeLessThanOrEqual(result.originalTokens);
    expect(result.breakdown.sharedDictionary).toBeGreaterThan(0);
    expect(result.messages.some((m) => m.content.startsWith('@shared'))).toBe(true);
  });

  it('does not emit a @shared preamble when sharedDictionary is off', async () => {
    const s = sample('refactor');
    const result = await optimizeContext(s.messages, { sharedDictionary: false });

    expect(result.breakdown.sharedDictionary).toBe(0);
    expect(result.messages.some((m) => m.content.startsWith('@shared'))).toBe(false);
  });

  it('extractive selection trims the noisy log when a query is set', async () => {
    const s = sample('logs');
    const result = await optimizeContext(s.messages, {
      sharedDictionary: false,
      extractive: true,
      query: s.suggestedQuery,
      recentTurns: 1,
    });

    expect(result.breakdown.extractive).toBeGreaterThan(0);
    expect(result.messages.some((m) => m.content.includes('elided'))).toBe(true);
    // The relevant lines survive verbatim.
    expect(result.messages.some((m) => m.content.includes('INV-9001'))).toBe(true);
  });
});

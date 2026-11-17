/**
 * Cache / preserved-thinking guard for ContextEngine.optimize().
 *
 * Claude's prompt cache is a byte-exact prefix match, and on Fable 5.2 (and
 * newer-account Opus/Sonnet 5.5) every thinking block is bound to the exact
 * messages before it. So the history PAKT emits on turn N must be a byte
 * prefix of what it emits on turn N+1: earlier messages never change.
 *
 * Today only some configurations hold this. The `it.fails` cases pin the
 * known violations, so they flip loudly when append-only mode lands (or if a
 * stable configuration regresses).
 */
import { describe, expect, it } from 'vitest';
import { createContextEngine } from '../src/context-engine/index.js';
import type { ContextEngineConfig } from '../src/context-engine/types.js';

/** Messages from call N that changed by call N+1, per turn (0 = stable). */
function prefixBreaks(config: ContextEngineConfig, turns = 12): number[] {
  const engine = createContextEngine(config);
  let prev: string[] | null = null;
  const breaks: number[] = [];
  for (let t = 1; t <= turns; t++) {
    engine.addMessage({ role: 'user', content: `step ${t}: what does module_${t}'s handler do?` });
    engine.addMessage({
      role: 'assistant',
      content: `Reading module_${t}. Using the retry wrapper for handler ${t} so it stays idempotent.`,
    });
    const log = Array.from({ length: 60 }, (_, i) =>
      i % 3 === 0
        ? `import { helper } from '../shared/helpers/index.js';`
        : `line ${t}-${i} doing distinct work for item ${t * 100 + i}`,
    ).join('\n');
    engine.addToolResult('read_file', log);
    engine.addToolResult(
      'query',
      JSON.stringify(
        Array.from({ length: 20 }, (_, i) => ({
          id: t * 100 + i,
          name: `user_${t}_${i}`,
          role: 'developer',
          active: true,
        })),
      ),
    );
    const out = engine.optimize().messages.map((m) => `${m.role}\u0000${m.content}`);
    if (prev) {
      let common = 0;
      while (common < prev.length && prev[common] === out[common]) common++;
      breaks.push(prev.length - common);
    }
    prev = out;
  }
  return breaks;
}

const allStable = (b: number[]) => b.every((n) => n === 0);

describe('ContextEngine.optimize() keeps earlier messages byte-stable', () => {
  it('holds with the shared dictionary off and no budget pressure', () => {
    expect(allStable(prefixBreaks({ sharedDictionary: false }))).toBe(true);
  });

  // Known violation: @shared is re-mined over the whole history each call and
  // its preamble sits at the front, so aliases renumber and the prefix resets.
  it.fails('holds with the default config (@shared dictionary on)', () => {
    expect(allStable(prefixBreaks({}))).toBe(true);
  });

  // Known violation: under budget pressure, tool-result aging and fact
  // extraction rewrite or drop old turns (keep-tail compaction).
  it.fails('holds under budget pressure', () => {
    expect(allStable(prefixBreaks({ sharedDictionary: false, maxContextTokens: 8000 }))).toBe(true);
  });
});

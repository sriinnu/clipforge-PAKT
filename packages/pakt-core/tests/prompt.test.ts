import { describe, expect, it } from 'vitest';
import { PAKT_SYSTEM_PROMPT } from '../src/prompt.js';
import { countTokens } from '../src/tokens/counter.js';

describe('PAKT_SYSTEM_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof PAKT_SYSTEM_PROMPT).toBe('string');
    expect(PAKT_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it('explains the dictionary notation (@dict)', () => {
    expect(PAKT_SYSTEM_PROMPT).toMatch(/@?dict/i);
  });

  it('explains the pipe delimiter', () => {
    expect(PAKT_SYSTEM_PROMPT).toContain('|');
  });

  it('fits in a small token budget for the default model family', () => {
    // Default model ('gpt-4o' -> o200k_base) counts the prompt at 80;
    // cl100k_base counts it at 79. The budget guard should stay tight
    // across both families — keep headroom small.
    const tokens = countTokens(PAKT_SYSTEM_PROMPT);
    expect(tokens).toBeLessThanOrEqual(85);
  });

  it('does not contain instructions to output PAKT', () => {
    const lower = PAKT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).not.toMatch(/respond\s+(in|with|using)\s+pakt/);
    expect(lower).not.toMatch(/output\s+(in|with|using)\s+pakt/);
    expect(lower).not.toMatch(/reply\s+(in|with|using)\s+pakt/);
    expect(lower).not.toMatch(/generate\s+pakt/);
    expect(lower).not.toMatch(/write\s+(in|with|using)\s+pakt/);
  });
});

import { describe, expect, it } from 'vitest';

import { GptTokenCounter } from '../src/tokens/gpt-counter.js';
import {
  getTokenizerFamily,
  getTokenizerFamilyInfo,
} from '../src/tokens/tokenizer-family.js';
import { countTokens } from '../src/tokens/counter.js';

// ===========================================================================
// 1. getTokenizerFamily — o200k_base path (GPT-4o family)
// ===========================================================================

describe('getTokenizerFamily — o200k_base (GPT-4o family)', () => {
  it('maps gpt-4o to o200k_base', () => {
    expect(getTokenizerFamily('gpt-4o')).toBe('o200k_base');
  });

  it('maps gpt-4o-mini to o200k_base', () => {
    expect(getTokenizerFamily('gpt-4o-mini')).toBe('o200k_base');
  });

  it('maps revision-pinned gpt-4o-2024-08-06 to o200k_base', () => {
    expect(getTokenizerFamily('gpt-4o-2024-08-06')).toBe('o200k_base');
  });

  it('maps o1 and o3 reasoning models to o200k_base', () => {
    expect(getTokenizerFamily('o1')).toBe('o200k_base');
    expect(getTokenizerFamily('o3-mini')).toBe('o200k_base');
  });

  it('exposes exact=true (no approximation warning) for GPT-4o', () => {
    const info = getTokenizerFamilyInfo('gpt-4o');
    expect(info.family).toBe('o200k_base');
    expect(info.exact).toBe(true);
    expect(info.approximationNote).toBeUndefined();
  });

  it('GptTokenCounter routes gpt-4o through the o200k_base encoder', () => {
    const counter = new GptTokenCounter('gpt-4o');
    expect(counter.family).toBe('o200k_base');
    expect(counter.count('hello world')).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 2. getTokenizerFamily — cl100k_base path (GPT-4 / GPT-3.5)
// ===========================================================================

describe('getTokenizerFamily — cl100k_base (GPT-4 / GPT-3.5)', () => {
  it('maps gpt-4 to cl100k_base', () => {
    expect(getTokenizerFamily('gpt-4')).toBe('cl100k_base');
  });

  it('maps gpt-4-turbo to cl100k_base (gpt-4 prefix)', () => {
    expect(getTokenizerFamily('gpt-4-turbo')).toBe('cl100k_base');
  });

  it('maps gpt-3.5-turbo to cl100k_base', () => {
    expect(getTokenizerFamily('gpt-3.5-turbo')).toBe('cl100k_base');
  });

  it('is case-insensitive (GPT-4 == gpt-4)', () => {
    expect(getTokenizerFamily('GPT-4')).toBe('cl100k_base');
    expect(getTokenizerFamily('GPT-4O')).toBe('o200k_base');
  });

  it('does NOT let gpt-4 capture gpt-4o (ordering check)', () => {
    // Regression guard: the mapping table must check 'gpt-4o' before 'gpt-4'.
    expect(getTokenizerFamily('gpt-4o')).toBe('o200k_base');
    expect(getTokenizerFamily('gpt-4o-mini')).toBe('o200k_base');
  });

  it('exposes exact=true for GPT-4', () => {
    const info = getTokenizerFamilyInfo('gpt-4');
    expect(info.family).toBe('cl100k_base');
    expect(info.exact).toBe(true);
  });

  it('routes gpt-4 and gpt-4o through different encoder code paths', () => {
    // The two families share many common-english merges, so counts on
    // pure prose can coincide. The stronger guarantee we can make is that
    // the counters carry different family labels, i.e. they're wired
    // through different encoders even if token counts happen to match.
    const cl100kCounter = new GptTokenCounter('gpt-4');
    const o200kCounter = new GptTokenCounter('gpt-4o');
    expect(cl100kCounter.family).toBe('cl100k_base');
    expect(o200kCounter.family).toBe('o200k_base');

    // Text with lots of modern tokens / emojis / code tends to differ.
    const text = 'const greet = (name) => `Hello, ${name}! \u{1F44B}`;'.repeat(5);
    const cl100k = cl100kCounter.count(text);
    const o200k = o200kCounter.count(text);
    expect(cl100k).toBeGreaterThan(0);
    expect(o200k).toBeGreaterThan(0);
    expect(cl100k).not.toBe(o200k);
  });
});

// ===========================================================================
// 3. Unknown-model fallback
// ===========================================================================

describe('getTokenizerFamily — unknown model fallback', () => {
  it('falls back to cl100k_base for unknown model names', () => {
    expect(getTokenizerFamily('totally-made-up-model-xyz')).toBe('cl100k_base');
  });

  it('falls back for empty / nullish model strings', () => {
    expect(getTokenizerFamily('')).toBe('cl100k_base');
    expect(getTokenizerFamily(undefined)).toBe('cl100k_base');
    expect(getTokenizerFamily(null)).toBe('cl100k_base');
  });

  it('surfaces an approximationNote for unknown models', () => {
    const info = getTokenizerFamilyInfo('totally-made-up-model-xyz');
    expect(info.family).toBe('cl100k_base');
    expect(info.exact).toBe(false);
    expect(info.approximationNote).toBeTypeOf('string');
    expect(info.approximationNote).toContain('Unknown model');
  });

  it('GptTokenCounter still works for unknown models (no throw)', () => {
    const counter = new GptTokenCounter('totally-made-up-model-xyz');
    expect(counter.family).toBe('cl100k_base');
    const count = counter.count('hello');
    expect(count).toBeGreaterThan(0);
  });

  it('countTokens() does not throw for unknown models', () => {
    expect(() => countTokens('hi', 'nonexistent-model-id')).not.toThrow();
    expect(countTokens('hi', 'nonexistent-model-id')).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 4. Claude / Llama — approximate warning surface
// ===========================================================================

describe('getTokenizerFamily — Claude / Llama approximation', () => {
  it('maps claude-sonnet to cl100k_base but flags as approximate', () => {
    const info = getTokenizerFamilyInfo('claude-sonnet');
    expect(info.family).toBe('cl100k_base');
    expect(info.exact).toBe(false);
    expect(info.approximationNote).toBeTypeOf('string');
    expect(info.approximationNote).toContain('Claude');
    expect(info.approximationNote).toContain('approximation');
  });

  it('maps claude-opus and claude-haiku identically', () => {
    expect(getTokenizerFamily('claude-opus')).toBe('cl100k_base');
    expect(getTokenizerFamily('claude-haiku')).toBe('cl100k_base');
    expect(getTokenizerFamilyInfo('claude-opus').exact).toBe(false);
    expect(getTokenizerFamilyInfo('claude-haiku').exact).toBe(false);
  });

  it('maps llama-3 and llama-3.1 to cl100k_base with Llama-specific note', () => {
    expect(getTokenizerFamily('llama-3')).toBe('cl100k_base');
    const info = getTokenizerFamilyInfo('llama-3.1');
    expect(info.family).toBe('cl100k_base');
    expect(info.exact).toBe(false);
    expect(info.approximationNote).toContain('Llama');
  });

  it('Claude counter produces identical counts to GPT-4 counter (cl100k)', () => {
    // Both resolve to cl100k_base, so counts must match exactly.
    const text = 'Claude and GPT-4 share the cl100k_base fallback here.';
    const claude = new GptTokenCounter('claude-sonnet').count(text);
    const gpt4 = new GptTokenCounter('gpt-4').count(text);
    expect(claude).toBe(gpt4);
  });
});

import { describe, expect, it } from 'vitest';
import { countTokens } from '../src/tokens/counter.js';
import { compareSavings } from '../src/tokens/savings.js';

// ===========================================================================
// 1. countTokens
// ===========================================================================

describe('countTokens', () => {
  it('returns a positive number for "hello world"', () => {
    const count = countTokens('hello world');
    expect(count).toBeGreaterThan(0);
    expect(Number.isInteger(count)).toBe(true);
  });

  it('returns 0 for an empty string', () => {
    const count = countTokens('');
    expect(count).toBe(0);
  });

  it('returns a reasonable count for a JSON string', () => {
    const json = JSON.stringify({
      users: [
        { id: 1, name: 'Alice', role: 'developer' },
        { id: 2, name: 'Bob', role: 'designer' },
        { id: 3, name: 'Carol', role: 'manager' },
      ],
    });
    const count = countTokens(json);
    // A JSON string of this size should be somewhere between 20 and 200 tokens
    expect(count).toBeGreaterThan(10);
    expect(count).toBeLessThan(200);
  });

  it('accepts an optional model parameter without error', () => {
    const count = countTokens('hello world', 'gpt-4o');
    expect(count).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 2. compareSavings — basic
// ===========================================================================

describe('compareSavings', () => {
  const longJson = JSON.stringify({
    users: [
      { id: 1, name: 'Alice', role: 'developer', active: true },
      { id: 2, name: 'Bob', role: 'designer', active: false },
      { id: 3, name: 'Carol', role: 'manager', active: true },
    ],
  });

  const shortPakt = [
    '@from json',
    'users[3]{id|name|role|active}:',
    '1|Alice|developer|true',
    '2|Bob|designer|false',
    '3|Carol|manager|true',
  ].join('\n');

  it('shows positive savings when compressed is shorter', () => {
    const report = compareSavings(longJson, shortPakt);
    expect(report.savedTokens).toBeGreaterThan(0);
    expect(report.savedPercent).toBeGreaterThan(0);
    expect(report.originalTokens).toBeGreaterThan(report.compressedTokens);
  });

  it('includes cost savings for known model gpt-4o', () => {
    const report = compareSavings(longJson, shortPakt, 'gpt-4o');
    expect(report.model).toBe('gpt-4o');
    expect(report.costSaved).toBeDefined();
    expect(report.costSaved?.input).toBeGreaterThan(0);
    expect(report.costSaved?.output).toBeGreaterThan(0);
    expect(report.costSaved?.currency).toBe('USD');
  });

  it('includes cost savings for known model claude-sonnet', () => {
    const report = compareSavings(longJson, shortPakt, 'claude-sonnet');
    expect(report.model).toBe('claude-sonnet');
    expect(report.costSaved).toBeDefined();
    expect(report.costSaved?.input).toBeGreaterThan(0);
    expect(report.costSaved?.output).toBeGreaterThan(0);
    expect(report.costSaved?.currency).toBe('USD');
  });

  it('returns undefined costSaved for unknown model', () => {
    const report = compareSavings(longJson, shortPakt, 'unknown-model-xyz');
    expect(report.model).toBe('unknown-model-xyz');
    expect(report.costSaved).toBeUndefined();
  });

  it('savedPercent is in the range 0-100', () => {
    const report = compareSavings(longJson, shortPakt);
    expect(report.savedPercent).toBeGreaterThanOrEqual(0);
    expect(report.savedPercent).toBeLessThanOrEqual(100);
  });

  it('returns 0 savings when original === compressed', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    const report = compareSavings(text, text);
    expect(report.savedTokens).toBe(0);
    expect(report.savedPercent).toBe(0);
    expect(report.originalTokens).toBe(report.compressedTokens);
  });

  it('defaults to gpt-4o when no model is specified', () => {
    const report = compareSavings(longJson, shortPakt);
    expect(report.model).toBe('gpt-4o');
    expect(report.costSaved).toBeDefined();
  });

  it('handles empty strings', () => {
    const report = compareSavings('', '');
    expect(report.originalTokens).toBe(0);
    expect(report.compressedTokens).toBe(0);
    expect(report.savedTokens).toBe(0);
    expect(report.savedPercent).toBe(0);
  });
});

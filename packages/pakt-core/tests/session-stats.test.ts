import { beforeEach, describe, expect, it } from 'vitest';
import {
  SessionStats,
  getSessionStats,
  recordCall,
  resetSessionStats,
} from '../src/mcp/session-stats.js';

describe('SessionStats', () => {
  let stats: SessionStats;

  beforeEach(() => {
    stats = new SessionStats();
  });

  it('returns empty stats when no calls recorded', () => {
    const result = stats.getStats();

    expect(result.totalCalls).toBe(0);
    expect(result.callsByAction).toEqual({ compress: 0, decompress: 0, inspect: 0 });
    expect(result.totalInputTokens).toBe(0);
    expect(result.totalOutputTokens).toBe(0);
    expect(result.totalSavedTokens).toBe(0);
    expect(result.overallSavingsPercent).toBe(0);
    expect(result.byFormat).toEqual({});
    expect(result.topFormat).toBeNull();
    expect(result.lastCallAt).toBeNull();
    expect(result.sessionDuration).toMatch(/^\d+s$/);
  });

  it('tracks a single compress call', () => {
    stats.record({
      action: 'compress',
      format: 'json',
      inputTokens: 100,
      outputTokens: 30,
      savedTokens: 70,
      savingsPercent: 70,
      reversible: true,
      timestamp: Date.now(),
    });

    const result = stats.getStats();

    expect(result.totalCalls).toBe(1);
    expect(result.callsByAction.compress).toBe(1);
    expect(result.totalInputTokens).toBe(100);
    expect(result.totalOutputTokens).toBe(30);
    expect(result.totalSavedTokens).toBe(70);
    expect(result.overallSavingsPercent).toBe(70);
    expect(result.byFormat['json']?.calls).toBe(1);
    expect(result.topFormat?.format).toBe('json');
    expect(result.lastCallAt).toBeTruthy();
  });

  it('accumulates multiple calls across formats', () => {
    stats.record({
      action: 'compress',
      format: 'json',
      inputTokens: 200,
      outputTokens: 60,
      savedTokens: 140,
      savingsPercent: 70,
      reversible: true,
      timestamp: Date.now(),
    });
    stats.record({
      action: 'compress',
      format: 'json',
      inputTokens: 100,
      outputTokens: 40,
      savedTokens: 60,
      savingsPercent: 60,
      reversible: true,
      timestamp: Date.now(),
    });
    stats.record({
      action: 'compress',
      format: 'csv',
      inputTokens: 500,
      outputTokens: 80,
      savedTokens: 420,
      savingsPercent: 84,
      reversible: true,
      timestamp: Date.now(),
    });

    const result = stats.getStats();

    expect(result.totalCalls).toBe(3);
    expect(result.totalInputTokens).toBe(800);
    expect(result.totalSavedTokens).toBe(620);

    // Weighted savings: 620/800 = 77.5% → rounds to 78
    expect(result.overallSavingsPercent).toBe(78);

    expect(result.byFormat['json']?.calls).toBe(2);
    expect(result.byFormat['csv']?.calls).toBe(1);

    // json: 200/300 saved → 67%
    expect(result.byFormat['json']?.avgSavingsPercent).toBe(67);
    // csv: 420/500 → 84%
    expect(result.byFormat['csv']?.avgSavingsPercent).toBe(84);
  });

  it('computes weighted savings, not arithmetic average', () => {
    // Big payload: 1000 tokens, 50% savings
    stats.record({
      action: 'compress',
      format: 'json',
      inputTokens: 1000,
      outputTokens: 500,
      savedTokens: 500,
      savingsPercent: 50,
      reversible: true,
      timestamp: Date.now(),
    });
    // Small payload: 100 tokens, 90% savings
    stats.record({
      action: 'compress',
      format: 'json',
      inputTokens: 100,
      outputTokens: 10,
      savedTokens: 90,
      savingsPercent: 90,
      reversible: true,
      timestamp: Date.now(),
    });

    const result = stats.getStats();

    // Weighted: (500+90)/(1000+100) = 590/1100 ≈ 54%, NOT average of 50 and 90 = 70%
    expect(result.overallSavingsPercent).toBe(54);
  });

  it('tracks decompress and inspect actions', () => {
    stats.record({
      action: 'decompress',
      format: 'pakt',
      inputTokens: 50,
      outputTokens: 100,
      savedTokens: -50,
      savingsPercent: 0,
      reversible: true,
      timestamp: Date.now(),
    });
    stats.record({
      action: 'inspect',
      format: 'yaml',
      inputTokens: 200,
      outputTokens: 200,
      savedTokens: 0,
      savingsPercent: 0,
      reversible: true,
      timestamp: Date.now(),
    });

    const result = stats.getStats();

    expect(result.totalCalls).toBe(2);
    expect(result.callsByAction.decompress).toBe(1);
    expect(result.callsByAction.inspect).toBe(1);
    expect(result.callsByAction.compress).toBe(0);
  });

  it('estimates cost for known models', () => {
    stats.record({
      action: 'compress',
      format: 'json',
      inputTokens: 1_000_000,
      outputTokens: 300_000,
      savedTokens: 700_000,
      savingsPercent: 70,
      reversible: true,
      timestamp: Date.now(),
    });

    const result = stats.getStats('gpt-4o');

    expect(result.estimatedCostSaved).not.toBeNull();
    expect(result.estimatedCostSaved?.currency).toBe('USD');
    // gpt-4o: $2.5/MTok input, $10/MTok output
    // 700k saved tokens = 0.7 MTok
    // input cost: 0.7 * 2.5 = 1.75
    expect(result.estimatedCostSaved?.input).toBeCloseTo(1.75, 2);
    expect(result.estimatedCostSaved?.output).toBeCloseTo(7.0, 2);
  });

  it('returns null cost for unknown models', () => {
    stats.record({
      action: 'compress',
      format: 'json',
      inputTokens: 100,
      outputTokens: 50,
      savedTokens: 50,
      savingsPercent: 50,
      reversible: true,
      timestamp: Date.now(),
    });

    const result = stats.getStats('unknown-model-xyz');
    expect(result.estimatedCostSaved).toBeNull();
  });

  it('clears everything on reset', () => {
    stats.record({
      action: 'compress',
      format: 'json',
      inputTokens: 100,
      outputTokens: 30,
      savedTokens: 70,
      savingsPercent: 70,
      reversible: true,
      timestamp: Date.now(),
    });

    stats.reset();
    const result = stats.getStats();

    expect(result.totalCalls).toBe(0);
    expect(result.totalSavedTokens).toBe(0);
    expect(result.byFormat).toEqual({});
    expect(result.lastCallAt).toBeNull();
  });

  it('picks the top format by call count, breaking ties by savings', () => {
    // 2 json calls
    stats.record({
      action: 'compress',
      format: 'json',
      inputTokens: 100,
      outputTokens: 50,
      savedTokens: 50,
      savingsPercent: 50,
      reversible: true,
      timestamp: Date.now(),
    });
    stats.record({
      action: 'compress',
      format: 'json',
      inputTokens: 100,
      outputTokens: 50,
      savedTokens: 50,
      savingsPercent: 50,
      reversible: true,
      timestamp: Date.now(),
    });
    // 1 csv call with higher savings
    stats.record({
      action: 'compress',
      format: 'csv',
      inputTokens: 100,
      outputTokens: 10,
      savedTokens: 90,
      savingsPercent: 90,
      reversible: true,
      timestamp: Date.now(),
    });

    const result = stats.getStats();
    expect(result.topFormat?.format).toBe('json');
    expect(result.topFormat?.calls).toBe(2);
  });

  it('returns ISO 8601 lastCallAt', () => {
    const now = Date.now();
    stats.record({
      action: 'compress',
      format: 'json',
      inputTokens: 100,
      outputTokens: 30,
      savedTokens: 70,
      savingsPercent: 70,
      reversible: true,
      timestamp: now,
    });

    const result = stats.getStats();
    expect(result.lastCallAt).toBe(new Date(now).toISOString());
  });
});

describe('module-level singleton helpers', () => {
  beforeEach(() => {
    resetSessionStats();
  });

  it('recordCall and getSessionStats work through the singleton', () => {
    recordCall({
      action: 'compress',
      format: 'json',
      inputTokens: 100,
      outputTokens: 30,
      savedTokens: 70,
      savingsPercent: 70,
      reversible: true,
      timestamp: Date.now(),
    });

    const result = getSessionStats();
    expect(result.totalCalls).toBe(1);
    expect(result.totalSavedTokens).toBe(70);
  });

  it('resetSessionStats clears the singleton', () => {
    recordCall({
      action: 'compress',
      format: 'json',
      inputTokens: 100,
      outputTokens: 30,
      savedTokens: 70,
      savingsPercent: 70,
      reversible: true,
      timestamp: Date.now(),
    });

    resetSessionStats();
    const result = getSessionStats();
    expect(result.totalCalls).toBe(0);
  });
});

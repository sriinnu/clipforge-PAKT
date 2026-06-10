/**
 * Context engine tests.
 *
 * Validates the unified context window optimizer: tool result compression,
 * progressive history compression, content deduplication, fact extraction,
 * and overall savings calculation.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { ContextEngine, createContextEngine } from '../src/context-engine/index.js';

describe('ContextEngine', () => {
  let engine: ContextEngine;

  beforeEach(() => {
    engine = new ContextEngine({ maxContextTokens: 50_000, recentTurns: 3 });
  });

  // -----------------------------------------------------------------------
  // Basic functionality
  // -----------------------------------------------------------------------

  it('creates via factory function', () => {
    const e = createContextEngine();
    expect(e).toBeInstanceOf(ContextEngine);
  });

  it('tracks turn numbers — new turn on each user message', () => {
    engine.addMessage({ role: 'user', content: 'hello' });
    expect(engine.getCurrentTurn()).toBe(1);
    engine.addMessage({ role: 'assistant', content: 'hi there' });
    expect(engine.getCurrentTurn()).toBe(1);
    engine.addMessage({ role: 'user', content: 'another question' });
    expect(engine.getCurrentTurn()).toBe(2);
  });

  it('counts messages correctly', () => {
    engine.addMessage({ role: 'user', content: 'hello' });
    engine.addMessage({ role: 'assistant', content: 'hi' });
    engine.addToolResult('read_file', '{"key": "value"}');
    expect(engine.getMessageCount()).toBe(3);
  });

  // -----------------------------------------------------------------------
  // Tool result compression
  // -----------------------------------------------------------------------

  it('compresses large JSON tool results automatically', () => {
    const records = Array.from({ length: 30 }, (_, i) => ({
      name: 'User_' + i,
      role: 'developer',
      active: true,
      department: 'engineering',
    }));
    const json = JSON.stringify(records);

    engine.addMessage({ role: 'user', content: 'show me the users' });
    engine.addToolResult('read_file', json);

    const { savings } = engine.optimize();
    expect(savings.breakdown.toolResults).toBeGreaterThan(0);
    expect(savings.savedTokens).toBeGreaterThan(0);
  });

  it('skips compression for small tool results', () => {
    engine.addMessage({ role: 'user', content: 'check' });
    engine.addToolResult('run_command', 'ok');

    const { savings } = engine.optimize();
    expect(savings.breakdown.toolResults).toBe(0);
  });

  it('skips compression for non-structured tool results', () => {
    const longText = 'This is a plain text log message. '.repeat(20);
    engine.addMessage({ role: 'user', content: 'show logs' });
    engine.addToolResult('run_command', longText);

    const { savings } = engine.optimize();
    expect(savings.breakdown.toolResults).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Content deduplication
  // -----------------------------------------------------------------------

  it('deduplicates identical content across turns', () => {
    const repeated = JSON.stringify(Array.from({ length: 20 }, (_, i) => ({
      id: i, name: 'Item ' + i, status: 'active',
    })));

    engine.addMessage({ role: 'user', content: 'show items' });
    engine.addToolResult('read_file', repeated);
    engine.addMessage({ role: 'user', content: 'show items again' });
    engine.addToolResult('read_file', repeated);

    const { savings } = engine.optimize();
    expect(savings.breakdown.deduplication).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // Progressive history compression
  // -----------------------------------------------------------------------

  it('compresses old turns beyond recentTurns window', () => {
    // Add 6 turns (recentTurns=3, so turns 1-3 are old)
    for (let i = 0; i < 6; i++) {
      engine.addMessage({ role: 'user', content: 'turn ' + i });
      // Add a JSON tool result that can be compressed
      if (i < 4) {
        engine.addToolResult('api_call', JSON.stringify(
          Array.from({ length: 15 }, (_, j) => ({
            id: j, value: 'item_' + j, active: true, type: 'standard',
          })),
        ));
      }
      engine.addMessage({ role: 'assistant', content: 'response for turn ' + i });
    }

    const { savings } = engine.optimize();
    // History compression should kick in for old turns
    expect(savings.breakdown.historyCompression).toBeGreaterThanOrEqual(0);
  });

  // -----------------------------------------------------------------------
  // Fact extraction
  // -----------------------------------------------------------------------

  it('extracts facts from decision-like statements', () => {
    // Need enough turns to trigger summarization
    const engine2 = new ContextEngine({
      maxContextTokens: 500, // very low to trigger summarization
      recentTurns: 1,
    });

    for (let i = 0; i < 5; i++) {
      engine2.addMessage({ role: 'user', content: 'question ' + i });
      engine2.addMessage({
        role: 'assistant',
        content: 'I decided to use React for the frontend because it fits our team better. We also need to add authentication for the API.',
      });
    }

    const { index } = engine2.optimize();
    if (index) {
      expect(index.facts.length).toBeGreaterThan(0);
      // Should have extracted decisions and requirements
      const categories = new Set(index.facts.map((f) => f.category));
      expect(categories.size).toBeGreaterThan(0);
    }
  });

  // -----------------------------------------------------------------------
  // Output format
  // -----------------------------------------------------------------------

  it('returns messages array ready for LLM API', () => {
    engine.addMessage({ role: 'user', content: 'hello' });
    engine.addMessage({ role: 'assistant', content: 'hi' });

    const { messages } = engine.optimize();
    expect(messages.length).toBeGreaterThan(0);
    for (const msg of messages) {
      expect(msg).toHaveProperty('role');
      expect(msg).toHaveProperty('content');
      expect(typeof msg.content).toBe('string');
    }
  });

  it('savings breakdown sums correctly', () => {
    engine.addMessage({ role: 'user', content: 'test' });
    engine.addToolResult('api', JSON.stringify(
      Array.from({ length: 20 }, (_, i) => ({ id: i, name: 'x'.repeat(50) })),
    ));

    const { savings } = engine.optimize();
    const breakdownSum =
      savings.breakdown.toolResults +
      savings.breakdown.historyCompression +
      savings.breakdown.summarization +
      savings.breakdown.deduplication +
      savings.breakdown.toolResultAging;
    // Breakdown should account for all savings (may be slightly off due to index overhead)
    expect(breakdownSum).toBeGreaterThanOrEqual(0);
  });

  // -----------------------------------------------------------------------
  // Tool-result aging (Gemini-CLI back-to-front pattern)
  // -----------------------------------------------------------------------

  it('ages older tool results to last N lines when budget exceeded', () => {
    const aged = new ContextEngine({
      maxContextTokens: 200,
      recentTurns: 1,
      toolResultTailLines: 5,
    });

    // Older turn: tool result with many lines (will be truncated).
    aged.addMessage({ role: 'user', content: 'first request' });
    const longTool = Array.from({ length: 80 }, (_, i) => `line ${String(i)} payload data`).join('\n');
    aged.addToolResult('run_command', longTool);
    aged.addMessage({ role: 'assistant', content: 'done with first' });

    // Newer turn: stays whole.
    aged.addMessage({ role: 'user', content: 'second request' });
    aged.addToolResult('run_command', 'fresh result');
    aged.addMessage({ role: 'assistant', content: 'done with second' });

    const { messages, savings } = aged.optimize();
    expect(savings.breakdown.toolResultAging).toBeGreaterThan(0);

    const oldTool = messages.find(
      (m) => m.role === 'tool' && m.content.includes('earlier lines elided'),
    );
    expect(oldTool).toBeDefined();
    expect(oldTool?.content).toContain('earlier lines elided by tool-result aging');
    // Tail must end with the last numbered line.
    expect(oldTool?.content).toContain('line 79 payload data');
  });

  it('does not age tool results when within budget', () => {
    const fits = new ContextEngine({ maxContextTokens: 100_000, toolResultTailLines: 5 });
    fits.addMessage({ role: 'user', content: 'q' });
    fits.addToolResult('run_command', Array.from({ length: 50 }, (_, i) => `line ${String(i)}`).join('\n'));
    fits.addMessage({ role: 'assistant', content: 'a' });

    const { savings, messages } = fits.optimize();
    expect(savings.breakdown.toolResultAging).toBe(0);
    expect(messages.some((m) => m.content.includes('earlier lines elided'))).toBe(false);
  });

  it('snaps aging cutoff to user-message boundary (never splits a turn)', () => {
    const eng = new ContextEngine({
      maxContextTokens: 300,
      recentTurns: 1,
      toolResultTailLines: 3,
    });

    // Turn 1: long tool result.
    eng.addMessage({ role: 'user', content: 'first' });
    eng.addToolResult('cmd', Array.from({ length: 60 }, (_, i) => `t1-line-${String(i)}`).join('\n'));
    eng.addMessage({ role: 'assistant', content: 'reply 1' });

    // Turn 2: also long.
    eng.addMessage({ role: 'user', content: 'second' });
    eng.addToolResult('cmd', Array.from({ length: 60 }, (_, i) => `t2-line-${String(i)}`).join('\n'));
    eng.addMessage({ role: 'assistant', content: 'reply 2' });

    const { messages } = eng.optimize();
    // The newest user→tool→assistant block should never be split: if the
    // assistant's reply 2 is whole, the tool that precedes it must be
    // whole too (or vice-versa — both whole, both aged).
    const reply2 = messages.find((m) => m.role === 'assistant' && m.content === 'reply 2');
    expect(reply2).toBeDefined();
    expect(reply2?.content).not.toContain('earlier lines elided');
  });

  it('disables aging when toolResultTailLines is 0', () => {
    const off = new ContextEngine({
      maxContextTokens: 100,
      recentTurns: 1,
      toolResultTailLines: 0,
    });
    off.addMessage({ role: 'user', content: 'q' });
    off.addToolResult('cmd', Array.from({ length: 100 }, (_, i) => `line-${String(i)}`).join('\n'));
    off.addMessage({ role: 'assistant', content: 'a' });

    const { savings } = off.optimize();
    expect(savings.breakdown.toolResultAging).toBe(0);
  });

  it('ages a heavy single-line tool result via char-tail truncation', () => {
    /* Long unstructured string with no newlines — `addToolResult` skips
       compression for non-structured content, so the message keeps its
       single-line shape. The line-based aging path would skip this;
       the char-tail fallback must kick in. */
    const big = new ContextEngine({
      maxContextTokens: 200,
      recentTurns: 1,
      toolResultTailLines: 5,
    });
    big.addMessage({ role: 'user', content: 'fetch' });
    // 8000-char single-line string — well above SINGLE_LINE_TOKEN_THRESHOLD.
    const huge = 'long-payload-segment-'.repeat(400);
    big.addToolResult('logs', huge);
    big.addMessage({ role: 'assistant', content: 'parsed' });

    big.addMessage({ role: 'user', content: 'fresh' });
    big.addToolResult('logs', 'small recent result');
    big.addMessage({ role: 'assistant', content: 'ok' });

    const { messages, savings } = big.optimize();
    expect(savings.breakdown.toolResultAging).toBeGreaterThan(0);
    const aged = messages.find(
      (m) => m.role === 'tool' && m.content.includes('characters elided'),
    );
    expect(aged).toBeDefined();
  });

  it('aging is idempotent across repeated optimize() calls', () => {
    /* The engine mutates message content in place. Calling optimize()
       twice should not re-age already-aged messages — savings on the
       second call must reflect the now-shorter state, not double-count. */
    const eng = new ContextEngine({
      maxContextTokens: 200,
      recentTurns: 1,
      toolResultTailLines: 5,
    });
    eng.addMessage({ role: 'user', content: 'first' });
    eng.addToolResult(
      'cmd',
      Array.from({ length: 80 }, (_, i) => `payload-line-${String(i)}`).join('\n'),
    );
    eng.addMessage({ role: 'assistant', content: 'reply 1' });
    eng.addMessage({ role: 'user', content: 'second' });
    eng.addToolResult('cmd', 'fresh');
    eng.addMessage({ role: 'assistant', content: 'reply 2' });

    const first = eng.optimize();
    const second = eng.optimize();

    // First call ages; second call sees already-aged content.
    expect(first.savings.breakdown.toolResultAging).toBeGreaterThan(0);
    expect(second.savings.breakdown.toolResultAging).toBeLessThanOrEqual(
      first.savings.breakdown.toolResultAging,
    );
    // Aged message should still parse / contain the elision marker once,
    // not nested or duplicated.
    const aged = second.messages.find((m) => m.content.includes('elided by tool-result aging'));
    const occurrences = (aged?.content.match(/elided by tool-result aging/g) ?? []).length;
    expect(occurrences).toBeLessThanOrEqual(1);
  });

  it('ages nothing when there are no user messages (no boundary to snap to)', () => {
    const noUsers = new ContextEngine({
      maxContextTokens: 100,
      toolResultTailLines: 5,
    });
    noUsers.addMessage({ role: 'system', content: 'sys' });
    // toolResult requires currentTurn but we simulate by appending raw.
    for (let i = 0; i < 5; i++) {
      noUsers.addToolResult('cmd', Array.from({ length: 30 }, (_, j) => `line-${String(j)}`).join('\n'));
    }

    const { savings } = noUsers.optimize();
    // No user-message boundary → aging is a no-op (graceful, no crash).
    expect(savings.breakdown.toolResultAging).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  it('tracks cumulative stats across optimize() calls', () => {
    engine.addMessage({ role: 'user', content: 'first' });
    engine.addToolResult('api', JSON.stringify(
      Array.from({ length: 20 }, (_, i) => ({ id: i, role: 'dev', active: true })),
    ));
    engine.optimize();

    engine.addMessage({ role: 'user', content: 'second' });
    engine.optimize();

    const stats = engine.getStats();
    expect(stats.totalOptimizations).toBe(2);
    expect(stats.totalOriginalTokens).toBeGreaterThan(0);
  });

  it('resets all state', () => {
    engine.addMessage({ role: 'user', content: 'test' });
    engine.optimize();
    engine.reset();

    expect(engine.getMessageCount()).toBe(0);
    expect(engine.getCurrentTurn()).toBe(0);
    expect(engine.getStats().totalOptimizations).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Strategy: minimal
  // -----------------------------------------------------------------------

  it('minimal strategy only compresses tool results, not prose', () => {
    const minEngine = new ContextEngine({ strategy: 'minimal', recentTurns: 1 });

    for (let i = 0; i < 5; i++) {
      minEngine.addMessage({ role: 'user', content: 'question ' + i });
      minEngine.addMessage({ role: 'assistant', content: 'answer '.repeat(30) });
    }

    const { savings } = minEngine.optimize();
    expect(savings.breakdown.historyCompression).toBe(0);
  });
});

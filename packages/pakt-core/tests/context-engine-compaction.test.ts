/**
 * @module tests/context-engine-compaction
 * Compaction-cooperative safety pass — regression and behaviour tests.
 *
 * Validates that:
 * 1. Messages containing provider `compaction` blocks are passed through the
 *    context engine byte-identical under aggressive settings (opacity guarantee).
 * 2. Aging, deduplication, history-compression, and summarisation all skip
 *    opaque messages while still operating on non-opaque ones in the same
 *    conversation.
 * 3. `providerCompactionThresholdTokens` aligns PAKT's optimisation ceiling
 *    and surfaces correct `headroomTokens` in the savings output.
 * 4. The existing context-engine regression suite is unaffected (smoke pass).
 * 5. `isOpaqueBlock` and `messageIsImmutable` helpers behave correctly.
 */

import { describe, expect, it } from 'vitest';
import {
  ContextEngine,
  isOpaqueBlock,
  messageIsImmutable,
  BUILTIN_OPAQUE_TYPES,
} from '../src/context-engine/index.js';
import type { ContextMessage } from '../src/context-engine/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build a synthetic Anthropic compaction content block serialised as JSON. */
function makeCompactionBlock(summary = 'Prior context summary for testing.'): string {
  return JSON.stringify({
    type: 'compaction',
    summary,
    compacted_turns: 4,
    provider: 'anthropic',
    beta: 'compact-2026-01-12',
  });
}

/** Build a realistic multi-block assistant message that includes a compaction block. */
function makeCompactionMessage(summary?: string): ContextMessage {
  const blocks = JSON.stringify([
    { type: 'compaction', summary: summary ?? 'Conversation summary.', compacted_turns: 3 },
    { type: 'text', text: 'Let me continue from where we left off.' },
  ]);
  return {
    role: 'assistant',
    content: blocks,
    containsOpaqueBlocks: true,
  };
}

// ---------------------------------------------------------------------------
// 1. isOpaqueBlock / messageIsImmutable unit tests
// ---------------------------------------------------------------------------

describe('isOpaqueBlock', () => {
  it('returns true for builtin compaction type', () => {
    expect(isOpaqueBlock({ type: 'compaction' })).toBe(true);
  });

  it('returns true for builtin clear_tool_uses type', () => {
    expect(isOpaqueBlock({ type: 'clear_tool_uses' })).toBe(true);
  });

  it('returns false for text blocks', () => {
    expect(isOpaqueBlock({ type: 'text', text: 'hello' })).toBe(false);
  });

  it('returns false for tool_use blocks', () => {
    expect(isOpaqueBlock({ type: 'tool_use', id: 'abc', name: 'read_file', input: {} })).toBe(false);
  });

  it('returns true for custom extraOpaqueTypes', () => {
    expect(isOpaqueBlock({ type: 'my_provider_block' }, ['my_provider_block'])).toBe(true);
  });

  it('extraOpaqueTypes does not affect other blocks', () => {
    expect(isOpaqueBlock({ type: 'text' }, ['my_provider_block'])).toBe(false);
  });

  it('BUILTIN_OPAQUE_TYPES contains both core types', () => {
    expect(BUILTIN_OPAQUE_TYPES.has('compaction')).toBe(true);
    expect(BUILTIN_OPAQUE_TYPES.has('clear_tool_uses')).toBe(true);
  });
});

describe('messageIsImmutable', () => {
  it('returns true when containsOpaqueBlocks flag is set', () => {
    expect(messageIsImmutable({
      role: 'assistant',
      content: 'anything',
      containsOpaqueBlocks: true,
    })).toBe(true);
  });

  it('detects compaction sentinel in string content (compact JSON key)', () => {
    const content = `{"type":"compaction","summary":"foo"}`;
    expect(messageIsImmutable({ role: 'assistant', content })).toBe(true);
  });

  it('detects compaction sentinel in string content (spaced JSON key)', () => {
    const content = `{ "type": "compaction", "summary": "bar" }`;
    expect(messageIsImmutable({ role: 'assistant', content })).toBe(true);
  });

  it('returns false for plain text messages', () => {
    expect(messageIsImmutable({ role: 'assistant', content: 'Hello world' })).toBe(false);
  });

  it('detects opaque blocks in array content', () => {
    const msg: ContextMessage = {
      role: 'assistant',
      // We cast because the type normally requires string, but raw SDK responses
      // can be an array. The engine handles this at runtime.
      content: [{ type: 'compaction', summary: 'x' }] as unknown as string,
    };
    expect(messageIsImmutable(msg)).toBe(true);
  });

  it('returns false for array content with only text blocks', () => {
    const msg: ContextMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello' }] as unknown as string,
    };
    expect(messageIsImmutable(msg)).toBe(false);
  });

  it('respects extraOpaqueTypes in string content', () => {
    const content = `{"type":"my_custom_block","data":{}}`;
    expect(messageIsImmutable({ role: 'assistant', content }, ['my_custom_block'])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Opacity guarantee — byte-identical preservation through optimizeMessages
// ---------------------------------------------------------------------------

describe('opacity guarantee', () => {
  it('passes compaction message byte-identical under aggressive settings', () => {
    const engine = new ContextEngine({
      maxContextTokens: 200,   // very small budget → aggressive pruning
      recentTurns: 1,
      strategy: 'aggressive',
      toolResultTailLines: 3,
    });

    // Older turn — will be aged/compressed on non-opaque messages.
    engine.addMessage({ role: 'user', content: 'earlier question' });
    engine.addMessage({
      role: 'assistant',
      content: 'Earlier answer with lots of detail. '.repeat(30),
    });

    // Compaction block arrives as assistant message.
    const compactionContent = makeCompactionBlock('The assistant summarised turns 1-3.');
    const compactionMsg: ContextMessage = {
      role: 'assistant',
      content: compactionContent,
      containsOpaqueBlocks: true,
    };
    engine.addMessage(compactionMsg);

    // Newer turn after compaction.
    engine.addMessage({ role: 'user', content: 'next question after compaction' });
    engine.addMessage({ role: 'assistant', content: 'reply' });

    const { messages } = engine.optimize();

    // Find the compaction message in output.
    const found = messages.find((m) => m.containsOpaqueBlocks === true);
    expect(found).toBeDefined();
    // Byte-identical content check — no compression, no truncation, no summary.
    expect(found?.content).toBe(compactionContent);
  });

  it('compaction message is never replaced with a dedup reference', () => {
    const engine = new ContextEngine({
      maxContextTokens: 5_000,
      recentTurns: 2,
    });

    const compactionContent = makeCompactionBlock('Session summary v1.');
    const compactionMsg: ContextMessage = {
      role: 'assistant',
      content: compactionContent,
      containsOpaqueBlocks: true,
    };

    // Add the same compaction message twice (simulate a replay scenario).
    engine.addMessage(compactionMsg);
    engine.addMessage({ role: 'user', content: 'q1' });
    engine.addMessage(compactionMsg);
    engine.addMessage({ role: 'user', content: 'q2' });

    const { messages } = engine.optimize();
    const opaque = messages.filter((m) => m.containsOpaqueBlocks === true);
    // Both must survive with original content — neither replaced by a dedup ref.
    for (const m of opaque) {
      expect(m.content).toBe(compactionContent);
      expect(m.content).not.toContain('Same as turn');
    }
  });

  it('compaction message is never marked summarized', () => {
    const engine = new ContextEngine({
      maxContextTokens: 100,  // tiny → forces summarization pass
      recentTurns: 1,
    });

    const compactionContent = makeCompactionBlock('Summary block.');
    engine.addMessage({ role: 'user', content: 'q' });
    engine.addMessage({
      role: 'assistant',
      content: compactionContent,
      containsOpaqueBlocks: true,
    });

    const { messages } = engine.optimize();
    const opaque = messages.find((m) => m.containsOpaqueBlocks === true);
    expect(opaque).toBeDefined();
    expect(opaque?.summarized).toBeFalsy();
    expect(opaque?.content).toBe(compactionContent);
  });

  it('compaction message is never paktCompressed', () => {
    const engine = new ContextEngine({
      maxContextTokens: 100,
      recentTurns: 0,
      strategy: 'aggressive',
    });

    const compactionContent = makeCompactionBlock();
    engine.addMessage({ role: 'user', content: 'q' });
    engine.addMessage({
      role: 'assistant',
      content: compactionContent,
      containsOpaqueBlocks: true,
    });

    const { messages } = engine.optimize();
    const opaque = messages.find((m) => m.containsOpaqueBlocks === true);
    expect(opaque?.paktCompressed).toBeFalsy();
    expect(opaque?.content).toBe(compactionContent);
  });

  it('multi-block message with compaction preserves full content', () => {
    const engine = new ContextEngine({
      maxContextTokens: 300,
      recentTurns: 1,
    });

    const msg = makeCompactionMessage('Detailed prior-context summary.');
    engine.addMessage(msg);
    engine.addMessage({ role: 'user', content: 'continue' });

    const { messages } = engine.optimize();
    const opaque = messages.find((m) => m.containsOpaqueBlocks === true);
    expect(opaque?.content).toBe(msg.content);
  });

  it('addMessage auto-detects compaction sentinel in string content', () => {
    const engine = new ContextEngine({ maxContextTokens: 500 });
    const content = `{"type":"compaction","summary":"auto-detected","compacted_turns":2}`;

    // Do NOT set containsOpaqueBlocks — engine should auto-detect.
    engine.addMessage({ role: 'assistant', content });

    const { messages } = engine.optimize();
    const found = messages.find((m) => m.content === content);
    expect(found).toBeDefined();
    expect(found?.containsOpaqueBlocks).toBe(true);
    expect(found?.content).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// 3. Non-opaque messages still get aged/deduped in the same conversation
// ---------------------------------------------------------------------------

describe('non-opaque messages still optimised', () => {
  it('ages non-opaque tool results in the same conversation as a compaction message', () => {
    const engine = new ContextEngine({
      maxContextTokens: 250,
      recentTurns: 1,
      toolResultTailLines: 3,
    });

    // Older turn: big tool result — should be aged.
    engine.addMessage({ role: 'user', content: 'fetch data' });
    const bigOutput = Array.from({ length: 80 }, (_, i) => `row-${String(i)}-data`).join('\n');
    engine.addToolResult('db_query', bigOutput);
    engine.addMessage({ role: 'assistant', content: 'done' });

    // Provider sends a compaction block — must stay whole.
    const compactionContent = makeCompactionBlock('Old context compacted.');
    engine.addMessage({
      role: 'assistant',
      content: compactionContent,
      containsOpaqueBlocks: true,
    });

    // Newest turn.
    engine.addMessage({ role: 'user', content: 'next' });
    engine.addMessage({ role: 'assistant', content: 'ok' });

    const { messages, savings } = engine.optimize();

    // Compaction block must be preserved.
    const opaque = messages.find((m) => m.containsOpaqueBlocks === true);
    expect(opaque?.content).toBe(compactionContent);

    // Aging must have fired on the non-opaque tool result.
    expect(savings.breakdown.toolResultAging).toBeGreaterThan(0);
    const aged = messages.find(
      (m) => m.role === 'tool' && m.content.includes('earlier lines elided'),
    );
    expect(aged).toBeDefined();
  });

  it('deduplication still works on non-opaque messages', () => {
    const engine = new ContextEngine({ maxContextTokens: 50_000, recentTurns: 2 });

    const repeated = JSON.stringify(
      Array.from({ length: 20 }, (_, i) => ({ id: i, name: 'Item ' + String(i) })),
    );

    engine.addMessage({ role: 'user', content: 'q1' });
    engine.addToolResult('search', repeated);
    engine.addMessage({ role: 'user', content: 'q2' });
    engine.addToolResult('search', repeated);  // duplicate

    // Compaction block — must not be deduped even if content is identical.
    const compContent = makeCompactionBlock('Session summary.');
    engine.addMessage({ role: 'assistant', content: compContent, containsOpaqueBlocks: true });

    const { savings, messages } = engine.optimize();
    expect(savings.breakdown.deduplication).toBeGreaterThan(0);

    // Opaque message must still be intact.
    const opaque = messages.find((m) => m.containsOpaqueBlocks);
    expect(opaque?.content).toBe(compContent);
  });
});

// ---------------------------------------------------------------------------
// 4. providerCompactionThresholdTokens — threshold alignment and headroomTokens
// ---------------------------------------------------------------------------

describe('providerCompactionThresholdTokens', () => {
  it('headroomTokens is present and positive when optimised context is below threshold', () => {
    const engine = new ContextEngine({
      maxContextTokens: 50_000,
      providerCompactionThresholdTokens: 150_000,
    });

    engine.addMessage({ role: 'user', content: 'hello' });
    engine.addMessage({ role: 'assistant', content: 'hi' });

    const { savings } = engine.optimize();
    expect(savings.headroomTokens).toBeDefined();
    expect(savings.headroomTokens).toBeGreaterThan(0);
    // headroomTokens = threshold - optimizedTokens
    const expected = 150_000 - savings.optimizedTokens;
    expect(savings.headroomTokens).toBe(expected);
  });

  it('headroomTokens is negative when context exceeds threshold', () => {
    // Simulate: threshold very small so context already exceeds it.
    const engine = new ContextEngine({
      maxContextTokens: 50_000,
      providerCompactionThresholdTokens: 1,  // absurdly low
    });

    engine.addMessage({ role: 'user', content: 'hello' });
    engine.addMessage({ role: 'assistant', content: 'hi there, how can I help?' });

    const { savings } = engine.optimize();
    expect(savings.headroomTokens).toBeDefined();
    expect(savings.headroomTokens).toBeLessThan(0);
  });

  it('headroomTokens is absent when providerCompactionThresholdTokens is not set', () => {
    const engine = new ContextEngine({ maxContextTokens: 50_000 });
    engine.addMessage({ role: 'user', content: 'hello' });
    const { savings } = engine.optimize();
    expect(savings.headroomTokens).toBeUndefined();
  });

  it('effective ceiling is min(maxContextTokens, threshold) for aging decisions', () => {
    // threshold < maxContextTokens: aging should kick in at the lower threshold.
    const lowThreshold = new ContextEngine({
      maxContextTokens: 100_000,
      providerCompactionThresholdTokens: 250,  // very low → forces aging
      recentTurns: 1,
      toolResultTailLines: 3,
    });

    lowThreshold.addMessage({ role: 'user', content: 'old request' });
    lowThreshold.addToolResult(
      'cmd',
      Array.from({ length: 80 }, (_, i) => `line-${String(i)}`).join('\n'),
    );
    lowThreshold.addMessage({ role: 'assistant', content: 'done' });
    lowThreshold.addMessage({ role: 'user', content: 'new request' });
    lowThreshold.addToolResult('cmd', 'small result');
    lowThreshold.addMessage({ role: 'assistant', content: 'ok' });

    const { savings } = lowThreshold.optimize();
    // Aging must have fired because ceiling = min(100_000, 250) = 250.
    expect(savings.breakdown.toolResultAging).toBeGreaterThan(0);
  });

  it('threshold higher than maxContextTokens does not change effective ceiling', () => {
    // threshold > maxContextTokens: effective ceiling stays maxContextTokens.
    const engine = new ContextEngine({
      maxContextTokens: 200,
      providerCompactionThresholdTokens: 500_000,
      recentTurns: 1,
      toolResultTailLines: 3,
    });

    engine.addMessage({ role: 'user', content: 'old request' });
    engine.addToolResult(
      'cmd',
      Array.from({ length: 80 }, (_, i) => `data-${String(i)}`).join('\n'),
    );
    engine.addMessage({ role: 'assistant', content: 'done' });
    engine.addMessage({ role: 'user', content: 'new request' });

    const { savings } = engine.optimize();
    // Aging must fire because effective ceiling = min(200, 500_000) = 200.
    expect(savings.breakdown.toolResultAging).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 5. extraOpaqueTypes configuration
// ---------------------------------------------------------------------------

describe('extraOpaqueTypes', () => {
  it('treats custom type as immutable when configured', () => {
    const engine = new ContextEngine({
      maxContextTokens: 200,
      recentTurns: 1,
      toolResultTailLines: 3,
      extraOpaqueTypes: ['my_summary_block'],
    });

    const customContent = `{"type":"my_summary_block","data":"important"}`;
    engine.addMessage({ role: 'user', content: 'old q' });
    engine.addMessage({ role: 'assistant', content: customContent });
    engine.addMessage({ role: 'user', content: 'new q' });

    const { messages } = engine.optimize();
    const preserved = messages.find((m) => m.content === customContent);
    expect(preserved).toBeDefined();
    expect(preserved?.containsOpaqueBlocks).toBe(true);
  });

  it('does not affect messages without the custom type', () => {
    const engine = new ContextEngine({
      maxContextTokens: 50_000,
      extraOpaqueTypes: ['my_summary_block'],
    });

    const normal = 'Normal assistant message without any special blocks.';
    engine.addMessage({ role: 'user', content: 'q' });
    engine.addMessage({ role: 'assistant', content: normal });

    const { messages } = engine.optimize();
    const msg = messages.find((m) => m.role === 'assistant');
    expect(msg?.containsOpaqueBlocks).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// 6. Smoke pass — existing engine behaviours unaffected
// ---------------------------------------------------------------------------

describe('regression smoke pass', () => {
  it('turn tracking still works after compaction message', () => {
    const engine = new ContextEngine();
    engine.addMessage({ role: 'user', content: 'q1' });
    expect(engine.getCurrentTurn()).toBe(1);
    engine.addMessage({ role: 'assistant', content: makeCompactionBlock(), containsOpaqueBlocks: true });
    engine.addMessage({ role: 'user', content: 'q2' });
    expect(engine.getCurrentTurn()).toBe(2);
  });

  it('tool result compression still fires on non-opaque structured data', () => {
    const engine = new ContextEngine({ maxContextTokens: 50_000 });
    const records = JSON.stringify(
      Array.from({ length: 30 }, (_, i) => ({ id: i, name: 'User_' + String(i), active: true })),
    );
    engine.addMessage({ role: 'user', content: 'users?' });
    engine.addToolResult('get_users', records);

    const { savings } = engine.optimize();
    expect(savings.breakdown.toolResults).toBeGreaterThan(0);
  });

  it('reset clears state including opaque-block annotations', () => {
    const engine = new ContextEngine();
    engine.addMessage({
      role: 'assistant',
      content: makeCompactionBlock(),
      containsOpaqueBlocks: true,
    });
    engine.reset();
    expect(engine.getMessageCount()).toBe(0);
    expect(engine.getCurrentTurn()).toBe(0);
  });

  it('optimize() is non-destructive across multiple calls with opaque messages', () => {
    const engine = new ContextEngine({ maxContextTokens: 500, recentTurns: 1 });
    const compContent = makeCompactionBlock('v1 summary.');
    engine.addMessage({ role: 'assistant', content: compContent, containsOpaqueBlocks: true });
    engine.addMessage({ role: 'user', content: 'continue' });

    const r1 = engine.optimize();
    const r2 = engine.optimize();

    // Compaction message must survive both calls byte-identical.
    const o1 = r1.messages.find((m) => m.containsOpaqueBlocks);
    const o2 = r2.messages.find((m) => m.containsOpaqueBlocks);
    expect(o1?.content).toBe(compContent);
    expect(o2?.content).toBe(compContent);
  });
});

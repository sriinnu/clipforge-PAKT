import { describe, expect, it, beforeEach } from 'vitest';
import { createPaktInterceptor, optimizeMessages } from '../src/middleware/index.js';

// A big enough JSON blob to exceed the 100-token default threshold
const BIG_JSON = JSON.stringify({
  employees: Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    name: `employee_${String(i + 1)}`,
    department: 'engineering',
    status: 'active',
    level: 'senior',
  })),
});

const SMALL_JSON = '{"a": 1}';

describe('createPaktInterceptor', () => {
  it('compresses large structured JSON results', () => {
    const interceptor = createPaktInterceptor();
    const result = interceptor.processToolResult('read_file', BIG_JSON);

    expect(result.wasPaktCompressed).toBe(true);
    expect(result.savings.totalTokens).toBeGreaterThan(0);
    expect(result.savings.totalPercent).toBeGreaterThan(0);
    expect(result.text).not.toBe(BIG_JSON);
  });

  it('skips results below minTokens threshold', () => {
    const interceptor = createPaktInterceptor({ minTokens: 100 });
    const result = interceptor.processToolResult('read_file', SMALL_JSON);

    expect(result.wasPaktCompressed).toBe(false);
    expect(result.skipReason).toContain('minTokens');
    expect(result.text).toBe(SMALL_JSON);
  });

  it('skips passthrough tools matching glob pattern', () => {
    const interceptor = createPaktInterceptor({ passthrough: ['pakt_*'] });
    const result = interceptor.processToolResult('pakt_compress', BIG_JSON);

    expect(result.wasPaktCompressed).toBe(false);
    expect(result.skipReason).toBe('passthrough tool');
    expect(result.text).toBe(BIG_JSON);
  });

  it('skips passthrough tools matching exact name', () => {
    const interceptor = createPaktInterceptor({ passthrough: ['my_tool'] });
    const result = interceptor.processToolResult('my_tool', BIG_JSON);

    expect(result.wasPaktCompressed).toBe(false);
    expect(result.skipReason).toBe('passthrough tool');
  });

  it('skips results exceeding maxInputSize', () => {
    const interceptor = createPaktInterceptor({ maxInputSize: 10 });
    const result = interceptor.processToolResult('read_file', BIG_JSON);

    expect(result.wasPaktCompressed).toBe(false);
    expect(result.skipReason).toContain('maxInputSize');
  });

  it('skips unstructured text', () => {
    const interceptor = createPaktInterceptor({ minTokens: 1 });
    const prose = 'This is just a plain text paragraph with no structure whatsoever.';
    const result = interceptor.processToolResult('read_file', prose);

    expect(result.wasPaktCompressed).toBe(false);
    expect(result.skipReason).toContain('not in allowed list');
  });

  it('tracks cumulative session stats', () => {
    const interceptor = createPaktInterceptor();

    interceptor.processToolResult('tool_a', BIG_JSON);
    interceptor.processToolResult('tool_b', BIG_JSON);
    interceptor.processToolResult('tool_c', SMALL_JSON);

    const stats = interceptor.getStats();
    expect(stats.totalCalls).toBe(3);
    expect(stats.compressedCalls).toBe(2);
    expect(stats.totalSavedTokens).toBeGreaterThan(0);
  });

  it('resets stats correctly', () => {
    const interceptor = createPaktInterceptor();
    interceptor.processToolResult('tool', BIG_JSON);
    interceptor.resetStats();

    const stats = interceptor.getStats();
    expect(stats.totalCalls).toBe(0);
    expect(stats.compressedCalls).toBe(0);
    expect(stats.totalSavedTokens).toBe(0);
  });

  it('never returns expanded output (guard)', () => {
    // Even if we force a format that doesn't compress well,
    // the interceptor should never make things worse
    const interceptor = createPaktInterceptor({ minTokens: 1, formats: ['json', 'yaml', 'csv', 'text', 'markdown', 'pakt'] });
    const tiny = '{"x":1}';
    const result = interceptor.processToolResult('tool', tiny);

    // Either compressed and saved tokens, or returned original
    if (result.wasPaktCompressed) {
      expect(result.savings.totalTokens).toBeGreaterThan(0);
    } else {
      expect(result.text).toBe(tiny);
    }
  });
});

describe('optimizeMessages', () => {
  it('compresses tool-result messages with string content', () => {
    const messages = [
      { role: 'user', content: 'Read the config file' },
      { role: 'assistant', content: 'I will read it.' },
      { role: 'tool', content: BIG_JSON },
    ];

    const { messages: optimized, savings } = optimizeMessages(messages);

    expect(savings.compressedCalls).toBe(1);
    expect(savings.totalSavedTokens).toBeGreaterThan(0);
    // The tool message should have been modified in-place
    expect(optimized[2]!.content).not.toBe(BIG_JSON);
  });

  it('compresses tool-result messages with content blocks', () => {
    const messages = [
      { role: 'user', content: 'Read the config file' },
      {
        role: 'tool',
        content: [{ type: 'text', text: BIG_JSON }],
      },
    ];

    const { savings } = optimizeMessages(messages);
    expect(savings.compressedCalls).toBe(1);
  });

  it('leaves non-tool messages untouched', () => {
    const messages = [
      { role: 'user', content: BIG_JSON },
      { role: 'assistant', content: 'Here is the data.' },
    ];

    const { savings } = optimizeMessages(messages);
    expect(savings.compressedCalls).toBe(0);
    // User message should be unchanged
    expect(messages[0]!.content).toBe(BIG_JSON);
  });
});

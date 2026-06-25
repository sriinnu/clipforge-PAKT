import { describe, expect, it } from 'vitest';
import { createContextEngine } from '../src/context-engine/engine.js';
import {
  type SharedDictEntry,
  buildSharedDictionary,
  expandSharedDictionary,
} from '../src/context-engine/shared-dictionary.js';
import type { ContextMessage } from '../src/context-engine/types.js';

const MODEL = 'gpt-4o';

/** A line long enough to clear MIN_LINE_TOKENS and pay for an alias. */
const REPEATED = 'import { compress, decompress, detect } from "@sriinnu/pakt";';

function msg(role: ContextMessage['role'], content: string): ContextMessage {
  return { role, content };
}

describe('shared-dictionary: cross-message line aliasing', () => {
  it('aliases a line recurring across multiple messages and round-trips', () => {
    const messages: ContextMessage[] = [
      msg('tool', `${REPEATED}\nconst a = 1;`),
      msg('tool', `${REPEATED}\nconst b = 2;`),
      msg('assistant', `Here is the file again:\n${REPEATED}`),
    ];
    const originals = messages.map((m) => m.content);

    const result = buildSharedDictionary(messages, MODEL);

    expect(result.preamble).not.toBeNull();
    expect(result.savedTokens).toBeGreaterThan(0);
    expect(result.entries.length).toBeGreaterThanOrEqual(1);

    // The repeated line is gone from the bodies, replaced by an alias.
    const aliased = result.entries.find((e) => e.expansion === REPEATED);
    expect(aliased).toBeDefined();
    expect(aliased?.occurrences).toBe(3);
    for (const m of messages) {
      expect(m.content.includes(REPEATED)).toBe(false);
      // Round-trip: expanding restores the original byte-for-byte.
    }
    messages.forEach((m, i) => {
      expect(expandSharedDictionary(m.content, result.entries)).toBe(originals[i]);
    });
  });

  it('is a no-op when no line repeats enough to pay for itself', () => {
    const messages: ContextMessage[] = [
      msg('user', 'fix the bug'),
      msg('assistant', 'looking into it'),
      msg('tool', 'unique line one\nunique line two'),
    ];
    const before = messages.map((m) => m.content);
    const result = buildSharedDictionary(messages, MODEL);

    expect(result.preamble).toBeNull();
    expect(result.savedTokens).toBe(0);
    expect(result.entries).toHaveLength(0);
    expect(messages.map((m) => m.content)).toEqual(before);
  });

  it('never touches opaque or summarized messages', () => {
    const opaque = msg('assistant', `${REPEATED}\n${REPEATED}`);
    opaque.containsOpaqueBlocks = true;
    const summarized = msg('tool', `${REPEATED}\n${REPEATED}`);
    summarized.summarized = true;

    const messages: ContextMessage[] = [
      msg('tool', `${REPEATED}\nx`),
      msg('tool', `${REPEATED}\ny`),
      opaque,
      summarized,
    ];

    buildSharedDictionary(messages, MODEL);

    // Opaque and summarized bodies are left byte-identical.
    expect(opaque.content).toBe(`${REPEATED}\n${REPEATED}`);
    expect(summarized.content).toBe(`${REPEATED}\n${REPEATED}`);
  });

  it('bails losslessly if an alias token already appears as a line', () => {
    const messages: ContextMessage[] = [
      msg('tool', `§1\n${REPEATED}`),
      msg('tool', `${REPEATED}\nmore`),
    ];
    const before = messages.map((m) => m.content);
    const result = buildSharedDictionary(messages, MODEL);

    expect(result.preamble).toBeNull();
    expect(messages.map((m) => m.content)).toEqual(before);
  });

  it('expandSharedDictionary returns input unchanged for empty entries', () => {
    const entries: SharedDictEntry[] = [];
    expect(expandSharedDictionary('a\nb\nc', entries)).toBe('a\nb\nc');
  });
});

describe('shared-dictionary: engine integration', () => {
  it('emits a @shared preamble and reports savings in the breakdown', () => {
    const engine = createContextEngine({ maxContextTokens: 1_000_000 });
    // Several tool results sharing common lines across messages.
    for (let i = 0; i < 4; i++) {
      engine.addMessage({ role: 'user', content: `step ${String(i)}` });
      engine.addToolResult(
        'read_file',
        `${REPEATED}\nexport const value${String(i)} = ${String(i)};`,
      );
    }

    const { messages, savings } = engine.optimize();

    expect(savings.breakdown.sharedDictionary).toBeGreaterThan(0);
    const preamble = messages.find((m) => m.content.startsWith('@shared'));
    expect(preamble).toBeDefined();
    expect(preamble?.content).toContain('§1');
  });

  it('honours sharedDictionary: false', () => {
    const engine = createContextEngine({
      maxContextTokens: 1_000_000,
      sharedDictionary: false,
    });
    for (let i = 0; i < 4; i++) {
      engine.addMessage({ role: 'user', content: `step ${String(i)}` });
      engine.addToolResult('read_file', `${REPEATED}\nconst v${String(i)} = ${String(i)};`);
    }

    const { messages, savings } = engine.optimize();

    expect(savings.breakdown.sharedDictionary).toBe(0);
    expect(messages.some((m) => m.content.startsWith('@shared'))).toBe(false);
  });
});

/**
 * Dedup must only collapse byte-identical content. The old key was
 * `first 200 chars + length`, so two different files sharing a header and
 * a length were treated as duplicates and the second was replaced by a
 * "[Same as turn N]" note: silent data loss.
 */
import { describe, expect, it } from 'vitest';
import { deduplicateContent } from '../src/context-engine/history-strategies.js';
import type { ContextMessage } from '../src/context-engine/types.js';

const header = `// shared license header ${'x'.repeat(220)}\n`;
const fileA = `${header}export const a = 1;`;
const fileB = `${header}export const b = 2;`; // same length, same first 200 chars

function msg(content: string, turn: number): ContextMessage {
  return { role: 'tool', content, turn, currentTokens: 500 } as ContextMessage;
}

describe('deduplicateContent', () => {
  it('keeps different content that shares a prefix and length', () => {
    expect(fileA.length).toBe(fileB.length);
    const messages = [msg(fileA, 1), msg(fileB, 2)];
    deduplicateContent(messages, new Map(), 'gpt-4o');
    expect(messages[1]?.content).toBe(fileB);
  });

  it('still collapses exact repeats', () => {
    const messages = [msg(fileA, 1), msg(fileA, 2)];
    deduplicateContent(messages, new Map(), 'gpt-4o');
    expect(messages[0]?.content).toBe(fileA);
    expect(messages[1]?.content).toMatch(/^\[Same as turn 1:/);
  });
});

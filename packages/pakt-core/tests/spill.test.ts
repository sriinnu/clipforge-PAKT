import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createContextEngine } from '../src/context-engine/index.js';
import { setRecallStore } from '../src/mcp/handler-recall.js';
import { handlePaktTool } from '../src/mcp/handler.js';
import { FileSpillStore } from '../src/spill/file-store.js';
import { MemorySpillStore, SPILL_ID_PATTERN, spill, spillId } from '../src/spill/index.js';

/** A large, non-structured tool result (build log shape): PAKT won't compress it. */
function bigLog(lines = 600, salt = ''): string {
  return Array.from(
    { length: lines },
    (_, i) =>
      `[${String(i).padStart(4, '0')}] compiling module_${i}${salt} ... ok (${(i * 7) % 113}ms)`,
  ).join('\n');
}

describe('spill', () => {
  it('leaves small content untouched and stores nothing', () => {
    const store = new MemorySpillStore();
    const r = spill('hello\nworld', store, { thresholdTokens: 2000 });
    expect(r.spilled).toBe(false);
    expect(r.content).toBe('hello\nworld');
    expect(store.size).toBe(0);
  });

  it('replaces large content with a deterministic gist and stores the original', () => {
    const store = new MemorySpillStore();
    const text = bigLog();
    const a = spill(text, store, { thresholdTokens: 500, headLines: 5 });
    const b = spill(text, new MemorySpillStore(), { thresholdTokens: 500, headLines: 5 });
    expect(a.spilled).toBe(true);
    expect(a.id).toMatch(SPILL_ID_PATTERN);
    expect(a.content).toBe(b.content); // byte-stable: same input, same gist
    expect(a.tokens).toBeLessThan(a.originalTokens / 10);
    expect(a.content).toContain(`pakt_recall {"id":"${a.id}"}`);
    expect(a.content.startsWith(text.split('\n').slice(0, 5).join('\n'))).toBe(true);
    expect(store.get(a.id as string)).toBe(text);
  });

  it('gives different content different ids', () => {
    expect(spillId(bigLog(600, 'a'))).not.toBe(spillId(bigLog(600, 'b')));
    expect(spillId('ab')).not.toBe(spillId('ba'));
  });
});

describe('ContextEngine spill-at-append', () => {
  it('spills once at append and keeps the prefix byte-stable across optimize() calls', () => {
    const engine = createContextEngine({
      spillThresholdTokens: 500,
      sharedDictionary: false,
      strategy: 'minimal',
      toolResultTailLines: 0,
      maxContextTokens: 1_000_000_000,
    });
    const log = bigLog();
    engine.addMessage({ role: 'user', content: 'run the build' });
    engine.addToolResult('bash', log);
    const first = engine.optimize().messages.map((m) => m.content);
    const gist = first[1] as string;
    const id = gist.match(/sp_[0-9a-f]{16}/)?.[0] as string;
    expect(id).toBeDefined();
    expect(engine.recall(id)).toBe(log);

    for (let i = 0; i < 8; i++) {
      engine.addMessage({ role: 'user', content: `next step ${i}` });
      engine.addToolResult('bash', bigLog(600, `-${i}`));
      const now = engine.optimize().messages.map((m) => m.content);
      expect(now.slice(0, first.length)).toEqual(first);
    }
  });

  it('is off by default', () => {
    const engine = createContextEngine({
      sharedDictionary: false,
      maxContextTokens: 1_000_000_000,
    });
    engine.addToolResult('bash', bigLog());
    expect(engine.optimize().messages[0]?.content).not.toContain('pakt spilled');
  });
});

describe('FileSpillStore + pakt_recall', () => {
  let dir = '';
  afterEach(() => {
    setRecallStore(undefined);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips through disk with private permissions and serves line slices', () => {
    dir = mkdtempSync(join(tmpdir(), 'pakt-spill-'));
    const store = new FileSpillStore(dir);
    const text = bigLog();
    const r = spill(text, store, { thresholdTokens: 500 });
    const id = r.id as string;
    expect(statSync(join(dir, `${id}.txt`)).mode & 0o777).toBe(0o600);

    setRecallStore(new FileSpillStore(dir)); // a second process opening the same dir
    const full = handlePaktTool('pakt_recall', { id }) as Record<string, unknown>;
    expect(full.found).toBe(true);
    expect(full.text).toBe(text);
    expect(full.totalLines).toBe(600);

    const slice = handlePaktTool('pakt_recall', { id, startLine: 10, endLine: 12 }) as Record<
      string,
      unknown
    >;
    expect(slice.text).toBe(text.split('\n').slice(9, 12).join('\n'));
  });

  it('reports unknown ids and rejects malformed ones (no path traversal)', () => {
    dir = mkdtempSync(join(tmpdir(), 'pakt-spill-'));
    setRecallStore(new FileSpillStore(dir));
    const miss = handlePaktTool('pakt_recall', { id: 'sp_0000000000000000' }) as Record<
      string,
      unknown
    >;
    expect(miss.found).toBe(false);
    expect(() => handlePaktTool('pakt_recall', { id: '../../etc/passwd' })).toThrow(/sp_/);
  });

  it('prunes files past retention when opened', () => {
    dir = mkdtempSync(join(tmpdir(), 'pakt-spill-'));
    const old = join(dir, 'sp_aaaaaaaaaaaaaaaa.txt');
    writeFileSync(old, 'stale');
    const past = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    utimesSync(old, past, past);
    const store = new FileSpillStore(dir);
    expect(store.get('sp_aaaaaaaaaaaaaaaa')).toBeUndefined();
  });

  it('a recall refreshes retention so in-use spills survive pruning', () => {
    dir = mkdtempSync(join(tmpdir(), 'pakt-spill-'));
    const path = join(dir, 'sp_bbbbbbbbbbbbbbbb.txt');
    writeFileSync(path, 'still needed');
    const sixDays = new Date(Date.now() - 6 * 24 * 3600 * 1000);
    utimesSync(path, sixDays, sixDays);
    expect(new FileSpillStore(dir).get('sp_bbbbbbbbbbbbbbbb')).toBe('still needed');
    expect(Date.now() - statSync(path).mtimeMs).toBeLessThan(60_000);
  });
});

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatRibhuDoctor, ribhuRecommendations } from '../src/doctor/format.js';
import { runRibhuDoctor } from '../src/doctor/ribhu.js';

let root = '';
afterEach(() => rmSync(root, { recursive: true, force: true }));

const now = Date.parse('2026-11-20T12:00:00Z');
let seq = 0;
// Shapes copied from the real log (2026-10/11), numbers trimmed.
function row(o: Record<string, unknown>) {
  return JSON.stringify({
    ts: now - 3600_000 + seq++ * 1000,
    id: `ribhu-x-${seq}`,
    agent: 'main',
    routing: 'auto',
    project: '/work/app',
    output_tokens: 100,
    cost: null,
    ...o,
  });
}

function fixture() {
  root = mkdtempSync(join(tmpdir(), 'pakt-ribhu-'));
  // claude-code: input 2, everything else written to cache -> disjoint
  const cc = [
    row({
      provider: 'claude-code',
      model: 'fable',
      session: 's-cc',
      input_tokens: 2,
      cache_read_tokens: 1714,
      cache_write_tokens: 23110,
    }),
  ];
  // whole-prompt counts: each next read == previous input -> inclusive by sequence
  const incl = [4801, 6074, 7413, 7651].map((input, i, a) =>
    row({
      provider: 'ollama',
      model: 'gemma4:e4b',
      session: 's-incl',
      input_tokens: input,
      cache_read_tokens: i ? (a[i - 1] as number) - 5 : 0,
      cache_write_tokens: 0,
    }),
  );
  // deepseek main + subagent in one process; subagent input < read -> disjoint
  const tree = [
    row({
      provider: 'deepseek',
      model: 'deepseek-flash',
      session: 's-ds',
      input_tokens: 3340,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    }),
    row({
      provider: 'deepseek',
      model: 'deepseek-flash',
      session: 's-sub',
      agent: 'subagent',
      input_tokens: 255,
      cache_read_tokens: 3328,
      cache_write_tokens: 0,
      cache_break: false,
    }),
    // a lone row that could be either: stays a range
    row({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      session: 's-amb',
      input_tokens: 4788,
      cache_read_tokens: 768,
      cache_write_tokens: 0,
      cache_break: true,
      cache_break_cause: 'tools_changed',
    }),
  ];
  writeFileSync(join(root, '1-1.jsonl'), [...cc, ...incl].join('\n'));
  writeFileSync(join(root, '2-2.jsonl'), tree.join('\n'));
  writeFileSync(
    join(root, '3-3.jsonl'),
    [
      row({
        provider: 'deepseek',
        model: 'deepseek-flash',
        project: '/Users/x/.ribhu/eval/work/1/case',
        input_tokens: 9,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
      }),
      row({
        ts: now - 40 * 864e5,
        provider: 'deepseek',
        model: 'old',
        input_tokens: 9,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
      }),
      'not json',
    ].join('\n'),
  );
  writeFileSync(join(root, 'notes.txt'), 'ignored');
  return root;
}

describe('pakt doctor ribhu', () => {
  it("resolves each row's input_tokens convention from evidence", () => {
    const r = runRibhuDoctor({ root: fixture(), now });
    expect(r.rows).toEqual({ kept: 8, eval: 1, unreportedInput: 0 });
    expect(r.conventions).toEqual({ disjoint: 2, inclusive: 3, 'no-cache': 2, ambiguous: 1 });
    const ollama = r.byProvider.find((p) => p.provider === 'ollama');
    // inclusive rows: uncached = input - read, never the raw input
    expect(ollama?.uncachedLow).toBe(4801 + (6074 - 4796) + (7413 - 6069) + (7651 - 7408));
    expect(ollama?.uncachedHigh).toBe(ollama?.uncachedLow);
    const cc = r.byProvider.find((p) => p.provider === 'claude-code');
    expect([cc?.uncachedLow, cc?.uncachedHigh]).toEqual([2, 2]);
    // the unresolved deepseek row is a range, not a guess
    const ds = r.byProvider.find((p) => p.provider === 'deepseek');
    expect((ds?.uncachedHigh ?? 0) - (ds?.uncachedLow ?? 0)).toBe(768);
    expect(r.cacheHit[0]).toBeLessThan(r.cacheHit[1]);
  });

  it('groups a process into one subagent tree and counts cache breaks', () => {
    const r = runRibhuDoctor({ root: fixture(), now });
    expect(r.files).toBe(2);
    expect(r.trees.withSubagents).toBe(1);
    expect(r.trees.top[0]?.file).toBe('2-2.jsonl');
    expect(r.trees.top[0]?.subagentRequests).toBe(1);
    expect(r.byAgent.subagent?.requests).toBe(1);
    expect(r.cacheBreaks).toEqual({ tools_changed: 1 });
  });

  it('keeps eval rows only on request, and the report formats', () => {
    const r = runRibhuDoctor({ root: fixture(), now, includeEval: true });
    expect(r.rows.kept).toBe(9);
    expect(r.rows.eval).toBe(0);
    const text = formatRibhuDoctor(runRibhuDoctor({ root, now }));
    expect(text).toContain('1 eval-harness rows left out');
    expect(text).toContain('ambiguous 1');
    expect(ribhuRecommendations(runRibhuDoctor({ root, now })).join(' ')).toContain(
      'metered_input_tokens',
    );
  });

  it('names cold starts, not prefix breaks, when short sessions write more than they read', () => {
    root = mkdtempSync(join(tmpdir(), 'pakt-ribhu-'));
    const rows = Array.from({ length: 60 }, (_, i) =>
      row({
        provider: 'claude-code',
        model: 'fable',
        session: `s-${i}`,
        input_tokens: 2,
        cache_read_tokens: 1714,
        cache_write_tokens: 23110,
      }),
    );
    writeFileSync(join(root, '9-9.jsonl'), rows.join('\n'));
    const rec = ribhuRecommendations(runRibhuDoctor({ root, now })).join(' ');
    expect(rec).toContain('cold starts (60 calls over 60 sessions');
    expect(rec).not.toContain('prefix stable');
  });

  it('a missing log directory is an empty report, not an error', () => {
    root = mkdtempSync(join(tmpdir(), 'pakt-ribhu-'));
    const r = runRibhuDoctor({ root: join(root, 'nope'), now });
    expect(r.rows.kept).toBe(0);
    expect(formatRibhuDoctor(r)).toContain('0 responses');
  });
});

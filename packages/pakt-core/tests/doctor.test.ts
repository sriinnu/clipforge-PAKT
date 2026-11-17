import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../src/doctor/claude-code.js';
import { formatDoctor, recommendations } from '../src/doctor/format.js';

let root = '';
afterEach(() => rmSync(root, { recursive: true, force: true }));

const t0 = Date.parse('2026-11-17T10:00:00Z');
function req(i: number, ctx: number, write: number, gapS = 30, rid = `r${i}`) {
  return JSON.stringify({
    type: 'assistant',
    requestId: rid,
    timestamp: new Date(t0 + i * gapS * 1000).toISOString(),
    message: {
      model: 'claude-opus-5-5',
      content: [{ type: 'tool_use', id: `tu${i}`, name: 'Bash', input: {} }],
      usage: {
        input_tokens: 0,
        cache_read_input_tokens: ctx - write,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: write },
        output_tokens: 100,
      },
    },
  });
}
const result = (i: number) =>
  JSON.stringify({
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: `tu${i}`, content: 'x'.repeat(4000) }],
    },
  });

function fixture() {
  root = mkdtempSync(join(tmpdir(), 'pakt-doctor-'));
  const proj = join(root, 'proj');
  mkdirSync(join(proj, 'sess', 'subagents'), { recursive: true });
  // main: grows 20K/request to 500K, one >1h-gap rewrite in the middle
  const main: string[] = [];
  for (let i = 0; i < 25; i++) {
    const ctx = 20_000 * (i + 1);
    const write = i === 0 ? ctx : i === 12 ? ctx : 20_000;
    main.push(req(i, ctx, write, i === 12 ? 4000 : 30), result(i));
  }
  // streamed duplicate chunk of request 3 must not double count
  main.push(req(3, 80_000, 20_000));
  writeFileSync(join(proj, 'sess.jsonl'), main.join('\n'));
  const sub = [req(0, 30_000, 30_000), req(1, 40_000, 10_000)];
  writeFileSync(join(proj, 'sess', 'subagents', 'agent-1.jsonl'), sub.join('\n'));
  return root;
}

describe('pakt doctor', () => {
  it('counts main and subagent transcripts, dedups streamed chunks, classifies gaps', async () => {
    const r = await runDoctor({ root: fixture(), days: 365_000 });
    expect(r.files).toEqual({ main: 1, subagent: 1 });
    expect(r.byScope.main.requests).toBe(25);
    expect(r.byScope.subagent.requests).toBe(2);
    expect(r.causes['rewrite after >1h gap']?.requests).toBe(1);
    expect(r.causes['first request']?.requests).toBe(1);
    expect(r.shares.reads + r.shares.writes + r.shares.output + r.shares.uncached).toBeCloseTo(
      1,
      5,
    );
    expect(r.tools[0]?.name).toBe('Bash');
  });

  it('a lower window adds compactions, and too low can cost more than it saves', async () => {
    const r = await runDoctor({ root: fixture(), days: 365_000, windows: [300_000, 200_000] });
    const [w300, w200] = r.windows;
    expect(w300?.deltaPct).toBeLessThan(0);
    expect(w200?.extraCompactions).toBeGreaterThan(w300?.extraCompactions ?? 0);
    // each compaction re-writes the post-compact context at 2x; in a short
    // session that outweighs the cheaper reads
    expect(w200?.deltaPct).toBeGreaterThan(w300?.deltaPct ?? 0);
  });

  it('recommends conservatively and never past the current window', async () => {
    const r = await runDoctor({ root: fixture(), days: 365_000 });
    const text = formatDoctor(r);
    expect(text).toContain('subagent transcripts');
    expect(
      recommendations(r, 100_000).some((x) => x.startsWith('Set CLAUDE_CODE_AUTO_COMPACT_WINDOW')),
    ).toBe(false);
  });
});

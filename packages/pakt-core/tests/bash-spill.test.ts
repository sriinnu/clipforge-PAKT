import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bashSpill, bashSpillConfig, skipReason } from '../src/hooks/bash-spill.js';
import { runHook } from '../src/hooks/index.js';
import { FileSpillStore } from '../src/spill/file-store.js';
import { spillGist } from '../src/spill/index.js';

let dir = '';
const env = { ...process.env };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pakt-bash-spill-'));
  process.env.PAKT_LEDGER_DIR = join(dir, 'ledger');
  process.env.PAKT_SPILL_DIR = join(dir, 'spill');
});
afterEach(() => {
  process.env = { ...env };
  rmSync(dir, { recursive: true, force: true });
});

const big = Array.from({ length: 400 }, (_, i) => `line ${i} ok ${'x'.repeat(30)}`).join('\n');
const input = (stdout: string, extra: Record<string, unknown> = {}) => ({
  session_id: 's1',
  tool_name: 'Bash',
  tool_response: { stdout, stderr: '', interrupted: false, isImage: false, ...extra },
});
const ledger = () =>
  readFileSync(join(dir, 'ledger', 'spill.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

describe('spillGist head + tail', () => {
  it('keeps the first and last lines and never repeats a line', () => {
    const g = spillGist(big, 'sp_0000000000000000', 9999, 3, 4000, 2);
    expect(g.split('\n')).toEqual([
      'line 0 ok '.concat('x'.repeat(30)),
      'line 1 ok '.concat('x'.repeat(30)),
      'line 2 ok '.concat('x'.repeat(30)),
      expect.stringContaining('395 middle lines not shown'),
      'line 398 ok '.concat('x'.repeat(30)),
      'line 399 ok '.concat('x'.repeat(30)),
    ]);
    const short = spillGist('a\nb\nc', 'sp_0000000000000000', 10, 2, 4000, 5);
    expect(short.split('\n').filter((l) => l === 'a' || l === 'b' || l === 'c')).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('bash spill hook', () => {
  it('defaults to shadow: logs would-spill, changes nothing, writes no spill file', () => {
    expect(bashSpillConfig({}).mode).toBe('shadow');
    expect(runHook('post-tool-use', JSON.stringify(input(big))).stdout).toBe('');
    const [row] = ledger();
    expect(row).toMatchObject({ action: 'would-spill', mode: 'shadow', session: 's1' });
    expect(row.gistTokens).toBeLessThan(row.tokens);
    expect(JSON.stringify(row)).not.toContain('line 0'); // sizes only, never content
    expect(() => readdirSync(join(dir, 'spill'))).toThrow();
  });

  it('live: replaces stdout with head + tail + recall id, and the id recalls the full text', () => {
    const cfg = { ...bashSpillConfig({ PAKT_SPILL_MODE: 'live' }) };
    const out = JSON.parse(bashSpill(input(big), cfg));
    const u = out.hookSpecificOutput.updatedToolOutput;
    expect(out.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(Object.keys(u).sort()).toEqual(['interrupted', 'isImage', 'stderr', 'stdout']);
    expect(u.stdout).toContain('line 0 ok');
    expect(u.stdout).toContain('line 399 ok');
    expect(u.stdout).not.toContain('line 200 ok');
    const id = /pakt_recall \{"id":"(sp_[0-9a-f]{16})"\}/.exec(u.stdout)?.[1] ?? '';
    expect(new FileSpillStore().get(id)).toBe(big);
  });

  it('never spills errors, stderr, interrupts, images, small output or other tools', () => {
    const live = bashSpillConfig({ PAKT_SPILL_MODE: 'live' });
    const errored = `${big}\nTests  3 failed | 10 passed`;
    expect(skipReason(input(errored))).toBe('errorish');
    for (const e of [
      'src/a.ts(3,1): error TS2304: x',
      'error[E0308]: mismatched',
      'FAIL tests/x.test.ts',
      'Traceback (most recent call last):',
      'npm ERR! code 1',
      ' × boom',
      'bash: foo: command not found',
    ]) {
      expect(skipReason(input(`${big}\n${e}\n${big}`)), e).toBe('errorish');
    }
    // prose mentioning errors, and green summaries, still spill
    for (const ok of [
      'fix(core): better error handling',
      'Tests  0 failed | 9 passed',
      'no errors found',
    ]) {
      expect(skipReason(input(`${big}\n${ok}`)), ok).toBeUndefined();
    }
    expect(skipReason(input(big, { stderr: 'warn: x' }))).toBe('stderr');
    expect(skipReason(input(big, { interrupted: true }))).toBe('interrupted');
    expect(skipReason(input(big, { isImage: true }))).toBe('image');
    expect(skipReason({ ...input(big), tool_name: 'mcp__pakt__pakt_recall' })).toBe('not-bash');
    for (const x of [
      input(errored),
      input(big, { stderr: 'w' }),
      input('tiny'),
      { ...input(big), tool_name: 'Read' },
    ]) {
      expect(bashSpill(x, live)).toBe('');
    }
    expect(bashSpill(input(big), { ...live, mode: 'off' })).toBe('');
  });

  it('output already cut at the host cap gets no fake tail and says it was cut', () => {
    // planted: the real bug from the live test (seq 1 3000 cut at 20000 chars mid-line)
    const full = Array.from({ length: 3000 }, (_, i) => `row ${i + 1}`).join('\n');
    const cut = full.slice(0, 20_000);
    const cfg = bashSpillConfig({ PAKT_SPILL_MODE: 'live', BASH_MAX_OUTPUT_LENGTH: '20000' });
    const u = JSON.parse(bashSpill(input(cut), cfg)).hookSpecificOutput.updatedToolOutput;
    const lastShown = u.stdout
      .split('\n')
      .filter((l: string) => l.startsWith('row '))
      .pop();
    expect(lastShown).toBe('row 15'); // head only: no tail from the cut-off end
    expect(u.stdout).toContain('cut this output at 20000 chars');
    expect(ledger().pop()).toMatchObject({ action: 'spill', cut: true });
    // same size under a higher cap is complete output: keeps its real tail
    const ok = JSON.parse(bashSpill(input(cut), { ...cfg, hostCap: 100_000 })).hookSpecificOutput
      .updatedToolOutput;
    expect(ok.stdout).not.toContain('cut this output');
    expect(ok.stdout.trimEnd().split('\n').pop()).toBe(cut.split('\n').pop());
  });

  it('fails open on garbage and clamps bad env values to defaults', () => {
    expect(runHook('post-tool-use', 'not json').stdout).toBe('');
    expect(runHook('post-tool-use', '{"tool_name":"Bash","tool_response":7}').stdout).toBe('');
    const c = bashSpillConfig({
      PAKT_SPILL_MODE: 'yolo',
      PAKT_SPILL_THRESHOLD: '-5',
      PAKT_SPILL_TAIL: 'NaN',
    });
    expect(c).toEqual({
      mode: 'shadow',
      thresholdTokens: 1000,
      headLines: 15,
      tailLines: 15,
      hostCap: 30_000,
    });
  });
});

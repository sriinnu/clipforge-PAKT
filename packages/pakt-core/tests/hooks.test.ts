import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runHook } from '../src/hooks/index.js';

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pakt-hooks-'));
  process.env.PAKT_STATE_DIR = join(dir, 'state');
});
afterEach(() => {
  // biome-ignore lint/performance/noDelete: env var must be unset, not the string "undefined"
  delete process.env.PAKT_STATE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const line = (o: unknown) => JSON.stringify(o);
function transcript(): string {
  const path = join(dir, 't.jsonl');
  const rows = [
    { type: 'user', message: { content: 'old request before compaction' } },
    {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/old.ts' } }] },
    },
    { type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' },
    {
      type: 'user',
      cwd: '/repo',
      gitBranch: 'feat/x',
      message: { content: 'fix the auth bug in login.ts' },
    },
    {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/repo/login.ts' } }],
      },
    },
    {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', content: 'x\n[pakt spilled sp_0123456789abcdef: 9000 tokens]' },
        ],
      },
    },
    {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/repo/login.ts' } }],
      },
    },
    { type: 'user', message: { content: '<system-reminder>noise</system-reminder>' } },
    {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Fixed the token check; tests next.' }] },
    },
  ];
  writeFileSync(path, rows.map(line).join('\n'));
  return path;
}

describe('pakt hook pre-compact / session-start', () => {
  it('captures state since the last compaction and round-trips it after compaction', () => {
    const pre = runHook(
      'pre-compact',
      line({ session_id: 's-1', transcript_path: transcript(), trigger: 'auto' }),
    );
    expect(pre.stdout).toContain('- login.ts'); // relative to cwd /repo
    expect(pre.stdout).toContain('sp_0123456789abcdef');
    expect(pre.stdout).not.toContain('/old.ts'); // before the boundary: already summarised
    expect(pre.stdout.length).toBeLessThanOrEqual(10_000);
    expect(statSync(join(dir, 'state', 's-1.json')).mode & 0o777).toBe(0o600);

    const post = JSON.parse(
      runHook('session-start', line({ session_id: 's-1', source: 'compact' })).stdout,
    );
    const ctx = post.hookSpecificOutput.additionalContext as string;
    expect(post.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(ctx).toContain('branch: feat/x');
    expect(ctx).toContain('edited: login.ts');
    expect(ctx).toContain('last request: fix the auth bug in login.ts');
    expect(ctx).not.toContain('system-reminder');
    expect(ctx.length).toBeLessThanOrEqual(2000);
  });

  it('does nothing on a normal session start', () => {
    expect(runHook('session-start', line({ session_id: 's-1', source: 'startup' })).stdout).toBe(
      '',
    );
  });

  it('fails open on bad input, unknown events, missing files and unsafe ids', () => {
    expect(runHook('pre-compact', 'not json').stdout).toBe('');
    expect(runHook('nope', '{}').stdout).toBe('');
    expect(
      runHook('pre-compact', line({ session_id: 's', transcript_path: join(dir, 'missing') }))
        .stdout,
    ).toBe('');
    const traversal = runHook(
      'pre-compact',
      line({ session_id: '../../x', transcript_path: transcript() }),
    );
    expect(traversal.stdout).toContain('PAKT compaction guidance'); // guidance still useful
    expect(
      runHook('session-start', line({ session_id: '../../x', source: 'compact' })).stdout,
    ).toBe('');
  });
});

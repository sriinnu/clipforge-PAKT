/**
 * @module hooks/bash-spill
 * PostToolUse(Bash) spill: large, successful Bash output is replaced, once at
 * the moment it is produced, by its first and last lines plus a
 * `pakt_recall` id. The full output goes to the shared {@link FileSpillStore}.
 *
 * Modes (`PAKT_SPILL_MODE`):
 *   shadow (default)  log what would be spilled, change nothing
 *   live              replace the output via `updatedToolOutput`
 *   off               do nothing
 *
 * Never spilled: non-Bash tools (including `pakt_recall` itself), images,
 * interrupted commands, output with stderr, and anything that looks like an
 * error, so failures always reach the model in full.
 *
 * Every decision is appended to `~/.pakt/ledger/spill.jsonl` (sizes and ids
 * only, never content) for `pakt doctor` and the tuner.
 *
 * @internal Node.js only.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FileSpillStore } from '../spill/file-store.js';
import { MemorySpillStore, spill } from '../spill/index.js';

export type SpillMode = 'shadow' | 'live' | 'off';

export interface BashSpillConfig {
  mode: SpillMode;
  thresholdTokens: number;
  headLines: number;
  tailLines: number;
}

export function bashSpillConfig(env: NodeJS.ProcessEnv = process.env): BashSpillConfig {
  const mode = env.PAKT_SPILL_MODE;
  const num = (v: string | undefined, d: number, lo: number, hi: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= lo && n <= hi ? n : d;
  };
  return {
    mode: mode === 'live' || mode === 'off' ? mode : 'shadow',
    thresholdTokens: num(env.PAKT_SPILL_THRESHOLD, 1000, 200, 50_000),
    headLines: num(env.PAKT_SPILL_HEAD, 15, 0, 200),
    tailLines: num(env.PAKT_SPILL_TAIL, 15, 0, 200),
  };
}

/**
 * Error *shapes*, not bare words: compiler/runtime diagnostics, test-runner
 * failures, stack traces. A commit message saying "fix error handling" must
 * not block a spill; `error TS2304:` or `FAIL src/x.test.ts` must.
 */
const ERRORISH = [
  /\berror(\[[\w-]+\])?( [A-Z]+\d+)?:/i, // error: / error[E0308]: / error TS2304:
  /^\s*(fatal|panic|exception|traceback)\b/im,
  /\b(FAIL|FAILED|ERROR)\b|\bERR!/, // test runners, npm, uppercase log levels
  /^\s*[×✖✗]\s/m,
  /\b[1-9]\d* (failed|failing|errors?)\b/i, // "3 failed", "2 errors"; not "0 failed"
  /\bpermission denied\b|\bcommand not found\b|\bno such file\b/i,
];
const errorish = (s: string) => ERRORISH.some((re) => re.test(s));
/\b(error|errors|failed|failure|fatal|traceback|exception|panic|denied|cannot|not found)\b/i;

interface BashResponse {
  stdout?: unknown;
  stderr?: unknown;
  interrupted?: unknown;
  isImage?: unknown;
}

export interface PostToolUseInput {
  session_id?: string;
  tool_name?: string;
  tool_response?: BashResponse;
}

export type SkipReason =
  | 'not-bash'
  | 'shape'
  | 'image'
  | 'interrupted'
  | 'stderr'
  | 'errorish'
  | 'small';

/** Pure decision: why (not) to spill this output. */
export function skipReason(input: PostToolUseInput): SkipReason | undefined {
  if (input.tool_name !== 'Bash') return 'not-bash';
  const r = input.tool_response;
  if (!r || typeof r.stdout !== 'string') return 'shape';
  if (r.isImage === true) return 'image';
  if (r.interrupted === true) return 'interrupted';
  if (typeof r.stderr === 'string' && r.stderr.trim()) return 'stderr';
  if (errorish(r.stdout)) return 'errorish';
  return undefined;
}

function ledgerDir(): string {
  return process.env.PAKT_LEDGER_DIR ?? join(homedir(), '.pakt', 'ledger');
}

function log(row: Record<string, unknown>): void {
  try {
    mkdirSync(ledgerDir(), { recursive: true, mode: 0o700 });
    appendFileSync(join(ledgerDir(), 'spill.jsonl'), `${JSON.stringify(row)}\n`, { mode: 0o600 });
  } catch {}
}

/** Returns the hook's stdout (JSON) or '' to leave the output untouched. */
export function bashSpill(
  input: PostToolUseInput,
  cfg: BashSpillConfig = bashSpillConfig(),
): string {
  if (cfg.mode === 'off') return '';
  const skip = skipReason(input);
  if (skip === 'not-bash') return '';
  const stdout = String(input.tool_response?.stdout ?? '');
  const base = {
    ts: new Date().toISOString(),
    session: input.session_id,
    mode: cfg.mode,
    chars: stdout.length,
  };
  if (skip) {
    if (skip !== 'shape') log({ ...base, action: 'skip', reason: skip });
    return '';
  }
  // Shadow mode spills into memory only: nothing reaches disk but the ledger row.
  const store = cfg.mode === 'live' ? new FileSpillStore() : new MemorySpillStore();
  const r = spill(stdout, store, {
    thresholdTokens: cfg.thresholdTokens,
    headLines: cfg.headLines,
    tailLines: cfg.tailLines,
  });
  if (!r.spilled) {
    log({ ...base, action: 'skip', reason: 'small', tokens: r.originalTokens });
    return '';
  }
  log({
    ...base,
    action: cfg.mode === 'live' ? 'spill' : 'would-spill',
    id: r.id,
    tokens: r.originalTokens,
    gistTokens: r.tokens,
  });
  if (cfg.mode !== 'live') return '';
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      updatedToolOutput: {
        stdout: r.content,
        stderr: String(input.tool_response?.stderr ?? ''),
        interrupted: false,
        isImage: false,
      },
    },
  });
}

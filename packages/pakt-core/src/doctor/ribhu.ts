/**
 * @module doctor/ribhu
 * `pakt doctor ribhu`: where Ribhu's tokens go, from the per-response usage
 * log Ribhu writes (`~/.ribhu/usage/<start>-<pid>.jsonl`, one file per process).
 *
 * Aggregates only: no prompt content is read (the log holds none).
 *
 * The log does not say whether `input_tokens` includes the cache buckets:
 * it carries whatever the daemon's provider adapter reported, and both
 * conventions appear (Anthropic/DeepSeek report uncached input; older raw
 * prompt counts are the whole prompt). Each row is resolved from evidence:
 *
 * - `input < read + write`: cannot be inclusive, so the buckets are disjoint.
 * - no cache buckets: uncached input is `input` either way.
 * - otherwise ambiguous, settled per session by the next row's cache read:
 *   a prefix cache reads back the previous prompt, which is `input` when
 *   inclusive and `input + read + write` when disjoint.
 * - rows still unresolved are reported as a range (low = inclusive).
 *
 * Providers price differently (local models are free), so spend is shown as
 * tokens per provider, never summed into one cost.
 *
 * @internal Node.js only.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface RibhuDoctorOptions {
  /** Usage log directory. @default ~/.ribhu/usage */
  root?: string;
  /** Only rows from the last N days. @default 30 */
  days?: number;
  /** Include rows from Ribhu's own eval harness (`~/.ribhu/eval/`). @default false */
  includeEval?: boolean;
  /** Clock for tests. */
  now?: number;
}

/** How a row's `input_tokens` relates to its cache buckets. */
export type Convention = 'disjoint' | 'inclusive' | 'no-cache' | 'ambiguous';

interface Row {
  ts: number;
  file: string;
  session: string;
  agent: string;
  provider: string;
  model: string;
  input: number;
  read: number;
  write: number;
  output: number;
  inputReported: boolean;
  cacheBreak: string | null;
  conv: Convention;
}

export interface RibhuBucket {
  requests: number;
  /** Uncached input, inclusive reading of ambiguous rows (lower bound). */
  uncachedLow: number;
  /** Uncached input, disjoint reading of ambiguous rows (upper bound). */
  uncachedHigh: number;
  read: number;
  write: number;
  output: number;
}

export interface RibhuDoctorReport {
  files: number;
  sessions: number;
  rows: { kept: number; eval: number; unreportedInput: number };
  totals: RibhuBucket;
  conventions: Record<Convention, number>;
  /** Share of prompt tokens served from cache, as a [low, high] range. */
  cacheHit: [number, number];
  byProvider: ({ provider: string; models: string[]; sessions: number } & RibhuBucket)[];
  byAgent: Record<string, RibhuBucket>;
  /** Processes that spawned subagents: one Ribhu process is one tree. */
  trees: {
    withSubagents: number;
    subagentShare: number;
    top: {
      file: string;
      requests: number;
      subagentRequests: number;
      promptTokens: number;
      subagentShare: number;
    }[];
  };
  cacheBreaks: Record<string, number>;
}

const empty = (): RibhuBucket => ({
  requests: 0,
  uncachedLow: 0,
  uncachedHigh: 0,
  read: 0,
  write: 0,
  output: 0,
});

/** Uncached input of one row under each reading. */
function uncached(r: Row): [low: number, high: number] {
  const incl = Math.max(0, r.input - r.read - r.write);
  switch (r.conv) {
    case 'inclusive':
      return [incl, incl];
    case 'ambiguous':
      return [incl, r.input];
    default:
      return [r.input, r.input];
  }
}

function add(b: RibhuBucket, r: Row): void {
  const [lo, hi] = uncached(r);
  b.requests++;
  b.uncachedLow += lo;
  b.uncachedHigh += hi;
  b.read += r.read;
  b.write += r.write;
  b.output += r.output;
}

/** Whole prompt of a row under its convention (upper reading if ambiguous). */
const prompt = (r: Row) => uncached(r)[1] + r.read + r.write;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const str = (v: unknown, d: string) => (typeof v === 'string' && v ? v : d);

function rowConvention(input: number, read: number, write: number): Convention {
  if (read + write === 0) return 'no-cache';
  return input < read + write ? 'disjoint' : 'ambiguous';
}

/** Within 5% (plus slack for a few tokens of framing). */
const near = (a: number, b: number) => Math.abs(a - b) <= 0.05 * Math.max(a, b) + 16;

/**
 * Settle ambiguous rows per session from consecutive cache reads. A session
 * gets a verdict only when its evidence agrees (at least 2:1 and two votes).
 */
function settle(rows: Row[]): void {
  const bySession = new Map<string, Row[]>();
  for (const r of rows) {
    const s = bySession.get(r.session) ?? [];
    s.push(r);
    bySession.set(r.session, s);
  }
  for (const s of bySession.values()) {
    if (!s.some((r) => r.conv === 'ambiguous')) continue;
    s.sort((a, b) => a.ts - b.ts);
    let incl = 0;
    let disj = 0;
    for (let i = 1; i < s.length; i++) {
      const p = s[i - 1] as Row;
      const c = s[i] as Row;
      if (c.read === 0 || p.read + p.write === 0 || p.model !== c.model) continue;
      const asIncl = near(c.read, p.input);
      const asDisj = near(c.read, p.input + p.read + p.write);
      if (asIncl && !asDisj) incl++;
      else if (asDisj && !asIncl) disj++;
    }
    const verdict: Convention | undefined =
      incl >= 2 && incl >= 2 * disj
        ? 'inclusive'
        : disj >= 2 && disj >= 2 * incl
          ? 'disjoint'
          : undefined;
    if (!verdict) continue;
    for (const r of s) if (r.conv === 'ambiguous') r.conv = verdict;
  }
}

function readRows(root: string, cutoff: number, includeEval: boolean) {
  const rows: Row[] = [];
  let evalRows = 0;
  let files = 0;
  let names: string[] = [];
  try {
    names = readdirSync(root).filter((n) => n.endsWith('.jsonl'));
  } catch {
    return { rows, evalRows, files };
  }
  for (const name of names) {
    let text: string;
    try {
      text = readFileSync(join(root, name), 'utf8');
    } catch {
      continue;
    }
    let used = false;
    for (const line of text.split('\n')) {
      if (!line) continue;
      let x: Record<string, unknown>;
      try {
        x = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const ts = num(x.ts);
      if (ts <= cutoff) continue;
      if (!includeEval && String(x.project ?? '').includes('/.ribhu/eval/')) {
        evalRows++;
        continue;
      }
      const input = num(x.input_tokens);
      const read = num(x.cache_read_tokens);
      const write = num(x.cache_write_tokens);
      used = true;
      rows.push({
        ts,
        file: name,
        // One-shot calls carry no daemon session; their process is the best grouping.
        session: str(x.session, `file:${name}`),
        agent: str(x.agent, 'unknown'),
        provider: str(x.provider, 'unknown'),
        model: str(x.model, 'unknown'),
        input,
        read,
        write,
        output: num(x.output_tokens),
        inputReported: x.input_reported !== false,
        cacheBreak: x.cache_break === true ? str(x.cache_break_cause, 'unknown') : null,
        conv: rowConvention(input, read, write),
      });
    }
    if (used) files++;
  }
  return { rows, evalRows, files };
}

/** Build the report. The log is small (a few MB a month), so it is read whole. */
export function runRibhuDoctor(opts: RibhuDoctorOptions = {}): RibhuDoctorReport {
  const root = opts.root ?? join(homedir(), '.ribhu', 'usage');
  const cutoff = (opts.now ?? Date.now()) - (opts.days ?? 30) * 864e5;
  const { rows, evalRows, files } = readRows(root, cutoff, opts.includeEval ?? false);
  settle(rows);

  const totals = empty();
  const conventions: Record<Convention, number> = {
    disjoint: 0,
    inclusive: 0,
    'no-cache': 0,
    ambiguous: 0,
  };
  const providers = new Map<
    string,
    { b: RibhuBucket; models: Set<string>; sessions: Set<string> }
  >();
  const byAgent: Record<string, RibhuBucket> = {};
  const trees = new Map<
    string,
    { requests: number; sub: number; prompt: number; subPrompt: number }
  >();
  const cacheBreaks: Record<string, number> = {};
  const sessions = new Set<string>();
  let unreported = 0;

  for (const r of rows) {
    add(totals, r);
    conventions[r.conv]++;
    sessions.add(r.session);
    if (!r.inputReported) unreported++;
    const p = providers.get(r.provider) ?? {
      b: empty(),
      models: new Set<string>(),
      sessions: new Set<string>(),
    };
    add(p.b, r);
    p.models.add(r.model);
    p.sessions.add(r.session);
    providers.set(r.provider, p);
    const a = byAgent[r.agent] ?? empty();
    add(a, r);
    byAgent[r.agent] = a;
    const t = trees.get(r.file) ?? { requests: 0, sub: 0, prompt: 0, subPrompt: 0 };
    const isSub = r.agent === 'subagent';
    t.requests++;
    t.prompt += prompt(r);
    if (isSub) {
      t.sub++;
      t.subPrompt += prompt(r);
    }
    trees.set(r.file, t);
    if (r.cacheBreak) cacheBreaks[r.cacheBreak] = (cacheBreaks[r.cacheBreak] ?? 0) + 1;
  }

  const cached = totals.read + totals.write;
  const hit = (u: number) => (u + cached ? totals.read / (u + cached) : 0);
  const withSubs = [...trees.entries()].filter(([, t]) => t.sub > 0);
  const allPrompt = [...trees.values()].reduce((s, t) => s + t.prompt, 0);
  const subPrompt = withSubs.reduce((s, [, t]) => s + t.subPrompt, 0);

  return {
    files,
    sessions: sessions.size,
    rows: { kept: rows.length, eval: evalRows, unreportedInput: unreported },
    totals,
    conventions,
    // More uncached input means a lower hit rate: high reading gives the low bound.
    cacheHit: [hit(totals.uncachedHigh), hit(totals.uncachedLow)],
    byProvider: [...providers.entries()]
      .map(([provider, { b, models, sessions: s }]) => ({
        provider,
        models: [...models].sort(),
        sessions: s.size,
        ...b,
      }))
      .sort((a, b) => b.uncachedHigh + b.read + b.write - (a.uncachedHigh + a.read + a.write)),
    byAgent,
    trees: {
      withSubagents: withSubs.length,
      subagentShare: allPrompt ? subPrompt / allPrompt : 0,
      top: withSubs
        .map(([file, t]) => ({
          file,
          requests: t.requests,
          subagentRequests: t.sub,
          promptTokens: t.prompt,
          subagentShare: t.prompt ? t.subPrompt / t.prompt : 0,
        }))
        .sort((a, b) => b.promptTokens - a.promptTokens)
        .slice(0, 5),
    },
    cacheBreaks,
  };
}

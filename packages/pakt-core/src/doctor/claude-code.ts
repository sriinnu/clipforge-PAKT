/**
 * @module doctor/claude-code
 * `pakt doctor`: where Claude Code tokens actually go, from the local
 * transcripts Claude Code writes (main sessions AND `<session>/subagents/`).
 *
 * Aggregates only: no prompt or tool content leaves this module.
 *
 * Cost is in "input-token units" relative to the model's base input price:
 * uncached input 1, cache read 0.1, 5-minute cache write 1.25, 1-hour cache
 * write 2, output 5. Ratios hold across current Claude models, so shares and
 * deltas are meaningful even without a price table.
 *
 * @internal Node.js only.
 */

import { createReadStream, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const W = { input: 1, read: 0.1, w5: 1.25, w1h: 2, output: 5 } as const;

export interface DoctorOptions {
  /** Transcript root. @default ~/.claude/projects */
  root?: string;
  /** Only transcripts modified in the last N days. @default 30 */
  days?: number;
  /** Candidate compaction windows to simulate (tokens). */
  windows?: number[];
}

interface Usage {
  input: number;
  read: number;
  w5: number;
  w1h: number;
  output: number;
}

/** One API request reconstructed from a transcript. */
interface Req extends Usage {
  t: number;
  ctx: number;
}

export interface Bucket extends Usage {
  requests: number;
  cost: number;
}

export interface DoctorReport {
  files: { main: number; subagent: number };
  totals: Bucket;
  byScope: { main: Bucket; subagent: Bucket };
  /** Cost split by cost component, as shares of the total. */
  shares: { reads: number; writes: number; uncached: number; output: number };
  /** Main-thread requests classified by why they wrote to the cache. */
  causes: Record<string, Bucket>;
  avgContext: { main: number; subagent: number };
  compactions: { observed: number; medianPostContext: number };
  /** Simulated main-thread cost at each auto-compact window, vs today. */
  windows: { window: number; deltaPct: number; avgContext: number; extraCompactions: number }[];
  tools: { name: string; results: number; avgTokens: number; residentShare: number }[];
  recall: { spills: number; recalls: number };
}

const empty = (): Bucket => ({ requests: 0, cost: 0, input: 0, read: 0, w5: 0, w1h: 0, output: 0 });
const costOf = (u: Usage) =>
  u.input * W.input + u.read * W.read + u.w5 * W.w5 + u.w1h * W.w1h + u.output * W.output;

function add(b: Bucket, u: Usage): void {
  b.requests++;
  b.input += u.input;
  b.read += u.read;
  b.w5 += u.w5;
  b.w1h += u.w1h;
  b.output += u.output;
  b.cost += costOf(u);
}

function listTranscripts(root: string, cutoff: number): { main: string[]; subagent: string[] } {
  const out = { main: [] as string[], subagent: [] as string[] };
  const walk = (dir: string, depth: number) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(dir, n);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (depth < 3) walk(p, depth + 1);
      } else if (n.endsWith('.jsonl') && st.mtimeMs > cutoff) {
        (p.includes(`${'/'}subagents${'/'}`) ? out.subagent : out.main).push(p);
      }
    }
  };
  walk(root, 0);
  return out;
}

interface Parsed {
  reqs: Req[];
  /** Index into reqs of the first request after each compact boundary. */
  boundaries: number[];
  tools: Map<string, { results: number; tokens: number; resident: number }>;
  spills: number;
  recalls: number;
}

function usageOf(u: Record<string, unknown>): Usage {
  const n = (v: unknown) => (typeof v === 'number' ? v : 0);
  const cc = (u.cache_creation ?? undefined) as Record<string, unknown> | undefined;
  const w5 = cc ? n(cc.ephemeral_5m_input_tokens) : n(u.cache_creation_input_tokens);
  const w1h = cc ? n(cc.ephemeral_1h_input_tokens) : 0;
  return {
    input: n(u.input_tokens),
    read: n(u.cache_read_input_tokens),
    w5,
    w1h,
    output: n(u.output_tokens),
  };
}

function textLen(c: unknown): number {
  if (typeof c === 'string') return c.length;
  if (!Array.isArray(c)) return 0;
  let n = 0;
  for (const b of c) if (b?.type === 'text' && typeof b.text === 'string') n += b.text.length;
  return n;
}

async function parse(path: string): Promise<Parsed> {
  const out: Parsed = { reqs: [], boundaries: [], tools: new Map(), spills: 0, recalls: 0 };
  const byRequest = new Map<string, number>();
  const names = new Map<string, string>();
  let live: { name: string; tokens: number; reads: number }[] = [];
  const settle = () => {
    for (const r of live) {
      const t = out.tools.get(r.name);
      if (t) t.resident += r.tokens * r.reads;
    }
    live = [];
  };
  const rl = createInterface({
    input: createReadStream(path),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of rl) {
    if (!line) continue;
    let x: Record<string, unknown>;
    try {
      x = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (x.type === 'system' && x.subtype === 'compact_boundary') {
      settle();
      out.boundaries.push(out.reqs.length);
      continue;
    }
    const msg = x.message as Record<string, unknown> | undefined;
    const content = msg?.content;
    if (x.type === 'assistant' && msg) {
      const rid = typeof x.requestId === 'string' ? x.requestId : undefined;
      if (
        rid &&
        !byRequest.has(rid) &&
        msg.usage &&
        typeof msg.model === 'string' &&
        msg.model.startsWith('claude')
      ) {
        const u = usageOf(msg.usage as Record<string, unknown>);
        byRequest.set(rid, out.reqs.length);
        out.reqs.push({
          ...u,
          t: Date.parse(String(x.timestamp)),
          ctx: u.input + u.read + u.w5 + u.w1h,
        });
        for (const r of live) r.reads++;
      } else if (rid && byRequest.has(rid) && msg.usage) {
        // streamed chunks repeat usage; keep the largest output count
        const r = out.reqs[byRequest.get(rid) as number];
        const o = usageOf(msg.usage as Record<string, unknown>).output;
        if (r && o > r.output) r.output = o;
      }
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b?.type !== 'tool_use' || typeof b.name !== 'string') continue;
          const name = b.name.startsWith('mcp__')
            ? b.name.split('__').slice(0, 2).join('__')
            : b.name;
          names.set(b.id, name);
          if (b.name.endsWith('pakt_recall')) out.recalls++;
        }
      }
    } else if (x.type === 'user' && Array.isArray(content)) {
      for (const b of content) {
        if (b?.type !== 'tool_result') continue;
        const tokens = Math.round(textLen(b.content) / 4);
        const name = names.get(b.tool_use_id) ?? '?';
        const t = out.tools.get(name) ?? { results: 0, tokens: 0, resident: 0 };
        t.results++;
        t.tokens += tokens;
        out.tools.set(name, t);
        live.push({ name, tokens, reads: 0 });
        if (line.includes('pakt spilled sp_')) out.spills++;
      }
    }
  }
  settle();
  return out;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/**
 * Replay a session's context sizes under a compaction window. After a
 * simulated compaction the context restarts at `post` (the observed median)
 * and grows by the session's real per-request deltas.
 */
function simulate(sessions: Req[][], window: number, post: number) {
  let cost = 0;
  let compactions = 0;
  let ctxSum = 0;
  let n = 0;
  for (const s of sessions) {
    if (!s.length) continue;
    let sim = (s[0] as Req).ctx;
    cost += sim * W.w1h;
    for (let i = 1; i < s.length; i++) {
      const cur = s[i] as Req;
      const delta = cur.ctx - (s[i - 1] as Req).ctx;
      if (delta < 0) {
        sim = Math.min(sim, cur.ctx); // a real compaction in the log
        cost += sim * W.w1h;
      } else if (sim + delta > window) {
        cost += sim * W.read; // the summarising request reads the cached history
        compactions++;
        sim = Math.min(post, window);
        cost += sim * W.w1h;
      } else {
        cost += sim * W.read + delta * W.w1h;
        sim += delta;
      }
      ctxSum += sim;
      n++;
    }
  }
  return { cost, compactions, avgContext: n ? ctxSum / n : 0 };
}

function classify(prev: Req | undefined, r: Req): string {
  if (!prev) return 'first request';
  const write = r.w5 + r.w1h;
  if (write < 0.2 * r.ctx) return 'append (cache working)';
  const gap = (r.t - prev.t) / 1000;
  if (gap > 3600) return 'rewrite after >1h gap';
  if (gap > 300) return 'rewrite after 5m-1h gap';
  return 'rewrite <5m (prefix break or compaction)';
}

/** Build the report. Reads transcripts sequentially to bound memory. */
export async function runDoctor(opts: DoctorOptions = {}): Promise<DoctorReport> {
  const root = opts.root ?? join(homedir(), '.claude', 'projects');
  const cutoff = Date.now() - (opts.days ?? 30) * 864e5;
  const windows = opts.windows ?? [600_000, 400_000, 300_000, 200_000];
  const files = listTranscripts(root, cutoff);
  const report: DoctorReport = {
    files: { main: files.main.length, subagent: files.subagent.length },
    totals: empty(),
    byScope: { main: empty(), subagent: empty() },
    shares: { reads: 0, writes: 0, uncached: 0, output: 0 },
    causes: {},
    avgContext: { main: 0, subagent: 0 },
    compactions: { observed: 0, medianPostContext: 0 },
    windows: [],
    tools: [],
    recall: { spills: 0, recalls: 0 },
  };
  const mainSessions: Req[][] = [];
  const postCtx: number[] = [];
  const tools = new Map<string, { results: number; tokens: number; resident: number }>();
  const ctxSum = { main: 0, subagent: 0 };

  for (const scope of ['main', 'subagent'] as const) {
    for (const f of files[scope]) {
      const p = await parse(f);
      for (let i = 0; i < p.reqs.length; i++) {
        const r = p.reqs[i] as Req;
        add(report.totals, r);
        add(report.byScope[scope], r);
        ctxSum[scope] += r.ctx;
        if (scope === 'main') {
          const cause = classify(p.reqs[i - 1], r);
          const b = report.causes[cause] ?? empty();
          add(b, r);
          report.causes[cause] = b;
        }
      }
      report.recall.spills += p.spills;
      report.recall.recalls += p.recalls;
      if (scope === 'main') {
        mainSessions.push(p.reqs);
        for (const at of p.boundaries) {
          const r = p.reqs[at];
          if (r) postCtx.push(r.ctx);
        }
        for (const [name, t] of p.tools) {
          const acc = tools.get(name) ?? { results: 0, tokens: 0, resident: 0 };
          acc.results += t.results;
          acc.tokens += t.tokens;
          acc.resident += t.resident;
          tools.set(name, acc);
        }
      }
    }
  }

  const tc = report.totals.cost || 1;
  const t = report.totals;
  report.shares = {
    reads: (t.read * W.read) / tc,
    writes: (t.w5 * W.w5 + t.w1h * W.w1h) / tc,
    uncached: (t.input * W.input) / tc,
    output: (t.output * W.output) / tc,
  };
  report.avgContext = {
    main: report.byScope.main.requests ? ctxSum.main / report.byScope.main.requests : 0,
    subagent: report.byScope.subagent.requests
      ? ctxSum.subagent / report.byScope.subagent.requests
      : 0,
  };
  report.compactions = { observed: postCtx.length, medianPostContext: median(postCtx) || 80_000 };

  const post = report.compactions.medianPostContext;
  const base = simulate(mainSessions, Number.POSITIVE_INFINITY, post);
  for (const w of windows) {
    const s = simulate(mainSessions, w, post);
    report.windows.push({
      window: w,
      deltaPct: base.cost ? (s.cost / base.cost - 1) * 100 : 0,
      avgContext: s.avgContext,
      extraCompactions: s.compactions - base.compactions,
    });
  }

  const resident = [...tools.values()].reduce((a, x) => a + x.resident, 0) || 1;
  report.tools = [...tools.entries()]
    .map(([name, x]) => ({
      name,
      results: x.results,
      avgTokens: x.results ? Math.round(x.tokens / x.results) : 0,
      residentShare: x.resident / resident,
    }))
    .sort((a, b) => b.residentShare - a.residentShare)
    .slice(0, 8);
  return report;
}

/**
 * @module doctor/format
 * Human-readable `pakt doctor` output and the recommendations it makes.
 * Recommendations are proposals only: the doctor never edits settings.
 */

import type { DoctorReport } from './claude-code.js';
import type { RibhuDoctorReport } from './ribhu.js';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const k = (x: number) => `${Math.round(x / 1000)}K`;
const m = (x: number) => `${(x / 1e6).toFixed(1)}M`;

export function recommendations(r: DoctorReport, currentWindow?: number): string[] {
  const out: string[] = [];
  // Conservative: at most ~2x today's compaction count, since the simulation
  // can't see re-reads or summary loss. Step lower only after measuring those.
  const best = r.windows
    .filter((w) => w.deltaPct <= -10 && w.extraCompactions <= r.compactions.observed * 2 + 20)
    .sort((a, b) => a.deltaPct - b.deltaPct)[0];
  if (best && (currentWindow === undefined || best.window < currentWindow)) {
    out.push(
      `Set CLAUDE_CODE_AUTO_COMPACT_WINDOW=${best.window} (simulated ${best.deltaPct.toFixed(1)}% main-thread cost, +${best.extraCompactions} compactions). Install the pakt pre-compact/session-start hooks first so compactions lose less.`,
    );
  } else if (currentWindow !== undefined) {
    out.push(
      `CLAUDE_CODE_AUTO_COMPACT_WINDOW=${currentWindow} is set; measure re-reads after compaction before going lower.`,
    );
  }
  if (r.byScope.subagent.cost > 0.3 * r.totals.cost) {
    out.push(
      `Subagents are ${pct(r.byScope.subagent.cost / r.totals.cost)} of spend (avg context ${k(r.avgContext.subagent)}): audit which agents run long and what context they start with.`,
    );
  }
  const bash = r.tools.find((t) => t.name === 'Bash');
  if (bash && bash.residentShare > 0.5) {
    out.push(
      `Bash output is ${pct(bash.residentShare)} of resident tool-result tokens: the Bash spill hook targets this.`,
    );
  }
  const gaps = (r.causes['rewrite after >1h gap']?.cost ?? 0) / (r.byScope.main.cost || 1);
  if (gaps > 0.03)
    out.push(`${pct(gaps)} of main-thread cost is re-writing the cache after >1h idle.`);
  if (r.recall.spills >= 20) {
    const rate = r.recall.recalls / r.recall.spills;
    out.push(
      `pakt_recall rate ${pct(rate)} of spills${rate > 0.3 ? ' (high: raise the spill threshold or keep more lines)' : ''}.`,
    );
  }
  return out;
}

export function formatDoctor(r: DoctorReport, currentWindow?: number): string {
  const L: string[] = [];
  const t = r.totals;
  L.push('pakt doctor — Claude Code token spend (local transcripts, aggregates only)');
  L.push(
    `files: ${r.files.main} sessions + ${r.files.subagent} subagent transcripts, ${t.requests} requests`,
  );
  L.push('');
  L.push('Spend (input-token units: read 0.1, write 1.25/2, output 5)');
  L.push(
    `  main thread   ${pct(r.byScope.main.cost / (t.cost || 1)).padStart(6)}   avg context ${k(r.avgContext.main)}`,
  );
  L.push(
    `  subagents     ${pct(r.byScope.subagent.cost / (t.cost || 1)).padStart(6)}   avg context ${k(r.avgContext.subagent)}`,
  );
  L.push(
    `  by component  reads ${pct(r.shares.reads)}, writes ${pct(r.shares.writes)}, output ${pct(r.shares.output)}, uncached ${pct(r.shares.uncached)}`,
  );
  L.push(`  tokens        read ${m(t.read)}, written ${m(t.w5 + t.w1h)}, output ${m(t.output)}`);
  L.push('');
  L.push('Main-thread cache behaviour');
  const mc = r.byScope.main.cost || 1;
  for (const [cause, b] of Object.entries(r.causes).sort((a, b2) => b2[1].cost - a[1].cost)) {
    L.push(
      `  ${cause.padEnd(42)} ${String(b.requests).padStart(7)} req  ${pct(b.cost / mc).padStart(6)}`,
    );
  }
  L.push('');
  L.push(
    `Auto-compact window (main thread; ${r.compactions.observed} real compactions, median post-compact context ${k(r.compactions.medianPostContext)})`,
  );
  for (const w of r.windows) {
    L.push(
      `  ${k(w.window).padStart(5)}  ${`${w.deltaPct.toFixed(1)}%`.padStart(7)}  avg context ${k(w.avgContext).padStart(5)}  +${w.extraCompactions} compactions`,
    );
  }
  L.push(
    '  (simulation: ignores re-reads after compaction and summary quality; treat as an upper bound)',
  );
  L.push('');
  L.push('Resident tool results (share of tool-result tokens re-read across requests)');
  for (const x of r.tools)
    L.push(
      `  ${x.name.padEnd(28)} ${String(x.results).padStart(7)} results  avg ${String(x.avgTokens).padStart(5)} tok  ${pct(x.residentShare).padStart(6)}`,
    );
  const rec = recommendations(r, currentWindow);
  if (rec.length) {
    L.push('');
    L.push('Recommendations (proposals; pakt never edits your settings)');
    for (const x of rec) L.push(`  - ${x}`);
  }
  return `${L.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// pakt doctor ribhu
// ---------------------------------------------------------------------------

const range = (lo: number, hi: number, f: (x: number) => string) =>
  f(lo) === f(hi) ? f(lo) : `${f(lo)}–${f(hi)}`;

export function ribhuRecommendations(r: RibhuDoctorReport): string[] {
  const out: string[] = [];
  const n = r.rows.kept || 1;
  if (r.conventions.ambiguous / n > 0.05) {
    out.push(
      `${pct(r.conventions.ambiguous / n)} of rows can't say whether input_tokens includes the cache: have Ribhu's usage log write the whole-prompt count (metered_input_tokens) so uncached input is exact.`,
    );
  }
  if (r.trees.subagentShare > 0.3) {
    out.push(
      `Subagents are ${pct(r.trees.subagentShare)} of prompt tokens: check what context each child starts with.`,
    );
  }
  for (const p of r.byProvider) {
    const cached = p.read + p.write;
    const prompt = p.uncachedHigh + cached;
    // Only routes that report cache reads; small routes are noise.
    if (p.read === 0 || prompt < 1e6) continue;
    const hit = p.read / prompt;
    if (hit >= 0.5) continue;
    const perSession = p.requests / (p.sessions || 1);
    // Writes outweighing reads over short sessions is cold starts, not a prefix break.
    out.push(
      p.write > p.read && perSession < 3
        ? `${p.provider}: ${pct(hit)} cache hit, mostly cold starts (${p.requests} calls over ${p.sessions} sessions, each re-writing its prompt). Reuse a session for follow-up calls.`
        : `${p.provider}: only ${pct(hit)} of prompt tokens hit the cache. Keep the prompt prefix stable (no per-turn system-prompt edits, no history rewrite).`,
    );
  }
  const breaks = Object.entries(r.cacheBreaks).sort((a, b) => b[1] - a[1])[0];
  if (breaks && breaks[1] >= 5) out.push(`Most common cache break: ${breaks[0]} (${breaks[1]}x).`);
  return out;
}

export function formatRibhuDoctor(r: RibhuDoctorReport): string {
  const L: string[] = [];
  const t = r.totals;
  L.push('pakt doctor ribhu — Ribhu token spend (~/.ribhu/usage, aggregates only)');
  L.push(
    `${r.rows.kept} responses, ${r.sessions} sessions, ${r.files} processes${r.rows.eval ? ` (${r.rows.eval} eval-harness rows left out; --include-eval to add)` : ''}`,
  );
  if (!r.rows.kept) return `${L.join('\n')}\n`;
  L.push('');
  L.push(
    `Tokens   uncached ${range(t.uncachedLow, t.uncachedHigh, m)}, cache read ${m(t.read)}, cache write ${m(t.write)}, output ${m(t.output)}`,
  );
  L.push(`Cache hit ${range(r.cacheHit[0], r.cacheHit[1], pct)} of prompt tokens`);
  const c = r.conventions;
  L.push(
    `input_tokens convention: disjoint ${c.disjoint}, inclusive ${c.inclusive}, no cache buckets ${c['no-cache']}, ambiguous ${c.ambiguous}${r.rows.unreportedInput ? `; ${r.rows.unreportedInput} rows with input unreported` : ''}`,
  );
  L.push('');
  L.push('By provider (tokens; providers price differently, so no shared cost)');
  for (const p of r.byProvider) {
    L.push(
      `  ${p.provider.padEnd(14)} ${String(p.requests).padStart(6)} req  uncached ${range(p.uncachedLow, p.uncachedHigh, m).padStart(11)}  read ${m(p.read).padStart(7)}  write ${m(p.write).padStart(7)}  out ${m(p.output).padStart(6)}  ${p.models.slice(0, 3).join(', ')}`,
    );
  }
  L.push('');
  L.push('By agent');
  for (const [agent, b] of Object.entries(r.byAgent).sort(
    (a, b2) => b2[1].requests - a[1].requests,
  )) {
    L.push(
      `  ${agent.padEnd(14)} ${String(b.requests).padStart(6)} req  read ${m(b.read).padStart(7)}  out ${m(b.output).padStart(6)}`,
    );
  }
  L.push('');
  L.push(
    `Subagent trees: ${r.trees.withSubagents} processes spawned subagents; subagents are ${pct(r.trees.subagentShare)} of all prompt tokens`,
  );
  for (const x of r.trees.top) {
    L.push(
      `  ${x.file.padEnd(28)} ${String(x.requests).padStart(5)} req (${x.subagentRequests} subagent)  prompt ${m(x.promptTokens).padStart(7)}  subagents ${pct(x.subagentShare)}`,
    );
  }
  const breaks = Object.entries(r.cacheBreaks);
  if (breaks.length) {
    L.push('');
    L.push(`Cache breaks: ${breaks.map(([k2, v]) => `${k2} ${v}`).join(', ')}`);
  }
  const rec = ribhuRecommendations(r);
  if (rec.length) {
    L.push('');
    L.push('Recommendations (proposals; pakt never edits your settings)');
    for (const x of rec) L.push(`  - ${x}`);
  }
  return `${L.join('\n')}\n`;
}

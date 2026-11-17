/**
 * @module doctor/format
 * Human-readable `pakt doctor` output and the recommendations it makes.
 * Recommendations are proposals only: the doctor never edits settings.
 */

import type { DoctorReport } from './claude-code.js';

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

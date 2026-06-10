/**
 * Result persistence + markdown reporting for the PAKT comprehension eval.
 *
 * Writes:
 *   results/<timestamp>.json  — full raw results for the run
 *   results/latest.md         — per-model accuracy table (JSON vs PAKT, by
 *                               dataset x category) + token counts + cost
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Fable 5 pricing (USD per million tokens). */
export const PRICING = { inputPerMTok: 10, outputPerMTok: 50 };

/**
 * @typedef {Object} EvalRecord
 * @property {string} provider  Provider name (anthropic | openai | mock).
 * @property {string} model
 * @property {string} dataset
 * @property {string} category
 * @property {string} taskId
 * @property {"json"|"pakt"} format
 * @property {string} question
 * @property {string|number} expected
 * @property {string} got        Normalized model answer.
 * @property {string} raw        Raw model answer.
 * @property {boolean} correct
 * @property {{input: number, output: number}} usage  Provider-reported tokens (0 for mock).
 */

/**
 * Estimated input cost of one full run (all tasks x both formats) at Fable 5
 * pricing, from local token counts.
 * @param {{json: number, pakt: number}[]} payloadTokens Per-dataset payload token counts.
 * @param {number} taskCount Total task count across datasets.
 * @returns {{inputTokens: number, estUsd: number}}
 */
export function estimateRunCost(payloadTokens, taskCount) {
  // Each task sends the payload once per format; question/instructions ~80 tokens.
  const perDatasetTasks = taskCount / payloadTokens.length;
  let inputTokens = 0;
  for (const p of payloadTokens) inputTokens += (p.json + p.pakt + 2 * 80) * perDatasetTasks;
  const outputTokens = taskCount * 2 * 30; // terse answers, ~30 tokens each
  const estUsd =
    (inputTokens * PRICING.inputPerMTok + outputTokens * PRICING.outputPerMTok) / 1e6;
  return { inputTokens: Math.round(inputTokens), estUsd };
}

/** Formats a ratio as a percent string, or "—" when there are no samples. */
const pct = (ok, total) => (total === 0 ? '—' : `${((100 * ok) / total).toFixed(1)}% (${ok}/${total})`);

/**
 * Aggregates records into per-model, per-(dataset x category) accuracy rows.
 * @param {EvalRecord[]} records
 * @returns {Map<string, Map<string, {json: [number, number], pakt: [number, number]}>>}
 */
function aggregate(records) {
  const byModel = new Map();
  for (const r of records) {
    const modelKey = `${r.provider}:${r.model}`;
    if (!byModel.has(modelKey)) byModel.set(modelKey, new Map());
    const rows = byModel.get(modelKey);
    const rowKey = `${r.dataset} / ${r.category}`;
    if (!rows.has(rowKey)) rows.set(rowKey, { json: [0, 0], pakt: [0, 0] });
    const cell = rows.get(rowKey)[r.format];
    cell[1] += 1;
    if (r.correct) cell[0] += 1;
  }
  return byModel;
}

/**
 * Renders the markdown report for a run.
 * @param {{startedAt: string, mock: boolean, records: EvalRecord[], tokenStats: {dataset: string, jsonTokens: number, paktTokens: number, savingsPct: number}[], cost: {inputTokens: number, estUsd: number}}} run
 * @returns {string}
 */
export function renderMarkdown(run) {
  const lines = [];
  lines.push('# PAKT Model-Comprehension Eval — latest run');
  lines.push('');
  lines.push(`- Run started: ${run.startedAt}`);
  lines.push(`- Mode: ${run.mock ? '**MOCK (echo model — NOT model evidence; pipeline verification only)**' : 'live API'}`);
  lines.push(`- Records: ${run.records.length}`);
  lines.push('');
  for (const [modelKey, rows] of aggregate(run.records)) {
    lines.push(`## Model: \`${modelKey}\``);
    lines.push('');
    lines.push('| Dataset / Category | JSON accuracy | PAKT accuracy |');
    lines.push('|---|---|---|');
    let tot = { json: [0, 0], pakt: [0, 0] };
    for (const [rowKey, cell] of rows) {
      lines.push(`| ${rowKey} | ${pct(...cell.json)} | ${pct(...cell.pakt)} |`);
      tot.json[0] += cell.json[0]; tot.json[1] += cell.json[1];
      tot.pakt[0] += cell.pakt[0]; tot.pakt[1] += cell.pakt[1];
    }
    lines.push(`| **overall** | **${pct(...tot.json)}** | **${pct(...tot.pakt)}** |`);
    lines.push('');
  }
  lines.push('## Payload token counts (local tokenizer estimate)');
  lines.push('');
  lines.push('| Dataset | JSON (minified) | PAKT | Savings |');
  lines.push('|---|---|---|---|');
  for (const t of run.tokenStats) {
    lines.push(`| ${t.dataset} | ${t.jsonTokens} | ${t.paktTokens} | ${t.savingsPct.toFixed(1)}% |`);
  }
  lines.push('');
  lines.push(`## Estimated cost per full live run (Fable 5: $${PRICING.inputPerMTok}/MTok in, $${PRICING.outputPerMTok}/MTok out)`);
  lines.push('');
  lines.push(`- Estimated input tokens: ~${run.cost.inputTokens.toLocaleString('en-US')}`);
  lines.push(`- Estimated cost: ~$${run.cost.estUsd.toFixed(2)} per model`);
  lines.push('');
  lines.push('> No results are published in the repo README until a real run is executed and reviewed.');
  lines.push('');
  return lines.join('\n');
}

/**
 * Persists a run to results/<timestamp>.json and results/latest.md.
 * @param {Parameters<typeof renderMarkdown>[0]} run
 * @param {string} outDir Absolute path to the results directory.
 * @returns {{jsonPath: string, mdPath: string}}
 */
export function writeReport(run, outDir) {
  mkdirSync(outDir, { recursive: true });
  const stamp = run.startedAt.replace(/[:.]/g, '-');
  const jsonPath = join(outDir, `${stamp}.json`);
  const mdPath = join(outDir, 'latest.md');
  writeFileSync(jsonPath, JSON.stringify(run, null, 2) + '\n');
  writeFileSync(mdPath, renderMarkdown(run));
  return { jsonPath, mdPath };
}

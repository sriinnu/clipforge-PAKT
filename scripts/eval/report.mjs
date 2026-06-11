/**
 * Result persistence + markdown reporting for the PAKT comprehension eval.
 *
 * Writes:
 *   results/<timestamp>.json  — full raw results for the run
 *   results/latest.md         — per-model accuracy table (JSON vs PAKT, by
 *                               dataset x category) + matched-pair analysis +
 *                               token counts + cost estimate
 *
 * Matched-pair design
 * ───────────────────
 * For each QUESTION (task), we compare the outcomes on both formats side by
 * side and classify into one of four cells:
 *
 *   bothRight   — JSON correct, PAKT correct   → format doesn't matter (shared difficulty)
 *   bothWrong   — JSON wrong,   PAKT wrong      → task-difficulty noise; excluded from effect
 *   jsonOnly    — JSON correct, PAKT wrong      → format hurt PAKT
 *   paktOnly    — PAKT correct, JSON wrong      → format helped PAKT
 *
 * FORMAT EFFECT = paktOnly − jsonOnly
 *   Positive → PAKT outperforms JSON on questions where they diverge.
 *   Negative → PAKT underperforms JSON on divergent questions.
 *   ≈ 0      → format is comprehension-neutral.
 *
 * A two-sided exact sign test over the discordant pairs determines whether the
 * effect is real: only p < 0.05 claims a format effect, otherwise the verdict
 * is "neutral" and names the observed lean as a non-significant trend. This
 * never overclaims on a handful of divergent pairs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Fable 5 pricing (USD per million tokens). */
export const PRICING = { inputPerMTok: 10, outputPerMTok: 50 };

/** Significance level for the matched-pair sign test. */
const SIGN_TEST_ALPHA = 0.05;

/**
 * Two-sided exact binomial (sign) test p-value for a matched-pair comparison.
 *
 * Only discordant pairs carry information: of the `n = jsonOnly + paktOnly`
 * pairs where the formats disagreed, we test whether the split departs from a
 * fair 50/50 coin. `k` is the smaller arm. p = min(1, 2·Σ_{i=0..k} C(n,i)·0.5ⁿ).
 *
 * @param {number} jsonOnly  Pairs where JSON was right and PAKT wrong.
 * @param {number} paktOnly  Pairs where PAKT was right and JSON wrong.
 * @returns {number} Two-sided p-value in [0, 1] (1 when there are no discordant pairs).
 */
function signTestPValue(jsonOnly, paktOnly) {
  const n = jsonOnly + paktOnly;
  if (n === 0) return 1;
  const k = Math.min(jsonOnly, paktOnly);
  let tail = 0;
  for (let i = 0; i <= k; i++) {
    let c = 1;
    for (let j = 0; j < i; j++) c = (c * (n - j)) / (j + 1);
    tail += c;
  }
  return Math.min(1, 2 * tail * 0.5 ** n);
}

/**
 * @typedef {Object} EvalRecord
 * @property {string} suite     Suite name: "comprehension" | "stress".
 * @property {string} provider  Provider name (anthropic | openai | mock | cli).
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
 * @property {{input: number, output: number}} usage  Provider-reported tokens (0 for mock/cli).
 */

/**
 * @typedef {Object} MatchedPairCounts
 * @property {number} bothRight   Both JSON and PAKT correct.
 * @property {number} bothWrong   Both JSON and PAKT wrong.
 * @property {number} jsonOnly    JSON correct, PAKT wrong.
 * @property {number} paktOnly    PAKT correct, JSON wrong.
 * @property {number} total       Total matched questions.
 * @property {number} formatEffect paktOnly − jsonOnly.
 */

/**
 * Estimated input cost of one full run (all tasks × both formats) at Fable 5
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
 * Returns true when a model string comes from the CLI provider.
 * @param {string} model
 * @returns {boolean}
 */
function isCliModel(model) {
  return model.includes('(via Claude Code CLI)') || model.includes('(via Codex CLI)');
}

/**
 * Aggregates records into per-model, per-(dataset × category) accuracy rows.
 * Filtered to a specific suite name if provided.
 *
 * @param {EvalRecord[]} records
 * @param {string} [suiteFilter]  If set, only include records from this suite.
 * @returns {Map<string, Map<string, {json: [number, number], pakt: [number, number]}>>}
 */
function aggregate(records, suiteFilter) {
  const byModel = new Map();
  for (const r of records) {
    if (suiteFilter && r.suite !== suiteFilter) continue;
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
 * Computes matched-pair counts for a set of records from one suite.
 * Pairs are formed by (model, dataset, taskId) — each question is asked once
 * per format; we compare the json vs pakt outcome for the same question.
 *
 * @param {EvalRecord[]} records All records (filtered to one suite + model).
 * @returns {MatchedPairCounts}
 */
export function computeMatchedPairs(records) {
  // Key: "<provider>:<model>|<dataset>|<taskId>"
  const pairMap = new Map();

  for (const r of records) {
    const key = `${r.provider}:${r.model}|${r.dataset}|${r.taskId}`;
    if (!pairMap.has(key)) pairMap.set(key, { json: null, pakt: null });
    pairMap.get(key)[r.format] = r.correct;
  }

  /** @type {MatchedPairCounts} */
  const counts = { bothRight: 0, bothWrong: 0, jsonOnly: 0, paktOnly: 0, total: 0, formatEffect: 0 };

  for (const [, pair] of pairMap) {
    if (pair.json === null || pair.pakt === null) continue; // incomplete pair
    counts.total += 1;
    if (pair.json && pair.pakt) counts.bothRight += 1;
    else if (!pair.json && !pair.pakt) counts.bothWrong += 1;
    else if (pair.json && !pair.pakt) counts.jsonOnly += 1;
    else counts.paktOnly += 1;
  }

  counts.formatEffect = counts.paktOnly - counts.jsonOnly;
  return counts;
}

/**
 * Produces a plain-language verdict from matched-pair counts.
 * @param {MatchedPairCounts} mp
 * @returns {string}
 */
function formatVerdict(mp) {
  const delta = mp.formatEffect;
  const sign = delta > 0 ? '+' : '';
  if (mp.total === 0) return 'No matched pairs found.';

  const discordant = mp.jsonOnly + mp.paktOnly;
  const p = signTestPValue(mp.jsonOnly, mp.paktOnly);
  const pStr = p.toFixed(2);

  if (discordant === 0) {
    return `PAKT is comprehension-neutral vs JSON — formats agreed on all ${mp.total} questions.`;
  }

  // Not enough discordant pairs to reject the null → neutral, with the
  // observed lean reported honestly as a non-significant trend, not a result.
  if (p >= SIGN_TEST_ALPHA) {
    const trend =
      delta === 0
        ? 'no lean'
        : `a non-significant lean toward ${delta > 0 ? 'PAKT' : 'JSON'} (Δ=${sign}${delta})`;
    return (
      `PAKT is comprehension-neutral vs JSON — of ${discordant} divergent question(s), ` +
      `the split (${mp.paktOnly} PAKT / ${mp.jsonOnly} JSON) is ${trend}; ` +
      `sign-test p=${pStr} ≥ ${SIGN_TEST_ALPHA}, so the sample is too small to claim a real difference.`
    );
  }

  const favored = delta > 0 ? 'PAKT' : 'JSON';
  return (
    `Format effect favors ${favored} (Δ=${sign}${delta} over ${discordant} divergent ` +
    `question(s); sign-test p=${pStr} < ${SIGN_TEST_ALPHA}).`
  );
}

/**
 * Renders the matched-pair table section for a set of records.
 * @param {EvalRecord[]} records Subset for one model + one suite.
 * @returns {string[]} Lines to append to the report.
 */
function renderMatchedPairSection(records) {
  const mp = computeMatchedPairs(records);
  const lines = [];
  lines.push('### Matched-pair analysis');
  lines.push('');
  lines.push(
    'Each row in the table below is one QUESTION asked to both formats. ' +
    '`bothWrong` rows are task-difficulty noise and excluded from the format effect.',
  );
  lines.push('');
  lines.push('| Cell | Count | Meaning |');
  lines.push('|---|---|---|');
  lines.push(`| bothRight | ${mp.bothRight} | Both JSON and PAKT correct |`);
  lines.push(`| bothWrong | ${mp.bothWrong} | Both wrong — task difficulty noise |`);
  lines.push(`| jsonOnly  | ${mp.jsonOnly} | JSON correct, PAKT wrong |`);
  lines.push(`| paktOnly  | ${mp.paktOnly} | PAKT correct, JSON wrong |`);
  lines.push(`| **total matched** | **${mp.total}** | |`);
  lines.push('');
  lines.push(`**Format effect (paktOnly − jsonOnly) = ${mp.formatEffect > 0 ? '+' : ''}${mp.formatEffect}**`);
  lines.push('');
  lines.push(`**Verdict:** ${formatVerdict(mp)}`);
  lines.push('');
  return lines;
}

/**
 * Returns true when any record in the run used the CLI provider.
 * @param {EvalRecord[]} records
 * @returns {boolean}
 */
function hasCliRecords(records) {
  return records.some((r) => r.provider === 'cli');
}

/**
 * Returns the set of suite names present in the records.
 * @param {EvalRecord[]} records
 * @returns {Set<string>}
 */
function suiteNames(records) {
  return new Set(records.map((r) => r.suite));
}

/**
 * Renders the markdown report for a run.
 * @param {{startedAt: string, mock: boolean, suiteFlag?: string, records: EvalRecord[], tokenStats: {dataset: string, jsonTokens: number, paktTokens: number, savingsPct: number}[], cost: {inputTokens: number, estUsd: number}}} run
 * @returns {string}
 */
export function renderMarkdown(run) {
  const lines = [];
  lines.push('# PAKT Model-Comprehension Eval — latest run');
  lines.push('');
  lines.push(`- Run started: ${run.startedAt}`);
  lines.push(`- Suite: \`${run.suiteFlag ?? 'comprehension'}\``);
  lines.push(`- Mode: ${run.mock ? '**MOCK (echo model — NOT model evidence; pipeline verification only)**' : 'live API'}`);
  lines.push(`- Records: ${run.records.length}`);
  lines.push('');

  const suites = suiteNames(run.records);

  // Render one section per suite present.
  for (const suite of Array.from(suites)) {
    const suiteRecords = run.records.filter((r) => r.suite === suite);

    if (suites.size > 1) {
      lines.push(`---`);
      lines.push('');
      lines.push(`## Suite: \`${suite}\``);
      lines.push('');
      if (suite === 'comprehension') {
        lines.push(
          '> **Comprehension suite** — small payloads (6–8 rows), retrieval-light questions.' +
          ' Isolates format-reading ability. The matched-pair table below is the honest signal.',
        );
      } else {
        lines.push(
          '> **Stress suite** — 50/80-row payloads with cross-row reasoning and aggregation.' +
          ' Results here are format-confounded by retrieval difficulty; use the comprehension suite' +
          ' for the clean format-effect signal.',
        );
      }
      lines.push('');
    }

    for (const [modelKey, rows] of aggregate(suiteRecords)) {
      const modelName = modelKey.split(':').slice(1).join(':');
      const cli = isCliModel(modelName);

      lines.push(`### Model: \`${modelKey}\``);
      if (cli) {
        lines.push('');
        lines.push(
          '> **CLI mode** — accuracy here reflects the full Claude Code / Codex agent harness' +
          ' around the model, not a bare API endpoint.',
        );
      }
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

      // Matched-pair table — shown for every suite, but especially meaningful
      // for the comprehension suite.
      const modelRecords = suiteRecords.filter(
        (r) => `${r.provider}:${r.model}` === modelKey,
      );
      lines.push(...renderMatchedPairSection(modelRecords));
    }
  }

  // Token savings (always local, format-agnostic).
  lines.push('---');
  lines.push('');
  lines.push('## Payload token counts (local tokenizer estimate)');
  lines.push('');
  lines.push('| Dataset | JSON (minified) | PAKT | Savings |');
  lines.push('|---|---|---|---|');
  for (const t of run.tokenStats) {
    lines.push(`| ${t.dataset} | ${t.jsonTokens} | ${t.paktTokens} | ${t.savingsPct.toFixed(1)}% |`);
  }
  lines.push('');
  lines.push(
    `## Estimated cost per full live run ` +
    `(Fable 5: $${PRICING.inputPerMTok}/MTok in, $${PRICING.outputPerMTok}/MTok out)`,
  );
  lines.push('');
  lines.push(`- Estimated input tokens: ~${run.cost.inputTokens.toLocaleString('en-US')}`);
  lines.push(`- Estimated cost: ~$${run.cost.estUsd.toFixed(2)} per model`);
  lines.push('');

  // CLI methodology note.
  if (hasCliRecords(run.records)) {
    lines.push('---');
    lines.push('');
    lines.push('### CLI-mode methodology note');
    lines.push('');
    lines.push(
      'Accuracy numbers for CLI providers (`claude` / `codex`) reflect the **agent harness**' +
      ' around the model — system prompts, tool definitions, and any automatic context the CLI' +
      ' injects. This differs from raw-API accuracy, where the model receives only the eval prompt.',
    );
    lines.push('');
    lines.push(
      '**Token savings** in this report come from the harness\'s LOCAL `compress()` call.' +
      ' CLI-reported token usage is intentionally ignored: each `claude -p` call carries ~25K' +
      ' tokens of Claude Code system-prompt overhead unrelated to the PAKT payload.',
    );
    lines.push('');
  }

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

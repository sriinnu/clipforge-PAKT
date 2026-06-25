#!/usr/bin/env node
/**
 * PAKT model-comprehension eval runner.
 *
 * For each (dataset × format × model × task) it sends the payload — rendered
 * as (a) minified JSON and (b) PAKT compressed text (standard profile) — plus
 * a question, then scores the answer against ground truth computed from the
 * committed datasets.
 *
 * Usage:
 *   node scripts/eval/run.mjs [--mock] [--suite comprehension|stress|all]
 *                             [--model claude-fable-5]
 *                             [--openai-model gpt-4o-mini] [--dataset users]
 *                             [--max-tasks N]
 *                             [--profiles structure,standard,tokenizer,semantic]
 *                             [--frontier] [--semantic-budget N]
 *                             [--provider cli --cli claude [--model <alias>]]
 *                             [--provider cli --cli codex  [--model <alias>]]
 *
 * Layer-profile sweep:
 *   --profiles a,b,c  Render the payload under each PAKT layer profile and emit
 *                     a Pareto frontier (savings% vs comprehension accuracy),
 *                     each profile matched-paired against the shared JSON
 *                     baseline. Default: standard (single profile, as before).
 *   --frontier        Shorthand for the full sweep
 *                     (structure, standard, tokenizer, semantic).
 *   --semantic-budget Positive token budget for the lossy semantic profile
 *                     (default 200; only used when 'semantic' is swept).
 *
 * Env: ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENAI_BASE_URL.
 * KEY-GATED: with no keys, no --mock, and no --provider cli, prints a notice
 * and exits 0.
 * It never fabricates results.
 *
 * CLI mode (--provider cli):
 *   Uses the user's local Claude Code or Codex subscription — no API key
 *   needed. Token savings in the report are always from the LOCAL compress()
 *   call (harness-side), not from CLI-reported usage, because each `claude -p`
 *   call carries ~25K tokens of CLI system-prompt overhead unrelated to PAKT.
 *
 * Suite flag:
 *   --suite comprehension  (default) Small payloads, retrieval-light questions.
 *                          Isolates format-reading ability. Matched-pair analysis
 *                          shows whether PAKT format affects comprehension.
 *   --suite stress         Original 50/80-row datasets with reasoning/aggregation.
 *                          Format-confounded by retrieval difficulty.
 *   --suite all            Runs both suites back-to-back.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anthropicProvider, cliProvider, mockProvider, openAiProvider } from './providers.mjs';
import { estimateRunCost, writeReport } from './report.mjs';
import { buildComprehensionSuites, buildSuites, scoreAnswer } from './tasks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(HERE, 'results');
const PAKT_DIST = join(HERE, '..', '..', 'packages', 'pakt-core', 'dist', 'index.js');

/**
 * Parses CLI flags of the form --name value / --name.
 * @param {string[]} argv
 * @returns {Record<string, string|boolean>}
 */
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else args[key] = true;
  }
  return args;
}

/** Loads the built PAKT library, with a clear error if dist is missing. */
async function loadPakt() {
  try {
    return await import(PAKT_DIST);
  } catch (err) {
    console.error(`Cannot load PAKT from ${PAKT_DIST}`);
    console.error('Build it first: pnpm --filter @sriinnu/pakt build');
    throw err;
  }
}

/**
 * Builds the eval prompt. Identical for both formats except the payload —
 * the model gets no hint about PAKT, which is the honest drop-in test.
 * @param {string} payload
 * @param {string} question
 * @returns {string}
 */
function buildPrompt(payload, question) {
  return [
    'Answer based only on the data below. Reply with the answer value only —',
    'no explanation, no extra words, no units unless the question asks for them.',
    '',
    '<data>',
    payload,
    '</data>',
    '',
    `Question: ${question}`,
  ].join('\n');
}

/**
 * Resolves which suite-builder functions to use for a given flag value.
 * Returns a list of {suiteName, builder, datasetFilter} objects.
 *
 * @param {"comprehension"|"stress"|"all"} suiteFlag
 * @param {string[]|undefined} datasetFilter
 * @returns {{suiteName: string, builder: (keys?: string[]) => any[], datasetFilter: string[]|undefined}[]}
 */
function resolveSuites(suiteFlag, datasetFilter) {
  const comprehension = {
    suiteName: 'comprehension',
    builder: buildComprehensionSuites,
    datasetFilter: datasetFilter
      ? datasetFilter.map((k) => (k.startsWith('small-') ? k : `small-${k}`))
      : undefined,
  };
  const stress = {
    suiteName: 'stress',
    builder: buildSuites,
    datasetFilter: datasetFilter ? datasetFilter.filter((k) => !k.startsWith('small-')) : undefined,
  };
  if (suiteFlag === 'stress') return [stress];
  if (suiteFlag === 'all') return [comprehension, stress];
  return [comprehension]; // default
}

/** Entry point. */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mock = args.mock === true;
  const providerFlag = typeof args.provider === 'string' ? args.provider : null;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;
  const suiteFlag = typeof args.suite === 'string' ? args.suite : 'comprehension';

  if (!['comprehension', 'stress', 'all'].includes(suiteFlag)) {
    console.error(`--suite must be comprehension, stress, or all. Got: ${suiteFlag}`);
    process.exit(1);
  }

  /** @type {ReturnType<typeof mockProvider>[]} */
  const providers = [];

  if (mock) {
    providers.push(mockProvider());
  } else if (providerFlag === 'cli') {
    // ── CLI mode: no API key required ──────────────────────────────────────
    const cliName = typeof args.cli === 'string' ? args.cli : 'claude';
    if (cliName !== 'claude' && cliName !== 'codex') {
      console.error(`--cli must be 'claude' or 'codex', got: ${cliName}`);
      process.exit(1);
    }
    const model = typeof args.model === 'string' ? args.model : undefined;
    console.log(
      `[cli] Using ${cliName} CLI${model ? ` (model: ${model})` : ' (default model)'}` +
        ` — no API key required, auth via local ${cliName === 'claude' ? 'Claude Code' : 'Codex'} subscription.`,
    );
    if (cliName === 'codex') {
      console.log(
        '[cli] NOTE: codex provider is UNTESTED in this environment — ' +
          'output parsing is defensive but unverified. See providers.mjs for details.',
      );
    }
    providers.push(cliProvider({ cli: cliName, model }));
  } else {
    // ── API mode: key-gated ────────────────────────────────────────────────
    if (providerFlag && providerFlag !== 'anthropic' && providerFlag !== 'openai') {
      console.error(
        `Unknown --provider: ${providerFlag}. Use anthropic, openai, cli, or omit for auto-detect.`,
      );
      process.exit(1);
    }
    if (!providerFlag || providerFlag === 'anthropic') {
      if (anthropicKey) {
        providers.push(
          anthropicProvider({
            model: String(args.model ?? 'claude-fable-5'),
            apiKey: anthropicKey,
          }),
        );
      }
    }
    if (!providerFlag || providerFlag === 'openai') {
      if (openAiKey && args['openai-model']) {
        providers.push(
          openAiProvider({
            model: String(args['openai-model']),
            apiKey: openAiKey,
            baseUrl:
              process.env.OPENAI_BASE_URL ||
              (typeof args['openai-base-url'] === 'string' ? args['openai-base-url'] : undefined),
          }),
        );
      }
    }
  }

  if (providers.length === 0) {
    console.log('No API keys found (ANTHROPIC_API_KEY / OPENAI_API_KEY) and --mock not set.');
    console.log(
      'Nothing was run and no results were written — this harness never fabricates results.',
    );
    console.log(
      'Set a key for a live run, use `--provider cli --cli claude` for a subscription-based run,',
    );
    console.log('or use `node scripts/eval/run.mjs --mock` to verify the pipeline.');
    process.exit(0);
  }

  const pakt = await loadPakt();

  // Layer-profile sweep. Default to a single 'standard' profile (back-compat
  // with the original single-profile run). Pass `--profiles a,b,c` to sweep
  // multiple profiles and emit a Pareto frontier (savings% vs comprehension
  // accuracy) in the report. `--frontier` is shorthand for the full sweep.
  const KNOWN_PROFILES = ['structure', 'standard', 'tokenizer', 'semantic'];
  const profiles =
    args.frontier === true
      ? ['structure', 'standard', 'tokenizer', 'semantic']
      : typeof args.profiles === 'string'
        ? args.profiles
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean)
        : ['standard'];
  for (const p of profiles) {
    if (!KNOWN_PROFILES.includes(p)) {
      console.error(`Unknown --profiles entry "${p}". Known: ${KNOWN_PROFILES.join(', ')}`);
      process.exit(1);
    }
  }
  const semanticBudget = args['semantic-budget'] ? Number(args['semantic-budget']) : 200;
  const profileOptions = new Map(
    profiles.map((p) => [
      p,
      pakt.createProfiledPaktOptions(p, p === 'semantic' ? { semanticBudget } : {}),
    ]),
  );

  const datasetFilter = typeof args.dataset === 'string' ? args.dataset.split(',') : undefined;
  const maxTasks = args['max-tasks'] ? Number(args['max-tasks']) : Number.POSITIVE_INFINITY;

  // Resolve which suites to run.
  const suiteConfigs = resolveSuites(suiteFlag, datasetFilter);

  // Build all suites upfront.
  const allSuiteRuns = [];
  for (const cfg of suiteConfigs) {
    const suites = cfg.datasetFilter ? cfg.builder(cfg.datasetFilter) : cfg.builder();
    allSuiteRuns.push({ suiteName: cfg.suiteName, suites });
  }

  // Render payloads once per (dataset × profile) and collect token stats.
  // `payloads.get(key)` is `{ json: string, pakt: Map<profile, string> }`.
  const payloads = new Map();
  const tokenStats = [];
  for (const { suites } of allSuiteRuns) {
    for (const suite of suites) {
      if (payloads.has(suite.key)) continue; // avoid double-rendering shared keys
      const minified = JSON.stringify(suite.data);
      const paktByProfile = new Map();
      for (const p of profiles) {
        const result = pakt.compress(minified, profileOptions.get(p));
        paktByProfile.set(p, result.compressed);
        tokenStats.push({
          dataset: suite.key,
          profile: p,
          jsonTokens: result.originalTokens,
          paktTokens: result.compressedTokens,
          savingsPct: 100 * (1 - result.compressedTokens / result.originalTokens),
        });
      }
      payloads.set(suite.key, { json: minified, pakt: paktByProfile });
    }
  }

  const startedAt = new Date().toISOString();
  const records = [];
  let index = 0;

  for (const provider of providers) {
    console.log(`\n=== ${provider.name}:${provider.model} ===`);
    for (const { suiteName, suites } of allSuiteRuns) {
      console.log(`\n--- Suite: ${suiteName} ---`);
      for (const suite of suites) {
        const tasks = suite.tasks.slice(0, maxTasks);
        // Each "pass" is a (format, profile) rendering of the payload. The JSON
        // baseline is rendered once; every layer profile is paired against it.
        const passes = [
          { format: 'json', profile: 'json', payload: payloads.get(suite.key).json },
          ...profiles.map((p) => ({
            format: 'pakt',
            profile: p,
            payload: payloads.get(suite.key).pakt.get(p),
          })),
        ];
        for (const { format, profile, payload } of passes) {
          for (const task of tasks) {
            const prompt = buildPrompt(payload, task.question);
            let raw = '';
            let usage = { input: 0, output: 0 };
            try {
              const res = await provider.ask(prompt, { task, index, format, profile });
              raw = res.text;
              usage = res.usage;
            } catch (err) {
              console.error(`  ${task.id} [${format}:${profile}] FAILED: ${err.message}`);
            }
            const { correct, got } = scoreAnswer(task, raw);
            records.push({
              suite: suiteName,
              provider: provider.name,
              model: provider.model,
              dataset: suite.key,
              category: task.category,
              taskId: task.id,
              format,
              profile,
              question: task.question,
              expected: task.expected,
              got,
              raw,
              correct,
              usage,
            });
            console.log(
              `  ${task.id} [${format}:${profile}] ${correct ? 'PASS' : 'FAIL'} (expected: ${task.expected}, got: ${got || '<empty>'})`,
            );
            index++;
            // Pace: skip for mock (instant); use longer delay for CLI calls (slow).
            if (!mock) {
              const delay = providerFlag === 'cli' ? 1000 : 300;
              await new Promise((r) => setTimeout(r, delay));
            }
          }
        }
      }
    }
  }

  // Total task count across all suites for cost estimate.
  const taskCount = allSuiteRuns.reduce(
    (s, { suites }) =>
      s + suites.reduce((ss, suite) => ss + Math.min(suite.tasks.length, maxTasks), 0),
    0,
  );
  // Cost estimate is per-model for a single profile pass; use the first
  // profile's per-dataset token counts so payloadTokens.length matches the
  // dataset count the taskCount is divided across.
  const firstProfile = profiles[0];
  const cost = estimateRunCost(
    tokenStats
      .filter((t) => t.profile === firstProfile)
      .map((t) => ({ json: t.jsonTokens, pakt: t.paktTokens })),
    taskCount,
  );
  const run = { startedAt, mock, suiteFlag, profiles, records, tokenStats, cost };
  const { jsonPath, mdPath } = writeReport(run, RESULTS_DIR);

  const ok = records.filter((r) => r.correct).length;
  console.log(`\nDone: ${ok}/${records.length} correct.`);
  console.log(`Results: ${jsonPath}`);
  console.log(`Report:  ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

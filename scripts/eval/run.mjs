#!/usr/bin/env node
/**
 * PAKT model-comprehension eval runner.
 *
 * For each (dataset x format x model x task) it sends the payload — rendered
 * as (a) minified JSON and (b) PAKT compressed text (standard profile) — plus
 * a question, then scores the answer against ground truth computed from the
 * committed datasets.
 *
 * Usage:
 *   node scripts/eval/run.mjs [--mock] [--model claude-fable-5]
 *                             [--openai-model gpt-4o-mini] [--dataset users]
 *                             [--max-tasks N]
 *
 * Env: ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENAI_BASE_URL.
 * KEY-GATED: with no keys and no --mock, prints a notice and exits 0.
 * It never fabricates results.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSuites, scoreAnswer } from './tasks.mjs';
import { anthropicProvider, openAiProvider, mockProvider } from './providers.mjs';
import { writeReport, estimateRunCost } from './report.mjs';

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
    if (next && !next.startsWith('--')) { args[key] = next; i++; } else args[key] = true;
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

/** Entry point. */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mock = args.mock === true;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;

  /** @type {ReturnType<typeof mockProvider>[]} */
  const providers = [];
  if (mock) {
    providers.push(mockProvider());
  } else {
    if (anthropicKey) {
      providers.push(anthropicProvider({ model: String(args.model ?? 'claude-fable-5'), apiKey: anthropicKey }));
    }
    if (openAiKey && args['openai-model']) {
      providers.push(openAiProvider({
        model: String(args['openai-model']),
        apiKey: openAiKey,
        baseUrl: process.env.OPENAI_BASE_URL || (typeof args['openai-base-url'] === 'string' ? args['openai-base-url'] : undefined),
      }));
    }
  }
  if (providers.length === 0) {
    console.log('No API keys found (ANTHROPIC_API_KEY / OPENAI_API_KEY) and --mock not set.');
    console.log('Nothing was run and no results were written — this harness never fabricates results.');
    console.log('Set a key for a live run, or use `node scripts/eval/run.mjs --mock` to verify the pipeline.');
    process.exit(0);
  }

  const pakt = await loadPakt();
  const paktOptions = pakt.createProfiledPaktOptions('standard');
  const datasetFilter = typeof args.dataset === 'string' ? args.dataset.split(',') : undefined;
  const maxTasks = args['max-tasks'] ? Number(args['max-tasks']) : Infinity;
  const suites = buildSuites(datasetFilter);

  // Render payloads once per dataset and collect token stats.
  const payloads = new Map();
  const tokenStats = [];
  for (const suite of suites) {
    const minified = JSON.stringify(suite.data);
    const result = pakt.compress(minified, paktOptions);
    payloads.set(suite.key, { json: minified, pakt: result.compressed });
    tokenStats.push({
      dataset: suite.key,
      jsonTokens: result.originalTokens,
      paktTokens: result.compressedTokens,
      savingsPct: 100 * (1 - result.compressedTokens / result.originalTokens),
    });
  }

  const startedAt = new Date().toISOString();
  const records = [];
  let index = 0;
  for (const provider of providers) {
    console.log(`\n=== ${provider.name}:${provider.model} ===`);
    for (const suite of suites) {
      const tasks = suite.tasks.slice(0, maxTasks);
      for (const format of ['json', 'pakt']) {
        for (const task of tasks) {
          const prompt = buildPrompt(payloads.get(suite.key)[format], task.question);
          let raw = '';
          let usage = { input: 0, output: 0 };
          try {
            const res = await provider.ask(prompt, { task, index });
            raw = res.text;
            usage = res.usage;
          } catch (err) {
            console.error(`  ${task.id} [${format}] FAILED: ${err.message}`);
          }
          const { correct, got } = scoreAnswer(task, raw);
          records.push({
            provider: provider.name, model: provider.model,
            dataset: suite.key, category: task.category, taskId: task.id,
            format, question: task.question, expected: task.expected,
            got, raw, correct, usage,
          });
          console.log(`  ${task.id} [${format}] ${correct ? 'PASS' : 'FAIL'} (expected: ${task.expected}, got: ${got || '<empty>'})`);
          index++;
          if (!mock) await new Promise((r) => setTimeout(r, 300)); // gentle pacing for live APIs
        }
      }
    }
  }

  const taskCount = suites.reduce((s, x) => s + Math.min(x.tasks.length, maxTasks), 0);
  const cost = estimateRunCost(
    tokenStats.map((t) => ({ json: t.jsonTokens, pakt: t.paktTokens })),
    taskCount,
  );
  const run = { startedAt, mock, records, tokenStats, cost };
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

/**
 * Model providers for the PAKT comprehension eval.
 *
 * All providers expose the same shape:
 *   { name, model, ask(prompt, ctx) -> Promise<{text, usage: {input, output}}> }
 *
 * Anthropic and OpenAI-compatible endpoints are called via raw fetch (no SDK
 * dependency in this monorepo). The mock provider never touches the network.
 * The CLI provider spawns a subprocess (claude / codex) — no API key required,
 * uses the user's local subscription auth instead.
 *
 * IMPORTANT — CLI token numbers are NOT usable for PAKT savings analysis:
 *   Each `claude -p` call carries ~25K tokens of Claude Code system-prompt +
 *   tool-description overhead (confirmed: a 6-word prompt showed
 *   cache_creation_input_tokens=24858). Token savings in the report always come
 *   from the harness's LOCAL compress() counts, never from CLI-reported usage.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const MAX_TOKENS = 1024;
const RETRIES = 3;

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch with retry on 429/5xx/overload, exponential backoff.
 * @param {string} url
 * @param {RequestInit} init
 * @returns {Promise<any>} Parsed JSON body.
 */
async function fetchJson(url, init) {
  let lastErr;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res.json();
    const body = await res.text();
    lastErr = new Error(`HTTP ${res.status} from ${url}: ${body.slice(0, 300)}`);
    if (![429, 500, 529, 502, 503].includes(res.status)) throw lastErr;
    await sleep(1000 * 2 ** attempt);
  }
  throw lastErr;
}

/**
 * Creates an Anthropic Messages API provider (raw fetch, anthropic-version
 * 2023-06-01). Fable 5 family: no sampling params, no thinking param.
 * @param {{model: string, apiKey: string}} opts
 * @returns {{name: string, model: string, ask: (prompt: string) => Promise<{text: string, usage: {input: number, output: number}}>}}
 */
export function anthropicProvider({ model, apiKey }) {
  return {
    name: 'anthropic',
    model,
    async ask(prompt) {
      const data = await fetchJson('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const text = (data.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return {
        text,
        usage: { input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 },
      };
    },
  };
}

/**
 * Creates an OpenAI-compatible chat-completions provider (raw fetch). Works
 * with api.openai.com or any compatible endpoint via OPENAI_BASE_URL.
 * @param {{model: string, apiKey: string, baseUrl?: string}} opts
 * @returns {{name: string, model: string, ask: (prompt: string) => Promise<{text: string, usage: {input: number, output: number}}>}}
 */
export function openAiProvider({ model, apiKey, baseUrl = 'https://api.openai.com/v1' }) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  return {
    name: 'openai',
    model,
    async ask(prompt) {
      const data = await fetchJson(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      return {
        text: data.choices?.[0]?.message?.content ?? '',
        usage: {
          input: data.usage?.prompt_tokens ?? 0,
          output: data.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}

/**
 * Task ids the mock provider answers WRONG on purpose, proving the scorer can
 * fail a mismatch (mock runs should report exactly these as incorrect).
 */
export const MOCK_WRONG_IDS = new Set(['users-03']);

/**
 * Mock echo provider: returns the ground-truth answer with cosmetic noise
 * (casing, trailing period, quoting) to exercise normalization — except for
 * MOCK_WRONG_IDS, where it returns a deliberately wrong answer. Network-free;
 * proves pipeline mechanics and scoring without spending tokens.
 * @returns {{name: string, model: string, ask: (prompt: string, ctx: {task: import('./tasks.mjs').EvalTask, index: number}) => Promise<{text: string, usage: {input: number, output: number}}>}}
 */
export function mockProvider() {
  return {
    name: 'mock',
    model: 'mock-echo',
    async ask(_prompt, ctx) {
      const { task, index } = ctx;
      let text;
      if (MOCK_WRONG_IDS.has(task.id)) {
        text = 'deliberately-wrong-answer';
      } else {
        const base = String(task.expected);
        const variant = index % 3;
        text = variant === 0 ? `${base.toUpperCase()}.` : variant === 1 ? `"${base}"` : `  ${base}  `;
      }
      return { text, usage: { input: 0, output: 0 } };
    },
  };
}

// ─── CLI provider ────────────────────────────────────────────────────────────

/**
 * Per-call subprocess timeout in milliseconds. CLI calls are slow — each
 * `claude -p` spawn includes JVM/node startup + full inference.
 */
const CLI_TIMEOUT_MS = 180_000;

/**
 * Retry budget for transient CLI failures (spawn error, non-zero exit, parse
 * error). Hard failures after retries return a sentinel that scores as wrong
 * but does NOT crash the run.
 */
const CLI_RETRIES = 2;

/**
 * Sentinel value returned when the CLI provider cannot recover. The scorer
 * normalizes this to an empty string, which mismatches every ground truth.
 */
const CLI_FAILURE_SENTINEL = '__CLI_FAILURE__';

// ── claude helpers ────────────────────────────────────────────────────────────

/**
 * Parses the stdout of `claude -p ... --output-format json`.
 *
 * Verified shape (grounded fact — do not guess):
 *   { result: string, is_error: boolean, modelUsage: { ... } }
 *
 * `.result` holds the assistant text when `is_error` is false.
 * Throws if the JSON can't be parsed or `.is_error` is true.
 *
 * @param {string} stdout Raw stdout from the claude subprocess.
 * @returns {string} The assistant answer.
 */
function parseClaudeOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error('claude CLI produced empty stdout');
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`claude CLI output is not valid JSON: ${trimmed.slice(0, 200)}`);
  }
  if (parsed.is_error) {
    throw new Error(`claude CLI reported is_error=true: ${JSON.stringify(parsed).slice(0, 300)}`);
  }
  if (typeof parsed.result !== 'string') {
    throw new Error(`claude CLI output missing .result string: ${JSON.stringify(parsed).slice(0, 300)}`);
  }
  return parsed.result;
}

// ── codex helpers ─────────────────────────────────────────────────────────────

/**
 * Parses the stdout of `codex exec "<PROMPT>"`.
 *
 * UNTESTED IN THIS ENVIRONMENT — codex was found at PATH but interactive auth
 * was not confirmed at build time. The parsing strategy is defensive:
 *
 *   1. Try JSON.parse on the full output (in case codex has a --json mode or
 *      auto-emits structured output).
 *   2. Otherwise treat as plain text: strip any known "[codex]" / "Assistant:"
 *      prefixes, take the last non-empty line (avoids progress spinners printed
 *      on earlier lines).
 *
 * If the result is empty, throws so the retry loop can handle it.
 * Callers should pass `--output-format json` or equivalent if codex adds it in
 * a future version — update this parser accordingly.
 *
 * @param {string} stdout Raw stdout from the codex subprocess.
 * @returns {string} Best-effort extracted answer.
 */
function parseCodexOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error('codex CLI produced empty stdout');

  // Attempt 1: structured JSON (defensive future-proofing).
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      // Common fields codex might use — update if official schema differs.
      const text = parsed.result ?? parsed.output ?? parsed.content ?? parsed.text;
      if (typeof text === 'string' && text.trim()) return text.trim();
    } catch { /* fall through to plain-text path */ }
  }

  // Attempt 2: plain text — strip known prefixes, take last non-empty line.
  const lines = trimmed
    .split('\n')
    .map((l) => l.replace(/^\[codex\]\s*/i, '').replace(/^assistant:\s*/i, '').trim())
    .filter(Boolean);
  const answer = lines[lines.length - 1] ?? '';
  if (!answer) throw new Error('codex CLI: no extractable answer in output');
  return answer;
}

// ── factory ───────────────────────────────────────────────────────────────────

/**
 * Creates a CLI-driven provider that spawns `claude` or `codex` per question.
 *
 * No API key required — uses the user's local subscription auth (Claude Code
 * login / Codex auth). This makes it cost-free for subscribers on a per-token
 * billing basis (though `claude` reports a `total_cost_usd` field denominated
 * as API-equivalent — subscription users are NOT charged per token; ignore it).
 *
 * TOKEN SAVINGS NOTE: CLI usage token counts are intentionally NOT surfaced in
 * the report. Each `claude -p` call carries ~25K tokens of Claude Code system-
 * prompt overhead that has nothing to do with the PAKT payload. Token savings
 * are always derived from the harness's LOCAL compress() call, independent of
 * which provider answers the comprehension questions.
 *
 * @param {{ cli: 'claude'|'codex', model?: string }} opts
 *   `cli`   — which CLI binary to spawn ('claude' or 'codex').
 *   `model` — model alias passed to the CLI (e.g. 'claude-sonnet-4-5').
 *             Ignored silently if the CLI doesn't support --model.
 * @returns {{
 *   name: string,
 *   model: string,
 *   ask: (prompt: string, ctx: {task: import('./tasks.mjs').EvalTask, index: number}) => Promise<{text: string, usage: {input: number, output: number}}>
 * }}
 */
export function cliProvider({ cli, model }) {
  if (cli !== 'claude' && cli !== 'codex') {
    throw new Error(`cliProvider: cli must be 'claude' or 'codex', got: ${cli}`);
  }

  // Display model — shown in report headers and the model column.
  const displayModel = model
    ? `${model} (via ${cli === 'claude' ? 'Claude Code CLI' : 'Codex CLI'})`
    : `(default) (via ${cli === 'claude' ? 'Claude Code CLI' : 'Codex CLI'})`;

  return {
    name: 'cli',
    model: displayModel,

    /**
     * Asks one question via the CLI subprocess.
     * Retries once on transient failure; returns sentinel on hard failure.
     * @param {string} prompt
     * @returns {Promise<{text: string, usage: {input: number, output: number}}>}
     */
    async ask(prompt) {
      let lastErr;

      for (let attempt = 0; attempt < CLI_RETRIES; attempt++) {
        try {
          const { stdout } = await spawnCli(cli, model, prompt);
          const text = cli === 'claude' ? parseClaudeOutput(stdout) : parseCodexOutput(stdout);
          // Usage is zeroed: CLI token counts include massive system-prompt
          // overhead (~25K for claude) that is irrelevant to PAKT savings.
          // Savings come from the harness's LOCAL compress() counts instead.
          return { text, usage: { input: 0, output: 0 } };
        } catch (err) {
          lastErr = err;
          if (attempt < CLI_RETRIES - 1) {
            // Brief back-off before retry.
            await sleep(2000 * (attempt + 1));
          }
        }
      }

      // Hard failure — return sentinel so the run continues without crashing.
      console.error(`  [cli/${cli}] Hard failure after ${CLI_RETRIES} attempts: ${lastErr.message}`);
      return { text: CLI_FAILURE_SENTINEL, usage: { input: 0, output: 0 } };
    },
  };
}

/**
 * Spawns the CLI binary and returns stdout.
 * Uses execFile (NOT shell: true) — prompt is passed as an arg array element,
 * never interpolated into a shell string. This prevents shell injection.
 *
 * claude:  `claude -p "<prompt>" --output-format json [--model <model>]`
 * codex:   `codex exec "<prompt>" [--model <model>]`
 *   NOTE: codex --model flag existence is assumed from docs; mark untested.
 *
 * @param {'claude'|'codex'} cli
 * @param {string|undefined} model
 * @param {string} prompt
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
async function spawnCli(cli, model, prompt) {
  let bin, args;

  if (cli === 'claude') {
    bin = 'claude';
    // Verified args (grounded): -p <prompt> --output-format json [--model <id>]
    args = ['-p', prompt, '--output-format', 'json'];
    if (model) args.push('--model', model);
  } else {
    // codex — UNTESTED in this environment. Flag shape assumed from docs.
    // If codex adds a --output-format json flag in a future release, add it here.
    bin = 'codex';
    args = ['exec', prompt];
    if (model) args.push('--model', model); // assumed flag — verify with `codex exec --help`
  }

  return execFileAsync(bin, args, {
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024, // 10 MB — generous for verbose CLI output
    // Do NOT pass `shell: true` — prompt is user-controlled content; must be
    // passed as a direct arg to prevent any shell injection risk.
  });
}

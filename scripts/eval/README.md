# PAKT Model-Comprehension Eval

Answers the adoption-critical question for PAKT: **do LLMs read PAKT-compressed
payloads as accurately as the original JSON?** The harness runs the same
questions against the same data rendered two ways — minified JSON vs PAKT
(`compress()`, standard profile) — and compares accuracy and token counts.

It either produces real, reviewable evidence or nothing at all. It never
fabricates results.

> **Honesty note: No results are published in the repo README until a real run
> is executed and reviewed.** Anything in `results/` produced with `--mock` is
> pipeline verification, not model evidence — `latest.md` labels mock runs
> explicitly.

## How to run

```sh
# From the repo root (requires pakt-core built: pnpm --filter @sriinnu/pakt build)

# 1. Dry run — no keys, exits 0 with a notice, writes nothing:
node scripts/eval/run.mjs

# 2. Mock run — network-free echo model, proves pipeline + scoring end-to-end:
node scripts/eval/run.mjs --mock

# 3. Live run — Anthropic (default model claude-fable-5):
ANTHROPIC_API_KEY=sk-ant-... node scripts/eval/run.mjs
ANTHROPIC_API_KEY=sk-ant-... node scripts/eval/run.mjs --model claude-haiku-4-5

# 4. Live run — any OpenAI-compatible endpoint (runs alongside Anthropic if both keys set):
OPENAI_API_KEY=... node scripts/eval/run.mjs --openai-model gpt-4o-mini
OPENAI_API_KEY=... OPENAI_BASE_URL=https://my-gateway/v1 node scripts/eval/run.mjs --openai-model my-model
```

Note: the harness is plain ESM `.mjs` with strict JSDoc types (this monorepo
does not ship `tsx`, so there is no `run.ts` variant — `node scripts/eval/run.mjs`
is the single entry point).

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--mock` | off | Use the network-free echo model (see below) |
| `--model` | `claude-fable-5` | Anthropic model id |
| `--openai-model` | — | Model for the OpenAI-compatible endpoint (required to enable it) |
| `--openai-base-url` | `https://api.openai.com/v1` | Override endpoint (or `OPENAI_BASE_URL`) |
| `--dataset` | all | Comma-separated subset: `users,config,logs` |
| `--max-tasks` | all | Cap tasks per dataset (cheap smoke runs) |

### Env vars

- `ANTHROPIC_API_KEY` — enables the Anthropic provider (raw `fetch` to
  `/v1/messages`, `anthropic-version: 2023-06-01`, `max_tokens: 1024`).
- `OPENAI_API_KEY` / `OPENAI_BASE_URL` — enables any OpenAI-compatible
  `/chat/completions` endpoint.
- **Key-gated:** with no keys and no `--mock`, the runner prints a notice and
  exits 0.

## What gets measured

- **Datasets** (`datasets/`, fixed and committed — generated once by
  `datasets/generate.mjs` with a seeded PRNG, never regenerated at runtime;
  synthetic data, no real PII):
  - `tabular-users.json` — 50 user records, 8 mixed-type columns
  - `nested-config.json` — ~160-line nested service config
  - `logs.json` — 80 structured log entries with repeated keys/values
- **Tasks** (`tasks.mjs`) — 11 per dataset across extraction, QA/reasoning,
  and aggregation. Ground truths are computed from the data at load time, so
  they cannot drift.
- **Scoring** — exact match after normalization (trim, case, quotes, trailing
  punctuation); numeric answers parsed with 0.05 absolute tolerance; a narrow
  containment fallback accepts terse-but-wrapped answers ("the billing
  service") while rejecting long sentences.
- **Output** — `results/<timestamp>.json` (full records) and
  `results/latest.md` (per-model accuracy table by dataset x category, JSON vs
  PAKT columns, payload token counts, cost estimate).

## Mock mode

`--mock` uses an echo model that returns the ground-truth answer with cosmetic
noise (casing, quotes, padding) to exercise normalization — **except**
`users-03`, where it deliberately answers wrong. A correct mock run therefore
scores exactly 64/66, proving both that the pipeline wires payload → prompt →
answer → score, and that the scorer actually fails mismatches.

## Cost estimate per full live run

Measured payload tokens (PAKT's local tokenizer estimate):

| Dataset | JSON (minified) | PAKT | Savings |
|---|---|---|---|
| users | 2,491 | 1,765 | 29.1% |
| config | 592 | 740 | **-25.0%** (small nested configs can expand) |
| logs | 3,842 | 1,800 | 53.1% |

One full run = 33 tasks x 2 formats = 66 requests, each carrying its dataset
payload (~129K input tokens total) plus short answers (~4K output tokens).

At Claude Fable 5 pricing ($10/MTok input, $50/MTok output):
**~$1.40 per model per full run** (~$1.29 input + ~$0.10 output). Cheaper
models (e.g. Haiku 4.5 at $1/$5) come to ~$0.14. The runner recomputes this
estimate from actual token counts on every run and writes it to `latest.md`.

## Files

| File | Purpose |
|---|---|
| `run.mjs` | Entry point: key-gating, payload rendering (JSON + PAKT), orchestration |
| `tasks.mjs` | Task definitions, ground-truth computation, normalization + scoring |
| `providers.mjs` | Anthropic + OpenAI-compatible raw-fetch providers, mock echo model |
| `report.mjs` | Writes `results/<timestamp>.json` + `results/latest.md` |
| `datasets/generate.mjs` | One-off seeded generator (provenance only; not used at runtime) |

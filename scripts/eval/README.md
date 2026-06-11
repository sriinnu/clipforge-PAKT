# PAKT Model-Comprehension Eval

Answers the adoption-critical question for PAKT: **do LLMs read PAKT-compressed
payloads as accurately as the original JSON?** The harness runs the same
questions against the same data rendered two ways — minified JSON vs PAKT
(`compress()`, standard profile) — and compares accuracy using a **matched-pair
design** that isolates format-reading ability from retrieval/arithmetic noise.

It either produces real, reviewable evidence or nothing at all. It never
fabricates results.

> **Honesty note: No results are published in the repo README until a real run
> is executed and reviewed.** Anything in `results/` produced with `--mock` is
> pipeline verification, not model evidence — `latest.md` labels mock runs
> explicitly.

## Suites

### Comprehension suite (default)

Small payloads (6–8 rows fully visible in-context), retrieval-light questions
keyed by UNIQUE attributes. This is the **clean format-effect signal**.

| Dataset | Rows | Task count | Question types |
|---|---|---|---|
| `small-users.json` | 7 | 12 | extraction, relational, boolean, count |
| `small-config.json` | ~30 lines | 12 | extraction, relational, boolean, count |
| `small-events.json` | 8 | 12 | extraction, relational, boolean, count |

36 tasks × 2 formats = 72 requests per model per run.

**Why this is the right measurement:** every question is answerable by careful
reading of a small, fully-visible payload. Format is the only variable. Failures
isolate format-reading ability, not LLM retrieval capacity.

**Matched-pair methodology:** see below.

### Stress suite

Original 50/80-row datasets with cross-row reasoning and aggregation tasks.
Kept for regression coverage and because it answers a different question:
"can the model navigate a large PAKT payload?" — not the same as format legibility.

| Dataset | Rows | Task count | Question types |
|---|---|---|---|
| `tabular-users.json` | 50 | 11 | extraction, reasoning, aggregation |
| `nested-config.json` | ~160 lines | 11 | extraction, reasoning, aggregation |
| `logs.json` | 80 | 11 | extraction, reasoning, aggregation |

33 tasks × 2 formats = 66 requests per model per run.

**Caveat:** format-confounded by retrieval difficulty. A 50-row count question
is hard regardless of format. Accuracy differences here reflect LLM limitations,
not PAKT legibility. Use the comprehension suite for the format-effect signal.

## How to run

```sh
# From the repo root (requires pakt-core built: pnpm --filter @sriinnu/pakt build)

# 1. Dry run — no keys, exits 0 with a notice, writes nothing:
node scripts/eval/run.mjs

# 2. Mock run — network-free echo model, proves pipeline + scoring end-to-end:
node scripts/eval/run.mjs --mock                           # comprehension suite (default)
node scripts/eval/run.mjs --mock --suite stress            # stress suite only
node scripts/eval/run.mjs --mock --suite all               # both suites

# 3. Live run — Anthropic API (default model claude-fable-5):
ANTHROPIC_API_KEY=sk-ant-... node scripts/eval/run.mjs
ANTHROPIC_API_KEY=sk-ant-... node scripts/eval/run.mjs --model claude-haiku-4-5

# 4. Live run — any OpenAI-compatible endpoint:
OPENAI_API_KEY=... node scripts/eval/run.mjs --openai-model gpt-4o-mini

# 5. CLI mode — no API key needed, uses your Claude Code / Codex subscription:
node scripts/eval/run.mjs --provider cli --cli claude
node scripts/eval/run.mjs --provider cli --cli claude --suite comprehension
node scripts/eval/run.mjs --provider cli --cli claude --dataset small-users --max-tasks 1
```

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--mock` | off | Use the network-free echo model (see below) |
| `--suite` | `comprehension` | Suite to run: `comprehension`, `stress`, or `all` |
| `--provider` | auto | Force a provider: `anthropic`, `openai`, or `cli` |
| `--cli` | `claude` | Which CLI binary when `--provider cli`: `claude` or `codex` |
| `--model` | `claude-fable-5` | Model id for the Anthropic API or CLI `--model` flag |
| `--openai-model` | — | Model for the OpenAI-compatible endpoint (required to enable it) |
| `--openai-base-url` | `https://api.openai.com/v1` | Override endpoint (or `OPENAI_BASE_URL`) |
| `--dataset` | all | Comma-separated subset (e.g. `small-users,small-events`) |
| `--max-tasks` | all | Cap tasks per dataset (cheap smoke runs) |

### Env vars

- `ANTHROPIC_API_KEY` — enables the Anthropic API provider.
- `OPENAI_API_KEY` / `OPENAI_BASE_URL` — enables any OpenAI-compatible endpoint.
- **Key-gated:** with no keys and no `--mock` and no `--provider cli`, the
  runner prints a notice and exits 0.

## Matched-pair methodology

### Why matched pairs?

A naive comparison — "JSON accuracy: 72%, PAKT accuracy: 69%" — conflates two
things: format effect and task difficulty. If both formats fail question X, that
tells you nothing about PAKT; it tells you the question was hard. Matched pairs
exclude that noise.

### How it works

For each QUESTION, we compare the outcomes on both formats side by side:

| Cell | JSON | PAKT | Meaning |
|---|---|---|---|
| `bothRight` | correct | correct | Format irrelevant — shared success |
| `bothWrong` | wrong | wrong | Task-difficulty noise — **excluded** from effect |
| `jsonOnly` | correct | wrong | Format hurt PAKT |
| `paktOnly` | wrong | correct | Format helped PAKT |

**FORMAT EFFECT = paktOnly − jsonOnly**
- Positive → PAKT outperforms JSON on questions where they diverge.
- Negative → PAKT underperforms JSON on divergent questions.
- ≈ 0 → format is comprehension-neutral.

For the comprehension suite (~36 questions), an effect of |Δ| ≤ 2 is within
expected small-sample noise. The report prints a plain-language verdict line.

### Why the comprehension suite is the right input

The matched-pair metric needs format to be the only variable. The stress suite
tasks involve counting across 50 rows and cross-row scans — those fail for both
formats disproportionately (`bothWrong` soaks up the signal). The comprehension
suite is designed so every question is answerable by careful reading of a small
visible payload, keeping `bothWrong` low and `jsonOnly`/`paktOnly` interpretable.

### What the stress suite measures

A different (valid) question: "can the model navigate a large PAKT payload for
retrieval/aggregation?" The stress suite is format-confounded — the difficulty
gradient dominates any format signal. Run it for regression coverage and large-
payload stress, not for the clean format-comprehension answer.

## Mock mode

`--mock` uses an echo model that returns the ground-truth answer with cosmetic
noise (casing, quotes, padding) to exercise normalization — except for
deliberately wrong IDs that prove the scorer fails mismatches:

**Comprehension suite mock expectations (72 records):**
- `su-05` (small-users relational): wrong on BOTH formats → `bothWrong` cell
- `sc-09` (small-config boolean): wrong on PAKT only → `jsonOnly` cell
- All other 34 tasks: both correct → `bothRight`
- Overall: **69/72** correct; matched-pair: bothRight=34, bothWrong=1,
  jsonOnly=1, paktOnly=0, Δ=**-1** → "within noise" verdict.

**Stress suite mock expectations (66 records):**
- `users-03`: wrong on both formats → 64/66 correct.

This proves both that the pipeline wires payload → prompt → answer → score, and
that the scorer and matched-pair classifier actually fail mismatches correctly.

## CLI mode — zero-key, subscription-based evals

`--provider cli` spawns `claude` or `codex` as a subprocess per question —
no API key is required. Auth comes from your existing Claude Code login.

Token savings in the report always come from the harness's LOCAL `compress()`
call, independent of which provider answers the comprehension questions. CLI-
reported token counts are ignored because each `claude -p` call carries ~25K
tokens of Claude Code system-prompt overhead unrelated to the PAKT payload.

## Cost estimate

**Comprehension suite** — 36 tasks × 2 formats = 72 requests:

| Dataset | JSON (minified) | PAKT | Savings |
|---|---|---|---|
| small-users | ~290 tok | ~230 tok | ~22% |
| small-config | ~140 tok | ~180 tok | ~-28% (small nested configs can expand) |
| small-events | ~350 tok | ~205 tok | ~41% |

~22K input tokens, **~$0.33 per model per run** at Fable 5 pricing. Less than
¼ of the stress-suite cost.

**Stress suite** — 33 tasks × 2 formats = 66 requests:

| Dataset | JSON (minified) | PAKT | Savings |
|---|---|---|---|
| users | 2,491 tok | 1,765 tok | 29.1% |
| config | 592 tok | 740 tok | −25.0% (small nested config) |
| logs | 3,842 tok | 1,800 tok | 53.1% |

~129K input tokens, **~$1.40 per model per run** at Fable 5 pricing.

The runner recomputes both estimates from actual token counts on every run and
writes them to `latest.md`.

## Files

| File | Purpose |
|---|---|
| `run.mjs` | Entry point: key-gating, `--suite` flag, payload rendering (JSON + PAKT), orchestration |
| `tasks.mjs` | `buildComprehensionSuites()` + `buildSuites()` (stress), ground-truth computation, scoring |
| `providers.mjs` | Anthropic + OpenAI-compatible raw-fetch providers, mock echo model, CLI provider |
| `report.mjs` | Matched-pair analysis + accuracy tables + token stats → `results/<timestamp>.json` + `results/latest.md` |
| `datasets/generate.mjs` | One-off seeded generator for the stress datasets (provenance only; not used at runtime) |
| `datasets/small-users.json` | 7-user comprehension dataset (synthetic, no real PII) |
| `datasets/small-config.json` | Compact 4-service config comprehension dataset |
| `datasets/small-events.json` | 8-entry structured log comprehension dataset |
| `datasets/tabular-users.json` | 50-user stress dataset |
| `datasets/nested-config.json` | ~160-line nested config stress dataset |
| `datasets/logs.json` | 80-entry log stress dataset |

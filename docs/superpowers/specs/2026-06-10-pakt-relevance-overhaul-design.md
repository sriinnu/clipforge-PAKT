# PAKT Relevance Overhaul — Design

**Date:** 2026-06-10
**Status:** Approved direction (user-confirmed via session Q&A); executing in waves.
**Principle:** Transparency. What is written is what you get. No feature ships half-real; no doc claims more than the code does.

## Context

Full codebase health check (2026-06-10) found: clean build, 1154/1157 core tests passing
(3 known WSL CLI-spawn flakes), and a relevance gap — the clipboard-first product framing
is 2024-era, while the market moved to agent token economics (1M-context models, prompt
caching at 0.1× reads, provider-native compaction). PAKT's durable value: compressing the
**uncacheable volatile suffix** (tool results, RAG chunks, logs) and composing with prompt
caching rather than competing with it.

## User decisions

1. **Desktop** → reinvent as **Agent Telemetry HQ**: a live dashboard over pakt-core's
   stats JSONL (`~/.pakt/stats/`) — savings over time, per-source breakdown, cache
   stability, latency. Clipboard compression demoted to a utility. History wired for real.
2. **Extension** → **finish & publish prep**: icons, store assets, privacy policy, smoke
   tests. (Actual store submission is the user's action.)
3. **Core upgrades** → all of: cache-synergy pack, dictionary-as-system-prompt,
   comprehension eval harness, meta-token L3.5, plus researched extras.

## Workstreams

### W1 — Truth & fixes (no new features)
- **Desktop history (`apps/desktop/src-tauri/src/history.rs:62-141`)**: replace the five
  TODO stubs with real `tauri-plugin-sql` queries (schema already defined). If the plugin
  API can't be wired cleanly, the History panel is removed from the UI — it must not show
  fake data either way.
- **L4 PII CRLF bug (`packages/pakt-core/src/layers/L4-pii.ts:111-133`)**: header
  injection splits on `\n` only; normalize CRLF handling, add tests (TODO M1).
- **M2**: `isTemporalDeltaSentinel` returns plain boolean while `isNumericDeltaSentinel`
  is a type predicate — make symmetric.
- **M3**: de-export speculative constants from `layers/index.ts`; extract duplicated
  `parseSentinel` into `layers/delta-shared.ts`.
- **Playground tests**: vitest fork-pool fails on WSL ("Timeout waiting for worker") —
  switch pool config (`threads`) or add WSL-safe settings so the suite runs.
- **Copy feedback (desktop)**: wire the existing `COPY_STATE_RESET_MS` constant to a
  visible "Copied" state.

### W2 — Cache-synergy pack (core)
- Wire `RollingDictionary` into `handleCompress` so MCP sessions reuse aliases across
  turns (prefix-stable `@dict`, append-only slots).
- Emit `@cache prefix-end` directive after the `@dict` block; `cacheBreakpoint` consumers
  get a deterministic breakpoint byte offset.
- Guarantee header ordering (`@from`, `@compress`, `@dict`, `@cache`) is byte-stable
  across turns; add cache-stability tests (same session twice → identical prefix bytes).

### W3 — Dictionary-as-system-prompt (core)
- New option `dictPlacement: 'inline' | 'system'`. With `'system'`, `compress()` returns
  the dictionary as a separate block intended for the (cached) system prompt; the body
  references aliases only. Round-trip: `decompress(body, { dict })`.
- Surfaces: library API, CLI flag, MCP tool param. Docs with an Anthropic
  `cache_control` example.

### W4 — Comprehension eval harness
- `scripts/eval/`: extraction/QA/aggregation tasks over fixed datasets, each rendered as
  JSON vs PAKT, scored per model (Anthropic + OpenAI-compatible, key-gated).
- Output: markdown table for README. Honest framing: published numbers come from real
  runs; no numbers are committed until a run happens.

### W5 — Desktop → Agent Telemetry HQ
- New primary panel reading stats JSONL via the existing persister contract
  (`pakt stats --json` shape): today/7-day savings, per-source breakdown (MCP host,
  clipboard), latency, lossy share, cache-stability signal.
- Tauri backend: file-watch on `~/.pakt/stats/`, no polling UI.
- Clipboard workspace remains as a secondary tab. History = real SQLite (W1).
- Out of scope this cycle: icon/signing/DMG polish (tracked, not blocking).

### W6 — Extension publish prep
- PNG icons (16/48/128) from `assets/pakt-logo.svg`; store listing copy; privacy policy;
  screenshots checklist; smoke-test script + findings doc for the 5 target sites.
- Site-whitelist editing UI (storage field exists; expose it in Options).
- Submission itself: user action.

### W7 — Meta-token compression (L3.5)
- New lossless layer between L3 and L4: tokenizer-aware span merging across word
  boundaries (arXiv 2506.00307). Roundtrip fuzzers mandatory. Gated behind explicit
  opt-in until fuzz-clean.

### W8 — Research extras (investigate, then propose)
- Provider-adapter middleware (auto `cache_control` breakpoint insertion for Anthropic
  SDK calls through the proxy).
- Semantic dedup (vector-distance cache matching) — Tier 2 roadmap.
- Compaction-aware mode: cooperate with server-side `compact-2026-01-12` blocks.

## Sequencing

W1 first (truth before features), W2+W3 together (same files), then W4, W5, W6 in
parallel where file ownership is disjoint, W7 last (largest), W8 as findings allow.
Agents get owned-file scopes; no overlapping edits. Tests + lint green per wave;
README/CHANGELOG transparency pass at the end reflects only what actually shipped.

## Engineering constraints

- ≤400 LOC per source file (repo rule); new code must not add violations.
- JSDoc on all exported symbols; strict TS.
- Lossless layers require roundtrip tests; fuzzers for anything touching parsing.
- No fabricated benchmark numbers anywhere in docs.

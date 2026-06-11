# PAKT 0.12 Upgrade Proposal

_Synthesized 2026-06-10 from: CHANGELOG [Unreleased], future-features.md, polyglot-port-options.md,
token-efficiency-roadmap.md Tier 2/3, TODO.md P2/P3, and known debt inventory._

---

## 1. Thesis

0.11 completed PAKT's infrastructure layer — cache synergy, meta-token BPE aliasing,
compaction-cooperative context engine, proxy tool-catalog modes, a Python client, and an eval
harness. The machinery is there; the last mile is missing everywhere: the eval harness has never
run live, the extension is unpublished, the proxy's `call_tool` rewrite path is a stub, PyPI is
unpublished, and two files breach the 400-line cap. **0.12's theme is "close the open loops and
earn the right to grow."** Before adding net-new algorithmic surface, the release should: ship the
three features the research already ranked as Build (provider cache adapters, proxy tool-catalog
search facade, compaction-cooperative safety pass) which all monetize existing machinery with
minimal new code; clear the known debt that blocks trust (LOC violations, eval no-ops, CI gaps,
security vulnerabilities); and complete the publishing pipeline so there is actually a product
people can install. Algorithmic prototypes (budget governor, TOON, semantic dedup) belong in
research branches gated on eval evidence, not in the release cut.

---

## 2. Prioritized Table

| # | Item | Why now | Effort | Risk | Depends on |
|---|------|---------|--------|------|-----------|
| 1 | **Security: resolve 16 dependabot vulns (2 high)** | Blocks store listing + any enterprise use; a parallel audit agent is already running | S | Low | Audit agent findings |
| 2 | **LOC debt: split `L3-5-metatoken.ts` (443) and `Settings.tsx` (473)** | Both violate the 400-line cap; `L3-5-metatoken.ts` is in a hot test path; `Settings.tsx` blocks extension review | S | Low | None |
| 3 | **Provider cache adapter `src/middleware/provider-adapter.ts` (full wiring)** | Ranked #1 in future-features.md; hard parts (byte-stable prefixes, boundary detection) already exist; converts existing machinery into a directly billable 90% cache-read saving; needed for the proxy's slim/search modes to be cache-safe | S | Low | cache-breakpoint.ts, rolling-dict (both shipped) |
| 4 | **Compaction-cooperative safety pass** (opaque-block guards in `optimizeMessages()` + `ContextEngine`) | Ranked #3 in future-features.md; correctness/safety item, not a feature; a `ToolResultMessage` containing a `compaction` block is a live hazard today | S | Low | context-engine opaque-blocks.ts (shipped in 0.11) |
| 5 | **Proxy `call_tool` full rewrite path** (complete the `search` facade stub) | Ranked #2 in future-features.md; documented structured error is a cop-out; without transparent forwarding the search facade is unusable in production | M | Medium | provider-adapter (#3), comprehension-eval harness (#6) |
| 6 | **Run eval harness live (≥1 model)** and publish real numbers | CHANGELOG explicitly notes "no live model runs have been executed — no model accuracy numbers exist"; without numbers the eval harness is just scaffolding; also the prerequisite gate for the budget governor and semantic dedup prototypes | M | Medium | scripts/eval/, API key |
| 7 | **Publish `pakt-client` to PyPI** | Already built; unpublished per CHANGELOG; blocks Python ecosystem adoption | S | Low | Twine/maturin publish step, PyPI account |
| 8 | **Extension: smoke-test on 5 sites + Chrome Web Store submit** | Extension is feature-complete and store prep is done (listing copy, privacy policy, checklist exist); blocked only on human smoke-test pass | S | Low | Human QA pass |
| 9 | **macOS desktop: DMG + notarization + launch-at-login** | P2 in TODO; Rust compile on WSL is unverified — a macOS/GTK CI lane is needed first; notarization is a hard requirement for distribution | M | Medium | macOS CI lane (new), Rust compile-verified |
| 10 | **Add macOS CI lane** (verify Rust/Tauri compile on macOS runner) | Desktop Rust compile is explicitly "unverified on WSL"; CI is the gate for #9 and for any Tauri release | S | Low | GitHub Actions macOS runner |
| 11 | **Token-budget governor prototype** (`src/context-engine/governor.ts`, opt-in) | Ranked #4 in future-features.md; PROTOTYPE status; needs eval evidence before default-on; build behind `budget: {maxTokens, escalation}` flag | M | Medium | Live eval numbers (#6); existing layer-profiles.ts knobs |
| 12 | **TOON ingest/emit prototype** | Ranked #5 in future-features.md; cheap adoption hook (spec is small, TS SDK exists); pin to spec version | S–M | Low | format-parsers/ (existing) |
| 13 | **Semantic dedup — deterministic near-dup variant first** (normalized hash + line-level diff reference) | Ranked #6 in future-features.md; model-free variant keeps lossless identity; full embedding hook deferred | M | Low-Med | deduplicateContent() (existing), diff-reference format |
| 14 | **Collect real benchmark datasets** (`benchmarks/datasets/`, 1000+ payloads) | In TODO P1 since 0.9; eval harness needs realistic fixtures; SuperBPE and LLMLingua-2 tier-2 items need baselines | M | Low | None |
| 15 | **Non-code: docs site / benchmarks page / comparison table vs Headroom** | Headroom has ~21.3k stars; PAKT's "lossless + model-free + deterministic" wedge is undocumented in a scannable public form; no code change required but directly affects adoption | S | Low | — |

---

## 3. Recommended Cut for 0.12

### In (ship in 0.12)

- **Security vulns** (#1) — unblocking, S effort.
- **LOC splits** (#2) — quick hygiene, unblocks extension review.
- **Provider cache adapter full wiring** (#3) — highest ROI-per-line item in the research backlog.
- **Compaction safety pass** (#4) — correctness item, S effort, live hazard today.
- **Proxy `call_tool` rewrite path** (#5) — completes the 0.11 stub; without it `--tools search` is a documented no-op.
- **Run eval harness + publish numbers** (#6) — tables stakes for every prototype that follows.
- **Publish `pakt-client` to PyPI** (#7) — already built, zero implementation, blocks Python ecosystem.
- **Extension smoke-test + Chrome store submit** (#8) — feature-complete; only needs a QA pass.
- **macOS CI lane** (#10) — small CI config; unblocks #9 and all future Tauri releases.
- **Benchmark datasets** (#14) — feeds eval harness and tier-2 items.
- **Non-code: docs/benchmarks/comparison page** (#15) — one-day content task, high adoption leverage.

### Deferred to 0.13+

- **macOS DMG + notarization** (#9) — depends on CI lane landing first; M effort; own release beat.
- **Budget governor** (#11) — PROTOTYPE; needs eval evidence from #6 before default-on.
- **TOON interop** (#12) — PROTOTYPE; low risk but not blocking anything.
- **Semantic dedup** (#13) — PROTOTYPE; deterministic variant only; needs benchmark datasets (#14) to measure.
- **Windows desktop, template engine, dashboard** (TODO P3) — Phase 4/5; explicitly deferred.
- **SuperBPE / LLMLingua-2 L6 / RECOMP** (roadmap Tier 2/3) — no new urgency this cycle.
- **Rust core port** (polyglot-port-options.md option a) — correct call, but "when demand proves"; 0.x format is still moving.

---

## 4. Success Criteria (measurable at release time)

| Criterion | Target |
|-----------|--------|
| Security vulnerabilities | 0 high, 0 critical in `pnpm audit` / Dependabot |
| LOC cap compliance | 0 source files > 400 lines (`find src -name '*.ts' | xargs wc -l`) |
| Provider cache adapter | `buildAnthropicCacheHints` + `buildOpenAICacheHints` fully wired into `pakt proxy` and `optimizeMessages()`; new test confirms `cache_control` placement on a ≥ 2048-token prefix |
| Compaction safety | `optimizeMessages()` and `ContextEngine.optimize()` skip opaque compaction blocks; regression test with a synthetic `compact-2026-01-12` block confirms no mutation |
| Proxy `call_tool` | `--tools search` mode transparently forwards any registered tool call without returning a structured error; existing proxy tests pass + 1 new integration test |
| Eval harness | At least one live model run completed; token-savings numbers published in `scripts/eval/README.md` or CHANGELOG; no accuracy regression on comprehension fixtures |
| PyPI publish | `pip install pakt-client` succeeds on Python ≥ 3.10; `pakt-client --version` prints the correct version |
| Extension | Smoke-test checklist signed off (5 sites); Chrome Web Store listing submitted (accepted or under review) |
| CI | macOS GitHub Actions runner compiles Tauri/Rust clean; no new Rust compile warnings |
| Benchmark datasets | `benchmarks/datasets/` contains ≥ 500 real-world payloads across ≥ 4 categories (API responses, configs, logs, LLM tool results) |
| Docs | Public benchmarks/comparison page live or merged to docs site; Headroom comparison table present |

---

_Debt items not in this proposal (streaming compression, KV-cache, quantization) remain
explicitly skipped per the roadmap's "deliberately skip" list._

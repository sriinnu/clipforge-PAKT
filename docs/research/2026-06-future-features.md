# Future Features Research — June 2026

Candidate features to keep PAKT relevant 2026–2030, beyond what's already on
[docs/token-efficiency-roadmap.md](../token-efficiency-roadmap.md) (SuperBPE, LLMLingua-2 L6,
semantic-cache dedup of *calls*, RECOMP) and beyond what's in flight
(rolling-dictionary cache synergy, dictionary-as-system-prompt, comprehension evals, meta-token L3.5).

Method: each candidate was researched against the June-2026 state of the art (web sources cited
inline), then assessed against PAKT's actual architecture (modules named per
`packages/pakt-core/src/`). Verdicts are ranked at the end. Speculation is marked as such.

**Competitive context worth internalizing first:** the "compress agent context before it hits the
model" category is now real and crowded. [Headroom](https://github.com/chopratejas/headroom)
(~21.3k GitHub stars, June 2026) ships JSON compression, AST-aware code compression, a trained
text-compression model, a *CacheAligner* for provider KV-cache hits, and library/proxy/MCP surfaces —
the same three surfaces PAKT has. PAKT's differentiation is **lossless, model-free, deterministic
round-trip**. The features below lean into that wedge rather than chasing Headroom's lossy ML path.

---

## 1. Provider cache-adapter middleware (Anthropic `cache_control` / OpenAI `prompt_cache_key`)

### Problem and audience

API-proxy and middleware users (the `optimizeMessages()` / `pakt proxy` crowd) currently get token
*reduction* from PAKT but leave cache *pricing* on the table. Anthropic prompt-cache reads cost 10%
of base input (writes 1.25x at 5-min TTL, more for 1-hour); up to 4 `cache_control` breakpoints per
request, which must sit on the last byte-identical block — and tools/system/messages ordering all
participate in the prefix ([Anthropic prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
OpenAI caching is automatic above 1,024 tokens (128-token increments) but hit rate depends on the
optional `prompt_cache_key` routing hint for shared prefixes
([OpenAI prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)).
Production teams treat cache-hit-rate engineering as a first-class cost lever — 60–85% cost cuts
reported from breakpoint discipline alone
([AgentMarketCap, Apr 2026](https://agentmarketcap.ai/blog/2026/04/11/prompt-cache-hit-rate-engineering-2026)).
Headroom's CacheAligner existing at all is market validation.

### Evidence

- [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — breakpoint semantics, 4-breakpoint limit, pricing.
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) and [Prompt Caching 201 cookbook](https://developers.openai.com/cookbook/examples/prompt_caching_201) — automatic prefix caching, `prompt_cache_key`.
- [Anthropic compaction docs](https://platform.claude.com/docs/en/build-with-claude/compaction) — explicitly recommend `cache_control` on system prompt and on compaction blocks (composes with feature #3).
- [mager.co deep-dive, Apr 2026](https://www.mager.co/blog/2026-04-29-claude-prompt-caching/) — practitioner guidance on breakpoint placement in agent loops.

### How it composes with PAKT

PAKT already computes the cacheable-prefix boundary: `src/cache-breakpoint.ts`
(`computeCacheBreakpoint()` → byte offset + per-target TTL for `anthropic | bedrock | openai |
google`), and the rolling dictionary work makes the `@dict` prefix byte-stable across turns. What's
missing is the last mile: nobody *applies* the hint to a real request. A new
`src/middleware/provider-adapter.ts` would:

- Take an Anthropic-shaped request body and inject `cache_control: {type:'ephemeral'}` on the right
  content blocks: end of system prompt, end of tool definitions, and the newest stable
  conversation block — degrading gracefully within the 4-breakpoint budget.
- For OpenAI-shaped requests, derive a `prompt_cache_key` from a hash of the stable prefix
  (system + tools + `@dict` block) so sharded traffic routes to the same cache.
- Reuse `optimizeMessages()` in `src/middleware/interceptor.ts` as the entry point (a
  `cacheTarget` option in `InterceptorConfig`), and surface the same logic through `cli-proxy.ts`
  and the future HTTP proxy mode.

### Effort and risk

**Effort: S** (the hard part — byte-stable prefixes and boundary detection — already exists).
**Risk: low.** Provider API shapes are versioned and documented; worst case a misplaced breakpoint
wastes a cache write (1.25x on one block), never corrupts data.

### Verdict: **BUILD** (rank 1)

Highest ROI-per-line in this document. It converts existing PAKT machinery into a directly
billable saving (90% on cached reads) and is the feature that makes "token-economics middleware"
literal rather than aspirational.

---

## 2. MCP tool-catalog slimming: deferred-loading facade in `pakt proxy`

### Problem and audience

The loudest documented MCP pain point of 2026 is tool-definition bloat, not tool-result bloat. A
5–10 server Claude Code setup burns ~50–67k tokens in schemas before the first user prompt; the
GitHub MCP alone has been measured at ~42–55k tokens
([Unblocked autopsy](https://getunblocked.com/blog/mcp-token-budget-autopsy/),
[Unblocked GitHub MCP autopsy](https://getunblocked.com/blog/github-mcp-token-cost/)). Enterprise
deployments report 60–80% of context consumed by schemas — one three-server case burned 143k of a
200k window ([AgentMarketCap, Apr 2026](https://agentmarketcap.ai/blog/2026/04/08/mcp-context-bloat-enterprise-scale-tool-definitions-agent-context-budget)).
The provider-side answer is deferred loading: Anthropic's
[tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)
(`defer_loading: true`, regex/BM25 variants, claims >85% reduction by loading only 3–5 needed
tools), now default in Claude Code 2.1.x; OpenAI ships an equivalent
([tool search guide](https://developers.openai.com/api/docs/guides/tools-tool-search)). But that
only helps clients wired into those APIs. **An MCP host that wraps servers with `pakt proxy` gets
nothing today — `cli-proxy.ts` re-registers every wrapped tool verbatim.**

### Evidence

- [Anthropic tool search tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) — `defer_loading`, ~55k-token multi-server example, prefix-cache preservation.
- [StackOne: MCP token optimization, 4 approaches](https://www.stackone.com/blog/mcp-token-optimization/) — the "wrapper pattern" (expose 3 discovery tools instead of N) as an established community fix.
- [Maxim: cutting MCP token costs 92% at 500+ tools](https://www.getmaxim.ai/articles/cutting-mcp-token-costs-by-92-at-500-tools/).
- [atcyrus on Claude Code tool search](https://www.atcyrus.com/stories/mcp-tool-search-claude-code-context-pollution-guide) — measured ~47% session-startup reduction.

### How it composes with PAKT

`src/cli-proxy.ts` sits at exactly the right junction: it already lists the child server's tools and
re-registers them (`startProxy()` step 3–4). Add a `--toolset-mode` flag:

- `full` (today's behavior).
- `slim`: re-register tools with PAKT-compressed descriptions (reuse `src/layers/L5-abbreviations.ts`
  vocabulary; schemas minified, examples stripped beyond the first) — lossless-ish at the JSON level,
  description text is the lossy-but-low-risk part and stays opt-in.
- `search`: register only a 3-tool facade (`pakt_find_tool`, `pakt_describe_tool`,
  `pakt_call_tool`) backed by an in-proxy BM25 index over the wrapped catalog — the wrapper pattern,
  zero client support needed. The existing `mcp/server.ts` registration path and
  `middleware/interceptor.ts` passthrough config carry over unchanged.

### Effort and risk

**Effort: M** (BM25 over tool metadata is small; the real work is faithful arg forwarding and
error mapping in `pakt_call_tool`). **Risk: medium** — a facade hides tools from clients that do
their own planning over the tool list, and tool-selection accuracy through a facade needs eval
coverage (the in-flight comprehension-evals work is the right harness). Mitigation: `slim` mode is
near-zero-risk and ships first.

### Verdict: **BUILD** (rank 2)

The single biggest documented MCP cost sink, an established pattern with no lossless-deterministic
implementation in the proxy niche PAKT already occupies, and it makes `pakt proxy` worth running
even for users whose tool *results* are small.

---

## 3. Compaction-cooperative mode (play nice with `compact-2026-01-12` and context editing)

### Problem and audience

Anthropic now does server-side context management: the compaction API (beta header
`compact-2026-01-12`, default trigger 150k input tokens, minimum 50k) summarizes the transcript
into a `compaction` block, and the `clear_tool_uses_20250919` context-editing strategy clears old
tool results past a threshold
([compaction docs](https://platform.claude.com/docs/en/build-with-claude/compaction),
[context editing docs](https://platform.claude.com/docs/en/build-with-claude/context-editing)).
Compaction is *lossy and irreversible* — and it triggers as a function of input-token count. Every
token PAKT removes from tool results **delays the lossy event**, letting agents run longer on
verbatim context. Anthropic-reported evaluations cited across the 2026 literature put context
editing at a 29% agent-performance lift (39% with memory) — i.e., hosts will turn these on, and
middleware that fights them (e.g., by mutating a compaction block and breaking the "ignore
everything before it" contract) will corrupt sessions
([Anthropic: effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents),
[Claude cookbook: memory, compaction, tool clearing](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools)).
Audience: agent builders on Claude Opus 4.6+/Sonnet 4.6+/Fable-class models, and anyone routing
through PAKT's middleware to those models.

### How it composes with PAKT

Three concrete pieces:

1. **Safety pass (must-have):** `optimizeMessages()` in `src/middleware/interceptor.ts` and
   `ContextEngine.optimize()` in `src/context-engine/engine.ts` must treat `compaction` content
   blocks and clearing placeholders as opaque — never compress, dedupe (`deduplicateContent`), age
   (`ageToolResults`), or summarize them. Today both walk text blocks indiscriminately; a
   `ToolResultMessage` containing a compaction block is a hazard.
2. **Threshold cooperation:** give `ContextEngineConfig` a `providerCompactionTrigger` so
   `maxContextTokens` (and the aging budget) auto-aligns to, say, 80% of the provider trigger —
   PAKT's lossless layers fire *before* the provider's lossy one. This is configuration plumbing,
   not new algorithms.
3. **Cache choreography:** when compaction occurs, the provider drops everything before the block —
   the right move is a `cache_control` on the system prompt and on the compaction block itself (per
   the compaction docs). That's feature #1's adapter reacting to a compaction event; the two
   features compose.

### Effort and risk

**Effort: M** overall, but the safety pass alone is **S** and urgent. **Risk: medium** — beta API
(`compact-2026-01-12`) can churn; mitigate by keying behavior off block `type` strings in one
adapter file rather than scattering provider knowledge.

### Verdict: **BUILD** (rank 3 — safety pass immediately, cooperation knobs next)

"Behaves correctly alongside server-side compaction" will be table stakes for any context
middleware by 2027. Being early and documented here is cheap defensibility.

---

## 4. Token-budget-aware compression governor ("compress harder as budget shrinks")

### Problem and audience

Agent platforms increasingly run under explicit task budgets (cost ceilings, effort parameters,
runaway-spend kill switches — see
[MindStudio on Claude Code budget management](https://www.mindstudio.ai/blog/ai-agent-token-budget-management-claude-code)).
Research has moved the same direction: *ContextBudget* formalizes budget-aware context management
for long-horizon search agents ([arXiv:2604.01664](https://arxiv.org/abs/2604.01664)); adaptive
compression work adjusts token budgets dynamically with dialogue state
([arXiv:2603.29193](https://arxiv.org/abs/2603.29193)); *PoC* adds performance-prediction floors so
compression aggressiveness stays controllable ([arXiv:2603.19733](https://arxiv.org/abs/2603.19733)).
PAKT today applies a fixed strategy regardless of how much runway the session has left.

### How it composes with PAKT

The pieces exist; what's missing is the controller:

- `src/layer-profiles.ts` already defines named layer bundles — a budget governor is a mapping from
  *budget pressure* (tokens spent ÷ budget, plus context fill ratio) to profile + engine knobs.
- `src/context-engine/engine.ts` already has the graduated levers: `strategy`
  (`minimal → progressive → aggressive`), `recentTurns`, `toolResultTailLines`, summarization
  trigger (currently hard-coded at 60% of `maxContextTokens` in `shouldSummarize`).
- `src/middleware/types.ts` `InterceptorStats` already tracks cumulative spend; a
  `BudgetGovernor` consuming those stats and re-tuning `InterceptorConfig.minTokens` /
  engine config per call is a small, pure module (`src/context-engine/governor.ts`).
- Telemetry surface: `src/stats/` + `cli-commands-stats.ts` report savings; the governor adds
  "remaining budget" as a first-class stat.

### Effort and risk

**Effort: M.** **Risk: medium** — the failure mode is quality cliffs when the governor escalates
into summarization/aging too eagerly near budget exhaustion. The in-flight comprehension evals are
the prerequisite guardrail; ship behind explicit opt-in (`budget: {maxTokens, escalation}`).

### Verdict: **PROTOTYPE** (rank 4)

Strong thematic fit with the "agent token-economics" positioning and cheap to prototype on existing
knobs, but it needs eval evidence before it deserves default-on. Speculation flag: the claim that
budget-banded escalation beats a fixed `progressive` strategy is plausible but unproven for PAKT's
specific layers.

---

## 5. TOON interop (ingest + emit Token-Oriented Object Notation)

### Problem and audience

TOON (Token-Oriented Object Notation, released Oct 2025) became the de-facto community shorthand
for "token-efficient JSON": 30–60% fewer tokens on uniform tabular data, with production reports of
50%+ savings ([InfoQ, Nov 2025](https://www.infoq.com/news/2025/11/toon-reduce-llm-cost-tokens/),
[toon-format/toon spec + benchmarks](https://github.com/toon-format/toon)). A 2026 benchmark also
studies TOON on the *generation* side under constrained decoding
([arXiv:2603.03306](https://arxiv.org/abs/2603.03306)). Its known weakness — non-uniform/nested
data — is exactly where PAKT's columnar/structural layers do better. Agent builders now ask "TOON
or PAKT?"; the better answer is "PAKT reads and writes TOON," capturing that audience instead of
debating it.

### How it composes with PAKT

- **Ingest:** add a TOON parser under `src/format-parsers/` and a `'toon'` arm in `src/detect.ts` /
  `src/formats.ts`, so TOON flows through L2–L5 like JSON/YAML/CSV do (TOON output from upstream
  tools is increasingly common in RAG pipelines).
- **Emit:** a `toFormat: 'toon'` target in `src/serializer/` for users who want a
  *standard* compact format instead of PAKT's own notation — e.g., when the consuming model/prompt
  was already tuned for TOON, or when downstream systems can't carry the `@dict` contract.
  `src/compress.ts` option plumbing and the MCP `handler-compress.ts` flag are mechanical.
- The arXiv 2603.03306 generation results also make TOON a candidate target for
  `src/model-output.ts` (asking models to *reply* in TOON), which PAKT could then losslessly expand.

### Effort and risk

**Effort: S–M** (the spec is small and has a reference TypeScript SDK to validate against).
**Risk: low** — worst case it's an under-used format arm; the format is community-driven and not
formally standardized, so pin to a spec version.

### Verdict: **PROTOTYPE** (rank 5)

Cheap adoption hook with real distribution upside (TOON's audience is exactly PAKT's audience), but
it doesn't deepen the core moat, so it shouldn't displace ranks 1–3.

---

## 6. Semantic dedup of tool results in the context engine (embedding-distance)

### Problem and audience

Agents re-fetch near-identical content constantly — re-reads of a file after a small edit, repeated
search results, paginated API responses with overlapping rows. PAKT's current dedup is exact-ish:
`ContextEngine.deduplicateContent()` hashes `first-200-chars + length`, and `mcp/dedup-cache.ts`
is hash-equality. Both miss the paraphrase/overlap long tail. The technique is mature elsewhere:
SemDeDup-style embed → cluster → keep-densest pipelines are standard in data curation
([NVIDIA NeMo Curator semantic dedup](https://docs.nvidia.com/nemo/curator/curate-text/process-data/deduplication/semdedup)),
and SemHash shows CPU-only static embeddings (Model2Vec) deduping ~1.8M records in ~83s — no GPU,
no API ([SemHash overview](https://medium.com/@sreeprad99/how-semhash-simplifies-semantic-deduplication-for-llm-data-a0b1a53e84fe)).
Practitioner reports for multi-turn agent contexts cite 20–40% reductions at cosine ≥ ~0.85
([buildmvpfast: context compression techniques](https://www.buildmvpfast.com/blog/context-compression-techniques-fewer-tokens-llm-optimization-2026)).
Note this is *context* dedup (within a session's messages), distinct from roadmap item #6
(semantic caching to skip whole LLM calls).

### How it composes with PAKT

- Extend `deduplicateContent()` in `src/context-engine/engine.ts` with a pluggable similarity
  stage: keep the hash fast-path, add an optional `embedder?: (text) => Promise<number[]>` config
  hook mirroring the existing `summarizer` hook in `ContextEngineConfig` — user-supplied, so the
  core stays dependency-free.
- For tool results specifically, near-duplicates should become a *diff reference* ("same as turn N
  except: …") rather than deletion — `src/reverse/` machinery and the dedup placeholder format
  already established in `deduplicateContent` give the template.
- `mcp/dedup-cache.ts` gains the same optional stage for the MCP-server surface.

### Effort and risk

**Effort: M–L.** **Risk: high relative to PAKT's brand** — this is the first *semantically lossy*
judgment in the pipeline (two texts deemed "the same" at 0.85 cosine may differ in the one number
that matters). It must be opt-in, threshold-conservative, and ship with the diff-reference
fallback rather than silent dropping. Bundling any embedding model also strains the
browser/desktop/extension builds (`cache-breakpoint.ts`'s Buffer comment shows how careful those
surfaces already are) — hence the callback design.

### Verdict: **PROTOTYPE** (rank 6 — diff-reference variant first, embeddings second)

Real savings, real demand, but the riskiest fit with "lossless, model-free." The honest sequencing:
build the *deterministic* near-dup detector (normalized hashing + line-level diff references —
still model-free) and only then evaluate whether embeddings add enough over it to justify the hook.

---

## Evaluated and skipped

- **Streaming/incremental compression for long-running tool outputs** — *skip for now.* MCP tool
  results are delivered whole per the current spec (progress notifications exist, but content
  arrives at completion), so there's no streaming surface for `cli-proxy.ts` to compress
  incrementally; the practical 2026 pattern is "cap/summarize at ingestion, keep full output in
  files/logs" ([Zylos research](https://zylos.ai/research/2026-02-28-ai-agent-context-compression-strategies/)),
  which `ContextEngine.ageToolResults()` already approximates. Revisit if the MCP spec
  (the [2026-07-28 release candidate](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
  is the one to watch) adds chunked tool-result streaming. Speculation: it likely will, given the
  spec's recent velocity on tool output (`outputSchema` → full JSON Schema 2020-12).
- **LLMLingua-2 / RECOMP / SuperBPE / call-level semantic caching** — already on the roadmap
  (Tier 2/3); nothing found in this pass that changes those assessments.
- **KV-cache / quantization / speculative decoding** — provider-side, no PAKT surface (unchanged
  from roadmap's "deliberately skip" list).

---

## Ranked summary

| # | Feature | Effort | Risk | Verdict |
|---|---------|--------|------|---------|
| 1 | Provider cache-adapter middleware (`cache_control` / `prompt_cache_key`) | S | Low | **Build** |
| 2 | MCP tool-catalog slimming / search facade in `pakt proxy` | M | Medium | **Build** |
| 3 | Compaction-cooperative mode (safety pass + threshold alignment) | S+M | Medium | **Build** (safety pass first) |
| 4 | Token-budget-aware compression governor | M | Medium | **Prototype** (gate on comprehension evals) |
| 5 | TOON ingest/emit interop | S–M | Low | **Prototype** |
| 6 | Semantic dedup of tool results (diff-reference → embeddings) | M–L | High | **Prototype** (deterministic variant first) |
| — | Streaming/incremental tool-output compression | — | — | **Skip** (no MCP surface yet; revisit post next MCP spec) |

The through-line: ranks 1–3 all monetize machinery PAKT already has (`cache-breakpoint.ts`,
`cli-proxy.ts`, `context-engine/engine.ts`) against the three loudest documented 2026 cost sinks —
cache misses, tool-schema bloat, and lossy server-side compaction — without compromising the
lossless/model-free identity. Ranks 4–6 expand the surface and each needs eval evidence before
graduating.

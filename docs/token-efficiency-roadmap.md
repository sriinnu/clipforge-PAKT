# Token Efficiency Roadmap

A working list of techniques surveyed from 2024-2026 research that would extend PAKT's reach beyond the current L1-L5 layer model. Each item names the paper, the slot it fits in PAKT's pipeline, the headline savings claimed by the authors, and a difficulty estimate.

This document captures **what's next** (and what just shipped). For shipped layers and prior research, see [docs/research.md](./research.md) and [docs/articles/research-landscape-2024-2026.md](./articles/research-landscape-2024-2026.md). For ranked future features and polyglot port options, see [docs/research/2026-06-future-features.md](./research/2026-06-future-features.md) and [docs/research/2026-06-polyglot-port-options.md](./research/2026-06-polyglot-port-options.md).

---

## Recently Shipped — 0.11.0 (2026-06-10)

### ✓ Cache-synergy pack: rolling-dict in handleCompress + @cache prefix-end

**What shipped:**
- `RollingDictionary` wired into `handleCompress` (MCP `pakt_compress`) — cross-turn alias reuse is now on by default for explicit compress calls; opt out with `statelessDict: true`.
- `@cache prefix-end` directive emitted after `@dict ... @end` when `cacheTarget` is set or `cacheDirective: true`.
- `cache-breakpoint.ts::findCacheDirectiveOffset` returns the exact byte offset for provider `cache_control` / `cachePoint` placement.
- Prefix byte-stability verified by `tests/cache-stability.test.ts`.

**References:**
- Anthropic [Prompt Caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- OpenAI [Prompt Caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)

---

### ✓ Dictionary-as-system-prompt — `dictPlacement: 'inline' | 'system'`

**What shipped:**
- `compress()` accepts `dictPlacement: 'system'`; result carries `result.dictBlock` for placement in the system prompt.
- `decompress(body, { dict })` accepts an externally-supplied dict block (inline wins on conflict).
- CLI: `--dict-placement system --dict-out <file>` on compress; `--dict <file>` on decompress.
- MCP: `dictPlacement` parameter on `pakt_compress`.

**Paper:** *Lossless Prompt Compression via Dictionary-Encoding and In-Context Learning* — [arXiv:2604.13066](https://arxiv.org/abs/2604.13066).

---

### ✓ Meta-token compression beyond word boundaries (L3.5, opt-in, experimental)

**What shipped:**
- `src/layers/L3-5-metatoken.ts` — BPE token-span aliasing reusing the `@dict` path. Off in all profiles by default.
- Per-span safety gate: only writes rewrites that strictly decrease token count.
- Measured on bundled test fixtures (gpt-4o / o200k_base): ~3-4% additional savings on repetitive JSON/log payloads; 0% on non-repetitive data. These are fixture-level measurements, not the 15-30% figure from arXiv 2506.00307 (different workload/encoding scheme).

**Paper:** *Lossless Token Sequence Compression via Meta-Tokens* — Wang et al., [arXiv:2506.00307](https://arxiv.org/abs/2506.00307).

---

## Tier 1 — High-leverage, on-roadmap

*(The three items that were here — cache-synergy pack, meta-token layer, dictionary-as-system-prompt — shipped in 0.11.0. See "Recently Shipped" above.)*

---

## Tier 2 — Worth prototyping

### 4. SuperBPE-style cross-boundary merges

**Paper:** *SuperBPE* — referenced in the 2025 BPE optimisation literature. Removes the pretokenization restriction on BPE merges, achieving up to 33% fewer tokens at the same vocabulary size.

**PAKT slot:** L3 enhancement. PAKT could ship a small per-tokenizer "merge map" (frequent sequences across whitespace boundaries) that gets applied as a post-pass.

**Estimated lift:** Up to 15% additional compression on prose-heavy content. Effort: medium-high (requires offline learning per tokenizer family).

---

### 5. LLMLingua-2 as opt-in L6 lossy layer

**Paper:** *LLMLingua-2* — Microsoft, [arXiv:2403.12968](https://arxiv.org/abs/2403.12968). Task-agnostic prompt compression via token classification with a BERT-level encoder; 2-5x compression with accuracy preserved across QA, summarization, and reasoning.

**PAKT slot:** New optional L6 layer (lossy, opt-in) for non-structured prose where L1-L5 hit diminishing returns. Would require shipping or fetching a small classifier model.

**Estimated lift:** 2-5x on the prose path. Effort: high (model packaging, runtime, opt-in UX).

---

### 6. Semantic dedup with vector-distance matching

**Production guidance:** [PyImageSearch — Semantic Caching for LLMs (May 2026)](https://pyimagesearch.com/2026/05/04/semantic-caching-for-llms-ttls-confidence-and-cache-safety/), [Redis](https://redis.io/blog/what-is-semantic-caching/). Production workloads see 20-60% LLM-call elimination via semantic dedup; ~31% of queries are semantically similar.

**PAKT slot:** `dedupCache` already exists with hash-equality matching. Extending to embedding-distance dedup with a confidence threshold would cover the long tail of paraphrased prompts.

**Estimated lift:** 20-60% additional call elimination on top of compression savings. Effort: medium (needs an embedding provider; TTL + confidence scoring per the production hardening literature).

---

## Tier 3 — Far field

### 7. RECOMP-style retrieval context distillation

**Paper:** *RECOMP* — Xu, Shi, Choi, [arXiv:2310.04408](https://arxiv.org/abs/2310.04408). Compress retrieved documents to 6% of length with minimal quality loss via extractive + abstractive summarizers.

**PAKT slot:** Targets the `context-engine/` module (already in tree). PAKT today is a serialization layer; this would push it into the RAG-context-shaping space.

**Estimated lift:** 16x compression on retrieved-document context. Effort: very high (orthogonal to PAKT's current structural focus; effectively a new module).

---

### 8. Next-token-prediction lossless compression for stored stats

**Paper:** *Lossless Compression of LLM-Generated Text via Next-Token Prediction* — [arXiv:2505.06297](https://arxiv.org/abs/2505.06297) (May 2025). 20x compression vs Gzip's 3x.

**PAKT slot:** Off the hot path — `stats/persister.ts` historical record archives. Trades runtime CPU for disk space; only worth it for users with large persisted stats.

**Estimated lift:** ~7x reduction on stored stats footprint. Effort: medium (model dependency).

---

## What we deliberately skip

- **KV-cache compression at the model side** (DeltaKV, etc.) — PAKT is a client-side library; the cache lives inside the provider.
- **Quantization** — model-side concern, no PAKT surface area.
- **Speculative decoding** — output-side optimisation, orthogonal to PAKT's input compression.

---

## Survey sources

- *Prompt Compression for Large Language Models: A Survey* — [arXiv:2410.12388](https://arxiv.org/abs/2410.12388). Taxonomy of hard / soft / extractive / abstractive prompt-compression methods.
- *Awesome LLM Compression* — [github.com/HuangOwen/Awesome-LLM-Compression](https://github.com/HuangOwen/Awesome-LLM-Compression). Living index of compression papers and tools.
- *Contextual Compression in Retrieval-Augmented Generation: A Survey* — [arXiv:2409.13385](https://arxiv.org/abs/2409.13385).

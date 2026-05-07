# Token Efficiency Roadmap

A working list of techniques surveyed from 2024-2026 research that would extend PAKT's reach beyond the current L1-L5 layer model. Each item names the paper, the slot it fits in PAKT's pipeline, the headline savings claimed by the authors, and a difficulty estimate.

This document captures **what's next**, not what's shipped. For shipped layers and prior research, see [docs/research.md](./research.md) and [docs/articles/research-landscape-2024-2026.md](./articles/research-landscape-2024-2026.md).

---

## Tier 1 — High-leverage, on-roadmap

### 1. Prefix-stable @dict ordering for prompt-cache hits *(0.10, partial)*

**The opportunity:** Anthropic prompt cache reads cost 10% of base input tokens (90% off); OpenAI gives 50% off cached prefixes. The cached prefix has to be **byte-identical** across calls. PAKT's `@dict` block lives at the top of the output and is therefore in the cacheable region — but if the alias map reshuffles between turns, the cache invalidates.

**What landed in 0.10:**
- `RollingDictionary.seed()` now emits expansions in deterministic, append-only order (sorted by `discoveredAtTurn`, tie-broken lex).
- `compressL2()` pins seeded expansions to the same `$a, $b, ...` slots they had in prior turns; new winners append.
- `handleAuto` wires `rollingDict.seed()` and `update()` through the structured-format path.

**What's still ahead:**
- Wire rolling-dict into `handleCompress` (currently stateless).
- Emit a `@cache prefix-end` directive after `@dict ... @end` so MCP clients know exactly where to set provider `cache_control` breakpoints.
- Pin the L1 `@from <fmt>` and `@compress <mode>` headers to a fixed order (already mostly stable).

**Estimated lift:** 90% input-token cost reduction on multi-turn agent loops once the entire prefix is cache-stable. Effort: small.

**References:**
- Anthropic [Prompt Caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- OpenAI [Prompt Caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)

---

### 2. Meta-token compression beyond word boundaries

**Paper:** *Lossless Token Sequence Compression via Meta-Tokens* — Wang et al., [arXiv:2506.00307](https://arxiv.org/abs/2506.00307) (Aug 2025). LZ77-style lossless compression of token sequences, achieving 27%/18% length reduction with the decoder reconstructing the original deterministically.

**PAKT slot:** L3 (tokenizer-aware). PAKT today rewrites delimiters for tokenizer alignment; the meta-token approach generalises this to learn frequent multi-token spans across word boundaries.

**Implementation sketch:**
- Build a session-level frequency table of tokenizer-output spans, not raw substrings.
- Replace top-N spans with a sentinel character pair the decompressor can reverse.
- Constraint: the sentinel must round-trip through the same tokenizer the model uses.

**Estimated lift:** 15-30% additional savings on text-heavy content. Effort: medium (needs per-tokenizer span tables).

---

### 3. Dictionary-as-system-prompt for repetitive logs

**Paper:** *Lossless Prompt Compression via Dictionary-Encoding and In-Context Learning* — [arXiv:2604.13066](https://arxiv.org/abs/2604.13066). 60-80% compression on log-style data with 0.99+ exact-match round-trip, no fine-tuning required.

**PAKT slot:** A new MCP option `dictPlacement: 'inline' | 'system'`. When `'system'`, PAKT emits the body without the `@dict` block and returns the dictionary separately so the consumer can pin it to the system prompt — where prompt caching is most effective and survives across user turns.

**Estimated lift:** Compounds with #1; potentially 95%+ effective input-cost reduction for stable system contexts. Effort: small (handler-level wiring, no algorithm changes).

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

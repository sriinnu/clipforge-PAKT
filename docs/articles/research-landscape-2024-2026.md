# LLM Compression Research Landscape (2024--2026)

**Purpose:** Survey of compression techniques relevant to PAKT, organized
by approach. Informs roadmap decisions and positions PAKT in the literature.
**Last updated:** March 2026

---

## 1. Where PAKT Sits

PAKT occupies a unique niche: **rule-based, format-aware, model-agnostic
text-level compression**. No other system combines all three properties.

```
                    Model-Agnostic ──────── Model-Specific
                         │                       │
  Text-Level ──── [ PAKT ] ──── [ LLMLingua-2 ] ──── [ SCOPE ]
                         │                       │
  Latent-Level ─── [ ARC-Encoder ] ───── [ Gist Tokens ] ── [ ICAE ]
                         │                       │
  Runtime ──────── [ Compactor ] ──────── [ ZipCache ] ── [ KVTC ]
```

---

## 2. Text-Level Compression (PAKT's Domain)

### 2.1 Neural Token Classification

**LLMLingua-2** (Pan et al., arXiv:2403.12968, Mar 2024)
- Trains XLM-RoBERTa as keep/drop token classifier
- 2-5x compression, task-agnostic, bidirectional context
- 194K+ downloads on HuggingFace
- **Trade-off vs PAKT:** Higher compression on prose, but requires
  running a 560M-parameter model at compression time

**Selection-p** (arXiv:2410.11786, Oct 2024)
- Self-supervised token classification (no GPT-4 distillation)
- Avoids LLMLingua-2's dependency on expensive training data

### 2.2 Perplexity-Based Pruning

**LongLLMLingua** (arXiv:2310.06839, Oct 2023)
- Uses small LM perplexity to score token importance
- Adds query-awareness for long-context scenarios
- Predecessor to LLMLingua-2

**DSPC** (Gao et al., arXiv:2509.13723, Sep 2025)
- Two-stage: TF-IDF sentence filter + attention-based token pruning
- Training-free, outperforms LongLLMLingua
- **PAKT takeaway:** TF-IDF filtering is cheap and effective for prose

### 2.3 Generative Rewriting

**SCOPE** (Zhang et al., arXiv:2508.15813, Aug 2025)
- Rewrites prompt chunks via summarization (not token-dropping)
- Dynamic per-chunk compression ratios
- **PAKT takeaway:** Interesting for L4 prose, but adds LLM dependency

### 2.4 Salience-Based

**FrugalPrompt** (arXiv:2510.16439, Oct 2025)
- Token attribution scores for importance ranking
- Training-free, lightweight
- **PAKT takeaway:** Salience heuristics could inform L4 field dropping

---

## 3. Learned Compression Tokens (Latent Level)

### 3.1 Gist Tokens

**Gist Tokens** (Mu et al., arXiv:2304.08467, Apr 2023)
- Fine-tunes LLMs with special compression tokens
- Prompts compressed into virtual token representations
- **Critical finding (Dec 2024 study, arXiv:2412.17483):** Fails on
  synthetic recall tasks (needle-in-haystack). Near-lossless on
  summarization but catastrophic on exact retrieval.
- **PAKT validation:** Confirms need for lossless compression layers

**GistPool** (Petrov et al., arXiv:2504.08934, Apr 2025)
- Fixes gisting's long-context failure via average pooling
- No architecture changes to decoder

**UniGist** (Deng et al., arXiv:2509.15763, Sep 2025)
- Chunk-free training with "gist shift trick"
- Handles both detail-recall and long-range dependencies

**Sentence-Anchored Gist** (Tarasov et al., arXiv:2511.08128, Nov 2025)
- Anchors compression at sentence boundaries
- 2-8x compression on 3B LLaMA

### 3.2 External Encoders

**AutoCompressors** (Chevalier et al., arXiv:2305.14788, May 2023)
- Trains LLMs to produce "summary vectors" via unsupervised LM
- Foundation paper for learned compression
- No follow-up as of March 2026

**ARC-Encoder** (Pilchen et al., arXiv:2510.20535, Oct 2025)
- Separate encoder, works across multiple decoder LLMs
- 4-8x compression without fine-tuning the decoder
- **PAKT validation:** Portable encoder validates model-agnostic approach

**ICAE** (Ge et al., arXiv:2307.06945, Jul 2023)
- LoRA-adapted encoder → fixed "memory slots"
- Requires model fine-tuning

---

## 4. KV Cache Compression (Runtime Level)

### 4.1 Token Eviction

**Compactor** (Chari & Van Durme, arXiv:2507.08143, Jul 2025)
- Approximate leverage scores for token importance
- Training-free, 20-68% memory reduction
- vLLM integration with Triton kernels
- **PAKT takeaway:** Context-calibrated compression ratio idea

### 4.2 Quantization

**ZipCache** (He et al., arXiv:2405.14256, May 2024)
- Channel-separable tokenwise quantization
- 4.98x compression, 0.38% accuracy drop

**KVTC** (Staniszewski & Lancucki, arXiv:2511.01815, Nov 2025)
- PCA decorrelation + adaptive quantization + entropy coding
- Up to 20x compression

### 4.3 Delta / Residual

**DeltaKV** (Hao et al., arXiv:2602.08005, Feb 2026)
- Stores deltas between similar KV entries
- **PAKT adaptation:** Delta encoding for tabular arrays (implemented)

### 4.4 Pitfalls

**Pitfalls of KV Cache Compression** (arXiv:2510.00231, Oct 2025)
- KV compression degrades multi-instruction tasks
- Can cause system prompt leakage
- **PAKT advantage:** Text-level compression avoids these failure modes

---

## 5. Empirical Findings (Meta-Studies)

### 5.1 Extractive > Abstractive for Structured Data
**Source:** Jha et al., arXiv:2407.08892, Jul 2024 (UC Berkeley)
- Extractive compression outperforms abstractive for long-context inference
- **Validates PAKT's approach** (structural extraction, not summarization)

### 5.2 Moderate Compression Improves Performance
**Source:** Zhang et al., arXiv:2505.00019, Apr 2025
- Compression removes noise, can improve LLM accuracy on LongBench
- Compression hurts more on short contexts than long ones
- **Validates PAKT's structural denoising** (removing format overhead)

### 5.3 Lossy Compression Fails on Exact Recall
**Source:** Deng et al., arXiv:2412.17483, Dec 2024
- Gist-based compression catastrophically fails on needle-in-haystack
- **Validates PAKT's lossless-first design** (L1-L3 preserve everything)

### 5.4 Data Distribution Determines Compression Quality
**Source:** Lv et al., arXiv:2602.01778, Feb 2026
- High-entropy input compresses poorly regardless of method
- **Motivates PAKT's compressibility scoring** (implemented)

---

## 6. Key Takeaways for PAKT Roadmap

1. **Stay model-agnostic.** Neural compression (LLMLingua-2, gist tokens)
   achieves higher ratios but locks you to specific models/runtimes.
   PAKT's zero-dependency approach is a strategic advantage.

2. **Lossless first is validated.** The Dec 2024 gist study confirms that
   lossy compression fails on exact recall. PAKT's L1-L3 lossless layers
   are the right default.

3. **Compression CAN improve LLM quality.** The Apr 2025 empirical study
   shows noise removal helps. PAKT's structural denoising is not just
   cost savings -- it's quality improvement.

4. **Know before you compress.** The Feb 2026 data distribution paper
   motivates pre-compression analysis. PAKT's compressibility scoring
   addresses this directly.

5. **Delta encoding is low-hanging fruit.** DeltaKV's residual approach
   maps directly to PAKT's tabular arrays. High impact, low complexity.

6. **Query-aware compression is the next frontier.** LongCodeZip and
   ACC-RAG show that conditioning on intent dramatically improves
   compression quality. PAKT should add optional intent-awareness to L4.

---

## References

1. Pan, Z. et al. "LLMLingua-2: Data Distillation for Efficient and Faithful Task-Agnostic Prompt Compression." arXiv:2403.12968, Mar 2024.
2. "Selection-p: Self-Supervised Task-Agnostic Prompt Compression." arXiv:2410.11786, Oct 2024.
3. Jiang, H. et al. "LongLLMLingua: Accelerating and Enhancing LLMs in Long Context Scenarios via Prompt Compression." arXiv:2310.06839, Oct 2023.
4. Gao, Y. et al. "DSPC: Efficient Prompt Compression via Dual-Stage Token Pruning." arXiv:2509.13723, Sep 2025.
5. Zhang, X. et al. "SCOPE: Summarization-Based Context Compression for Efficient LLM Prompting." arXiv:2508.15813, Aug 2025.
6. "FrugalPrompt: Token Attribution-Based Prompt Compression." arXiv:2510.16439, Oct 2025.
7. Mu, J. et al. "Learning to Compress Prompts with Gist Tokens." arXiv:2304.08467, Apr 2023.
8. Deng, Y. et al. "When Gist Tokens Fail: Evaluating Compression Tokens on Exact Recall Tasks." arXiv:2412.17483, Dec 2024.
9. Petrov, A. et al. "GistPool: Efficient Context Compression via Average Pooling." arXiv:2504.08934, Apr 2025.
10. Deng, Y. et al. "UniGist: Unified Gist Token Training for Chunk-Free Context Compression." arXiv:2509.15763, Sep 2025.
11. Tarasov, S. et al. "Sentence-Anchored Gist Compression for Long-Context LLMs." arXiv:2511.08128, Nov 2025.
12. Chevalier, A. et al. "Adapting Language Models to Compress Contexts." arXiv:2305.14788, May 2023.
13. Pilchen, M. et al. "ARC-Encoder: Portable Context Compression across Decoder LLMs." arXiv:2510.20535, Oct 2025.
14. Ge, T. et al. "In-Context Autoencoder for Context Compression in a Large Language Model." arXiv:2307.06945, Jul 2023.
15. Chari, S. & Van Durme, B. "Compactor: Efficient KV Cache Compression via Approximate Leverage Scores." arXiv:2507.08143, Jul 2025.
16. He, J. et al. "ZipCache: Accurate and Efficient KV Cache Quantization with Salient Token Identification." arXiv:2405.14256, May 2024.
17. Staniszewski, M. & Lancucki, A. "KVTC: KV Cache Compression via Decorrelation and Entropy Coding." arXiv:2511.01815, Nov 2025.
18. Hao, Y. et al. "DeltaKV: Delta-Based Residual Compression for KV Caches." arXiv:2602.08005, Feb 2026.
19. "Pitfalls of KV Cache Compression for Multi-Instruction Tasks." arXiv:2510.00231, Oct 2025.
20. Jha, A. et al. "Extractive vs. Abstractive Context Compression for Long-Context Inference." arXiv:2407.08892, Jul 2024.
21. Zhang, Y. et al. "When Compression Improves LLM Performance: A Noise-Removal Perspective." arXiv:2505.00019, Apr 2025.
22. Lv, H. et al. "Data Distribution Matters: How Input Entropy Determines Compression Quality." arXiv:2602.01778, Feb 2026.

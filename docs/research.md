# Research Landscape

PAKT's design is informed by a systematic survey of 25+ papers from 2024-2026 on prompt compression, KV-cache compression, and structured-data serialization for LLMs. See [docs/articles/research-landscape-2024-2026.md](./articles/research-landscape-2024-2026.md) for the full survey.

## Directly adapted in 0.6

- **DeltaKV** (Hao et al., [arXiv:2602.08005](https://arxiv.org/abs/2602.08005), Feb 2026) -- Residual KV cache compression via long-range similarity. Adapted as delta encoding for tabular arrays.
- **Data Distribution Matters** (Lv et al., [arXiv:2602.01778](https://arxiv.org/abs/2602.01778), Feb 2026) -- Input entropy determines compression quality. Adapted as compressibility scoring.
- **Compactor** (Chari & Van Durme, [arXiv:2507.08143](https://arxiv.org/abs/2507.08143), Jul 2025) -- Context-calibrated compression ratios. Informed auto-profile recommendation.

## Validating PAKT's approach

- **LLMLingua-2** (Microsoft, [arXiv:2403.12968](https://arxiv.org/abs/2403.12968), 2024) -- Task-agnostic prompt compression via data distillation. Closest neural competitor; PAKT achieves comparable savings on structured data without running a model.
- **Gist Token Study** (Deng et al., [arXiv:2412.17483](https://arxiv.org/abs/2412.17483), Dec 2024) -- Lossy compression fails on exact recall. Validates PAKT's lossless-first L1-L3 design.
- **Extractive > Abstractive** (Jha et al., [arXiv:2407.08892](https://arxiv.org/abs/2407.08892), Jul 2024) -- Extractive compression outperforms abstractive for factual content. Validates PAKT's structural approach.
- **Compression Improves LLM Quality** (Zhang et al., [arXiv:2505.00019](https://arxiv.org/abs/2505.00019), Apr 2025) -- Moderate compression removes noise and can improve LLM accuracy.

## Previously cited

- **CompactPrompt** (2025) -- Structured prompt compression for financial datasets.
- **LTSC** (2024) -- LLM-driven Token-level Structured Compression.
- **LiteToken** (2025) -- Lightweight token compression for structured data.
- **Table Serialization Studies** -- Pipe-delimited formats outperform JSON for tabular LLM data.

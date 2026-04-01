# TF-IDF Pre-Filter & Sinkhorn Budget Allocation

**Sources:**
- DSPC (arXiv:2509.13723, Sep 2025) -- Gao et al. (TF-IDF filtering)
- mHC (arXiv:2512.24880, Dec 2025) -- Xie, Wei et al. (Sinkhorn allocation)
**Relevance to PAKT:** Mixed-content prose filtering, packer budget allocation
**Status:** Design proposals for future implementation

---

## Part A: TF-IDF Pre-Filter for Prose Sections

### 1. Problem

PAKT's mixed-content pipeline (`compressMixed`) identifies JSON/YAML/CSV
blocks embedded in markdown and compresses them independently. But the
surrounding prose -- paragraphs, explanations, headers -- passes through
unchanged. For large documents (API docs, README files, conversation
logs), prose can dominate the token budget.

### 2. Source: DSPC (Dual-Stage Progressive Compression)

DSPC (Gao et al., 2025) achieves state-of-the-art prompt compression
with zero training via a two-stage pipeline:

**Stage 1 -- Sentence Filtering (TF-IDF):**
- Compute TF-IDF scores for each sentence in the document
- Filter sentences below a threshold (low semantic contribution)
- This coarse pass removes 30-50% of prose cheaply

**Stage 2 -- Token Pruning:**
- Within surviving sentences, prune low-utility tokens using
  attention contribution + cross-model loss difference + positional
  importance signals
- This fine pass achieves another 20-30% compression

DSPC outperforms LongLLMLingua on long-context benchmarks while being
entirely training-free.

### 3. Adaptation for PAKT

We propose a lightweight TF-IDF sentence scorer for PAKT's mixed-content
pipeline. When processing markdown documents:

1. **Segment prose** into sentences (split on `.`, `!`, `?`, newlines)
2. **Compute document-frequency** for each word across all sentences
3. **Score each sentence** by sum of TF-IDF weights
4. **Mark low-scoring sentences** for optional removal in L4 mode

This is NOT for L1-L3 (which are lossless). It's an enhancement for
the L4 semantic layer when applied to mixed content.

### 4. Implementation Sketch

```
Input: markdown document with embedded JSON blocks
  ├── JSON blocks → existing PAKT compression (L1-L3)
  └── Prose sections → TF-IDF sentence scoring
       ├── High-score sentences: preserve verbatim
       ├── Medium-score sentences: compress if over budget
       └── Low-score sentences: candidates for removal (L4 only)
```

### 5. Why Defer

- Sentence segmentation is locale-sensitive and error-prone
- TF-IDF requires document-level statistics (not per-block)
- Most PAKT users compress structured data, not prose
- L4 semantic compression is already opt-in and rarely used
- Adding a TF-IDF dependency increases bundle size

**Recommendation:** Implement when mixed-content L4 compression is
requested by users. Keep it behind a feature flag.

---

## Part B: Sinkhorn-Based Budget Allocation for Packer

### 1. Problem

PAKT's context window packer (`pack()`) distributes a token budget
across multiple items using one of three strategies: priority, recency,
or balanced (60% priority + 40% recency). The current allocation is
linear -- items are sorted by score, then greedily packed until the
budget is exhausted.

This greedy approach has a failure mode: high-priority items consume
the entire budget, leaving no room for moderately important items that
collectively provide more context than any single high-priority item.

### 2. Source: mHC (Manifold-Constrained Hyper-Connections)

PAKT's proposed budget allocation draws on the classical Sinkhorn-Knopp
algorithm (1964) for doubly stochastic normalization, recently applied
in neural architectures like mHC (Xie, Wei et al., 2025). mHC solves
training instability in deep transformers by constraining mixing matrices
to be **doubly stochastic** -- matrices where all rows and columns sum
to 1. The normalization procedure:

```
1. Start with unconstrained logits matrix M
2. Exponentiate: A = exp(M)
3. Repeat 20 times:
   a. Normalize rows: A[i] = A[i] / sum(A[i])
   b. Normalize columns: A[:,j] = A[:,j] / sum(A[:,j])
4. Result: doubly stochastic matrix on the Birkhoff polytope
```

**Key properties:**
- Spectral norm <= 1 (prevents any single stream from dominating)
- Products of doubly stochastic matrices remain doubly stochastic
- Geometrically, these are convex combinations of permutations

### 3. Adaptation for PAKT Packer

Apply Sinkhorn normalization to budget allocation:

1. **Compute raw scores** for each item (priority, recency, size)
2. **Build allocation matrix** M where M[i] = raw score for item i
3. **Apply Sinkhorn normalization** to produce a doubly stochastic
   allocation vector (each item gets a fair, bounded share)
4. **Allocate tokens** proportionally: `budget_i = total_budget * M[i]`

This ensures:
- No single item can consume more than its fair share
- All items get a non-zero allocation (no starvation)
- The total budget is exactly consumed (no waste)
- The allocation is a smooth function of scores (no cliff effects)

### 4. Example

**5 items, 1000 token budget:**

| Item | Priority | Greedy Allocation | Sinkhorn Allocation |
|------|----------|-------------------|---------------------|
| A | 0.9 | 500 (50%) | 320 (32%) |
| B | 0.7 | 350 (35%) | 260 (26%) |
| C | 0.4 | 150 (15%) | 180 (18%) |
| D | 0.2 | 0 (dropped) | 130 (13%) |
| E | 0.1 | 0 (dropped) | 110 (11%) |

With greedy allocation, items D and E are dropped entirely. With
Sinkhorn, every item gets a proportional share, and even low-priority
items contribute context.

### 5. Why Defer

- Current packer works well for typical use cases (5-20 items)
- Sinkhorn adds O(N * iterations) overhead per pack call
- The benefit is marginal when items have similar sizes
- Need user feedback on whether the greedy failure mode is real

**Recommendation:** Implement when packer is used with 50+ items and
users report dropped items that should have been included. The
Sinkhorn algorithm itself is < 30 lines of code.

---

## 6. References

1. Gao et al., "DSPC: Dual-Stage Progressive Compression Framework
   for Long Context," arXiv:2509.13723, Sep 2025.
2. Xie, Wei et al., "mHC: Manifold-Constrained Hyper-Connections,"
   arXiv:2512.24880, Dec 2025.
3. Xie et al., "Hyper-Connections," arXiv:2409.19606, Sep 2024.
4. Pan, Wu, Jiang et al., "LLMLingua-2: Data Distillation for
   Efficient and Faithful Task-Agnostic Prompt Compression,"
   arXiv:2403.12968, Mar 2024.

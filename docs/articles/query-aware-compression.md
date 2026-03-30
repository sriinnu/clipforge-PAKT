# Query-Aware Compression: Intent-Driven Token Budgeting

**Source:** LongCodeZip (arXiv:2510.00446, Oct 2025) -- Shi, Qian et al.
**Also:** ACC-RAG (arXiv:2507.22931), CodePromptZip (arXiv:2502.14925)
**Relevance to PAKT:** Future L4 enhancement, intent-aware field prioritization
**Status:** Design proposal (not yet implemented)

---

## 1. Problem

PAKT compresses all fields equally. When a user asks "what is Alice's
email?", PAKT compresses the `email` field as aggressively as `address`,
`phone`, and `notes`. For lossless layers (L1-L3) this is fine -- all
data survives. But for L4 semantic compression, equal treatment means
the answer to the user's question might be the first thing dropped.

---

## 2. Source Papers

### 2.1 LongCodeZip (Shi, Qian et al., 2025)

LongCodeZip achieves 5.6x compression on code without degradation via
a **dual-stage query-aware** approach:

1. **Coarse stage:** Rank functions/classes by **conditional perplexity**
   relative to the user's instruction. Functions unrelated to the query
   are aggressively summarized or dropped.
2. **Fine stage:** Within surviving functions, apply block-level selection
   under an adaptive token budget.

The key insight: **compression should be conditioned on the downstream
task.** A function that's irrelevant to the query can be dropped entirely;
a function that's critical must be preserved verbatim.

**Results:** 5.6x compression, 108 upvotes on HuggingFace, outperforms
LLMLingua-2 on code-specific benchmarks.

### 2.2 ACC-RAG: Dynamic Context Compression for RAG (2025)

ACC-RAG dynamically adjusts compression rates in retrieval-augmented
generation based on query relevance:

- Documents scored by semantic similarity to the query
- High-relevance documents get light compression (preserve detail)
- Low-relevance documents get heavy compression (keep gist only)
- Multi-granular embeddings enable hierarchical compression

### 2.3 CodePromptZip (He, Wang, Chen, 2025)

CodePromptZip introduces **type-aware priority** for code compression:

- Identifiers and keywords have high preservation priority
- Comments and whitespace have low priority
- A copy mechanism preserves exact tokens when needed

This maps directly to structured data: keys > values, numbers > strings,
short values > long values (in terms of information density).

---

## 3. Design for PAKT

### 3.1 Intent Parameter

Add an optional `intent` field to `PaktOptions`:

```ts
compress(data, {
  intent: "find the user's email address",
  layers: { structural: true, dictionary: true, semantic: true },
  semanticBudget: 64,
});
```

### 3.2 Field Relevance Scoring

When `intent` is provided and L4 is enabled:

1. **Keyword extraction:** Extract nouns/verbs from intent string
   (simple regex, no NLP dependency)
2. **Field matching:** Score each JSON key by keyword overlap
   - Exact match: 1.0 (e.g., intent mentions "email", key is "email")
   - Partial match: 0.5 (e.g., intent mentions "contact", key is "contactEmail")
   - No match: 0.0
3. **Budget allocation:** High-relevance fields get proportionally more
   of the semantic budget; low-relevance fields are compressed first

### 3.3 Type-Aware Priority (from CodePromptZip)

Independent of intent, fields can be ranked by type:

| Field Type | Priority | Rationale |
|-----------|----------|-----------|
| Numeric IDs | Highest | Often query targets, exact recall required |
| Enum-like strings | High | Categorical data, few unique values |
| Short strings (< 20 chars) | Medium | Names, codes, identifiers |
| Long strings (> 100 chars) | Low | Descriptions, notes -- summarizable |
| Null values | Lowest | No information content |

---

## 4. Why Not Implement Now

Query-aware compression requires careful design:

1. **Keyword extraction quality** -- regex-based extraction is brittle.
   "Find users in New York" should match `city` but regex won't infer that.
2. **Lossless layers unaffected** -- L1-L3 don't drop data, so intent
   only matters for L4. Most users don't use L4.
3. **Scope creep risk** -- adding NLP inference defeats PAKT's zero-
   dependency advantage.

**Recommended approach:** Implement as a simple keyword-to-field matcher
in a future PR. No embeddings, no models. Let users explicitly annotate
field priorities if keyword matching is insufficient.

---

## 5. References

1. Shi, Qian et al., "LongCodeZip: Dual-Stage Code Compression for
   Long-Context LLMs," arXiv:2510.00446, Oct 2025.
2. Dynamic Context Compression for Efficient RAG (ACC-RAG),
   arXiv:2507.22931, Jul 2025.
3. He, Wang, Chen, "CodePromptZip: Type-Aware Priority-Driven
   Compression for Code," arXiv:2502.14925, Feb 2025.
4. Zhang, Wang, Wang, "SCOPE: A Generative Approach for LLM Prompt
   Compression," arXiv:2508.15813, Aug 2025.

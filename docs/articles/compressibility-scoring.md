# Compressibility Scoring: Know Before You Compress

**Source:** "Data Distribution Matters" (arXiv:2602.01778, Feb 2026) -- Lv et al.
**Also:** Compactor (arXiv:2507.08143) -- context-calibrated compression
**Relevance to PAKT:** Pre-compression analysis, `pakt inspect` enhancement
**Status:** Implemented in `packages/pakt-core/src/compressibility.ts`

---

## 1. Problem

PAKT compresses everything thrown at it, but not all inputs compress
equally well. A JSON array of 100 identical objects compresses 60%+.
A JSON object with 100 unique UUID values compresses barely 10%.

Users waste time compressing low-compressibility inputs. Worse, agents
using PAKT via MCP have no signal for whether compression is worth the
round-trip overhead. The `pakt_inspect` tool reports savings *after*
compressing -- but by then the work is already done.

---

## 2. Source Papers

### 2.1 Data Distribution Matters (Lv et al., 2026)

This paper studies how input data distribution affects prompt compression
quality. Key findings:

- **Input entropy negatively correlates with compression quality.**
  High-entropy text (diverse vocabulary, few repetitions) compresses
  poorly across all methods -- neural and rule-based alike.
- **Encoder-decoder alignment matters.** Compression quality depends on
  how well the compressed representation matches the decoder's
  expectations. For text-level compression (PAKT's domain), this means
  the compressed format must remain parseable by the target LLM.
- **Data-centric evaluation is essential.** Compression benchmarks that
  don't account for input distribution give misleading results.

### 2.2 Compactor: Context-Calibrated Compression (Chari & Van Durme, 2025)

Compactor introduces **context-calibrated compression** -- automatically
inferring the maximum safe compression ratio for a given input based on
statistical leverage scores. The key insight: instead of applying a fixed
compression ratio, analyze the input and adapt.

---

## 3. Adaptation for PAKT

We implement `estimateCompressibility()` -- a lightweight, zero-inference
function that analyzes input structure and returns a 0.0--1.0 score
predicting how well PAKT will compress it.

### 3.1 Scoring Dimensions

The score is a weighted combination of four structural signals:

| Signal | Weight | What It Measures |
|--------|--------|-----------------|
| **Repetition density** | 0.35 | Ratio of repeated values to total values |
| **Structural overhead** | 0.30 | Ratio of syntax tokens (braces, quotes, commas) to data |
| **Schema uniformity** | 0.20 | How consistent object shapes are across arrays |
| **Value brevity** | 0.15 | Average value length (shorter = less compressible) |

### 3.2 Scoring Algorithm

```
1. Parse input to detect format (JSON, YAML, CSV, text)
2. Extract all scalar values and structural tokens
3. Compute repetition density:
   - Count unique values vs total values
   - High repetition (many dupes) → high score
4. Compute structural overhead:
   - Count syntax characters ({, }, [, ], ", :, ,)
   - High overhead ratio → high score (more to strip)
5. Compute schema uniformity:
   - For arrays of objects: measure key consistency
   - Uniform schemas → high score (tabular compression)
6. Compute value brevity penalty:
   - Average value length < 3 chars → penalty (little to compress)
   - Average value length > 20 chars → bonus (dictionary candidates)
7. Weighted sum → final score [0.0, 1.0]
```

### 3.3 Score Interpretation

| Score Range | Label | Recommendation |
|-------------|-------|----------------|
| 0.0 -- 0.2 | Low | Skip compression; overhead may exceed savings |
| 0.2 -- 0.4 | Moderate | L1 structural only; dictionary unlikely to help |
| 0.4 -- 0.6 | Good | L1+L2 standard profile recommended |
| 0.6 -- 0.8 | High | L1+L2+L3 tokenizer profile; expect 30-50% savings |
| 0.8 -- 1.0 | Excellent | Full pipeline; tabular/repetitive data, 50%+ savings |

### 3.4 Example Outputs

**High compressibility (0.87):**
```json
[
  {"name": "Alice", "role": "engineer", "dept": "platform"},
  {"name": "Bob", "role": "engineer", "dept": "platform"},
  {"name": "Charlie", "role": "engineer", "dept": "platform"}
]
```
Why: uniform schema, repeated values ("engineer", "platform"), high
structural overhead (braces, quotes on every row).

**Low compressibility (0.18):**
```json
{"id": "a1b2c3d4", "token": "x9y8z7w6", "nonce": "q5r4s3t2"}
```
Why: all unique values, short keys, no arrays, minimal structural overhead.

---

## 4. Integration Points

- **`pakt inspect`**: Returns `compressibility` field alongside existing
  savings analysis. Agents can check compressibility *before* deciding
  to compress.
- **`compress()` fast-path**: When compressibility < 0.1, `compress()`
  can short-circuit and return the original input immediately.
- **MCP `pakt_inspect`**: Adds `compressibilityScore` and
  `compressibilityLabel` to the inspect response.

---

## 5. Relation to Information Theory

The compressibility score is a practical proxy for what information
theory calls **redundancy** -- the difference between the maximum
possible entropy and the actual entropy of the input. PAKT's L1
strips syntactic redundancy (format overhead), L2 strips value
redundancy (repeated n-grams), and the compressibility score
estimates both before any work is done.

Shannon's source coding theorem guarantees that no lossless
compression can beat the entropy rate. Our score approximates
this bound cheaply, without computing actual token-level entropy
(which would require running a tokenizer -- the very cost we're
trying to avoid).

---

## 6. References

1. Lv et al., "Data Distribution Matters: A Data-Centric Perspective
   on Context Compression," arXiv:2602.01778, Feb 2026.
2. Chari & Van Durme, "Compactor: Efficient KV Cache Compression via
   Approximate Leverage Scores," arXiv:2507.08143, Jul 2025.
3. Jha et al., "Characterizing Prompt Compression Methods for Long
   Context Inference," arXiv:2407.08892, Jul 2024.
4. Zhang et al., "An Empirical Study on Prompt Compression for Large
   Language Models," arXiv:2505.00019, Apr 2025.

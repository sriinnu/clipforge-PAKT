# Delta Encoding for Homogeneous Arrays

**Source:** DeltaKV (arXiv:2602.08005, Feb 2026) -- Hao et al.
**Relevance to PAKT:** L1.5 structural optimization for tabular data
**Status:** Implemented in `packages/pakt-core/src/layers/L1-delta.ts`

---

## 1. Problem

JSON arrays of objects with shared schemas are the most common structured
payload in LLM workflows -- API responses, database queries, log entries.
PAKT's L1 structural compression already converts these into tabular form:

```
users [3]{name|role|city}:
  Alice|dev|NYC
  Bob|dev|NYC
  Charlie|dev|NYC
```

But when adjacent rows share many values (e.g., same `role`, same `city`),
each repeated value still costs tokens. In the example above, `dev` appears
3 times and `NYC` appears 3 times -- 6 redundant tokens that L2 dictionary
would catch, but at the cost of a `@dict` header with alias overhead.

---

## 2. Source Paper: DeltaKV

DeltaKV (Hao et al., 2026) compresses KV caches in transformer inference
by exploiting **long-range similarity** between key-value pairs across
sequence positions. Instead of storing full KV tensors, DeltaKV:

1. Identifies a **reference frame** (the first occurrence of a pattern)
2. Stores subsequent occurrences as **deltas** (differences from reference)
3. Reconstructs original values via `reference + delta` at inference time

The core insight: in sequences with repeated structure, most of the
information is shared. Only the *differences* carry new information.

**Key results:** Up to 8x KV cache compression with < 1% accuracy loss
on LongBench, achieved without any model fine-tuning.

---

## 3. Adaptation for PAKT

We adapt DeltaKV's delta-from-reference principle to text-level tabular
compression. The mapping is direct:

| DeltaKV (KV Cache) | PAKT (Text Level) |
|---------------------|-------------------|
| Reference KV frame | First row of tabular array |
| Delta tensor | Changed fields only |
| Zero delta | `~` sentinel (unchanged) |
| Reconstruction | Replace `~` with previous row's value |

### 3.1 Delta Encoding Rules

Given a tabular array with N rows and M fields:

1. **Row 0** is always stored in full (the reference frame)
2. **Row i** (i > 0): for each field j, if `row[i][j] === row[i-1][j]`,
   emit `~` instead of the value
3. On decompression, `~` is replaced with the value from the previous row
4. A `@compress delta` header signals that delta encoding is active

### 3.2 Example

**Before delta encoding:**
```
users [5]{name|role|dept|city}:
  Alice|engineer|platform|NYC
  Bob|engineer|platform|NYC
  Charlie|engineer|platform|SF
  Diana|designer|product|SF
  Eve|designer|product|SF
```

**After delta encoding:**
```
@compress delta
users [5]{name|role|dept|city}:
  Alice|engineer|platform|NYC
  Bob|~|~|~
  Charlie|~|~|SF
  Diana|designer|product|~
  Eve|~|~|~
```

Token savings: 10 field values replaced by `~` sentinels. At ~1 token per
value vs 1 token for `~`, the savings come from shorter BPE sequences.
On highly repetitive data (logs, time-series), savings reach 20-40% on
top of L1 structural compression.

### 3.3 When NOT to Apply

Delta encoding is counterproductive when:
- Arrays have < 3 rows (overhead of `@compress delta` header)
- Rows are highly diverse (few `~` replacements, header cost wasted)
- Values are already short (single characters gain nothing from `~`)

The implementation gates on a **minimum delta ratio**: at least 30% of
field values must be `~` for delta encoding to activate.

---

## 4. Interaction with Other Layers

- **L1 (structural):** Delta encoding runs *after* L1 tabular conversion,
  as a post-pass on tabular arrays only. It does not affect objects,
  inline arrays, or list arrays.
- **L2 (dictionary):** Delta encoding reduces the pool of repeated values
  available for L2 aliasing. This is intentional -- `~` is cheaper than
  a `$a` alias (no dict header overhead). L2 still runs on remaining
  non-delta values.
- **L3 (tokenizer):** No interaction. Delta encoding operates on values,
  not delimiters.
- **L4 (semantic):** No interaction. L4 operates on the AST after delta
  encoding has already been applied.

---

## 5. References

1. Hao et al., "DeltaKV: Residual-based KV Cache Compression via
   Long-range Similarity," arXiv:2602.08005, Feb 2026.
2. He et al., "ZipCache: Accurate and Efficient KV Cache Quantization
   with Salient Token Identification," arXiv:2405.14256, May 2024.
3. Chari & Van Durme, "Compactor: Efficient KV Cache Compression via
   Approximate Leverage Scores," arXiv:2507.08143, Jul 2025.

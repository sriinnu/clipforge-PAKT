# PAKT Algorithms Reference

This document provides implementation-level detail for every algorithm and data
structure used in the PAKT compression engine. It complements
[PAKT-PAPER.md](./PAKT-PAPER.md) which covers the academic treatment and
evaluation. For the mixed-content pipeline and context-window packer algorithms,
see [algorithms-mixed-packer.md](./algorithms-mixed-packer.md).

---

## 1. L1: Structural Normalization

**Source:** `packages/pakt-core/src/layers/L1-compress.ts`

L1 converts parsed JavaScript data into a PAKT AST (`DocumentNode`). This is a
single recursive pass that maps each JS value to the most compact AST node type.

### 1.1 AST Node Types

| Node Type        | JS Source                  | PAKT Syntax             |
|------------------|----------------------------|-------------------------|
| `KeyValueNode`   | primitive field            | `key: value`            |
| `ObjectNode`     | nested plain object        | indented children       |
| `InlineArrayNode`| array of all primitives    | `key [N]: v1, v2, ...`  |
| `TabularArrayNode`| array of uniform objects  | `key [N]{f1\|f2}: ...`  |
| `ListArrayNode`  | array of mixed objects     | `- item` blocks         |
| `CommentNode`    | preserved comments         | `% ...`                 |

### 1.2 buildBody() -- Two-Phase Dispatch

```
function buildBody(obj):
  body <- empty list
  for each (key, value) in obj.entries:
    if value is Array:
      if every element is primitive:
        append InlineArray(key, value.map(toScalar))
      else if isTabular(value):             // see 1.3
        append TabularArray(key, value)
      else:
        append ListArray(key, value)         // recursive per item
    else if value is Object:
      append ObjectNode(key, buildBody(value))
    else:
      append KeyValue(key, toScalar(value))
  return body
```

**Complexity:** O(N) time and space, where N = total number of scalar values
across all nesting levels. Each value is visited exactly once.

### 1.3 Tabular Detection (Key Deduplication)

The `isTabular(arr)` check determines whether an array of objects can use the
column-header notation. All elements must be plain objects sharing the exact same
set of keys, and every value must be a primitive (no nested objects or arrays).

```
function isTabular(arr):
  if arr is empty: return false
  keys <- Object.keys(arr[0])
  if keys is empty: return false
  if any value in arr[0] is non-primitive: return false
  for each obj in arr[1..]:
    if obj is not a plain object: return false
    if Object.keys(obj).length != keys.length: return false
    for each k in keys:
      if k not in obj OR obj[k] is non-primitive: return false
  return true
```

When tabular, keys appear once in the field header rather than once per row:

```
users [3]{name|role|active}:
  Alice|developer|true
  Bob|developer|true
  Carol|designer|false
```

**Complexity:** O(K * R) where K = unique keys, R = number of rows.

### 1.4 Scalar Encoding

`toScalar(v)` maps JS values to typed AST scalars:

- `null` -> `NullScalar`
- `boolean` -> `BooleanScalar`
- `number` -> `NumberScalar` (raw string preserved)
- `string` -> `StringScalar` (auto-quoted if ambiguous)

Quoting is triggered when a string matches: numbers, booleans, `null`, or
contains `|`, `:`, `$`, `,`, leading/trailing whitespace, or escape characters.
This preserves round-trip fidelity: `"42"` (string) vs `42` (number).

---

## 2. L2: Dictionary Compression

**Source:** `packages/pakt-core/src/layers/L2-dictionary.ts`, `L2-candidates.ts`,
`L2-scoring.ts`, `L2-clone.ts`

### 2.1 Frequency Analysis (Exact Duplicates)

```
function findExactCandidates(body, minSavings):
  scalars <- collectStringScalars(body)    // unquoted only
  freq    <- count occurrences of each value
  candidates <- empty list
  for each (value, count) in freq:
    if count < 3 OR value.length < 2: skip
    vTok <- ceil(value.length / 4)         // BPE estimate
    netSavings <- (vTok - 1) * count - (vTok + 3)
    if netSavings >= minSavings:
      candidates.append({value, count, netSavings, type: 'exact'})
  return candidates
```

**Token estimation:** `estimateTokens(v) = max(1, ceil(len(v) / 4))`. This is
a fast BPE approximation that avoids importing a full tokenizer into the L2 hot
path.

**Net savings formula:**

```
netSavings = (vTok - 1) * occurrences - (vTok + 3)
              ^^^^^^^^^                  ^^^^^^^^^
              per-occurrence gain         dictionary entry cost
```

The `-1` accounts for the alias token (`$a`) replacing the full value. The `+3`
accounts for dictionary entry overhead (alias definition line in the header).

### 2.2 Prefix / Suffix / Substring Detection

**Prefix detection** (`findPrefixCandidates`): Sorts unique values
lexicographically. Adjacent sorted strings sharing a common start of >=8 chars
become prefix candidates. Uses sorted-adjacency comparison: O(V log V) sort +
O(V) scan.

**Suffix detection** (`findSuffixCandidates`): Reverses all strings, sorts, then
finds common prefixes of reversed strings (= common suffixes of originals).
Minimum suffix length is 6 characters.

**Substring detection** (`findSubstringCandidates`): Sliding-window n-gram
mining across 8 window sizes: `[32, 24, 20, 16, 12, 10, 8, 6]`. For each
window size, extracts all substrings and counts how many distinct values contain
them. Uses a dynamic break-even threshold:

```
minOccurrences = max(2, ceil((tokens + 3) / (tokens - 1)))
```

This ensures each alias saves more than the dictionary entry costs. Dominated
candidates (shorter substrings fully contained in a longer one with equal or
greater frequency) are pruned.

**Complexity:** O(V * W * L) where V = distinct values, W = window sizes (8),
L = max value length.

### 2.3 Greedy Selection with Simulation

After collecting all candidates, L2 runs a greedy simulation:

```
function selectAliases(candidates, allValues, minSavings):
  sort candidates by value.length descending       // dedup pass
  deduped <- remove candidates dominated by longer ones
  sort deduped by netSavings descending             // selection pass
  simValues <- copy of allValues
  selected  <- empty list
  for each candidate in deduped:
    if selected.length >= 52: break                 // MAX_ALIASES
    recount effective occurrences in simValues
    recompute netSavings with effective count
    if netSavings < minSavings: skip
    selected.append(candidate)
    replace matching values in simValues with alias placeholders
  return selected
```

The simulation prevents overestimation: once a value is replaced by an alias,
subsequent candidates cannot claim savings from that same text.

### 2.4 Alias Assignment

Aliases are assigned in selection order: `$a`..`$z` (indices 0-25),
`$aa`..`$az` (indices 26-51). Maximum 52 aliases.

```
function aliasForIndex(i):
  if i < 26: return "$" + char(97 + i)       // $a..$z
  return "$a" + char(97 + (i - 26))           // $aa..$az
```

### 2.5 Substitution Pass

Uses `cloneBody()` to produce a new AST (never mutates the input):

- **Exact matches:** value-to-alias map, whole-value replacement
- **Substring matches:** substring-to-alias map, inline `${alias}` replacement
  (longest substrings processed first to prevent partial overlaps)

Decompression reverses this: alias-to-expansion map, `${alias}` regex expansion.

---

## 3. L3: Tokenizer-Aware Gating

**Source:** `packages/pakt-core/src/layers/L3-tokenizer.ts`,
`packages/pakt-core/src/tokens/registry.ts`

### 3.1 Pluggable Tokenizer Registry

```
State: factories <- ordered list (most-recently-registered first)

function registerTokenCounter(factory):
  prepend factory to factories

function getTokenCounter(model):
  for each factory in factories:
    counter <- factory(model)
    if counter is not null: return counter
  return GptTokenCounter(model)              // BPE cl100k_base fallback
```

The registry is a chain-of-responsibility pattern. Custom factories return a
`TokenCounter` object `{model, count(text) -> number}` or `null` to pass through.

### 3.2 Indent Compression

L3's primary transform compresses 2-space indentation to 1-space:

```
function compressIndent(text):
  for each line in text.split('\n'):
    depth <- count consecutive 2-space pairs at line start
    if depth > 0:
      line <- ' '.repeat(depth) + line.slice(depth * 2)
  return joined lines
```

Benchmarked at ~2.5% token savings across cl100k_base and o200k_base. The
`@target l3` header signals the decompressor to reverse the transform (1-space
back to 2-space) before parsing.

### 3.3 Safety Gate

L3 is gated: token count is measured before and after. If compression does not
reduce the count, the `@target` header is removed via `revertL3()`. This ensures
L3 never makes output larger.

---

## 4. L4: Semantic (Lossy) Compression

**Source:** `packages/pakt-core/src/layers/L4-strategies.ts`,
`packages/pakt-core/src/layers/L4-text-transforms.ts`

L4 is opt-in and lossy. It applies AST-level strategies followed by text-level
transforms, stopping once the output fits within a token budget.

### 4.1 AST Strategies (Applied Progressively)

**Strategy A -- Value Truncation:** Collects all string scalars > 50 chars,
sorts by length descending, truncates to 40 chars + `"..."`. Mutates in-place.

```
function strategyValueTruncation(doc):
  long <- collectStringScalars(doc.body)
           .filter(s -> s.value.length > 50)
           .sort by length descending
  for each scalar in long:
    scalar.value <- scalar.value[0..40] + "..."
  return doc
```

**Strategy B -- Array Truncation:** Arrays with > 10 items are reduced to
first 3 + last 2 + summary node `"... (N more items)"`. Handles inline arrays,
tabular arrays, and list arrays.

```
function truncateArray(node):
  if node.length <= 10: return
  head   <- node.items[0..3]
  tail   <- node.items[-2..]
  middle <- node.length - 3 - 2
  node.items <- head + [summary("... ({middle} more items)")] + tail
```

**Strategy C -- Field Dropping:** Objects with > 8 fields have low-information
fields pruned (null, empty string, boolean values). Maximum 30% of fields
dropped.

**Strategy D -- Redundancy Collapse:** Consecutive list items with identical key
signatures (sorted key names joined by comma) are collapsed. Runs of >= 3
identical items become: first item + `"... (N identical)"`.

```
function collapseListArray(node):
  if node.items.length < 3: return
  i <- 0
  while i < items.length:
    sig     <- itemSignature(items[i])       // sorted key names
    runLen  <- count consecutive items with same sig
    if runLen >= 3:
      keep first + add summary("... ({runLen-1} identical)")
      advance i by runLen
    else:
      keep all items in run, advance i by runLen
```

### 4.2 Text-Level Transforms

Applied after AST serialization, in order:

1. **Whitespace normalization:** Collapse multiple spaces to single space in
   content (preserving leading indent). Strip trailing whitespace per line.
2. **Value abbreviation:** `true` -> `T`, `false` -> `F`, `null` -> `~`.
   Only in value positions (after `: ` or within pipe-delimited rows).
3. **Numeric precision reduction:** Numbers with 3+ decimal places reduced to 2.

Each transform is gated by token count; processing stops when within budget.

### 4.3 Activation

L4 is not enabled by default. Activated via `CompressOptions.layers.semantic =
true` with a token budget. Once applied, output is marked `@warning lossy` and
`reversible = false` in the result.

---

## 5. Mixed-Content Pipeline & Context Packer

Covered in [algorithms-mixed-packer.md](./algorithms-mixed-packer.md).

---

## 6. Related Research

| Paper | arXiv | Technique | PAKT Relationship |
|-------|-------|-----------|-------------------|
| **LLMLingua** | [2310.05736](https://arxiv.org/abs/2310.05736) | Perplexity-based token pruning via small LM | PAKT avoids neural inference; operates at format level |
| **LLMLingua-2** | [2403.12968](https://arxiv.org/abs/2403.12968) | Token classification (keep/drop labels) | PAKT uses deterministic structural rules, no training |
| **RECOMP** | [2310.04408](https://arxiv.org/abs/2310.04408) | Extractive/abstractive compressors | PAKT is extractive only at L4; L1-L3 are lossless |
| **Selective Context** | [2304.01568](https://arxiv.org/abs/2304.01568) | Self-information token pruning | PAKT's L4 field dropping is conceptually similar but uses heuristic scoring |
| **LongLLMLingua** | [2310.06839](https://arxiv.org/abs/2310.06839) | Query-aware long-context pruning | PAKT's packer uses priority/recency rather than query relevance |
| **AutoCompressors** | [2305.14788](https://arxiv.org/abs/2305.14788) | Soft token compression via trained LMs | PAKT is zero-shot; no model weights or fine-tuning |

**Interval overlap detection** uses a standard computational geometry technique:
sorted interval lists with binary search for range-overlap queries [see
de Berg et al., *Computational Geometry*, Ch. 10 -- interval trees and
sweepline algorithms].

---

## 7. Data Structures Summary

| Name | Location | Purpose | Complexity |
|------|----------|---------|------------|
| `AstNode[]` (BodyNode) | `layers/L1-compress.ts` | AST representation of structured data | O(N) space |
| `DictEntryNode[]` | `layers/L2-dictionary.ts` | Alias-to-expansion table | O(A) space, A = aliases (max 52) |
| `Map<string, number>` | `layers/L2-dictionary.ts` | Frequency counter for exact duplicates | O(V) space, V = distinct values |
| `AliasCandidate[]` | `layers/L2-candidates.ts` | Scored candidates for greedy selection | O(V) space |
| `[number, number][]` | `mixed/extractor.ts` | Sorted occupied intervals for overlap check | O(B) space, B = blocks |
| `PackerItem[]` | `packer/types.ts` | Context window items with priority | O(N) space |
| `TokenCounterFactory[]` | `tokens/registry.ts` | Pluggable tokenizer chain | O(F) space, F = registered factories |

---

*Last updated: March 2026*

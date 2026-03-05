# PAKT Algorithms Reference: Mixed-Content Pipeline & Context Packer

Continuation of [algorithms.md](./algorithms.md). Covers the mixed-content block
extraction pipeline and the context window packer algorithm.

---

## 5. Mixed-Content Pipeline

**Source:** `packages/pakt-core/src/mixed/extractor.ts`,
`packages/pakt-core/src/mixed/compress-mixed.ts`

### 5.1 Block Extraction

The extractor scans input text for structured data blocks in strict priority
order, ensuring higher-priority block types claim their ranges before
lower-priority ones are checked.

**Detection order:**

1. **YAML frontmatter** -- regex: `^---\n([\s\S]*?)\n---(?:\n|$)`. Only at
   document start. Always parsed as `yaml` format.

2. **Fenced code blocks** -- regex: `` /^(`{3,})([\w.-]*)\s*\n([\s\S]*?)^\1\s*$/gm ``.
   Language tag mapped via `{json, jsonc -> json, yaml, yml -> yaml, csv, tsv -> csv}`.
   Unrecognized tags fall back to auto-detection (confidence >= 0.8).

3. **Inline JSON** -- balanced brace counting (NOT regex). Scans each line
   for leading `{` or `[`, then walks forward tracking depth, string literals,
   and escape characters. Validates with `JSON.parse()` before accepting.

4. **CSV-like sections** -- runs of 3+ consecutive non-empty lines with
   consistent comma or tab delimiters (same column count across all rows).

```
function extractBlocks(text):
  allBlocks <- []

  // Phase 1: YAML frontmatter (highest priority)
  fm <- extractFrontmatter(text)
  if fm: allBlocks.append(fm)

  // Phase 2: Fenced code blocks
  fenced <- extractFencedBlocks(text)
  allBlocks.extend(fenced)

  // Phase 3: Inline JSON (skip occupied ranges)
  intervals <- buildOccupiedIntervals(allBlocks)
  inlineJson <- extractInlineJson(text, intervals)
  allBlocks.extend(inlineJson)

  // Phase 4: CSV sections (skip occupied ranges)
  intervals <- buildOccupiedIntervals(allBlocks)   // rebuild after JSON
  csvBlocks <- extractCsvSections(text, intervals)
  allBlocks.extend(csvBlocks)

  sort allBlocks by startOffset ascending
  return allBlocks
```

### 5.2 Interval-Based Overlap Prevention

This is the key algorithmic contribution of the mixed-content module.

**Problem:** When extracting blocks at different priority levels, later
extractors must not claim character ranges already occupied by earlier blocks.
The naive approach uses a `Set<number>` of every occupied character position --
this is O(N) memory proportional to document length. For a 100KB document, that
is ~100,000 entries in the set.

**Solution:** Sorted interval array `[start, end][]` with binary search.

#### buildOccupiedIntervals()

```
function buildOccupiedIntervals(blocks):
  intervals <- blocks.map(b -> [b.startOffset, b.endOffset])
  sort intervals ascending by start
  return intervals
```

**Complexity:** O(B log B) where B = number of already-extracted blocks
(typically 1-20 in real documents).

**Memory:** O(B) -- two numbers per block, vs O(N) for the set approach. For a
100KB document with 5 blocks: ~40 bytes vs ~100,000 bytes.

#### isOverlapping() -- Binary Search + Linear Walk

Two half-open ranges `[a, b)` and `[c, d)` overlap if and only if `a < d` AND
`c < b`.

```
function isOverlapping(start, end, intervals):
  // Binary search: find rightmost interval whose start < end
  lo <- 0
  hi <- intervals.length - 1
  candidate <- -1

  while lo <= hi:
    mid <- (lo + hi) >>> 1                   // unsigned right shift
    if intervals[mid].start < end:
      candidate <- mid
      lo <- mid + 1
    else:
      hi <- mid - 1

  if candidate == -1: return false

  // Walk left from candidate: intervals are sorted by START, not by end.
  // A wider interval earlier in the list may still overlap [start, end)
  // even when a later, narrower one does not. Cannot break early.
  for idx from candidate down to 0:
    if intervals[idx].end > start: return true

  return false
```

**Why the linear walk is necessary:** Intervals are sorted by `start`, not by
`end`. Consider these intervals:

```
intervals: [0, 1000], [50, 60], [100, 110]
query:     [500, 510]
```

Binary search finds `candidate = 2` (interval `[100, 110]` has start < 510).
But `[100, 110].end = 110` does not overlap `[500, 510]`. We must walk left to
find `[0, 1000].end = 1000 > 500`, which does overlap. If we broke early at
`[100, 110]`, we would miss the overlap.

**Complexity:**
- Binary search: O(log B)
- Left walk: O(B) worst case, O(1) amortized for non-overlapping intervals
- Total: O(log B + B) worst case, O(log B) amortized
- In practice, blocks rarely overlap, so the walk terminates quickly

#### Alternative: Interval Trees

An interval tree would provide O(log B) worst-case query time. PAKT uses the
simpler sorted-array approach because B is typically 1-20, making the constant
factors of an interval tree implementation more expensive than the linear walk.

### 5.3 Balanced Brace Counting (Inline JSON)

```
function findMatchingBracket(text, startIdx):
  open    <- text[startIdx]                  // '{' or '['
  close   <- '}' if open == '{' else ']'
  depth   <- 0
  inStr   <- false
  escaped <- false

  for i from startIdx to text.length:
    ch <- text[i]
    if inStr:
      if escaped:     escaped <- false
      else if ch == '\': escaped <- true
      else if ch == '"': inStr <- false
      continue
    if ch == '"':     inStr <- true
    else if ch == open:  depth++
    else if ch == close:
      depth--
      if depth == 0: return i

  return -1                                  // unmatched
```

**Complexity:** O(N) where N = length from startIdx to closing bracket. Handles
nested structures, escaped characters, and string literals correctly.

### 5.4 Per-Block Compression Routing

Each extracted block is compressed independently through the PAKT pipeline.
Compressed blocks are wrapped in HTML comment markers:

```
function compressMixed(input, options):
  blocks <- extractBlocks(input)
  if blocks is empty: return passthrough

  replacements <- []
  for each block in blocks:
    result <- compress(block.content, {fromFormat: block.format, ...options})
    origTokens  <- countTokens(block.content)
    compTokens  <- countTokens(result.compressed)
    if compTokens < origTokens:
      wrapped <- "<!-- PAKT:{format} -->\n{compressed}\n<!-- /PAKT -->"
      replacements.append({block.startOffset, block.endOffset, wrapped})

  // Apply replacements in reverse offset order to preserve positions
  compressed <- input
  for each replacement in replacements.reversed():
    compressed <- compressed[0..start] + replacement + compressed[end..]

  return compressed
```

The reverse-order application is critical: replacing blocks from end-to-start
preserves the character offsets of earlier blocks.

---

## 6. Context Window Packer

**Source:** `packages/pakt-core/src/packer/packer.ts`,
`packages/pakt-core/src/packer/types.ts`

### 6.1 Sorting Strategies

Three strategies determine the order in which items are considered for packing:

**Priority:** Descending priority score (higher = more important). Ties broken
by original array order (stable sort).

```
sort items by item.priority descending
```

**Recency:** Reverse array order (last item in input = most recent = first
considered).

```
sort items by originalIndex descending
```

**Balanced:** Weighted combination: 60% priority + 40% recency. Recency is
normalized to `[0, 1]` based on position in the original array.

```
function score(item, maxIndex):
  priorityScore <- item.priority or 0
  recencyScore  <- item.originalIndex / maxIndex    // 0..1
  return priorityScore * 0.6 + recencyScore * 0.4

sort items by score descending
```

### 6.2 Adaptive Compression

Items in the bottom 30% of the sorted list (position ratio >= 0.7) receive more
aggressive compression: L3 (tokenizer-aware) is force-enabled and the dictionary
minimum savings threshold is lowered from 3 to 2.

```
function compressItem(item, model, options, positionRatio):
  compressOpts <- copy of options.compressOptions
  if adaptiveCompression AND positionRatio >= 0.7:
    enable L1 + L2 + L3
    compressOpts.dictMinSavings <- min(current, 2)

  result <- compress(item.content, compressOpts)
  verified <- countTokens(result.compressed, model)

  if verified < originalTokens:
    return compressed result
  else:
    return original (compression did not help)
```

### 6.3 Greedy Packing Algorithm

```
function pack(items, options):
  strategy       <- options.strategy or 'priority'
  model          <- options.model or 'gpt-4o'
  reserveTokens  <- options.reserveTokens or 50
  effectiveBudget <- options.budget - reserveTokens

  // 1. Index items (preserve original position for recency)
  indexed <- items.map((item, i) -> {item, originalIndex: i})

  // 2. Sort by strategy
  sorted <- sortByStrategy(indexed, strategy)

  // 3. Greedily pack
  packed    <- []
  dropped   <- []
  usedTokens <- 0

  for i from 0 to sorted.length:
    positionRatio <- i / (sorted.length - 1)
    compressed <- compressItem(sorted[i], model, options, positionRatio)
    remaining  <- effectiveBudget - usedTokens

    if compressed.tokens <= remaining:
      packed.append(compressed)
      usedTokens += compressed.tokens
    else:
      dropped.append({id, reason: 'over_budget', tokensNeeded: compressed.tokens})

  // 4. Build statistics
  return {packed, dropped, totalTokens: usedTokens, remainingBudget, stats}
```

**Complexity:** O(N log N) for sorting + O(N) for the packing scan, where
N = number of input items. Each item is compressed exactly once. The compression
itself is O(M) per item where M = item content size.

### 6.4 Token Budgeting

The `reserveTokens` parameter (default 50) reserves space for framing overhead
(separators between packed items, system prompt fragments). The effective budget
is `budget - reserveTokens`.

Each item's token count is independently verified after compression --
`countTokens(compressed)` is called rather than trusting the savings reported by
`compress()`. This double-verification prevents budget overruns from estimation
errors.

### 6.5 Error Handling

Compression failure for any individual item is caught and the original
uncompressed text is used as fallback. This ensures the packer never blocks a
production pipeline -- at worst, an item uses more tokens than ideal.

---

## Data Structures Summary (Mixed + Packer)

| Name | Location | Purpose | Complexity |
|------|----------|---------|------------|
| `ExtractedBlock[]` | `mixed/extractor.ts` | Detected structured blocks with offsets | O(B) space |
| `[number, number][]` | `mixed/extractor.ts` | Sorted occupied intervals | O(B) space |
| `MixedBlockResult[]` | `mixed/compress-mixed.ts` | Per-block compression metadata | O(B) space |
| `IndexedItem[]` | `packer/packer.ts` | Items with preserved original index | O(N) space |
| `PackedItem[]` | `packer/types.ts` | Successfully packed items with stats | O(N) space |
| `DroppedItem[]` | `packer/types.ts` | Items dropped due to budget overflow | O(N) space |
| `PackerStats` | `packer/types.ts` | Aggregate packing statistics | O(1) space |

---

*Last updated: March 2026*

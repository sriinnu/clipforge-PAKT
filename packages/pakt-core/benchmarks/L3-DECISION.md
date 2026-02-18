# L3 Tokenizer-Aware Compression -- Decision

## Status: NOT IMPLEMENTED

## Summary

L3 (tokenizer-aware compression) was evaluated via a benchmark gate
(`benchmarks/tokenizer.bench.ts`) that tests whether alternative text
representations yield meaningful token savings on PAKT output.

## What was tested

Four categories of text representation were evaluated across all seven
benchmark fixtures (small-objects.json, tabular-50.json, nested-config.json,
api-response.json, wide-object.json, mixed-types.yaml, large-table.csv),
using both cl100k_base (GPT-4) and o200k_base (GPT-4o) tokenizers:

1. **Delimiters**: `|` (baseline) vs `\t` vs `,` vs `;`
2. **Booleans**: `true/false` (baseline) vs `T/F` vs `1/0`
3. **Whitespace**: 2-space indent (baseline) vs 1-space vs tab
4. **Number formats**: as-is (baseline) vs strip trailing zeros

## Why savings are low

- The pipe `|` character is already a single BPE token in both cl100k
  and o200k. Alternative delimiters (tab, comma, semicolon) are also
  single tokens. The difference is how they merge with adjacent text --
  pipe actually merges well in practice.
- `true` and `false` are each a single token in both encodings. `T`/`F`
  and `1`/`0` are also single tokens. No savings.
- Indentation (2-space) is a tiny fraction of total tokens. Switching
  to 1-space saves one character per indent level, but BPE often merges
  `  ` (two spaces) into a single token anyway.
- Trailing zero stripping rarely applies -- most numbers in real data
  either have no decimals or already lack trailing zeros.

## Decision

Combined savings across all transforms stacked together are expected to
be well below the 3% threshold. The complexity of implementing L3
(tokenizer profiles, model-specific transforms, `@target` header
handling, decompression normalization) is not justified by sub-3% gains.

Run `pnpm --filter @yugenlab/pakt bench` to verify with actual numbers.

## Threshold

- Required: >= 3% average savings across fixtures and tokenizers
- The gate benchmark (`tokenizer.bench.ts`) prints a PASS/FAIL verdict.

# Benchmark Snapshot

Release-facing fixture snapshot for `@sriinnu/pakt@0.8.0`.

## Method

- Generated with `scripts/release/generate-benchmark-snapshot.mjs`
- Token counting uses the package default model path (`gpt-4o` via `gpt-tokenizer`)
- Release-facing baseline is the default lossless path: `L1 + L2`
- Tradeoff section also measures lossless `L1 + L2 + L3` and lossy `L1 + L2 + L3 + L4` with per-fixture budgets set to 70% of the lossless `L1 + L2` token count
- Fixtures come from `packages/pakt-core/benchmarks/fixtures/`

## Default Lossless Snapshot

| Fixture | Original | Compressed | Savings | L1 | L2 | Dict | Note |
|---|---:|---:|---:|---:|---:|---:|---|
| Small object array | 480 | 227 | +53% | 253 | 0 | 0 | Uniform JSON rows compress well via tabular L1 encoding. |
| Tabular JSON (50 rows) | 3086 | 1431 | +54% | 1630 | 25 | 10 | Best-fit PAKT shape: repeated keys plus repeated values. |
| Nested config JSON | 837 | 637 | +24% | 200 | 0 | 0 | Moderate gains from structural simplification, limited L2 help. |
| API response JSON | 2199 | 1849 | +16% | 350 | 0 | 0 | Less regular than tabular data, so savings are lower. |
| Wide object JSON | 520 | 406 | +22% | 114 | 0 | 0 | Single-object payloads save some syntax but little repetition. |
| Mixed YAML config | 700 | 646 | +8% | 54 | 0 | 0 | YAML already removes some JSON syntax overhead, so gains are smaller. |
| Large CSV table | 3000 | 3236 | -8% | 0 | 0 | 0 | CSV is already compact; PAKT is not a universal win here. |

## L3 / L4 Tradeoff Snapshot

| Fixture | L1+L2 | L1+L2+L3 | L3 Δ | L1+L2+L3+L4 | L4 Budget | L4 Δ |
|---|---:|---:|---:|---:|---:|---:|
| Small object array | 227 | 222 | +5 | 222 | 158 | +5 |
| Tabular JSON (50 rows) | 1431 | 1376 | +55 | 263 | 1001 | +1168 |
| Nested config JSON | 637 | 630 | +7 | 630 | 445 | +7 |
| API response JSON | 1849 | 1846 | +3 | 265 | 1294 | +1584 |
| Wide object JSON | 406 | 403 | +3 | 403 | 284 | +3 |
| Mixed YAML config | 646 | 632 | +14 | 409 | 452 | +237 |
| Large CSV table | 3236 | 3141 | +95 | 221 | 2265 | +3015 |

## Readout

- Best fixture: **Tabular JSON (50 rows)** at **54%** token savings
- Weakest fixture: **Large CSV table** at **-8%** token savings
- Positive-savings fixtures: **6/7**
- Best L3 uplift: **Large CSV table** at **95** additional tokens saved beyond the default lossless path
- Best budgeted L4 uplift: **Large CSV table** at **3015** additional tokens saved beyond the default lossless path
- L4 triggered lossy output on **4/7** fixtures in this snapshot
- L4 deltas reflect budget-fitting lossy output; large jumps mean information was discarded to hit the target budget, not that the lossless format suddenly became better.
- Honest takeaway: PAKT is strongest on JSON-like structured payloads with repeated keys, tabular rows, or repeated values. It is not a blanket improvement for already-compact CSV.

## Public Claim Guardrails

- Safe lossless claim: **typical 30-50% savings on structured payloads across the core L1-L3 pipeline**
- Clarify that higher gains mainly show up on tabular and repetitive JSON
- Treat L4 numbers as opt-in, budgeted, and lossy; do not mix them into lossless marketing copy
- Do not frame PAKT as a general prose compressor
- Mention that the browser extension is experimental


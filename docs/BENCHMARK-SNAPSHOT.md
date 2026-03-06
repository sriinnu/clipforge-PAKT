# Benchmark Snapshot (v0.4.3)

Release-facing benchmark summary for `@sriinnu/pakt@0.4.3`.

## Scope

- Mode: default **lossless** compression (`L1 + L2`)
- Tokenizer path: package default (`gpt-4o` via `gpt-tokenizer`)
- Fixtures: `packages/pakt-core/benchmarks/fixtures/`
- Generator: `scripts/release/generate-benchmark-snapshot.mjs`

## Fixture Results

| Fixture | Original | Compressed | Savings | L1 | L2 | Dict | Interpretation |
|---|---:|---:|---:|---:|---:|---:|---|
| Small object array | 481 | 214 | +56% | 267 | 0 | 0 | Strong structural compaction from repeated object shape. |
| Tabular JSON (50 rows) | 3092 | 1435 | +54% | 1632 | 25 | 10 | Best-fit case: repeated keys and repeated values. |
| Nested config JSON | 828 | 630 | +24% | 198 | 0 | 0 | Moderate gains from syntax reduction and structure flattening. |
| API response JSON | 2196 | 1840 | +16% | 356 | 0 | 0 | Savings present, but less regular than tabular payloads. |
| Wide object JSON | 519 | 405 | +22% | 114 | 0 | 0 | Single object still benefits from structural rewrite. |
| Mixed YAML config | 700 | 646 | +8% | 54 | 0 | 0 | Lower gain because YAML is already relatively compact. |
| Large CSV table | 3017 | 3222 | -7% | 0 | 0 | 0 | Negative case: flat CSV can already be compact. |

## Summary Stats

- Best case: **+56%** (`Small object array`)
- Worst case: **-7%** (`Large CSV table`)
- Positive fixtures: **6 / 7**
- Median across fixtures: **+22%**
- Mean across fixtures: **+25%**
- Weighted total (all fixtures): `10833 -> 8392` = **+23%**
- Weighted structured-only total (excluding CSV): `7816 -> 5170` = **+34%**

## What This Supports Publicly

- Defensible claim: **typical 30-50% savings on structured payloads**
- Works best on JSON-like/tabular/repetitive structures
- Can be neutral or worse on already-compact CSV
- Not positioned as a general prose compressor

## Reproduce

Run from repo root:

```bash
pnpm bench:snapshot
```

This regenerates this file using the current benchmark fixtures and defaults.

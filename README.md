<p align="center">
  <img src="assets/pakt-logo.svg?v=2" alt="PAKT" height="60" />
</p>

<h3 align="center">ClipForge PAKT</h3>

<p align="center">
  Lossless-first, model-free token compression for structured data sent to LLMs.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@sriinnu/pakt"><img src="https://img.shields.io/npm/v/@sriinnu/pakt?color=6366f1&label=npm" alt="npm version" /></a>
  <a href="https://github.com/sriinnu/clipforge-PAKT/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b5cf6" alt="license" /></a>
  <a href="https://github.com/sriinnu/clipforge-PAKT/actions"><img src="https://img.shields.io/github/actions/workflow/status/sriinnu/clipforge-PAKT/ci.yml?label=CI&color=22c55e" alt="CI" /></a>
  <!-- SPONSOR-BADGES-START -->
  <!-- SPONSOR-BADGES-END -->
</p>

---

## What it is

**PAKT** (Pipe-Aligned Kompact Text) converts JSON, YAML, CSV, Markdown, and text into a compact pipe-delimited form that tokenizes to fewer BPE tokens than the original — so the same data costs less to send to an LLM. It is deterministic and runs no model: no inference cost, no extra latency, and nothing that can hallucinate.

The core layers (`L1–L3`) are **lossless** — `decompress()` returns the input byte-for-byte. A separate `L4` layer is opt-in, budgeted, and explicitly lossy.

It does not help everything. Small, deeply-nested config objects can come out *larger* (measured +25% on one ~160-line config). Prose with no repetition compresses to nothing and is passed through unchanged. `pakt_inspect` / `pakt auto` tell you whether a given payload is worth compressing before you commit.

```
JSON (28 tokens)                    PAKT (15 tokens)
------------------------------      --------------------------
{                                   @from json
  "users": [                        @dict
    { "name": "Alice",                $a: dev
      "role": "dev" },             @end
    { "name": "Bob",
      "role": "dev" }              users [2]{name|role}:
  ]                                   Alice|$a
}                                     Bob|$a
```

## What it saves (and where it doesn't)

Savings are content-dependent. Measured on the bundled fixtures (gpt-4o / `o200k_base`):

| Input | Savings | Round-trip |
|---|---|---|
| JSON, 10 records | 27% | lossless |
| JSON, 50 records | 33% | lossless |
| Log lines with duplicates | 57% | lossless |
| Repetitive text | 38–69% | lossless |
| Small deeply-nested config | **−25% (expands)** | lossless |
| Prose, no repetition | 0% (passthrough) | unchanged |

Full reproducible numbers: [docs/BENCHMARK-SNAPSHOT.md](./docs/BENCHMARK-SNAPSHOT.md).

## Does the model still read it correctly?

Lossless on bytes does not by itself prove a model understands the compressed form as well as raw JSON, so this is measured directly. The harness asks every question of both formats and uses matched-pair scoring with a two-sided sign test.

Comprehension suite, 36 questions × 4 runs = 144 paired observations, through the Claude Code CLI:

| | JSON | PAKT |
|---|---|---|
| Pooled accuracy | 73.6% | 70.8% |

The formats agreed on 124/144 questions. Of the 20 that diverged, PAKT was right on 8 and JSON on 12 — a sign test gives **p = 0.50**, indistinguishable from chance. So on this suite PAKT is **comprehension-neutral versus minified JSON: no statistically significant penalty, and none measured the other way either.**

This is one suite, measured through one agent harness at one setting. Reproduce or extend it with `node scripts/eval/run.mjs --provider cli --cli claude` (uses a local Claude Code/Codex subscription) or `--provider anthropic` with an API key. Details and the harness's reasoning: [scripts/eval/README.md](./scripts/eval/README.md).

## Install

```bash
npm install @sriinnu/pakt
```

Node 18+ for the package; Node 22+ to develop this repo.

```ts
import { compress, decompress, detect } from '@sriinnu/pakt';

const result = compress('{"users":[{"name":"Alice","role":"dev"},{"name":"Bob","role":"dev"}]}');
console.log(result.compressed);
console.log(`Saved ${result.savings.totalPercent}% tokens`);

const original = decompress(result.compressed, 'json'); // byte-for-byte for L1–L3
console.log(detect('name,role\nAlice,dev').format);      // 'csv'
```

## How it works

Compression is layered. Each app and CLI surface exposes the same profiles:

- **`L1` Structural** — pipe-delimited rewrite that drops JSON's syntactic overhead.
- **`L2` Dictionary** — aliases repeated values into a `@dict` block.
- **`L3` Tokenizer-aware** — uses a real BPE tokenizer (`gpt-tokenizer`) to pick forms the model actually merges, rather than byte-level guesses that disappear at the API boundary.
- **`L4` Semantic** — opt-in and **lossy**; requires a positive `semanticBudget`. Off unless you ask for it.

`L1–L3` round-trip exactly; delta encoding for tabular arrays applies automatically when it pays off.

## Beyond a single payload

These are opt-in and aimed at agent loops. The lossless paths are on by default; the lossy ones are off until you enable them.

- **MCP server** — `pakt serve --stdio` exposes `pakt_compress`, `pakt_auto`, `pakt_inspect`, `pakt_stats`, `pakt_explain`, `pakt_savings`, `pakt_dashboard`. Same logic as the CLI and library.
- **Context engine** — `createContextEngine()` compresses tool results, deduplicates repeated content across turns, ages old tool output to a tail, and (default on, lossless) shares a cross-message `@shared` dictionary. Opt-in and **lossy**: query-aware extractive line selection (`extractive`) and comment/blank-line code compaction (`compactCode`). The comprehension impact of these lossy passes has not yet been measured on a live model — treat them as experimental.
- **Optional neural tier** — `combineWithGuarantee()` lets you plug in a neural compressor (you supply the model) and keeps its output only when it is smaller *and* passes your fidelity check; otherwise it falls back to the deterministic result. The combined output is never larger than the deterministic baseline. No model is bundled.
- **Prompt-cache cooperation** — PAKT keeps the `@dict` prefix byte-stable across turns and emits a cache-breakpoint hint, so a provider's own prefix cache can reuse it. The cost reduction there comes from the provider's cache; PAKT's part is making the prefix stable.

## Why not …

- **LLMLingua / LLMLingua-2** — neural compressors: they run a model to rewrite the prompt (lossy, model-dependent, adds cost and latency). PAKT is deterministic and runs no model. Comparable savings on structured data; different trade-offs.
- **TOON** — the inspiration for PAKT's `L1` syntax (credited below). PAKT adds the dictionary layer, tokenizer-aware packing, delta encoding, multi-format input, and the MCP/CLI surfaces.
- **gzip / brotli** — compress bytes, but the API bills tokens after BPE; a gzipped prompt still costs full tokens once decoded. PAKT reshapes the text so the tokenizer itself emits fewer tokens.
- **Minifying JSON** — worth doing, but only removes whitespace. PAKT minifies, then adds dictionary and tokenizer-aware layers on top.

## Repository

pnpm workspace monorepo:

```
packages/
  pakt-core/     compression engine, CLI, MCP server  (@sriinnu/pakt)
  pakt-python/   thin Python wrapper                   (pakt-client, not yet published)
apps/
  playground/    local web UI for trying inputs
  desktop/       Tauri tray app + telemetry dashboard
  extension/     Chrome extension (experimental)
docs/            format spec, benchmark snapshot, research
scripts/eval/    comprehension eval harness
```

`pnpm install && pnpm build`, `pnpm test`. Version history is in [CHANGELOG.md](./CHANGELOG.md).

See the **[pakt-core README](./packages/pakt-core/README.md)** for the full API, CLI, and format spec. The hosted playground (runs locally in the browser, uploads nothing): [pakt-4f9.pages.dev](https://pakt-4f9.pages.dev/).

## Status and limitations

- `@sriinnu/pakt` (core library, CLI, MCP server) is the stable, released surface.
- The desktop app is validated on macOS; the Windows/Linux tray targets exist in source but are not validated.
- The browser extension is complete but has not been submitted to a store or smoke-tested on live sites.
- `pakt-client` (Python) is a subprocess wrapper, not a port, and is not yet on PyPI.
- `L4` semantic mode, extractive selection, and code compaction are lossy and off by default.
- The comprehension result above is one suite through one harness; broader validation is open work.

## Credits

PAKT's `L1` syntax is directly inspired by **[TOON Format](https://github.com/toon-format/spec)** by **[Nicholas Charlton](https://github.com/nichochar)**, which showed that structured data can drop JSON's syntactic overhead and stay unambiguous. PAKT builds on it with the dictionary layer, multi-format input, and lossless round-tripping.

Relevant research: LLMLingua-2 ([arXiv:2403.12968](https://arxiv.org/abs/2403.12968)); the Gist Token study on lossy recall failure ([arXiv:2412.17483](https://arxiv.org/abs/2412.17483)), which motivates the lossless-first design; DeltaKV ([arXiv:2602.08005](https://arxiv.org/abs/2602.08005)), adapted for tabular delta encoding. Full list: [docs/research.md](./docs/research.md).

## License

[MIT](./LICENSE) — Srinivas Pendela. Independently maintained; sponsorship is optional ([GitHub Sponsors](https://github.com/sponsors/sriinnu)).

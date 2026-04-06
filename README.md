<p align="center">
  <img src="assets/pakt-logo.svg" alt="PAKT" height="60" />
</p>

<h3 align="center">ClipForge PAKT</h3>

<p align="center">
  Lossless-first prompt compression for structured LLM data. Structured payloads often drop 30-50% tokens across core L1-L3.<br/>
  <i>Stop paying for syntax. Every token should carry meaning.</i>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@sriinnu/pakt"><img src="https://img.shields.io/npm/v/@sriinnu/pakt?color=6366f1&label=npm" alt="npm version" /></a>
  <a href="https://github.com/sriinnu/clipforge-PAKT/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b5cf6" alt="license" /></a>
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <a href="https://github.com/sriinnu/clipforge-PAKT/actions"><img src="https://img.shields.io/github/actions/workflow/status/sriinnu/clipforge-PAKT/ci.yml?label=CI&color=22c55e" alt="CI" /></a>
  <a href="https://github.com/sriinnu/clipforge-PAKT/stargazers"><img src="https://img.shields.io/github/stars/sriinnu/clipforge-PAKT?color=f59e0b&style=flat" alt="GitHub stars" /></a>
  <a href="https://github.com/sriinnu/clipforge-PAKT/pulls"><img src="https://img.shields.io/badge/PRs-welcome-a855f7" alt="PRs welcome" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/repo%20Node.js-%3E%3D22-339933?logo=node.js&logoColor=white" alt="Repo Node.js" />
  <img src="https://img.shields.io/badge/Tauri-v2-24c8d8?logo=tauri&logoColor=white" alt="Tauri" />
  <img src="https://img.shields.io/badge/macOS-validated-111827?logo=apple&logoColor=white" alt="macOS validated" />
  <img src="https://img.shields.io/badge/Windows-tray%20target-2563eb?logo=windows&logoColor=white" alt="Windows tray target" />
  <img src="https://img.shields.io/badge/Linux-tray%20target-6d28d9?logo=linux&logoColor=white" alt="Linux tray target" />
</p>

---

## What is PAKT?

**PAKT** (Pipe-Aligned Kompact Text) is a lossless-first compression format that converts JSON, YAML, CSV, and mixed markdown content into a compact pipe-delimited syntax optimized for LLM token efficiency. Structured payloads often see **30-50% token savings**, with higher gains on repetitive and tabular data, while preserving data fidelity across core lossless layers `L1-L3`. `L4` is separately opt-in, budgeted, and lossy.

LLMs charge by the token. Structured data wastes tokens on syntax: braces, quotes, repeated keys, whitespace. PAKT eliminates the waste.

### About ClipForge

ClipForge is the product suite built around PAKT. In this repository, that means:

- **[@sriinnu/pakt](./packages/pakt-core/)** -- The core library, CLI, and MCP server. This is the stable release surface for Node.js and TypeScript projects, plus agent hosts that need stdio tools for compress, auto, and inspect.
- **[ClipForge Playground](./apps/playground/)** -- A lightweight local web UI for trying JSON, YAML, CSV, and mixed markdown compression before wiring PAKT into a real workflow. It is a browser lab, not a release integration. Hosted playground: [pakt-4f9.pages.dev](https://pakt-4f9.pages.dev/).
- **[ClipForge Desktop](./apps/desktop/)** -- A Tauri desktop shell for clipboard compression workflows. The current release validation is macOS menu bar first; Windows and Linux tray targets exist in source but are not part of the validated release path yet.
- **[ClipForge Browser Extension](./apps/extension/)** *(experimental)* -- A Chrome extension with a popup, context-menu actions, and input helpers for supported web LLM UIs such as ChatGPT, Claude, and Gemini. Site coverage is intentionally limited today.

The goal is simple: every token you send to an LLM should carry meaning, not syntax.

For agent workflows, the MCP server is the integration bridge. `pakt serve --stdio` exposes `pakt_compress`, `pakt_auto`, and `pakt_inspect` through the standard MCP transport, so stdio-based MCP clients can call the same toolset without custom protocol glue. The generic stdio path is verified in-repo; named hosts like Claude Desktop and Cursor are integration targets rather than a certification matrix. `pakt_inspect` is the recommended first call when deciding whether compression is worth it.

The app surfaces now align on shared layer profiles: `Structure only (L1)`, `Standard (L1+L2)`, `Tokenizer-aware (L1+L2+L3)`, and opt-in `Semantic (L1+L2+L3+L4)`. Semantic mode requires a positive `semanticBudget` and is explicitly lossy.

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

---

## Monorepo Structure

This is a [pnpm workspace](https://pnpm.io/workspaces) monorepo.

```
clipforge-PAKT/
  packages/
    pakt-core/          Core compression engine, CLI, and MCP server
  apps/
    playground/         Local web playground for trying PAKT inputs
    desktop/            ClipForge tray app (Tauri v2 + React)
    extension/          Experimental Chrome extension for supported LLM UIs
  docs/                 Format spec and guides
  assets/
    pakt-logo.svg       Logo assets
```

### Packages

| Package | npm | Description |
|---------|-----|-------------|
| [`@sriinnu/pakt`](./packages/pakt-core/) | [![npm](https://img.shields.io/npm/v/@sriinnu/pakt?color=6366f1&label=)](https://www.npmjs.com/package/@sriinnu/pakt) | PAKT compression engine -- the core library with API and CLI |

---

## Quick Start

```bash
npm install @sriinnu/pakt
```

`@sriinnu/pakt` supports **Node 18+**. Monorepo development for this repository uses **Node 22+**.

```ts
import { compress, decompress, detect } from '@sriinnu/pakt';

// Compress JSON to PAKT
const result = compress('{"users": [{"name": "Alice", "role": "dev"}, {"name": "Bob", "role": "dev"}]}');
console.log(result.compressed);
console.log(`Saved ${result.savings.totalPercent}% tokens`);

// Decompress back to JSON
const original = decompress(result.compressed, 'json');
console.log(original.text);

// Detect input format
const detected = detect('name,role\nAlice,dev');
console.log(detected.format); // 'csv'
```

### Compressibility Scoring (0.6+)

```ts
import { estimateCompressibility } from '@sriinnu/pakt';

const score = estimateCompressibility(myJson);
console.log(score.score);    // 0.72
console.log(score.label);    // 'high'
console.log(score.profile);  // 'tokenizer' — recommended layer profile
console.log(score.breakdown); // { repetitionDensity, structuralOverhead, schemaUniformity, valueLengthScore }
```

### Delta Encoding (0.6+)

Delta encoding activates automatically on tabular arrays with 30%+ repeated adjacent values. No code change needed — `compress()` applies it as a post-pass on L1.

```
@from json
@compress delta
users [5]{name|role|dept|city}:
  Alice|engineer|platform|NYC
  Bob|~|~|~
  Charlie|~|~|SF
  Diana|designer|product|~
  Eve|~|~|~
```

The `~` sentinel replaces unchanged fields. Fully reversible via `decompress()`.

See the **[pakt-core README](./packages/pakt-core/README.md)** for comprehensive API documentation, CLI usage, format specification, and examples.

Core CLI example for opt-in lossy packing:

```bash
npx @sriinnu/pakt compress data.json --semantic-budget 120
```

Release-facing benchmark numbers live in **[docs/BENCHMARK-SNAPSHOT.md](./docs/BENCHMARK-SNAPSHOT.md)**.

For LLM round-trips, the core package now also exposes `interpretModelOutput()` so your app can auto-detect PAKT in a model response, repair minor syntax issues, and decompress valid replies back to JSON/YAML/CSV.

Try the hosted playground: **[pakt-4f9.pages.dev](https://pakt-4f9.pages.dev/)**.

### Root Workspace Commands

From the repo root, you can install, build, and boot each surface directly:

```bash
pnpm install
pnpm build
pnpm build:all
pnpm build:core
pnpm build:playground
pnpm build:extension
pnpm build:desktop:web
pnpm build:desktop
pnpm build:apps
pnpm test:core
pnpm test:playground
pnpm dev:playground
pnpm dev:extension
pnpm dev:desktop:web
pnpm dev:desktop
pnpm start:mcp
```

Local surface entrypoints:

```bash
pnpm dev:playground   # local playground
pnpm dev:extension    # extension dev build
pnpm dev:desktop:web  # desktop frontend only
pnpm dev:desktop      # real Tauri desktop shell
pnpm start:mcp        # core MCP server over stdio
```

Playground notes for release testing:

- Mixed-content restores embedded structured blocks semantically; exact original formatting may normalize.
- CSV is not always a win; some already-compact CSV can expand.
- Compare mode now includes an auto-pack lab; table-aware variants unlock for top-level CSV and top-level JSON arrays.
- The playground runs locally in the browser session and does not upload payloads.
- For mixed-content decompress, paste the PAKT-marked output back into the input area, then run `Decompress`.

CLI/MCP note:

- `semanticBudget` now cleanly opts into lossy `L4`; if you stay on `L1-L3`, the pipeline remains lossless.
- `pakt serve --stdio` now uses the official MCP SDK stdio transport, and embedders can register the same tools programmatically via `registerPaktTools()`.

### Session Stats (0.6.2)

Track token savings across sessions with persistent, multi-agent support.

**MCP tool:** `pakt_stats` returns compression metrics. Use `scope: 'session'` for the current process (fast, default) or `scope: 'all'` to aggregate across all agents from disk.

**CLI:** `pakt stats` has two modes:

```bash
pakt stats data.json             # single-shot stats for one file
pakt stats                       # aggregate from persistent storage
pakt stats --today               # filter to today
pakt stats --week                # filter to last 7 days
pakt stats --agent research      # filter by agent name
pakt stats --active              # only running agents
pakt stats --compact             # archive old sessions
pakt stats --reset               # clear all stats
```

**Named agents:** `pakt serve --stdio --agent-name research` names the session for filtering.

Stats are persisted as per-agent JSONL files in `~/.pakt/stats/`. Each MCP server writes to its own file -- zero contention across 10+ concurrent agents. Old sessions are lazily compacted into daily summaries.

---

## Key Features

- **4-layer compression pipeline** -- Structural (L1), Dictionary (L2), Tokenizer-Aware (L3), and an opt-in budgeted Semantic layer (L4)
- **Delta encoding** *(new in 0.6)* -- Adjacent rows in tabular arrays that share values are replaced with `~` sentinels, saving 20-40% on repetitive data on top of L1. Inspired by DeltaKV (arXiv:2602.08005)
- **Compressibility scoring** *(new in 0.6)* -- `estimateCompressibility()` returns a 0-1 score, label, and recommended profile before you compress. Know if compression is worth it without running the pipeline. Inspired by "Data Distribution Matters" (arXiv:2602.01778)
- **Multi-format support** -- JSON, YAML, CSV, Markdown, Plain Text with auto-detection
- **Lossless data round-tripping** -- L1-L3 preserve data fidelity on decompress; L4 is explicitly lossy
- **Typical 30-50% token savings** -- Real BPE token counting via gpt-tokenizer
- **Session stats** *(new in 0.6.2)* -- `pakt_stats` MCP tool and `pakt stats` CLI for real-time token savings tracking with persistent multi-agent support
- **CLI included** -- `pakt compress`, `pakt decompress`, `pakt auto`, `pakt inspect`, `pakt detect`, `pakt tokens`, `pakt savings`, `pakt stats`
- **MCP server included** -- `pakt serve --stdio` exposes `pakt_compress`, `pakt_auto`, `pakt_inspect`, and `pakt_stats` over the official MCP SDK stdio transport for agent workflows
- **Embeddable MCP tools** -- `registerPaktTools()` lets other MCP hosts add the same PAKT toolset without reimplementing schemas or handlers
- **Small runtime dependency set** -- `gpt-tokenizer`, the MCP SDK, and `zod`
- **Full TypeScript support** -- All types exported, dual ESM/CJS builds

---

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- [pnpm](https://pnpm.io/) >= 9

### Setup

```bash
git clone https://github.com/sriinnu/clipforge-PAKT.git
cd clipforge-PAKT
pnpm install
```

### Commands

```bash
# Build all packages
pnpm build

# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run benchmarks
pnpm bench

# Clean build artifacts
pnpm clean
```

---

## Inspiration & Credits

PAKT would not exist without the prior work and ideas of these projects and researchers:

### TOON Format

PAKT's core pipe-delimited syntax (Layer 1) is directly inspired by **[TOON Format v1.3](https://github.com/toon-format/spec)** -- the original compact notation for structured data, created by **[Nicholas Charlton](https://github.com/nichochar)** ([@nichochar](https://github.com/nichochar)). TOON demonstrated that structured data can be represented without the syntactic overhead of JSON while remaining unambiguous and machine-parseable. PAKT builds on this foundation by adding multi-format support, a dictionary compression layer, and guaranteed lossless round-tripping. TOON has implementations across Python, TypeScript, Go, Rust, .NET, Elixir, Java, and Julia -- a testament to the strength of its design.

### Research

PAKT 0.6 features are informed by a systematic survey of 25+ papers from 2024-2026. See [docs/articles/research-landscape-2024-2026.md](./docs/articles/research-landscape-2024-2026.md) for the full survey.

**Directly adapted in 0.6:**
- **DeltaKV** (Hao et al., arXiv:2602.08005, Feb 2026) -- Residual KV cache compression via long-range similarity. Adapted as delta encoding for tabular arrays.
- **Data Distribution Matters** (Lv et al., arXiv:2602.01778, Feb 2026) -- Input entropy determines compression quality. Adapted as compressibility scoring.
- **Compactor** (Chari & Van Durme, arXiv:2507.08143, Jul 2025) -- Context-calibrated compression ratios. Informed auto-profile recommendation.

**Validating PAKT's approach:**
- **LLMLingua-2** (Microsoft, arXiv:2403.12968, 2024) -- Task-agnostic prompt compression via data distillation. Closest neural competitor; PAKT achieves comparable savings on structured data without running a model.
- **Gist Token Study** (Deng et al., arXiv:2412.17483, Dec 2024) -- Lossy compression fails on exact recall. Validates PAKT's lossless-first L1-L3 design.
- **Extractive > Abstractive** (Jha et al., arXiv:2407.08892, Jul 2024) -- Extractive compression outperforms abstractive for factual content. Validates PAKT's structural approach.
- **Compression Improves LLM Quality** (Zhang et al., arXiv:2505.00019, Apr 2025) -- Moderate compression removes noise and can improve LLM accuracy.

**Previously cited:**
- **CompactPrompt** (2025) -- Structured prompt compression for financial datasets.
- **LTSC** (2024) -- LLM-driven Token-level Structured Compression.
- **LiteToken** (2025) -- Lightweight token compression for structured data.
- **Table Serialization Studies** -- Pipe-delimited formats outperform JSON for tabular LLM data.

---

## License

[MIT](./LICENSE) -- Srinivas Pendela

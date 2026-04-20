<p align="center">
  <img src="assets/pakt-logo.svg" alt="PAKT" height="60" />
</p>

<h3 align="center">ClipForge PAKT</h3>

<p align="center">
  The only prompt compressor that's <b>lossless</b>, <b>model-free</b>, and <b>built for structured data</b>.<br/>
  No inference cost, no hallucinations, no byte-level tricks an LLM can't see -- just fewer tokens for the same payload.<br/>
  <b>27-69% savings</b> on JSON / YAML / CSV / logs.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@sriinnu/pakt"><img src="https://img.shields.io/npm/v/@sriinnu/pakt?color=6366f1&label=npm" alt="npm version" /></a>
  <a href="https://github.com/sriinnu/clipforge-PAKT/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b5cf6" alt="license" /></a>
  <img src="https://img.shields.io/badge/TypeScript-6-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/version-0.7.0-6366f1" alt="version" />
  <a href="https://github.com/sriinnu/clipforge-PAKT/actions"><img src="https://img.shields.io/github/actions/workflow/status/sriinnu/clipforge-PAKT/ci.yml?label=CI&color=22c55e" alt="CI" /></a>
  <a href="https://github.com/sriinnu/clipforge-PAKT/stargazers"><img src="https://img.shields.io/github/stars/sriinnu/clipforge-PAKT?color=f59e0b&style=flat" alt="GitHub stars" /></a>
  <a href="https://github.com/sriinnu/clipforge-PAKT/pulls"><img src="https://img.shields.io/badge/PRs-welcome-a855f7" alt="PRs welcome" /></a>
  <a href="https://github.com/sponsors/sriinnu"><img src="https://img.shields.io/badge/Sponsor-ec4899?logo=githubsponsors&logoColor=white" alt="Sponsor on GitHub" /></a>
  <a href="https://buymeacoffee.com/sriinnu"><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buymeacoffee&logoColor=black" alt="Buy Me a Coffee" /></a>
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

### Why not X?

- **LLMLingua / LLMLingua-2?** Neural compressors. They run a model to rewrite your prompt, which is lossy, model-dependent, and adds inference cost and latency. PAKT is deterministic, model-free, and free to run.
- **TOON format?** TOON is the core inspiration for PAKT's Layer 1 pipe-delimited syntax. PAKT extends it with a dictionary layer (L2), tokenizer-aware packing (L3), delta encoding for tabular arrays, multi-format input (JSON/YAML/CSV/Markdown/Text), and an MCP server for agents.
- **gzip / brotli?** They compress bytes, but the LLM API bills you on tokens after BPE tokenization. A gzipped prompt still costs full tokens once decoded. PAKT reshapes the text so the tokenizer itself produces fewer tokens.
- **Just minify JSON?** Free and worth doing -- but it only removes whitespace. PAKT minifies, then layers dictionary substitution and tokenizer-aware choices on top, typically doubling the savings.

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

### Auto Context Compression (0.7)

PAKT automatically compresses data on every MCP tool call to reduce conversation context size. Compressed data stays in context and saves tokens on every subsequent turn.

- **Content-addressed dedup** -- SHA-256 hash cache (10MB byte-budget LRU) avoids re-compressing identical data
- **Text compression** -- line dedup + word n-gram dictionary. 57% savings on logs, 38% on repetitive text, 69% on identical lines
- **Whitespace normalization** -- trailing spaces, blank line runs stored as metadata for lossless restoration
- **Configurable tool description** -- `registerPaktTools(server, { autoDescription: '...' })` controls how aggressively the LLM uses auto-compression
- **Safe detection** -- `@from John` and `@warning chemicals` correctly detected as text, not PAKT. No false positives on `@username`, `@Override`, email headers
- **Input size caps** -- 512KB for auto, 1MB for explicit compress, 100KB for text compression. Prevents CPU DoS

| Input Type | Savings | Round-trip |
|---|---|---|
| JSON 10 records | 27% | Lossless |
| JSON 50 records | 33% | Lossless |
| Log lines (duplicates) | 57% | Lossless |
| Repetitive text | 38-69% | Lossless |
| Normal prose (no repetition) | 0% (passthrough) | Safe |

---

## Key Features

- **Lossless by default** -- L1 (Structural), L2 (Dictionary), and L3 (Tokenizer-Aware) round-trip exactly. L4 (Semantic) is opt-in and explicitly lossy, gated by a `semanticBudget`.
- **Multi-format** -- JSON, YAML, CSV, Markdown, and Plain Text with auto-detection, so the same pipeline handles structured, tabular, and mixed content.
- **Tokenizer-aware via real BPE** -- Uses `gpt-tokenizer` to measure and pick tokens LLMs actually merge, not byte-level heuristics that vanish at the API boundary.
- **MCP + CLI + library, zero model dependency** -- `pakt serve --stdio` exposes `pakt_compress`, `pakt_auto`, `pakt_inspect`, and `pakt_stats` to agents; the same logic ships as a CLI and a typed TypeScript library.
- **27-69% savings with public benchmarks** -- 27-33% on JSON payloads, 57% on duplicate log lines, 38-69% on repetitive text. Full reproducible numbers in [docs/BENCHMARK-SNAPSHOT.md](./docs/BENCHMARK-SNAPSHOT.md).

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

### TOON Format

PAKT's core pipe-delimited syntax (Layer 1) is directly inspired by **[TOON Format v1.3](https://github.com/toon-format/spec)** -- the original compact notation for structured data, created by **[Nicholas Charlton](https://github.com/nichochar)** ([@nichochar](https://github.com/nichochar)). TOON demonstrated that structured data can be represented without the syntactic overhead of JSON while remaining unambiguous and machine-parseable. PAKT builds on this foundation by adding multi-format support, a dictionary compression layer, and guaranteed lossless round-tripping. TOON has implementations across Python, TypeScript, Go, Rust, .NET, Elixir, Java, and Julia -- a testament to the strength of its design.

### Key research

- **LLMLingua-2** (Microsoft, [arXiv:2403.12968](https://arxiv.org/abs/2403.12968), 2024) -- The closest neural competitor. PAKT achieves comparable savings on structured data without running a model.
- **Gist Token Study** (Deng et al., [arXiv:2412.17483](https://arxiv.org/abs/2412.17483), Dec 2024) -- Lossy compression fails on exact recall, which motivates PAKT's lossless-first L1-L3 design.
- **DeltaKV** (Hao et al., [arXiv:2602.08005](https://arxiv.org/abs/2602.08005), Feb 2026) -- Residual similarity compression, adapted as PAKT's delta encoding for tabular arrays.

Full citation list and survey: [docs/research.md](./docs/research.md).

---

## Related Projects

PAKT sits alongside a couple of sibling tools that round out the token economy — shrink, measure, monitor:

- **[tokmeter](https://github.com/sriinnu/tokmeter)** -- Token usage tracker for AI coding agents. Tracks consumption across 16+ agents through five surfaces: CLI, TUI, React web dashboard, MCP server ([Drishti](https://www.npmjs.com/package/@sriinnu/drishti)), and a macOS menu bar. Includes cost digests, cache-efficiency analytics, and a model advisor.
- **[Runic](https://github.com/sriinnu/Runic)** -- macOS menubar app monitoring AI usage, costs, and quotas across 26 providers in real time. Charts, forecasts, budget alerts, CSV/JSON export, widgets, and a bundled CLI. Local-only, zero telemetry.

PAKT reduces what you send; tokmeter and Runic tell you what you spent.

---

## Support

PAKT is maintained independently. If it saves you tokens and you'd like to back continued development, you can sponsor via [GitHub Sponsors](https://github.com/sponsors/sriinnu) or [Buy Me a Coffee](https://buymeacoffee.com/sriinnu). Issues, PRs, and stars help just as much.

---

## License

[MIT](./LICENSE) -- Srinivas Pendela

<p align="center">
  <img src="assets/pakt-logo.svg" alt="PAKT" height="60" />
</p>

<h3 align="center">ClipForge PAKT</h3>

<p align="center">
  Lossless prompt compression for structured LLM data. Typical 30-50% fewer tokens.<br/>
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
  <img src="https://img.shields.io/badge/macOS-supported-8b5cf6?logo=apple&logoColor=white" alt="macOS" />
  <img src="https://img.shields.io/badge/Windows-supported-6366f1?logo=windows&logoColor=white" alt="Windows" />
  <img src="https://img.shields.io/badge/Linux-supported-a855f7?logo=linux&logoColor=white" alt="Linux" />
</p>

---

## What is PAKT?

**PAKT** (Pipe-Aligned Kompact Text) is a lossless-first compression format that converts JSON, YAML, CSV, and mixed markdown content into a compact pipe-delimited syntax optimized for LLM token efficiency. It delivers **typical 30-50% token savings**, with higher gains on repetitive and tabular payloads, while preserving data fidelity across its core layers.

LLMs charge by the token. Structured data wastes tokens on syntax: braces, quotes, repeated keys, whitespace. PAKT eliminates the waste.

### About ClipForge

ClipForge is the product suite built around PAKT. In this repository, that means:

- **[@sriinnu/pakt](./packages/pakt-core/)** -- The core library, CLI, and MCP server. Install it from npm and use it in Node.js or TypeScript projects.
- **[ClipForge Playground](./apps/playground/)** -- A lightweight web UI for trying JSON, YAML, CSV, and mixed markdown compression locally before wiring PAKT into a real workflow. Hosted playground: [pakt-4f9.pages.dev](https://pakt-4f9.pages.dev/).
- **[ClipForge Desktop](./apps/desktop/)** -- A Tauri tray app for reading clipboard text, compressing or decompressing it, copying results back, optionally watching clipboard updates, and storing local history when you opt in.
- **[ClipForge Browser Extension](./apps/extension/)** *(experimental)* -- A Chrome extension with a popup, context-menu actions, and input helpers for supported web LLM UIs such as ChatGPT, Claude, and Gemini.

The goal is simple: every token you send to an LLM should carry meaning, not syntax.

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

See the **[pakt-core README](./packages/pakt-core/README.md)** for comprehensive API documentation, CLI usage, format specification, and examples.

Release-facing benchmark numbers live in **[docs/BENCHMARK-SNAPSHOT.md](./docs/BENCHMARK-SNAPSHOT.md)**.

Try the hosted playground: **[pakt-4f9.pages.dev](https://pakt-4f9.pages.dev/)**.

To try the local playground:

```bash
pnpm -C apps/playground dev
```

Playground notes for release testing:

- Mixed-content restores embedded structured blocks semantically; exact original formatting may normalize.
- CSV is not always a win; some already-compact CSV can expand.
- The playground runs locally in the browser session and does not upload payloads.
- For mixed-content decompress, paste the PAKT-marked output back into the input area, then run `Decompress`.

---

## Key Features

- **4-layer compression pipeline** -- Structural (L1), Dictionary (L2), Tokenizer-Aware (L3), Semantic (L4)
- **Multi-format support** -- JSON, YAML, CSV, Markdown, Plain Text with auto-detection
- **Lossless data round-tripping** -- core layers preserve data fidelity on decompress
- **Typical 30-50% token savings** -- Real BPE token counting via gpt-tokenizer
- **CLI included** -- `pakt compress`, `pakt decompress`, `pakt detect`, `pakt tokens`, `pakt savings`
- **MCP server included** -- `pakt serve --stdio` exposes `pakt_compress` and `pakt_auto`
- **Minimal runtime dependencies** -- only `gpt-tokenizer` at runtime
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

- **CompactPrompt** (2025) -- Structured prompt compression for financial datasets, showing that redundant content in function-calling prompts can be safely removed.
- **LLMLingua-2** (Microsoft, 2024) -- Task-agnostic prompt compression via data distillation, achieving high compression ratios with minimal accuracy loss.
- **LTSC** (2024) -- LLM-driven Token-level Structured Compression, combining structural and token-level techniques for long text workflows.
- **LiteToken** (2025) -- Lightweight token compression for efficient encoding of structured data in LLM contexts.
- **Table Serialization Studies** -- Research demonstrating that pipe-delimited formats consistently outperform JSON when presenting tabular data to LLMs.

---

## License

[MIT](./LICENSE) -- Srinivas Pendela

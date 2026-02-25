<p align="center">
  <img src="assets/pakt-logo.svg" alt="PAKT" height="60" />
</p>

<h3 align="center">ClipForge PAKT</h3>

<p align="center">
  Lossless prompt compression for LLMs. 30-50% fewer tokens. Perfect round-tripping.<br/>
  <i>Stop paying for syntax. Every token should carry meaning.</i>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@yugenlab/pakt"><img src="https://img.shields.io/npm/v/@yugenlab/pakt?color=6366f1&label=npm" alt="npm version" /></a>
  <a href="https://github.com/sriinnu/clipforge-PAKT/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b5cf6" alt="license" /></a>
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <a href="https://github.com/sriinnu/clipforge-PAKT/actions"><img src="https://img.shields.io/github/actions/workflow/status/sriinnu/clipforge-PAKT/ci.yml?label=CI&color=22c55e" alt="CI" /></a>
  <a href="https://github.com/sriinnu/clipforge-PAKT/stargazers"><img src="https://img.shields.io/github/stars/sriinnu/clipforge-PAKT?color=f59e0b&style=flat" alt="GitHub stars" /></a>
  <a href="https://github.com/sriinnu/clipforge-PAKT/pulls"><img src="https://img.shields.io/badge/PRs-welcome-a855f7" alt="PRs welcome" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Tauri-v2-24c8d8?logo=tauri&logoColor=white" alt="Tauri" />
  <img src="https://img.shields.io/badge/macOS-supported-8b5cf6?logo=apple&logoColor=white" alt="macOS" />
  <img src="https://img.shields.io/badge/Windows-supported-6366f1?logo=windows&logoColor=white" alt="Windows" />
  <img src="https://img.shields.io/badge/Linux-supported-a855f7?logo=linux&logoColor=white" alt="Linux" />
</p>

---

## What is PAKT?

**PAKT** (Pipe-Aligned Kompact Text) is a lossless compression format that converts JSON, YAML, CSV, and Markdown into a compact pipe-delimited syntax optimized for LLM token efficiency. It achieves **30-50% token savings** while maintaining perfect lossless round-tripping.

LLMs charge by the token. Structured data wastes tokens on syntax: braces, quotes, repeated keys, whitespace. PAKT eliminates the waste.

### About ClipForge

ClipForge is a suite of tools built around PAKT, designed to make prompt compression accessible everywhere you work with LLMs:

- **[@yugenlab/pakt](./packages/pakt-core/)** -- The core compression library and CLI. Install it via npm and integrate PAKT into any Node.js or TypeScript project.
- **[ClipForge Desktop](./apps/desktop/)** -- A cross-platform menubar application (built with Tauri v2 and React) that compresses clipboard content on the fly. Copy structured data, compress it with a keystroke, and paste the PAKT output directly into your LLM prompt.
- **ClipForge Browser Extension** *(coming soon)* -- Inline compression for web-based LLM interfaces.

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
    pakt-core/          Core compression engine + CLI
  apps/
    desktop/            ClipForge menubar app (Tauri v2 + React)
  docs/                 Format spec and guides
  assets/
    pakt-logo.svg       Logo assets
```

### Packages

| Package | npm | Description |
|---------|-----|-------------|
| [`@yugenlab/pakt`](./packages/pakt-core/) | [![npm](https://img.shields.io/npm/v/@yugenlab/pakt?color=6366f1&label=)](https://www.npmjs.com/package/@yugenlab/pakt) | PAKT compression engine -- the core library with API and CLI |

---

## Quick Start

```bash
npm install @yugenlab/pakt
```

```ts
import { compress, decompress, detect } from '@yugenlab/pakt';

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

---

## Key Features

- **4-layer compression pipeline** -- Structural (L1), Dictionary (L2), Tokenizer-Aware (L3), Semantic (L4)
- **Multi-format support** -- JSON, YAML, CSV, Markdown, Plain Text with auto-detection
- **Perfect lossless round-tripping** -- `decompress(compress(input)) === input` for L1+L2
- **30-50% token savings** -- Real BPE token counting via gpt-tokenizer
- **CLI included** -- `pakt compress`, `pakt decompress`, `pakt detect`, `pakt tokens`, `pakt savings`
- **Zero runtime dependencies** -- Only gpt-tokenizer for token counting
- **Full TypeScript support** -- All types exported, dual ESM/CJS builds

---

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 8

### Setup

```bash
git clone https://github.com/sriinnu/clipforge-PAKT.git
cd clipforge-pakt
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

[MIT](./LICENSE) -- YugenLab

---

<p align="center">
  <sub>Built by <b>YugenLab</b></sub>
</p>

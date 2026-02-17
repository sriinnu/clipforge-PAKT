<p align="center">
  <img src="assets/pakt-logo.svg" alt="PAKT" height="60" />
</p>

<h3 align="center">ClipForge PAKT</h3>

<p align="center">
  Lossless prompt compression for LLMs. 30-50% fewer tokens. Perfect round-tripping.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@yugenlab/pakt"><img src="https://img.shields.io/npm/v/@yugenlab/pakt?color=6366f1&label=npm" alt="npm version" /></a>
  <a href="https://github.com/yugenlab/clipforge-pakt/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b5cf6" alt="license" /></a>
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
</p>

---

## What is PAKT?

**PAKT** (Pipe-Aligned Kompact Text) is a lossless compression format that converts JSON, YAML, CSV, and Markdown into a compact pipe-delimited syntax optimized for LLM token efficiency. It achieves **30-50% token savings** while maintaining perfect lossless round-tripping.

LLMs charge by the token. Structured data wastes tokens on syntax: braces, quotes, repeated keys, whitespace. PAKT eliminates the waste.

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
git clone https://github.com/yugenlab/clipforge-pakt.git
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

## License

[MIT](./LICENSE) -- YugenLab

---

<p align="center">
  <sub>Built by <b>YugenLab</b></sub>
</p>

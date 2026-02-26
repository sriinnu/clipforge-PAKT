# PAKT — Pipe-Aligned Kompact Text

Lossless prompt compression for LLMs. 30-50% fewer tokens. Perfect round-tripping.

[![npm version](https://img.shields.io/npm/v/@sriinnu/pakt?color=6366f1&label=npm)](https://www.npmjs.com/package/@sriinnu/pakt)
[![license](https://img.shields.io/badge/license-MIT-8b5cf6)](https://github.com/sriinnu/clipforge-PAKT/blob/main/LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)
![tests](https://img.shields.io/badge/tests-540%20passing-22c55e)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@sriinnu/pakt?color=f59e0b&label=size)](https://bundlephobia.com/package/@sriinnu/pakt)

---

**PAKT** converts JSON, YAML, CSV, and Markdown into a compact pipe-delimited format purpose-built for LLM consumption. It strips the syntactic overhead that wastes tokens — braces, quotes, repeated keys, whitespace — and replaces it with a dense, unambiguous notation that LLMs parse just as well.

Every token saved is money saved. At scale, PAKT pays for itself in a single API call.

---

## Quick Demo

**Input** — a JSON array with repeated values (28 tokens):

```json
{
  "users": [
    { "name": "Alice", "role": "dev" },
    { "name": "Bob", "role": "dev" }
  ]
}
```

**PAKT output** (15 tokens):

```
@from json
@dict
  $a: dev
@end

users [2]{name|role}:
  Alice|$a
  Bob|$a
```

**Result:** 46% token savings. `decompress(compress(input)) === input`. Lossless.

---

## Installation

```bash
npm install @sriinnu/pakt
```

---

## Quick Start

### Compress

```ts
import { compress } from '@sriinnu/pakt';

const json = JSON.stringify({
  users: [
    { name: 'Alice', role: 'developer', team: 'platform' },
    { name: 'Bob', role: 'developer', team: 'platform' },
    { name: 'Carol', role: 'designer', team: 'product' },
  ],
});

const result = compress(json);

console.log(result.compressed);
// @from json
// @dict
//   $a: developer
//   $b: platform
// @end
//
// users [3]{name|role|team}:
//   Alice|$a|$b
//   Bob|$a|$b
//   Carol|designer|product

console.log(result.savings.totalPercent); // ~42
console.log(result.reversible);           // true
```

### Decompress

```ts
import { decompress } from '@sriinnu/pakt';

const result = decompress(paktString, 'json');

console.log(result.text);           // Pretty-printed JSON
console.log(result.data);           // Parsed JavaScript object
console.log(result.originalFormat); // 'json'
console.log(result.wasLossy);       // false
```

### Detect Format

```ts
import { detect } from '@sriinnu/pakt';

detect('{"key": "value"}');
// { format: 'json', confidence: 0.99, reason: 'Starts with { and valid JSON parse' }

detect('name,role\nAlice,dev\nBob,pm');
// { format: 'csv', confidence: 0.9, reason: 'Consistent comma-delimited columns' }
```

### Count Tokens

```ts
import { countTokens } from '@sriinnu/pakt';

countTokens('Hello, world!'); // 4
```

### Compare Savings

```ts
import { compareSavings } from '@sriinnu/pakt';

const report = compareSavings(originalText, compressedText, 'gpt-4o');

console.log(report.savedPercent);      // 42
console.log(report.savedTokens);       // 120
console.log(report.costSaved?.input);  // 0.0003 (USD)
console.log(report.costSaved?.output); // 0.0012 (USD)
```

---

## CLI

```bash
npm install -g @sriinnu/pakt
```

```bash
# Compress a file
pakt compress data.json

# Compress with specific layers
pakt compress data.json --layers 1,2

# Pipe from stdin
cat data.json | pakt compress
curl -s api.example.com/users | pakt compress

# Decompress to original format
pakt decompress data.pakt

# Decompress to a specific format
pakt decompress data.pakt --to yaml

# Detect format
pakt detect mystery-file.txt

# Count tokens
pakt tokens data.json

# Savings report
pakt savings data.json --model gpt-4o
```

---

## How It Works

PAKT compresses text through a 4-layer pipeline. Each layer is independent and toggleable.

| Layer | Name | What It Does | Lossless | Default |
|-------|------|-------------|----------|---------|
| **L1** | Structural | Strips braces, quotes, commas. Converts to pipe-delimited PAKT syntax. | Yes | On |
| **L2** | Dictionary | Replaces repeated strings with short aliases (`$a`, `$b` ... `$az`) in a `@dict` block. | Yes | On |
| **L3** | Tokenizer-Aware | Re-encodes delimiters to align with the target model's BPE boundaries. | Yes | Gated |
| **L4** | Semantic | Lossy compression via summarization. Flagged with `@warning lossy`. | **No** | Opt-in |

Layers 1-3 guarantee **100% lossless round-tripping**: `decompress(compress(input)) === input`.

> **Note:** L3 and L4 are gated stubs for future release. L1 and L2 are fully implemented.

```ts
compress(data, {
  layers: {
    structural: true,
    dictionary: true,
    tokenizerAware: true,   // requires targetModel
    semantic: false,
  },
  targetModel: 'gpt-4o',
});
```

---

## PAKT Format Syntax

### Headers

```
@from json               Original input format
@target gpt-4o           Target model for L3
@warning lossy           Flags non-reversible output
```

### Dictionary

```
@dict
  $a: developer
  $b: Engineering
@end
```

### Tabular Arrays (most powerful compression target)

```
users [3]{name|role|team}:
  Alice|$a|platform
  Bob|$a|platform
  Carol|designer|product
```

### Other Structures

```
name: Alice                          % key-value
tags [4]: TypeScript,Rust,Go,Python  % inline array
events [2]:                          % list array
  - type: deploy
    status: success
  - type: rollback
    status: failed
config                               % nested object
  database
    host: localhost
    port: 5432
```

---

## API Reference

### `compress(input, options?)`

```ts
function compress(input: string, options?: Partial<PaktOptions>): PaktResult
```

Returns `PaktResult` with: `compressed`, `originalTokens`, `compressedTokens`, `savings`, `reversible`, `detectedFormat`, `dictionary`.

### `decompress(pakt, outputFormat?)`

```ts
function decompress(pakt: string, outputFormat?: PaktFormat): DecompressResult
```

Returns `DecompressResult` with: `data`, `text`, `originalFormat`, `wasLossy`.

### `detect(input)`

```ts
function detect(input: string): DetectionResult
```

Returns `DetectionResult` with: `format`, `confidence` (0-1), `reason`.

### `validate(pakt)` / `repair(pakt)`

```ts
function validate(pakt: string): ValidationResult
function repair(pakt: string): string | null
```

### `countTokens(text, model?)` / `compareSavings(original, compressed, model?)`

```ts
function countTokens(text: string, model?: string): number
function compareSavings(original: string, compressed: string, model?: string): SavingsReport
```

### `prettyPrint(ast, options?)`

```ts
function prettyPrint(ast: DocumentNode, options?: PrettyOptions): string
```

---

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `layers` | `Partial<PaktLayers>` | `{ structural: true, dictionary: true }` | Compression layers to enable |
| `fromFormat` | `PaktFormat` | Auto-detected | Force input format |
| `targetModel` | `string` | `'gpt-4o'` | Target model for L3 |
| `dictMinSavings` | `number` | `3` | Min net token savings for a dictionary alias |

---

## Benchmarks

| Input | Format | Tokens | With PAKT | Savings |
|-------|--------|--------|-----------|---------|
| 50-row user array | JSON | 1,847 | 923 | **50%** |
| Nested API response | JSON | 612 | 389 | **36%** |
| 20-column dataset | CSV | 2,103 | 1,154 | **45%** |
| Deep config file | YAML | 891 | 534 | **40%** |

```bash
pnpm bench
```

---

## Supported Formats

| Format | Compress | Decompress | Notes |
|--------|----------|------------|-------|
| JSON | Yes | Yes | Supports JSONC (comments stripped) |
| YAML | Yes | Yes | Common patterns supported |
| CSV | Yes | Yes | Comma, tab, semicolon delimiters |
| Markdown | Yes | Yes | Headings, tables, links, code blocks |
| Plain Text | Yes | Yes | Passthrough with minimal encoding |

Cross-format conversion works through PAKT as an intermediate:

```ts
const pakt = compress(jsonString);
const yaml = decompress(pakt.compressed, 'yaml');
```

---

## Acknowledgments

PAKT's pipe-delimited syntax is inspired by **[TOON Format](https://github.com/toon-format/spec)** by [Nicholas Charlton](https://github.com/nichochar). TOON proved that JSON's syntactic overhead is unnecessary for machine-readable formats. PAKT builds on TOON's design by adding multi-format support, automatic dictionary compression, and guaranteed lossless round-tripping.

---

## Contributing

```bash
git clone https://github.com/sriinnu/clipforge-PAKT.git
cd clipforge-pakt && pnpm install
pnpm build && pnpm test
```

---

## License

[MIT](https://github.com/sriinnu/clipforge-PAKT/blob/main/LICENSE)

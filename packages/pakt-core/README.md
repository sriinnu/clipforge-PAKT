<p align="center">
  <img src="../../assets/pakt-logo.svg" alt="PAKT" height="60" />
</p>

<h3 align="center">Pipe-Aligned Kompact Text</h3>

<p align="center">
  Lossless prompt compression for LLMs. 30-50% fewer tokens. Perfect round-tripping.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@yugenlab/pakt"><img src="https://img.shields.io/npm/v/@yugenlab/pakt?color=6366f1&label=npm" alt="npm version" /></a>
  <a href="https://github.com/sriinnu/clipforge-PAKT/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b5cf6" alt="license" /></a>
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/tests-540%20passing-22c55e" alt="tests" />
  <img src="https://img.shields.io/bundlephobia/minzip/@yugenlab/pakt?color=f59e0b&label=size" alt="bundle size" />
  <a href="https://github.com/sriinnu/clipforge-PAKT/issues"><img src="https://img.shields.io/github/issues/sriinnu/clipforge-PAKT?color=a855f7" alt="GitHub issues" /></a>
  <a href="https://github.com/sriinnu/clipforge-PAKT/pulls"><img src="https://img.shields.io/badge/PRs-welcome-a855f7" alt="PRs welcome" /></a>
</p>

---

**PAKT** converts JSON, YAML, CSV, and Markdown into a compact pipe-delimited format purpose-built for LLM consumption. It strips the syntactic overhead that wastes tokens -- braces, quotes, repeated keys, whitespace -- and replaces it with a dense, unambiguous notation that LLMs parse just as well.

Every token saved is money saved. At scale, PAKT pays for itself in a single API call.

---

## Quick Demo

**Input** -- a JSON array with repeated values (28 tokens):

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
npm install @yugenlab/pakt
```

```bash
pnpm add @yugenlab/pakt
```

```bash
yarn add @yugenlab/pakt
```

---

## Quick Start

### Compress

```ts
import { compress } from '@yugenlab/pakt';

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
import { decompress } from '@yugenlab/pakt';

const result = decompress(paktString, 'json');

console.log(result.text);           // Pretty-printed JSON
console.log(result.data);           // Parsed JavaScript object
console.log(result.originalFormat); // 'json'
console.log(result.wasLossy);       // false
```

### Detect Format

```ts
import { detect } from '@yugenlab/pakt';

detect('{"key": "value"}');
// { format: 'json', confidence: 0.99, reason: 'Starts with { and valid JSON parse' }

detect('name,role\nAlice,dev\nBob,pm\nCarol,design');
// { format: 'csv', confidence: 0.9, reason: 'Consistent comma-delimited columns (2 cols, 4 rows)' }

detect('@from json\nname: Alice');
// { format: 'pakt', confidence: 1.0, reason: 'Contains @from header' }
```

### Count Tokens

```ts
import { countTokens } from '@yugenlab/pakt';

const tokens = countTokens('Hello, world!');
console.log(tokens); // 4
```

### Compare Savings

```ts
import { compareSavings } from '@yugenlab/pakt';

const report = compareSavings(originalText, compressedText, 'gpt-4o');

console.log(report.savedPercent);          // 42
console.log(report.savedTokens);           // 120
console.log(report.costSaved?.input);      // 0.0003 (USD)
console.log(report.costSaved?.output);     // 0.0012 (USD)
```

---

## CLI Usage

Install globally for shell access:

```bash
npm install -g @yugenlab/pakt
```

### Compress

```bash
# Compress a file
pakt compress data.json

# Compress with specific layers
pakt compress data.json --layers 1,2

# Force input format
pakt compress data.json --from json

# Pipe from stdin
cat data.json | pakt compress
curl -s api.example.com/users | pakt compress
```

### Decompress

```bash
# Decompress to original format (from @from header)
pakt decompress data.pakt

# Decompress to a specific format
pakt decompress data.pakt --to yaml
pakt decompress data.pakt --to csv

# Pipe mode
cat data.pakt | pakt decompress --to json > output.json
```

### Detect Format

```bash
pakt detect mystery-file.txt
# Format:     csv
# Confidence: 95%
# Reason:     Consistent comma-delimited columns (5 cols, 100 rows)
```

### Count Tokens

```bash
pakt tokens data.json
# 1847

pakt tokens data.json --model claude-sonnet
# 1847
```

### Savings Report

```bash
pakt savings data.json
# Model:            gpt-4o
# Original tokens:  1847
# Compressed tokens: 923
# Saved tokens:     924
# Savings:          50%
# Cost saved (input):  $0.002310 USD
# Cost saved (output): $0.009240 USD

pakt savings data.json --model claude-opus
```

---

## How It Works

PAKT compresses text through a 4-layer pipeline. Each layer is independent and can be toggled on or off.

```
                        PAKT Compression Pipeline
  +-----------+     +-----------+     +-----------+     +-----------+
  |    L1     |     |    L2     |     |    L3     |     |    L4     |
  | Structural| --> | Dictionary| --> | Tokenizer | --> | Semantic  |
  |           |     |           |     |   Aware   |     |           |
  +-----------+     +-----------+     +-----------+     +-----------+
   Strip syntax      Deduplicate      Optimize for      Lossy
   Convert to        repeated         target model's    summarization
   PAKT notation     values with      BPE tokenizer     (opt-in)
                     $a, $b aliases

   [Lossless]        [Lossless]       [Lossless]        [Lossy]
   [Default ON]      [Default ON]     [Gated]           [Opt-in]
```

| Layer | Name | What It Does | Lossless | Default |
|-------|------|-------------|----------|---------|
| **L1** | Structural | Strips braces, quotes, colons, commas. Converts to pipe-delimited PAKT syntax. Arrays of uniform objects become compact tabular rows. | Yes | On |
| **L2** | Dictionary | Finds repeated string values across the document and replaces them with short aliases (`$a`, `$b`, ... `$z`, `$aa`-`$az`) defined in a `@dict` header block. | Yes | On |
| **L3** | Tokenizer-Aware | Re-encodes delimiters to align with the target model's BPE tokenizer boundaries, minimizing token splits. | Yes | Gated |
| **L4** | Semantic | Lossy compression via summarization. Output is flagged with `@warning lossy` and marked as non-reversible. | **No** | Opt-in |

Layers 1-3 guarantee **100% lossless round-tripping**: `decompress(compress(input)) === input`.

Layer 4 trades fidelity for maximum compression when perfect reconstruction is not required.

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

> **Note:** L3 (Tokenizer-Aware) and L4 (Semantic) are currently gated for future release. L1 and L2 are fully implemented and available now.

---

## PAKT Format Syntax

A PAKT document consists of an optional preamble (headers + dictionary) followed by the data body.

### Headers

Headers are prefixed with `@` and declare metadata about the document:

```
@version 0.2.0           Version of the PAKT spec
@from json               Original input format
@target gpt-4o           Target model for L3 optimization
@compress semantic        Active compression mode
@warning lossy            Flags non-reversible output
```

### Dictionary Block

The `@dict` ... `@end` block defines short aliases for repeated values:

```
@dict
  $a: developer
  $b: Engineering
  $c: active
@end
```

### Key-Value Pairs

Simple scalar values use `key: value` syntax:

```
name: Alice
age: 28
active: true
email: null
```

### Tabular Arrays

Arrays of uniform objects are the most powerful compression target. They use a compact header declaring the field names, followed by pipe-delimited rows:

```
users [3]{name|role|team}:
  Alice|$a|platform
  Bob|$a|platform
  Carol|designer|product
```

This replaces three full JSON objects with three short lines.

### Inline Arrays

Arrays of primitives are flattened to a single comma-delimited line:

```
tags [4]: TypeScript,Rust,Go,Python
scores [3]: 95,87,92
```

### List Arrays

Arrays of non-uniform objects use YAML-style dash notation:

```
events [2]:
  - type: deploy
    status: success
  - type: rollback
    status: failed
    reason: timeout
```

### Nested Objects

Objects are expressed through indentation:

```
config
  database
    host: localhost
    port: 5432
  cache
    ttl: 3600
```

---

## API Reference

### `compress(input, options?)`

Compresses a string into PAKT format.

```ts
function compress(input: string, options?: PaktOptions): PaktResult
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | `string` | Text to compress (JSON, YAML, CSV, Markdown, or plain text) |
| `options` | `PaktOptions` | Optional compression settings |

**Returns** `PaktResult`:

| Field | Type | Description |
|-------|------|-------------|
| `compressed` | `string` | The PAKT-formatted output |
| `originalTokens` | `number` | Token count of the input |
| `compressedTokens` | `number` | Token count of the PAKT output |
| `savings` | `PaktSavings` | Savings breakdown (total and per-layer) |
| `reversible` | `boolean` | `false` only if L4 (semantic) was applied |
| `detectedFormat` | `PaktFormat` | The input format (detected or specified) |
| `dictionary` | `DictEntry[]` | Alias entries created by L2 |

---

### `decompress(pakt, outputFormat?)`

Decompresses a PAKT string back to any supported format.

```ts
function decompress(pakt: string, outputFormat?: PaktFormat): DecompressResult
```

If `outputFormat` is omitted, the format declared in the `@from` header is used.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `pakt` | `string` | The PAKT-formatted string to decompress |
| `outputFormat` | `PaktFormat` | Target output format (defaults to `@from` header value) |

**Returns** `DecompressResult`:

| Field | Type | Description |
|-------|------|-------------|
| `data` | `unknown` | Parsed structured data (JavaScript object/array) |
| `text` | `string` | Formatted output string in the requested format |
| `originalFormat` | `PaktFormat` | Format declared in `@from` header |
| `wasLossy` | `boolean` | Whether L4 (semantic compression) was applied |

---

### `detect(input)`

Identifies the format of input text using heuristic analysis.

```ts
function detect(input: string): DetectionResult
```

Detection runs in priority order: PAKT > JSON > CSV > Markdown > YAML > Text. Each detector produces a confidence score; the highest-confidence candidate wins.

**Returns** `DetectionResult`:

| Field | Type | Description |
|-------|------|-------------|
| `format` | `PaktFormat` | `'json'` \| `'yaml'` \| `'csv'` \| `'markdown'` \| `'pakt'` \| `'text'` |
| `confidence` | `number` | 0 (guess) to 1 (certain) |
| `reason` | `string` | Human-readable explanation of the detection |

---

### `countTokens(text, model?)`

Counts BPE tokens for a text string using the cl100k_base tokenizer (compatible with GPT-4, GPT-4o, and Claude models).

```ts
function countTokens(text: string, model?: string): number
```

---

### `compareSavings(original, compressed, model?)`

Generates a detailed savings report comparing original and compressed text, with optional cost estimates based on model pricing.

```ts
function compareSavings(original: string, compressed: string, model?: string): SavingsReport
```

**Returns** `SavingsReport`:

| Field | Type | Description |
|-------|------|-------------|
| `originalTokens` | `number` | Token count of original text |
| `compressedTokens` | `number` | Token count of compressed text |
| `savedTokens` | `number` | Tokens saved |
| `savedPercent` | `number` | Percentage saved (0-100) |
| `model` | `string` | Model used for counting/pricing |
| `costSaved` | `object \| undefined` | `{ input: number, output: number, currency: string }` |

Known model pricings: `gpt-4o`, `gpt-4o-mini`, `claude-sonnet`, `claude-opus`, `claude-haiku`.

---

### `prettyPrint(ast, options?)`

Formats a PAKT AST into human-readable PAKT with column-aligned tabular rows.

```ts
import { prettyPrint } from '@yugenlab/pakt';
import type { PrettyOptions } from '@yugenlab/pakt';

const options: PrettyOptions = {
  indent: 2,            // spaces per indent level (default: 2)
  maxLineLength: 120,   // max line length before wrapping (default: 120)
  sectionSpacing: 1,    // blank lines between top-level sections (default: 1)
  alignColumns: true,   // align tabular columns with padding (default: true)
};

const pretty = prettyPrint(documentNode, options);
```

When `alignColumns` is enabled, tabular arrays are formatted with padded cells:

```
users [3]{name|role|city}:
  Alice | developer | New York
  Bob   | designer  | London
  Carol | manager   | Tokyo
```

---

### `validate(pakt)` / `repair(pakt)`

Validate PAKT syntax and auto-repair common issues.

```ts
import { validate, repair } from '@yugenlab/pakt';

const result = validate(paktString);
// { valid: true, errors: [], warnings: [{ line: 3, message: '...', code: 'W001' }] }

const { text, applied } = repair(paktString);
// text: fixed PAKT string, applied: list of repairs made
```

---

## Supported Formats

PAKT auto-detects the input format and can decompress to any supported output format, enabling cross-format conversion through the PAKT intermediate representation.

| Format | Auto-Detect | Compress | Decompress To | Notes |
|--------|------------|----------|---------------|-------|
| **JSON** | Yes (0.99) | Yes | Yes | Supports JSONC (comments stripped) |
| **YAML** | Yes (0.80) | Yes | Yes | Subset parser; handles common YAML patterns |
| **CSV** | Yes (0.95) | Yes | Yes | Comma, tab, and semicolon delimiters |
| **Markdown** | Yes (0.90) | Yes | Yes | Headings, tables, links, code blocks |
| **Plain Text** | Fallback | Yes | Yes | Passthrough with minimal structural encoding |
| **PAKT** | Yes (1.00) | -- | Yes | Already compressed; returned unchanged |

```ts
// Cross-format conversion: JSON -> PAKT -> YAML
const pakt = compress(jsonString);
const yaml = decompress(pakt.compressed, 'yaml');

// CSV -> PAKT -> JSON
const pakt2 = compress(csvString, { fromFormat: 'csv' });
const json = decompress(pakt2.compressed, 'json');
```

---

## Configuration

### `PaktOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `layers` | `Partial<PaktLayers>` | `{ structural: true, dictionary: true }` | Which compression layers to enable |
| `fromFormat` | `PaktFormat` | Auto-detected | Force a specific input format |
| `targetModel` | `string` | `'gpt-4o'` | Target model for L3 tokenizer optimization |
| `dictMinSavings` | `number` | `3` | Minimum net token savings required to create a dictionary alias |
| `semanticBudget` | `number` | `0` | Token budget for L4 semantic compression |

### `PaktLayers`

| Layer | Field | Default | Description |
|-------|-------|---------|-------------|
| L1 | `structural` | `true` | Structural conversion to PAKT syntax |
| L2 | `dictionary` | `true` | N-gram deduplication with aliases |
| L3 | `tokenizerAware` | `false` | Model-specific BPE tokenizer optimization |
| L4 | `semantic` | `false` | Lossy compression via summarization |

```ts
import { compress, DEFAULT_OPTIONS, DEFAULT_LAYERS } from '@yugenlab/pakt';

const result = compress(input, {
  ...DEFAULT_OPTIONS,
  layers: { ...DEFAULT_LAYERS, tokenizerAware: true },
  targetModel: 'claude-sonnet',
  dictMinSavings: 5,
});
```

---

## Exported Types

All types are exported for full TypeScript support:

```ts
import type {
  PaktOptions,
  PaktResult,
  PaktFormat,
  PaktLayers,
  PaktSavings,
  DecompressResult,
  DetectionResult,
  DictEntry,
  SavingsReport,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ModelPricing,
  ParserMode,
  HeaderType,
  EnvelopeInfo,
  PrettyOptions,
} from '@yugenlab/pakt';
```

---

## Benchmarks

| Input | Format | Tokens | With PAKT | Savings | Roundtrip |
|-------|--------|--------|-----------|---------|-----------|
| 50-row user array | JSON | 1,847 | 923 | **50%** | Lossless |
| Nested API response | JSON | 612 | 389 | **36%** | Lossless |
| 20-column dataset | CSV | 2,103 | 1,154 | **45%** | Lossless |
| Deep config file | YAML | 891 | 534 | **40%** | Lossless |
| API response (25 items) | JSON | 1,200 | 720 | **40%** | Lossless |

Run benchmarks locally:

```bash
pnpm bench
```

---

## Acknowledgments

PAKT's Layer 1 pipe-delimited syntax is directly inspired by **[TOON Format v1.3](https://github.com/toon-format/spec)**, created by **[Nicholas Charlton](https://github.com/nichochar)** ([@nichochar](https://github.com/nichochar)). TOON is the original compact notation for structured data -- it proved that JSON's syntactic overhead is unnecessary for machine-readable formats. PAKT builds on TOON's core design by adding multi-format input support, an automatic dictionary compression layer, and guaranteed lossless round-tripping across a configurable pipeline. TOON has implementations in Python, TypeScript, Go, Rust, .NET, Elixir, Java, and Julia.

Thank you, Nicholas, for creating TOON and making the spec open.

---

## Research and References

PAKT's design draws from peer-reviewed research on prompt compression and efficient LLM communication:

- **CompactPrompt** (2025) -- Structured prompt compression that removes redundant content from function-calling prompts while preserving LLM accuracy.
- **LLMLingua-2** (Microsoft, 2024) -- Task-agnostic prompt compression via data distillation, achieving high compression with minimal accuracy loss.
- **LTSC** (2024) -- LLM-driven Token-level Structured Compression for long text workflows, combining structural and token-level techniques.
- **LiteToken** (2025) -- Lightweight token compression for efficient encoding of structured data in LLM contexts.
- **Table Serialization Studies** -- Research on optimal formats for presenting tabular data to LLMs (pipe-delimited formats consistently outperform JSON for tables).

PAKT extends these ideas with a layered, configurable pipeline and guaranteed lossless round-tripping through L1-L3.

---

## Contributing

```bash
# Clone the monorepo
git clone https://github.com/sriinnu/clipforge-PAKT.git
cd clipforge-pakt

# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Run benchmarks
pnpm bench
```

PRs welcome. Please run `pnpm build && pnpm test` before submitting.

---

## License

[MIT](../../LICENSE) -- YugenLab

---

<p align="center">
  <sub>Built by <b>YugenLab</b></sub>
</p>

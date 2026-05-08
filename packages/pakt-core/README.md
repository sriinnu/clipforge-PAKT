<p align="center">
  <img src="https://raw.githubusercontent.com/sriinnu/clipforge-PAKT/main/assets/pakt-logo.svg" alt="PAKT" height="60" />
</p>

<h3 align="center">@sriinnu/pakt</h3>

<p align="center">
  Lossless-first prompt compression for LLM data. Structured payloads drop 27-33%, repetitive text 38-69%, logs 57% tokens.<br/>
  <i>Stop paying for syntax. Every token should carry meaning.</i>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@sriinnu/pakt"><img src="https://img.shields.io/npm/v/@sriinnu/pakt?color=6366f1&label=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@sriinnu/pakt"><img src="https://img.shields.io/npm/dm/@sriinnu/pakt?color=8b5cf6&label=downloads" alt="npm downloads" /></a>
  <a href="https://github.com/sriinnu/clipforge-PAKT/actions"><img src="https://img.shields.io/github/actions/workflow/status/sriinnu/clipforge-PAKT/ci.yml?label=CI&color=22c55e" alt="CI" /></a>
  <a href="https://github.com/sriinnu/clipforge-PAKT/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b5cf6" alt="license" /></a>
  <img src="https://img.shields.io/badge/TypeScript-6-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white" alt="Node.js >= 18" />
</p>

---

PAKT (Pipe-Aligned Kompact Text) converts JSON, YAML, CSV, and markdown documents with embedded structured blocks into a compact pipe-delimited format that reduces LLM token counts by **30-50%** on structured payloads while preserving data fidelity across its core `L1-L3` layers. An optional budgeted `L4` layer trades fidelity for additional savings only when explicitly requested.

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

| Input Type | Savings | Round-trip |
|---|---|---|
| JSON 10 records | 27% | Lossless |
| JSON 50 records | 33% | Lossless |
| Log lines (duplicates) | 57% | Lossless |
| Repetitive text | 38-69% | Lossless |
| Normal prose (no repetition) | 0% (passthrough) | Safe |

---

## Install

```bash
npm install @sriinnu/pakt
```

Requires **Node 18+**.

---

## Quick Usage

### Compress and decompress

```typescript
import { compress, decompress } from '@sriinnu/pakt';

const result = compress('{"name":"Alice","age":30,"role":"engineer"}');
console.log(result.compressed);          // PAKT-encoded string
console.log(`Saved ${result.savings.totalPercent}% tokens`);

const original = decompress(result.compressed, 'json');
console.log(original.text);             // original JSON restored
```

### Mixed content (markdown with embedded data blocks)

```typescript
import { compressMixed } from '@sriinnu/pakt';

const markdown = '# Report\n```json\n{"users":[{"name":"Alice"}]}\n```';
const result = compressMixed(markdown);
console.log(result.compressed);         // prose untouched, structured blocks compressed
```

### Detect format + count tokens

```typescript
import { detect, countTokens } from '@sriinnu/pakt';

const fmt = detect('name: Alice\nage: 30');
console.log(fmt.format);     // 'yaml'

const n = countTokens('{"hello":"world"}', 'gpt-4o');
console.log(n);              // token count
```

### Supported tokenizers

PAKT counts tokens — and runs L3's merge-savings gate — using the tokenizer
family that matches the target model. Use `getTokenizerFamily(model)` to
align downstream consumers (playground, desktop, extension) with the same
encoding the core uses.

| Target model                                 | Family         | Notes                                   |
| -------------------------------------------- | -------------- | --------------------------------------- |
| `gpt-4o`, `gpt-4o-mini`, `o1`, `o3`, `o4`    | `o200k_base`   | Exact.                                  |
| `gpt-4`, `gpt-4-turbo`, `gpt-3.5-turbo`      | `cl100k_base`  | Exact.                                  |
| `claude-sonnet`, `claude-opus`, `claude-haiku` | `cl100k_base` | **Approximate** — see caveat below.     |
| `llama-3`, `llama-3.1`                       | `cl100k_base`  | **Approximate** — see caveat below.     |
| Unknown model strings                        | `cl100k_base`  | Fallback; `exact: false` in the info.   |

Exact Claude counts require Anthropic's tokenizer, which is not publicly
available. Llama ships a 128k SentencePiece vocab that `gpt-tokenizer`
does not bundle. For both, PAKT uses `cl100k_base` as the closest
publicly-available BPE — expect small drift from the provider's own
counts. Register a custom `TokenCounter` via `registerTokenCounter(...)`
if you need exact counts for those families.

```typescript
import { getTokenizerFamily, getTokenizerFamilyInfo } from '@sriinnu/pakt';

getTokenizerFamily('gpt-4o');            // 'o200k_base'
getTokenizerFamily('claude-opus');       // 'cl100k_base'

const info = getTokenizerFamilyInfo('claude-sonnet');
if (!info.exact) console.warn(info.approximationNote);
```

### Compressibility scoring

```typescript
import { estimateCompressibility } from '@sriinnu/pakt';

const score = estimateCompressibility(myJson);
console.log(score.score);    // 0.72
console.log(score.label);    // 'high'
console.log(score.profile);  // 'tokenizer' — recommended layer profile
```

### LLM round-trip: detect PAKT on the way back

```typescript
import { PAKT_SYSTEM_PROMPT, compress, interpretModelOutput } from '@sriinnu/pakt';

const packed = compress(largeJsonPayload).compressed;

// send `${PAKT_SYSTEM_PROMPT}` + `packed` to your model
const modelReply = await runModel(packed);

const resolved = interpretModelOutput(modelReply, { outputFormat: 'json' });

if (resolved.action === 'decompressed' || resolved.action === 'repaired-decompressed') {
  console.log(resolved.data); // structured JSON object
} else {
  console.log(resolved.text); // raw model response
}
```

### Opt-in L4 semantic compression

```typescript
import { compress } from '@sriinnu/pakt';

const result = compress(largeJsonPayload, {
  fromFormat: 'json',
  layers: { semantic: true },
  semanticBudget: 120,
});

console.log(result.reversible); // false
console.log(result.compressed); // includes @compress semantic + @warning lossy
```

### Prompt cache integration (0.10)

When the LLM provider supports prefix caching (Anthropic `cache_control`, AWS Bedrock 1h TTL, OpenAI auto-prefix-cache, Google context caching), pass a `target` and PAKT will tell you exactly where the cacheable prefix ends:

```typescript
import { compress } from '@sriinnu/pakt';

const result = compress(payload, { target: 'bedrock' });

console.log(result.cacheBreakpoint);
// { byteOffset: 142, recommendedTTLSeconds: 3600, target: 'bedrock' }

// Pass to the SDK: cache_control sits at byteOffset; everything before
// is prefix-stable across turns (assuming you use pakt_auto + rolling-dict).
```

| Target       | Recommended TTL | Source |
|--------------|-----------------|--------|
| `bedrock`    | 3600s (1h)      | AWS What's-New (Jan 2026) |
| `anthropic`  | 300s (5min)     | Anthropic prompt-caching docs (Mar 2026 default) |
| `openai`     | 0 (auto)        | OpenAI prefix cache, server-managed |
| `google`     | 0 (auto)        | Gemini context caching, ≥32k tokens |

The byte offset lands right after the `@dict ... @end` block. Header recognition is restricted to a known whitelist (`@from`, `@dict`, `@end`, `@compress`, `@warning`, `@version`, `@target`, `@profile`) so a body line starting with `@mention` or `@Component` does not get absorbed into the prefix and break byte-stability.

### Context engine (0.10)

Unified context-window optimizer for agent loops:

```typescript
import { createContextEngine } from '@sriinnu/pakt';

const engine = createContextEngine({
  maxContextTokens: 50_000,
  recentTurns: 5,
  toolResultTailLines: 30,    // older tool outputs truncate to last 30 lines
});

engine.addMessage({ role: 'user', content: 'fix the auth bug' });
engine.addToolResult('read_file', bigJson);

const { messages, savings } = engine.optimize();
console.log(savings.breakdown);
// {
//   toolResults,         // savings from compressing tool results in place
//   historyCompression,  // savings from compressing old turns
//   summarization,       // savings from extracting key facts
//   deduplication,       // savings from replacing repeated content with references
//   toolResultAging,     // savings from tail-truncating older tool outputs (0.10)
// }
```

**Tool-result aging** walks the transcript back-to-front, snaps the cutoff to the nearest user-message boundary, and tail-truncates older tool outputs. Char-fallback handles long single-line payloads (minified JSON, base64). Set `toolResultTailLines: 0` to disable aging entirely.

---

## MCP Server

Add 5 lines to your MCP config. This is the agent integration path for stdio-based MCP hosts:

```json
{
  "mcpServers": {
    "pakt": {
      "command": "npx",
      "args": ["-y", "@sriinnu/pakt", "serve", "--stdio"]
    }
  }
}
```

Your AI agent gets seven tools automatically:

| Tool | Purpose |
|------|---------|
| `pakt_compress` | Compress an explicit input with optional layer / semantic / PII / target options |
| `pakt_auto` | Auto-detect: compress structured input, decompress PAKT input, passthrough otherwise. Backed by dedup cache + rolling-dict for cross-turn alias reuse |
| `pakt_inspect` | Estimate savings without compressing — agents call this first to decide whether compression is worth it |
| `pakt_stats` | Compression metrics for the current process (or `scope: 'all'` to aggregate from disk). Surfaces P50/P95/P99 latency and lossy-call accounting (0.10) |
| `pakt_explain` | Per-layer breakdown of what each layer saved on a given input |
| `pakt_savings` | Concise dollar-amount savings summary at the configured model's pricing |
| `pakt_dashboard` | Rich view: format breakdown, dedup efficiency, rolling-dict reuse, latency, lossy (0.10) |

The compress / auto tools accept `semanticBudget` for opt-in lossy L4, `piiMode` for redaction, and `target` for cache-control hints (0.10).

If you are embedding PAKT into your own MCP host, register the tools directly:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerPaktTools } from '@sriinnu/pakt';

const server = new McpServer({ name: 'my-agent', version: '1.0.0' });
registerPaktTools(server);
```

---

## CLI

```bash
npm install -g @sriinnu/pakt

pakt compress data.json                       # compress to PAKT
pakt compress data.json --semantic-budget 120  # opt into lossy L4
pakt decompress data.pakt --to json           # decompress
cat data.json | pakt auto                     # auto-detect + compress or decompress
pakt inspect data.json --model gpt-4o         # inspect before packing
pakt savings data.json --model gpt-4o         # token savings report
pakt stats                                    # aggregate session stats
pakt stats --today                            # filter to today
pakt serve --stdio                            # start MCP server
```

---

## Key Features

- **5-layer compression pipeline** -- Structural (L1), Dictionary (L2), Tokenizer-Aware (L3), opt-in budgeted Semantic (L4), Content-aware abbreviations (L5)
- **Delta encoding** -- Adjacent rows sharing values replaced with `~` sentinels, plus `+N` / `-N` numeric deltas for monotonic columns (ids, timestamps, counters), saving 20-40% on repetitive tabular data
- **Prefix-stable `@dict` for prompt caching (0.10)** -- `RollingDictionary` pins seeded expansions to fixed alias slots across turns so the cacheable prefix stays byte-identical. New `target` option returns a `cacheBreakpoint` hint (byte offset + recommended TTL) for Anthropic, AWS Bedrock (1h TTL), OpenAI, and Google
- **Context engine (0.10)** -- `createContextEngine()` unifies tool-result compression, dedup, fact extraction, and back-to-front tool-result aging that snaps to user-message boundaries
- **Tokenizer-family aware** -- `getTokenizerFamily(model)` / `countTokens(text, model)` align the L3 merge-savings gate and downstream token counts with the target model (`o200k_base`, `cl100k_base`, fallback documented for Claude / Llama)
- **10 MB input cap** -- `compress()` throws a typed error for oversize inputs with an allocation-free byte counter so the check does not materialise the input
- **Auto context compression** -- Content-addressed dedup, text line dedup, word n-gram dictionary, whitespace normalization
- **Compressibility scoring** -- `estimateCompressibility()` returns a 0-1 score and recommended profile before you compress
- **Session stats with latency + lossy (0.10)** -- `pakt_stats` and `pakt_dashboard` track P50/P95/P99 latency percentiles and non-reversible-call accounting alongside per-format token savings
- **Multi-format support** -- JSON, YAML, CSV, Markdown, Plain Text with auto-detection
- **Lossless round-tripping** -- L1-L3 preserve data fidelity; L4 is explicitly lossy. Property-based fuzzers run on every build
- **MCP server + embeddable tools** -- `pakt serve --stdio` or `registerPaktTools()` for agent workflows
- **Small runtime** -- `gpt-tokenizer`, MCP SDK, and `zod`
- **Full TypeScript support** -- All types exported, dual ESM/CJS builds

---

## Part of ClipForge

This is the core library inside the [ClipForge](https://github.com/sriinnu/clipforge-PAKT) monorepo. The desktop tray app, browser extension, and playground live alongside it as separate product surfaces.

---

## Documentation

- [Getting Started](https://github.com/sriinnu/clipforge-PAKT/blob/main/docs/GETTING-STARTED.md)
- [PAKT Format Spec](https://github.com/sriinnu/clipforge-PAKT/blob/main/docs/PAKT-FORMAT-SPEC.md)
- [Algorithm Details](https://github.com/sriinnu/clipforge-PAKT/blob/main/docs/algorithms.md)

---

## License

[MIT](https://github.com/sriinnu/clipforge-PAKT/blob/main/LICENSE) -- Srinivas Pendela

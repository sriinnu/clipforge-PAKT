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

Your AI agent gets `pakt_compress`, `pakt_auto`, `pakt_inspect`, and `pakt_stats` automatically. The tools accept optional `semanticBudget` for opt-in lossy L4, and `pakt_inspect` helps agents decide whether compression is worth it before they call it.

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

- **4-layer compression pipeline** -- Structural (L1), Dictionary (L2), Tokenizer-Aware (L3), and opt-in budgeted Semantic (L4)
- **Delta encoding** -- Adjacent rows sharing values replaced with `~` sentinels, saving 20-40% on repetitive tabular data
- **Auto context compression** -- Content-addressed dedup, text line dedup, word n-gram dictionary, whitespace normalization
- **Compressibility scoring** -- `estimateCompressibility()` returns a 0-1 score and recommended profile before you compress
- **Session stats** -- `pakt_stats` MCP tool and `pakt stats` CLI for real-time token savings tracking
- **Multi-format support** -- JSON, YAML, CSV, Markdown, Plain Text with auto-detection
- **Lossless round-tripping** -- L1-L3 preserve data fidelity; L4 is explicitly lossy
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

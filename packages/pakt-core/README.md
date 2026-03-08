# @sriinnu/pakt

**PAKT compression engine — lossless-first structured data compression for LLM token optimization. Core `L1-L3` is lossless; `L4` is opt-in and lossy.**

[![npm version](https://img.shields.io/npm/v/@sriinnu/pakt)](https://www.npmjs.com/package/@sriinnu/pakt)
[![tests](https://github.com/sriinnu/clipforge-PAKT/actions/workflows/ci.yml/badge.svg)](https://github.com/sriinnu/clipforge-PAKT/actions)
[![license](https://img.shields.io/npm/l/@sriinnu/pakt)](./LICENSE)

PAKT converts JSON, YAML, CSV, and markdown documents with embedded structured blocks into a compact pipe-delimited format that typically reduces LLM token counts by 30-50% while preserving structured data fidelity across its core `L1-L3` layers. An optional budgeted `L4` layer trades fidelity for additional savings only when explicitly requested.

---

## Install

```bash
npm install @sriinnu/pakt
```

Requires Node 18+.

PAKT is the core package inside the wider ClipForge repo. If you want the desktop tray app or the experimental browser extension, those live in the monorepo; this package is the library, CLI, and MCP surface.

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

`interpretModelOutput()` auto-detects valid PAKT, searches fenced blocks, optionally repairs minor syntax issues, and only decompresses when the result validates cleanly.

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

### MCP Server (Claude Desktop, Cursor, Claude Code)

Add 5 lines to your MCP config — no extra files or SDK needed:

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

Your AI agent gets `pakt_compress` and `pakt_auto` tools automatically. Both accept optional `semanticBudget` for opt-in lossy `L4`.

### What the package includes

- Core compression and decompression APIs
- Mixed-content helpers for markdown documents with embedded JSON/YAML/CSV
- Token counting and format detection
- CLI commands
- MCP stdio server via `pakt serve --stdio`

### CLI

```bash
npm install -g @sriinnu/pakt

pakt compress data.json                      # compress to PAKT
pakt compress data.json --semantic-budget 120 # opt into lossy L4
pakt decompress data.pakt --to json          # decompress
cat data.json | pakt auto                    # auto-detect + compress or decompress
pakt savings data.json --model gpt-4o        # token savings report
pakt serve --stdio                           # start MCP server
```

---

## Full Documentation

- [Getting Started](https://github.com/sriinnu/clipforge-PAKT/blob/main/docs/GETTING-STARTED.md)
- [PAKT Format Spec](https://github.com/sriinnu/clipforge-PAKT/blob/main/docs/PAKT-FORMAT-SPEC.md)
- [Algorithm Details](https://github.com/sriinnu/clipforge-PAKT/blob/main/docs/algorithms.md)

---

## License

MIT

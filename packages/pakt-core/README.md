# @sriinnu/pakt

**PAKT compression engine — lossless-first structured data compression for LLM token optimization. Core `L1-L3` is lossless; `L4` is opt-in and lossy.**

[![npm version](https://img.shields.io/npm/v/@sriinnu/pakt)](https://www.npmjs.com/package/@sriinnu/pakt)
[![tests](https://github.com/sriinnu/clipforge-PAKT/actions/workflows/ci.yml/badge.svg)](https://github.com/sriinnu/clipforge-PAKT/actions)
[![license](https://img.shields.io/npm/l/@sriinnu/pakt)](./LICENSE)

PAKT converts JSON, YAML, CSV, and markdown documents with embedded structured blocks into a compact pipe-delimited format that often reduces LLM token counts by 30-50% on structured payloads while preserving structured data fidelity across its core `L1-L3` layers. An optional budgeted `L4` layer trades fidelity for additional savings only when explicitly requested.

For app and host integrations, `PAKT_LAYER_PROFILES` and `createProfiledPaktOptions()` provide the canonical shared profile model used across the playground, extension, desktop shell, and custom Node hosts.

---

## Install

```bash
npm install @sriinnu/pakt
```

Requires Node 18+.

PAKT is the core package inside the wider ClipForge repo. This package is the supported library, CLI, and MCP surface. The desktop tray app and the browser extension live in the monorepo as separate product surfaces with different maturity levels.

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

### MCP Server (stdio-based MCP hosts)

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

Your AI agent gets `pakt_compress`, `pakt_auto`, and `pakt_inspect` automatically. `pakt serve --stdio` uses the official MCP SDK stdio transport, so the protocol and framing match standard MCP clients instead of a custom line protocol. The generic stdio path is verified in-repo; named hosts such as Claude Desktop, Cursor, and Claude Code are common targets rather than an exhaustive certification matrix. That matters because agents can inspect first, then compress or decompress only when the token savings justify the call. The compression tools accept optional `semanticBudget` for opt-in lossy `L4`, and `pakt_inspect` helps agents decide whether compression is worth it before they call it.

If you are embedding PAKT into your own MCP host, register the tools directly:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerPaktTools } from '@sriinnu/pakt';

const server = new McpServer({ name: 'my-agent', version: '1.0.0' });
registerPaktTools(server);
```

### What the package includes

- Core compression and decompression APIs
- Mixed-content helpers for markdown documents with embedded JSON/YAML/CSV
- Token counting and format detection
- CLI commands
- MCP stdio server via `pakt serve --stdio`

### CLI

```bash
npm install -g @sriinnu/pakt

pakt compress data.json                       # compress to PAKT
pakt compress data.json --semantic-budget 120 # opt into lossy L4
pakt decompress data.pakt --to json           # decompress
cat data.json | pakt auto                     # auto-detect + compress or decompress
pakt inspect data.json --model gpt-4o         # inspect before packing
pakt savings data.json --model gpt-4o         # token savings report
pakt serve --stdio                            # start MCP server
```

---

## Full Documentation

- [Getting Started](https://github.com/sriinnu/clipforge-PAKT/blob/main/docs/GETTING-STARTED.md)
- [PAKT Format Spec](https://github.com/sriinnu/clipforge-PAKT/blob/main/docs/PAKT-FORMAT-SPEC.md)
- [Algorithm Details](https://github.com/sriinnu/clipforge-PAKT/blob/main/docs/algorithms.md)

---

## License

MIT

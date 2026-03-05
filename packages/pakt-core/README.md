# @sriinnu/pakt

**PAKT compression engine — lossless format conversion for LLM token optimization.**

[![npm version](https://img.shields.io/npm/v/@sriinnu/pakt)](https://www.npmjs.com/package/@sriinnu/pakt)
[![tests](https://github.com/sriinnu/clipforge-pakt/actions/workflows/ci.yml/badge.svg)](https://github.com/sriinnu/clipforge-pakt/actions)
[![license](https://img.shields.io/npm/l/@sriinnu/pakt)](./LICENSE)

PAKT converts JSON, YAML, CSV, and Markdown into a compact pipe-delimited format that
reduces LLM token counts by 30–60% without losing information.

---

## Install

```bash
npm install @sriinnu/pakt
```

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

### Mixed content (markdown with embedded data)

```typescript
import { compressMixed } from '@sriinnu/pakt';

const markdown = '# Report\n```json\n{"users":[{"name":"Alice"}]}\n```';
const result = compressMixed(markdown);
console.log(result.compressed);         // prose untouched, JSON blocks compressed
```

### Detect format + count tokens

```typescript
import { detect, countTokens } from '@sriinnu/pakt';

const fmt = detect('name: Alice\nage: 30');
console.log(fmt.format);     // 'yaml'

const n = countTokens('{"hello":"world"}', 'gpt-4o');
console.log(n);              // token count
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

Your AI agent gets `pakt_compress` and `pakt_auto` tools automatically.

### CLI

```bash
npm install -g @sriinnu/pakt

pakt compress data.json                      # compress to PAKT
pakt decompress data.pakt --to json          # decompress
cat data.json | pakt auto                    # auto-detect + compress or decompress
pakt savings data.json --model gpt-4o        # token savings report
pakt serve --stdio                           # start MCP server
```

---

## Full Documentation

- [Getting Started](https://github.com/sriinnu/clipforge-pakt/blob/main/docs/GETTING-STARTED.md)
- [PAKT Format Spec](https://github.com/sriinnu/clipforge-pakt/blob/main/docs/PAKT-FORMAT-SPEC.md)
- [Algorithm Details](https://github.com/sriinnu/clipforge-pakt/blob/main/docs/algorithms.md)

---

## License

MIT

# PAKT MCP Integration Guide

PAKT exposes three MCP-compatible tools that help agents decide when structured
data is worth compacting, compress it into a model-efficient format, and restore
it when a human or downstream system needs the original representation. This
guide covers integration with MCP clients and hosts, direct TypeScript usage,
and shell workflows.

## Overview

PAKT (Pipe-Aligned Kompact Text) compresses JSON, YAML, CSV, and Markdown into a
compact pipe-delimited format that uses **typically 30-50% fewer tokens** on the
payloads it is designed for. The MCP layer exists so agents can use PAKT as a
workflow primitive instead of a manual pre/post-processing step: inspect first,
compress only when it helps, then decompress only when a consumer needs the
original shape.

| Tool             | Purpose                                           |
|------------------|---------------------------------------------------|
| `pakt_compress`  | Compress text into PAKT with format hint support  |
| `pakt_auto`      | Auto-detect direction: compress raw or decompress PAKT |
| `pakt_inspect`   | Detect format, count tokens, estimate savings, and recommend the next action |

---

## Available Tools

### pakt_compress

Compresses input text into PAKT format. Accepts an optional format hint to skip
auto-detection when the caller knows the input type.

**Input schema:**

| Parameter | Type   | Required | Description                                                       |
|-----------|--------|----------|-------------------------------------------------------------------|
| `text`    | string | yes      | The text content to compress (JSON, YAML, CSV, Markdown, mixed)   |
| `format`  | string | no       | Format hint: `json`, `yaml`, `csv`, `markdown`, `text`, `pakt`    |
| `semanticBudget` | number | no | Positive token budget for opt-in lossy `L4` semantic compression |

**Output schema:**

| Field        | Type   | Description                            |
|--------------|--------|----------------------------------------|
| `compressed` | string | The compressed PAKT string             |
| `savings`    | number | Savings percentage (0-100)             |
| `format`     | string | Detected or specified input format     |
| `originalTokens` | number | Original token count               |
| `compressedTokens` | number | Compressed token count           |
| `savedTokens` | number | Absolute tokens saved                 |
| `reversible` | boolean | False only when the payload is lossy |

**Example request/response:**

```json
{
  "name": "pakt_compress",
  "arguments": {
    "text": "{\"users\":[{\"name\":\"Alice\",\"role\":\"dev\"},{\"name\":\"Bob\",\"role\":\"dev\"}]}",
    "format": "json"
  }
}
```

```json
{
  "compressed": "@from json\n@dict\n  $a: dev\n@end\nusers[2]{name|role}:\nAlice|$a\nBob|$a",
  "savings": 42,
  "format": "json"
}
```

### pakt_auto

Auto-detects whether the input is PAKT or raw text and routes accordingly.
PAKT input is decompressed; raw input is compressed.

**Input schema:**

| Parameter | Type   | Required | Description                                                           |
|-----------|--------|----------|-----------------------------------------------------------------------|
| `text`    | string | yes      | Text to process. PAKT is decompressed; raw is compressed              |
| `semanticBudget` | number | no | Positive token budget for opt-in lossy `L4` on the compress path     |

**Output schema:**

| Field     | Type   | Description                                  |
|-----------|--------|----------------------------------------------|
| `result`  | string | The processed text                           |
| `action`  | string | `"compressed"` or `"decompressed"`           |
| `savings` | number | Savings percentage (only when compressing)   |
| `detectedFormat` | string | Detected format before the action   |
| `originalFormat` | string | Original structured format when decompressing |
| `inputTokens` | number | Token count before processing (compress path) |
| `outputTokens` | number | Token count after processing (compress path) |
| `savedTokens` | number | Absolute tokens saved (compress path) |
| `reversible` | boolean | Whether the resulting representation preserves all information |
| `wasLossy` | boolean | Whether decompressed PAKT carried lossy `L4` content |

**Example -- compressing raw JSON:**

```json
{ "name": "pakt_auto", "arguments": { "text": "{\"name\":\"Alice\"}" } }
```

```json
{
  "result": "@from json\nname: Alice",
  "action": "compressed",
  "savings": 35,
  "detectedFormat": "json",
  "inputTokens": 12,
  "outputTokens": 8,
  "savedTokens": 4,
  "reversible": true
}
```

**Example -- decompressing PAKT:**

```json
{ "name": "pakt_auto", "arguments": { "text": "@from json\nname: Alice" } }
```

```json
{
  "result": "{\"name\":\"Alice\"}",
  "action": "decompressed",
  "detectedFormat": "pakt",
  "originalFormat": "json",
  "reversible": true,
  "wasLossy": false
}
```

---

## Integration by Platform

### Claude Desktop (`claude_desktop_config.json`)

PAKT ships with a built-in MCP server. Add 5 lines to your Claude Desktop
config at `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

Restart Claude Desktop. The `pakt_compress`, `pakt_auto`, and `pakt_inspect`
tools appear automatically.

### Cursor / VS Code with Continue.dev

Add to `.cursor/mcp.json` or `.continue/config.json`:

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

### Claude Code (`.mcp.json`)

Add to your project's `.mcp.json`:

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

### pakt_inspect

Detects the current format, counts tokens, estimates compression savings, and
recommends whether an MCP client should compress, decompress, or leave the text
as-is.

**Input schema:**

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `text`    | string | yes      | The text to inspect |
| `model`   | string | no       | Optional model identifier for token counting |
| `semanticBudget` | number | no | Optional positive token budget for lossy `L4` estimation |

**Output schema:**

| Field     | Type   | Description |
|-----------|--------|-------------|
| `detectedFormat` | string | Detected input format |
| `confidence` | number | Detector confidence |
| `reason` | string | Detection reason |
| `inputTokens` | number | Token count for the current input |
| `recommendedAction` | string | `compress`, `decompress`, or `leave-as-is` |
| `estimatedOutputTokens` | number | Token count after estimated compression, when relevant |
| `estimatedSavings` | number | Estimated savings percentage, when relevant |
| `estimatedSavedTokens` | number | Estimated tokens saved, when relevant |
| `reversible` | boolean | Whether the current or estimated representation is reversible |
| `originalFormat` | string | Original structured format when inspecting PAKT input |
| `wasLossy` | boolean | Whether the inspected PAKT payload contains lossy `L4` content |

### Any MCP-compatible client (generic)

`pakt serve --stdio` uses the official MCP SDK stdio transport, so it speaks
standard MCP framing and is expected to work with MCP clients that support stdio
transport. The repository currently verifies the generic stdio path directly;
named client configs below are integration targets, not an exhaustive client
certification matrix.

For custom servers (middleware, routing, multi-tool hosts), use the exported SDK
registration helper directly. This keeps the input/output contract, validation,
and tool behavior aligned with the packaged server:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerPaktTools } from '@sriinnu/pakt';

const server = new McpServer({ name: 'my-agent', version: '1.0.0' });
registerPaktTools(server);

await server.connect(new StdioServerTransport());
```

**Raw JSON tool definitions** (from `PAKT_MCP_TOOLS`):

```json
[
  {
    "name": "pakt_compress",
    "description": "Compress text into PAKT format for LLM token optimization. Supports JSON, YAML, CSV, Markdown, and mixed content. Returns the compressed string and savings percentage. Use the optional `format` parameter to skip auto-detection. Use `semanticBudget` to opt into lossy L4 semantic compression.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "text": {
          "type": "string",
          "description": "The text content to compress (JSON, YAML, CSV, Markdown, or mixed)."
        },
        "format": {
          "type": "string",
          "description": "Optional format hint. Skips auto-detection when provided. Valid values: json, yaml, csv, markdown, text, pakt.",
          "enum": ["json", "yaml", "csv", "markdown", "text", "pakt"]
        },
        "semanticBudget": {
          "type": "number",
          "description": "Optional positive token budget for opt-in lossy L4 semantic compression."
        }
      },
      "required": ["text"],
      "additionalProperties": false
    }
  },
  {
    "name": "pakt_auto",
    "description": "Auto-detect and process text: if input is PAKT, decompress it; if input is raw text/JSON/YAML/CSV/Markdown, compress it to PAKT. Returns the result string, the action taken, and savings (when compressing).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "text": {
          "type": "string",
          "description": "The text to process. PAKT input is decompressed; raw input is compressed."
        },
        "semanticBudget": {
          "type": "number",
          "description": "Optional positive token budget for opt-in lossy L4 semantic compression on the compress path."
        }
      },
      "required": ["text"],
      "additionalProperties": false
    }
  },
  {
    "name": "pakt_inspect",
    "description": "Inspect text before using PAKT. Detects the format, counts tokens, estimates compression savings, and recommends whether to compress, decompress, or leave the content as-is.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "text": {
          "type": "string",
          "description": "The text to inspect."
        },
        "model": {
          "type": "string",
          "description": "Optional model identifier used for token counting."
        },
        "semanticBudget": {
          "type": "number",
          "description": "Optional positive token budget to estimate lossy L4 compression."
        }
      },
      "required": ["text"],
      "additionalProperties": false
    }
  }
]
```

### n8n / Workflow Automation

In n8n, use a **Code node** (JavaScript) to call PAKT directly:

```javascript
// n8n Code node -- compress incoming data
const { compress } = require('@sriinnu/pakt');
const input = $input.first().json;
const result = compress(JSON.stringify(input.data));
return [{ json: { compressed: result.compressed, savings: result.savings.totalPercent } }];
```

Or use an **HTTP Request node** if you expose PAKT as an HTTP server
(wrap the MCP server with an HTTP adapter). The request body follows the
standard MCP tool call format shown in the tool definitions above.

### Chitragupta (shell agent)

For shell-based AI agents, PAKT provides CLI one-liners and sourceable
shell functions.

**Prerequisites:**

```bash
npm install -g @sriinnu/pakt
pakt --version
```

**Shell functions** -- add to `.bashrc` or `.zshrc`:

```bash
# Source the hook script (if provided)
source /path/to/clipforge-PAKT/scripts/chitragupta-hook.sh

# Or define inline:
pakt_send() { echo "$1" | pakt auto; }
pakt_receive() { echo "$1" | pakt auto; }

pakt_llm_call() {
  local prompt="$1"
  local llm_cmd="${2:-llm}"
  local compressed
  compressed=$(pakt_send "$prompt")
  local raw_response
  raw_response=$(echo "$compressed" | $llm_cmd)
  pakt_receive "$raw_response"
}
```

**Usage:**

```bash
# Compress a file and pipe to an LLM CLI
pakt auto data.json | llm-cli send --stdin

# Compress + call + decompress in one shot
pakt_llm_call "Analyze this JSON: $(cat data.json)"

# Compress and suppress savings output
echo "$prompt" | pakt auto 2>/dev/null
```

**Savings reporting:** `pakt auto` writes savings metadata to stderr so it
does not interfere with piped stdout.

---

## Full Round-Trip Example

A complete TypeScript example showing compression, LLM call, and decompression.

```typescript
import {
  PAKT_MCP_TOOLS,
  PAKT_SYSTEM_PROMPT,
  handlePaktTool,
} from '@sriinnu/pakt';
import type { PaktCompressResult, PaktAutoResult } from '@sriinnu/pakt';

// ---- Step 1: Register tools with your MCP server ----
// (see the generic server example above)

// ---- Step 2: Compress structured data before sending ----
const apiResponse = { users: [
  { name: 'Alice', role: 'eng', active: true },
  { name: 'Bob', role: 'eng', active: true },
  { name: 'Carol', role: 'pm', active: false },
]};

const compressed = handlePaktTool('pakt_compress', {
  text: JSON.stringify(apiResponse),
  format: 'json',
}) as PaktCompressResult;

console.log(`Compressed (${compressed.savings}% saved):`);
console.log(compressed.compressed);
// ---- Step 3: Build LLM messages with PAKT system prompt ----
const messages = [
  {
    role: 'system' as const,
    content: `You are a data analyst.\n\n${PAKT_SYSTEM_PROMPT}`,
  },
  {
    role: 'user' as const,
    content: `Summarize active users:\n${compressed.compressed}`,
  },
];

// ---- Step 4: Call your LLM (pseudo-code) ----
// const llmResponse = await callLLM(messages);
// ---- Step 5: Auto-decompress if the LLM responded in PAKT ----
const llmResponse = '@from json\nactiveUsers[2]{name|role}:\nAlice|eng\nBob|eng';
const decompressed = handlePaktTool('pakt_auto', {
  text: llmResponse,
}) as PaktAutoResult;

console.log(`Action: ${decompressed.action}`);
console.log(decompressed.result);
// => {"activeUsers":[{"name":"Alice","role":"eng"},{"name":"Bob","role":"eng"}]}
```

---

## PAKT_SYSTEM_PROMPT

When sending PAKT-compressed data to an LLM, append `PAKT_SYSTEM_PROMPT` to
your system message so the model understands the notation:

```typescript
import { PAKT_SYSTEM_PROMPT } from '@sriinnu/pakt';

const systemPrompt = `${basePrompt}\n\n${PAKT_SYSTEM_PROMPT}`;
```

The prompt is approximately 45 tokens and teaches the LLM to read
pipe-delimited rows and `@dict` aliases. Its content:

```
Data may use PAKT notation: pipe-delimited rows with a header row
declaring field names. `@dict` defines aliases (`$a`, `$b`) for
repeated values. Example:
@dict
  $a: eng
@end
team[2]{name|role}:
Alice|$a
Bob|$a
Treat PAKT as structured data equivalent to JSON.
```

**Why it matters:** Without this prompt, the LLM may not understand the
compressed format. Including it costs ~45 tokens but enables the model to
both read PAKT input and optionally respond in PAKT, creating a full
compression round-trip that compounds savings across multi-turn conversations.

---

## Configuration Reference

| Tool            | Description                          | Input                    | Output                                      |
|-----------------|--------------------------------------|--------------------------|----------------------------------------------|
| `pakt_compress` | Compress text into PAKT format       | `{ text, format?, semanticBudget? }` | `{ compressed, savings, format, originalTokens, compressedTokens, savedTokens, reversible }` |
| `pakt_auto`     | Auto compress or decompress          | `{ text, semanticBudget? }` | `{ result, action, savings?, detectedFormat, originalFormat?, inputTokens?, outputTokens?, savedTokens?, reversible?, wasLossy? }` |
| `pakt_inspect`  | Detect format and estimate savings   | `{ text, model?, semanticBudget? }` | `{ detectedFormat, confidence, reason, inputTokens, recommendedAction, estimatedOutputTokens?, estimatedSavings?, estimatedSavedTokens?, reversible?, originalFormat?, wasLossy? }` |

| Export              | Type     | Description                                  |
|---------------------|----------|----------------------------------------------|
| `PAKT_MCP_TOOLS`    | Array    | Raw JSON tool definitions for docs or custom registries |
| `registerPaktTools` | Function | Preferred SDK registration helper for MCP hosts |
| `handlePaktTool`    | Function | Dispatch function for incoming tool calls |
| `PAKT_SYSTEM_PROMPT`| String   | System prompt snippet for LLM comprehension |

All exports are available from the main package entry point:

```typescript
import {
  PAKT_MCP_TOOLS,
  registerPaktTools,
  handlePaktTool,
  PAKT_SYSTEM_PROMPT,
} from '@sriinnu/pakt';
```

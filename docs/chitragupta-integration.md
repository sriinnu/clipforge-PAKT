# Chitragupta Shell Integration

PAKT provides transparent token compression for AI agent workflows.
This guide covers how to integrate PAKT with Chitragupta (or any shell-based LLM assistant) for automatic prompt compression and response decompression.

## Overview

The integration works at two levels:

1. **Shell one-liners** -- pipe text through `pakt auto` before/after LLM calls.
2. **MCP tools** -- register `pakt_compress` and `pakt_auto` as MCP tools for agent-native compression.

## Shell Integration

### Prerequisites

Install the `@sriinnu/pakt` package globally (or ensure it is in your PATH):

```bash
npm install -g @sriinnu/pakt
# or
pnpm add -g @sriinnu/pakt
```

Verify the CLI is available:

```bash
pakt --version
```

### One-liners

**Compress a prompt before sending to an LLM:**

```bash
echo "$prompt" | pakt auto
```

**Decompress a PAKT-encoded LLM response:**

```bash
echo "$response" | pakt auto
```

**Compress a file and send to an LLM CLI:**

```bash
pakt auto data.json | llm-cli send --stdin
```

**Pipe a JSON API response through PAKT before passing to an agent:**

```bash
curl -s https://api.example.com/data | pakt auto | agent-cli prompt --stdin
```

### Shell function: `pakt_llm_call`

Add this to your `.bashrc`, `.zshrc`, or source the provided hook script:

```bash
# Source the hook script
source /path/to/clipforge-PAKT/scripts/chitragupta-hook.sh

# Or define inline:
pakt_send() {
  echo "$1" | pakt auto
}

pakt_receive() {
  echo "$1" | pakt auto
}

pakt_llm_call() {
  local prompt="$1"
  local llm_cmd="${2:-llm}"

  # Compress the prompt
  local compressed
  compressed=$(pakt_send "$prompt")

  # Call the LLM (replace with your LLM CLI)
  local raw_response
  raw_response=$(echo "$compressed" | $llm_cmd)

  # Decompress the response (if the LLM returned PAKT)
  pakt_receive "$raw_response"
}
```

**Usage:**

```bash
# Using the default LLM CLI
pakt_llm_call "Analyze this JSON: $(cat data.json)"

# Using a specific LLM CLI
pakt_llm_call "Summarize this data: $(cat report.csv)" "claude"
```

### Savings reporting

The `pakt auto` command writes savings metadata to stderr, so it does
not interfere with piped stdout. To see savings:

```bash
# Savings appear on stderr
echo '{"users": [{"name": "Alice", "role": "dev"}]}' | pakt auto
# stdout: compressed PAKT
# stderr: # Saved 42% (18->10 tokens, -8)
```

To suppress savings output:

```bash
echo "$prompt" | pakt auto 2>/dev/null
```

## MCP Tool Integration

PAKT exposes two MCP-compatible tools that can be registered with any
MCP server (Chitragupta, Claude Desktop, Cursor, etc.).

### Tool definitions

```typescript
import { PAKT_MCP_TOOLS, handlePaktTool } from '@sriinnu/pakt';

// PAKT_MCP_TOOLS contains:
// [
//   { name: 'pakt_compress', ... },
//   { name: 'pakt_auto', ... },
// ]
```

### Registering with an MCP server

```typescript
import { PAKT_MCP_TOOLS, handlePaktTool } from '@sriinnu/pakt';

for (const tool of PAKT_MCP_TOOLS) {
  server.registerTool(tool.name, tool.inputSchema, (args) =>
    handlePaktTool(tool.name, args),
  );
}
```

### Tool: `pakt_compress`

Compresses text into PAKT format.

**Input:**

| Parameter | Type   | Required | Description                                |
|-----------|--------|----------|--------------------------------------------|
| `text`    | string | yes      | The text to compress                       |
| `format`  | string | no       | Format hint (json, yaml, csv, markdown, text) |

**Output:**

```json
{
  "compressed": "@from json\nusers[2]{name|role}:\nAlice|dev\nBob|dev",
  "savings": 42,
  "format": "json"
}
```

### Tool: `pakt_auto`

Auto-detects direction and compresses or decompresses.

**Input:**

| Parameter | Type   | Required | Description              |
|-----------|--------|----------|--------------------------|
| `text`    | string | yes      | The text to auto-process |

**Output (when compressing):**

```json
{
  "result": "@from json\nname: Alice",
  "action": "compressed",
  "savings": 35
}
```

**Output (when decompressing):**

```json
{
  "result": "{\"name\": \"Alice\"}",
  "action": "decompressed"
}
```

## Chitragupta-specific setup

If using Chitragupta as your AI agent framework, add the following
to your Chitragupta MCP configuration:

```json
{
  "tools": [
    {
      "name": "pakt_compress",
      "description": "Compress text into PAKT format for token savings",
      "handler": "@sriinnu/pakt:handlePaktTool"
    },
    {
      "name": "pakt_auto",
      "description": "Auto compress or decompress text",
      "handler": "@sriinnu/pakt:handlePaktTool"
    }
  ]
}
```

### Workflow: Agent prompt compression

1. Agent prepares a prompt with structured data.
2. Before sending, call `pakt_compress` (or pipe through `pakt auto`).
3. Send the compressed prompt to the LLM with the PAKT system prompt.
4. Receive the LLM response.
5. If the response contains PAKT, call `pakt_auto` to decompress.

```typescript
import { PAKT_SYSTEM_PROMPT, handlePaktTool } from '@sriinnu/pakt';

// Step 1: Compress the structured data in the prompt
const compressed = handlePaktTool('pakt_compress', {
  text: JSON.stringify(apiResponse),
  format: 'json',
});

// Step 2: Build the LLM messages
const messages = [
  { role: 'system', content: `You are a helpful assistant.\n\n${PAKT_SYSTEM_PROMPT}` },
  { role: 'user', content: `Analyze this data:\n${compressed.compressed}` },
];

// Step 3: Call the LLM
const llmResponse = await callLLM(messages);

// Step 4: Auto-decompress if needed
const result = handlePaktTool('pakt_auto', { text: llmResponse });
console.log(result.result);
```

## System prompt

When sending PAKT-compressed data to an LLM, include the PAKT system
prompt so the model understands the notation:

```typescript
import { PAKT_SYSTEM_PROMPT } from '@sriinnu/pakt';

// Append to your system prompt
const systemPrompt = `${basePrompt}\n\n${PAKT_SYSTEM_PROMPT}`;
```

The system prompt is approximately 45 tokens and teaches the LLM
to read pipe-delimited rows and dictionary aliases.

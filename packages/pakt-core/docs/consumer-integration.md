# PAKT Consumer Integration Guide

How to integrate PAKT compression data into dashboards, MCP servers, and API proxies.

## Table of Contents

1. [Dashboard Tools (e.g., tokmeter)](#1-dashboard-tools)
2. [MCP Server Integrators](#2-mcp-server-integrators)
3. [API Proxy Builders](#3-api-proxy-builders)
4. [Prompt-Cache Integration](#4-prompt-cache-integration)

---

## 1. Dashboard Tools

### Reading Stats Files Directly

PAKT persists all compression stats as JSONL files in `~/.pakt/stats/`. Each MCP server session creates its own file, so concurrent agents never contend on writes.

**Directory layout:**

```
~/.pakt/stats/
  sess-claude-code-a1b2c3d4.jsonl   # Active session
  sess-cursor-e5f6a7b8.jsonl        # Another active session
  sess-windsurf-c9d0e1f2.jsonl      # Closed session (has footer)
  archive.jsonl                      # Compacted daily summaries
```

### JSONL Format Reference

Each `.jsonl` file contains three record types, discriminated by the `t` field:

**Session header** (first line, `t: "h"`):

```json
{"t":"h","agent":"claude-code","pid":12345,"startedAt":1712700000000,"project":"my-app"}
```

| Field       | Type   | Description                              |
|-------------|--------|------------------------------------------|
| `t`         | `"h"`  | Record type discriminator                |
| `agent`     | string | Agent name (e.g., `"claude-code"`)       |
| `pid`       | number | Process ID of the MCP server             |
| `startedAt` | number | Unix timestamp (ms) when session started |
| `project`   | string | Optional project identifier (cwd basename) |

**Call record** (body lines, `t: "r"`):

```json
{"t":"r","action":"compress","format":"json","inputTokens":1200,"outputTokens":480,"savedTokens":720,"savingsPercent":60,"reversible":true,"timestamp":1712700123456}
```

| Field            | Type    | Description                                     |
|------------------|---------|-------------------------------------------------|
| `t`              | `"r"`   | Record type discriminator                       |
| `action`         | string  | `"compress"`, `"decompress"`, or `"inspect"`    |
| `format`         | string  | Detected format: `json`, `yaml`, `csv`, `markdown`, `text`, `pakt` |
| `inputTokens`    | number  | Token count of the input                        |
| `outputTokens`   | number  | Token count of the output                       |
| `savedTokens`    | number  | `inputTokens - outputTokens`                    |
| `savingsPercent`  | number  | Savings as a percentage (0-100)                 |
| `reversible`     | boolean | Whether the operation was lossless              |
| `timestamp`      | number  | Unix timestamp (ms)                             |

**Session footer** (last line, `t: "f"` -- only present for closed sessions):

```json
{"t":"f","endedAt":1712703600000,"totalCalls":47}
```

| Field        | Type   | Description                       |
|--------------|--------|-----------------------------------|
| `t`          | `"f"`  | Record type discriminator         |
| `endedAt`    | number | Unix timestamp (ms) of shutdown   |
| `totalCalls` | number | Total calls in this session       |

**Archive daily summary** (in `archive.jsonl`, `t: "d"`):

```json
{"t":"d","date":"2026-04-09","format":"json","calls":34,"inputTokens":45000,"outputTokens":18000,"savedTokens":27000}
```

### Using `pakt stats --json`

The simplest way to get aggregated stats programmatically:

```bash
# All-time stats as JSON
pakt stats --json

# Filtered by time range
pakt stats --json --today
pakt stats --json --week

# Filtered by agent
pakt stats --json --agent claude-code
```

Output is a single JSON object on stdout:

```json
{
  "scope": "all time",
  "model": "gpt-4o",
  "sessionDuration": "0s",
  "totalCalls": 47,
  "callsByAction": { "compress": 42, "decompress": 3, "inspect": 2 },
  "totalInputTokens": 156000,
  "totalOutputTokens": 78000,
  "totalSavedTokens": 78000,
  "overallSavingsPercent": 50,
  "byFormat": {
    "json": { "calls": 34, "inputTokens": 120000, "outputTokens": 54000, "savedTokens": 66000, "avgSavingsPercent": 55 },
    "yaml": { "calls": 8, "inputTokens": 24000, "outputTokens": 18000, "savedTokens": 6000, "avgSavingsPercent": 25 }
  },
  "topFormat": { "format": "json", "calls": 34, "avgSavingsPercent": 55 },
  "estimatedCostSaved": { "input": 0.195, "output": 0.78, "currency": "USD" },
  "lastCallAt": "2026-04-10T14:30:00.000Z"
}
```

### Using `pakt stats --export`

Exports daily savings as CSV, suitable for spreadsheet import or charting:

```bash
pakt stats --export > savings.csv
pakt stats --export --week > weekly.csv
```

CSV columns: `date,calls,inputTokens,outputTokens,savedTokens,costSaved`

```csv
date,calls,inputTokens,outputTokens,savedTokens,costSaved
2026-04-08,12,34000,17000,17000,0.212500
2026-04-09,23,56000,25200,30800,0.385000
2026-04-10,8,22000,9900,12100,0.151250
```

### Example: Reading Savings in a Node.js Dashboard

```typescript
import { execSync } from 'node:child_process';

// Option A: Use the CLI (recommended for external tools)
function getPaktStats() {
  const output = execSync('pakt stats --json', { encoding: 'utf8' });
  return JSON.parse(output);
}

// Option B: Read JSONL files directly (for real-time dashboards)
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

interface CallRecord {
  t: 'r';
  action: string;
  format: string;
  inputTokens: number;
  outputTokens: number;
  savedTokens: number;
  savingsPercent: number;
  reversible: boolean;
  timestamp: number;
}

function readPaktRecords(): CallRecord[] {
  const statsDir = join(homedir(), '.pakt', 'stats');
  const files = readdirSync(statsDir).filter(f => f.endsWith('.jsonl'));
  const records: CallRecord[] = [];

  for (const file of files) {
    const content = readFileSync(join(statsDir, file), 'utf8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.t === 'r') records.push(parsed);
      } catch {
        // Skip malformed lines
      }
    }
  }

  return records;
}

// Option C: Use pakt-core as a library (same process)
import { readAllRecords } from '@sriinnu/pakt';

const records = readAllRecords({ since: Date.now() - 7 * 24 * 60 * 60 * 1000 });
const totalSaved = records.reduce((sum, r) => sum + r.savedTokens, 0);
console.log(`Saved ${totalSaved} tokens this week`);
```

---

## 2. MCP Server Integrators

### Calling PAKT Tools Programmatically

PAKT exposes MCP tools that can be called directly from Node.js without starting an MCP server.

#### Using `handlePaktTool()` Directly

```typescript
import { handlePaktTool } from '@sriinnu/pakt';

// Compress text
const compressResult = handlePaktTool('pakt_compress', {
  text: '{"users": [{"name": "Alice", "role": "admin"}, {"name": "Bob", "role": "dev"}]}',
  format: 'json',
});
console.log(compressResult.compressed);  // PAKT-compressed output
console.log(compressResult.savings);     // e.g. 45
console.log(compressResult.savedTokens); // e.g. 32

// Auto-detect and compress/decompress
const autoResult = handlePaktTool('pakt_auto', {
  text: someToolResultText,
});
// autoResult.action is 'compressed' or 'decompressed'
// autoResult.result is the processed text

// Get session savings summary
const savingsResult = handlePaktTool('pakt_savings', {
  model: 'claude-sonnet',
  scope: 'all',
});
console.log(savingsResult.summary);
// "You've saved 1.3M tokens ($19.50) across 47 calls at 50% average savings."

// Get detailed dashboard data
const dashResult = handlePaktTool('pakt_dashboard', {
  model: 'gpt-4o',
  scope: 'session',
});
console.log(dashResult.formatBreakdown);  // JSON string of per-format stats
console.log(dashResult.dedupEfficiency);  // JSON string of cache stats
```

#### Available Tool Names and Their Arguments

| Tool Name        | Key Args                    | Returns                                    |
|------------------|-----------------------------|--------------------------------------------|
| `pakt_compress`  | `text`, `format?`, `semanticBudget?` | `compressed`, `savings`, `savedTokens`, `reversible` |
| `pakt_auto`      | `text`, `semanticBudget?`   | `result`, `action`, `savings`, `detectedFormat` |
| `pakt_inspect`   | `text`, `model?`, `semanticBudget?` | `detectedFormat`, `recommendedAction`, `estimatedSavings` |
| `pakt_stats`     | `model?`, `scope?`          | `totalCalls`, `totalSavedTokens`, `byFormat`, `estimatedCostSaved` |
| `pakt_explain`   | `text`, `model?`            | `layerBreakdown`, `structuralAnalysis`, `recommendation` |
| `pakt_savings`   | `model?`, `scope?`          | `summary`, `totalSavedTokens`, `estimatedCostSaved` |
| `pakt_dashboard` | `model?`, `scope?`          | `summary`, `formatBreakdown`, `dedupEfficiency`, `rollingDictStats` |

### Embedding PAKT in a Custom MCP Server

Use `registerPaktTools()` to add all PAKT tools to your own MCP server:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerPaktTools } from '@sriinnu/pakt';

const server = new McpServer({
  name: 'my-custom-server',
  version: '1.0.0',
});

// Register all PAKT tools (pakt_compress, pakt_auto, pakt_inspect, etc.)
registerPaktTools(server);

// Optionally customize the pakt_auto description to control LLM behavior
registerPaktTools(server, {
  autoDescription: 'Compress structured data (JSON, YAML, CSV) to save tokens. Only use on tool results with >100 tokens.',
});

// Register your own tools alongside PAKT
server.registerTool('my_tool', { /* ... */ }, async (args) => { /* ... */ });

// Start the transport
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Setting Up Stats Persistence

If you want session stats persisted to `~/.pakt/stats/`, initialize a session ID:

```typescript
import {
  generateSessionId,
  initSession,
  finalizeSession,
  setSessionId,
  detectProject,
} from '@sriinnu/pakt';

// Generate a unique session ID and initialize the stats file
const sessionId = generateSessionId('my-agent');
setSessionId(sessionId);
initSession(sessionId, {
  agent: 'my-agent',
  pid: process.pid,
  startedAt: Date.now(),
  project: detectProject(),
});

// ... run your server ...

// On shutdown, finalize the session so it can be compacted later
process.on('SIGINT', () => {
  finalizeSession(sessionId, {
    endedAt: Date.now(),
    totalCalls: getTotalCalls(),
  });
  process.exit(0);
});
```

---

## 3. API Proxy Builders

### Using `compress()` and `decompress()` on Tool Results

The core compression functions work on raw text and return detailed results:

```typescript
import { compress, decompress, detect, countTokens } from '@sriinnu/pakt';

// Compress a tool result
const toolOutput = JSON.stringify(apiResponse);
const result = compress(toolOutput, { fromFormat: 'json' });

console.log(result.compressed);       // PAKT-format string
console.log(result.originalTokens);   // e.g. 1200
console.log(result.compressedTokens); // e.g. 480
console.log(result.savings.totalPercent); // e.g. 60
console.log(result.reversible);       // true for L1-L3

// Decompress when the LLM needs the original data
const restored = decompress(result.compressed, 'json');
console.log(restored.text);           // Original JSON
console.log(restored.wasLossy);       // false for L1-L3
```

### Checking if Compression is Worthwhile

Not all content benefits from compression. Short strings and prose text may actually expand. Use `estimateCompressibility()` for a lightweight pre-check, or `pakt_inspect` for a full estimate:

```typescript
import { estimateCompressibility, countTokens, handlePaktTool } from '@sriinnu/pakt';

function shouldCompress(text: string): boolean {
  // Quick heuristic check (no actual compression run)
  const estimate = estimateCompressibility(text);
  if (estimate.label === 'none' || estimate.label === 'low') {
    return false;
  }

  // Token count threshold -- below 50 tokens, PAKT overhead exceeds savings
  const tokens = countTokens(text);
  if (tokens < 50) {
    return false;
  }

  return true;
}

// Or use inspect for a more accurate assessment (runs the full pipeline)
const inspection = handlePaktTool('pakt_inspect', { text: toolOutput });
if (inspection.recommendedAction === 'compress' && inspection.estimatedSavings > 10) {
  // Worth compressing
}
```

### Pattern: Intercept `tool_result` Messages in an API Proxy

This is the primary integration pattern for API proxies that sit between an LLM client and the model API. Compress structured data in tool results before they enter the context window.

```typescript
import { compress, decompress, detect, countTokens } from '@sriinnu/pakt';

const MIN_TOKENS_FOR_COMPRESSION = 50;

interface Message {
  role: string;
  content: string | ContentBlock[];
}

interface ContentBlock {
  type: string;
  text?: string;
  tool_use_id?: string;
}

/**
 * Intercept tool_result messages and compress structured data.
 * Prose content passes through unchanged.
 */
function compressToolResults(messages: Message[]): Message[] {
  return messages.map(msg => {
    if (msg.role !== 'tool') return msg;

    // Handle string content
    if (typeof msg.content === 'string') {
      return { ...msg, content: maybeCompress(msg.content) };
    }

    // Handle content blocks
    if (Array.isArray(msg.content)) {
      return {
        ...msg,
        content: msg.content.map(block => {
          if (block.type === 'text' && block.text) {
            return { ...block, text: maybeCompress(block.text) };
          }
          return block;
        }),
      };
    }

    return msg;
  });
}

/**
 * Compress text if it's structured and above the token threshold.
 * Returns the original text unchanged if compression isn't beneficial.
 */
function maybeCompress(text: string): string {
  // Skip tiny inputs
  const tokens = countTokens(text);
  if (tokens < MIN_TOKENS_FOR_COMPRESSION) return text;

  // Detect format -- only compress structured data
  const detected = detect(text);
  if (detected.format === 'text' || detected.format === 'pakt') return text;

  // Attempt compression
  const result = compress(text, { fromFormat: detected.format });

  // Only use compressed version if it actually saves tokens
  if (result.compressedTokens >= result.originalTokens) return text;

  return result.compressed;
}
```

### Working with Mixed Content

For tool results that contain a mix of prose and structured data (e.g., a markdown file with embedded JSON code blocks), use the mixed-content pipeline:

```typescript
import { compressMixed, decompressMixed, extractBlocks } from '@sriinnu/pakt';

// Preview what blocks would be compressed
const blocks = extractBlocks(toolOutput);
for (const block of blocks) {
  console.log(`${block.type}: ${block.content.slice(0, 50)}...`);
}

// Compress mixed content -- prose passes through, structured blocks are compressed
const result = compressMixed(toolOutput);
console.log(result.compressed);
console.log(`Saved ${result.savings.totalPercent}% tokens`);

// Decompress back
const restored = decompressMixed(result.compressed);
console.log(restored.text);
```

### Model Pricing Reference

Cost estimates use these per-million-token rates:

| Model           | Input $/MTok | Output $/MTok |
|-----------------|-------------|---------------|
| `gpt-4o`        | $2.50       | $10.00        |
| `gpt-4o-mini`   | $0.15       | $0.60         |
| `claude-sonnet`  | $3.00       | $15.00        |
| `claude-opus`    | $15.00      | $75.00        |
| `claude-haiku`   | $0.80       | $4.00         |

To estimate cost savings:

```typescript
import { MODEL_PRICING } from '@sriinnu/pakt';

const model = 'claude-sonnet';
const pricing = MODEL_PRICING[model];
const savedTokens = 50000;

if (pricing) {
  const inputCostSaved = (savedTokens / 1_000_000) * pricing.inputPerMTok;
  const outputCostSaved = (savedTokens / 1_000_000) * pricing.outputPerMTok;
  console.log(`Input cost saved: $${inputCostSaved.toFixed(4)}`);
  console.log(`Output cost saved: $${outputCostSaved.toFixed(4)}`);
}
```

---

## 4. Prompt-Cache Integration

Provider prompt caches (Anthropic `cache_control`, OpenAI's automatic
prefix cache) bill cached reads at a fraction of base input cost — but only
when the cached region is **byte-identical** across calls. PAKT gives you
two levers to keep its output in the cacheable region.

### The `@cache prefix-end` directive

When you pass a cache `target` (or `cacheDirective: true`), `compress()`
emits a `@cache prefix-end` line right after the `@dict ... @end` block and
returns a `cacheBreakpoint` with the byte offset immediately after the
directive. The directive is a no-op header — `decompress()` strips it, so
round-trips are unaffected.

```ts
import { compress, decompress } from '@sriinnu/pakt';

const result = compress(bigJson, { target: 'anthropic' });
// result.compressed:
//   @from json
//   @dict
//     $a: platform_engineering_team
//     $b: security_engineering_team
//   @end
//   @cache prefix-end      <- place your cache_control breakpoint here
//   ...body...

const { byteOffset, recommendedTTLSeconds } = result.cacheBreakpoint!;
// Everything before byteOffset is the stable, cacheable prefix.

decompress(result.compressed); // directive is ignored — lossless
```

Across MCP turns, the `pakt_compress` and `pakt_auto` tools share a
per-session rolling dictionary: aliases discovered in earlier calls stay
pinned to the same `$a, $b, ...` slots and new ones append after, so the
prefix above stays byte-stable turn-over-turn. Opt out per call with
`statelessDict: true` on `pakt_compress`.

### Dictionary-as-system-prompt (`dictPlacement: 'system'`)

For multi-turn agents the dictionary belongs where caching is most
effective and survives across user turns: the **system prompt**. With
`dictPlacement: 'system'`, the body omits the `@dict` block entirely and
the dictionary comes back as a separate `dictBlock` string:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { compress, decompress } from '@sriinnu/pakt';

const { compressed: body, dictBlock } = compress(bigJson, {
  dictPlacement: 'system',
  target: 'anthropic', // moves the @cache directive into dictBlock
});

const client = new Anthropic();
const response = await client.messages.create({
  model: 'claude-sonnet-4-5',
  max_tokens: 1024,
  system: [
    { type: 'text', text: SYSTEM_PROMPT },
    {
      type: 'text',
      text: `PAKT dictionary (aliases used in payloads):\n${dictBlock ?? ''}`,
      cache_control: { type: 'ephemeral' }, // dict cached across turns
    },
  ],
  // Per-turn bodies are small and reference $a/$b aliases only.
  messages: [{ role: 'user', content: body }],
});

// Round-trip locally whenever you need the original data back:
const original = decompress(body, { dict: dictBlock });
```

Notes:

- With `dictPlacement: 'system'`, no `cacheBreakpoint` is returned for the
  body — the entire `dictBlock` is the cacheable unit (it carries the
  `@cache prefix-end` directive when a target was set).
- `decompress(body, { dict })` merges the external dictionary before alias
  expansion. On alias conflicts, **inline entries win** — a body's own
  `@dict` definitions are authoritative; conflicts only arise if you pass
  a stale external dict against an inline-compressed body.
- Token accounting: `compressedTokens` still counts dict + body together,
  since the dictionary reaches the model once (amortized by the cache).
- CLI equivalents:

```bash
pakt compress data.json --dict-placement system --dict-out dict.pakt > body.pakt
pakt decompress body.pakt --dict dict.pakt --to json
```

- MCP equivalents: `pakt_compress` accepts `dictPlacement`, `cacheTarget`,
  and `statelessDict`; the tool result carries `dictBlock` and
  `cacheByteOffset`.

---

## CLI Quick Reference

```bash
# Human-readable report with time breakdowns
pakt report
pakt report --model claude-sonnet

# Machine-readable stats output
pakt stats --json
pakt stats --json --today --model claude-opus
pakt stats --json --agent my-agent

# CSV export for spreadsheets/charting
pakt stats --export
pakt stats --export --week > weekly-savings.csv
```

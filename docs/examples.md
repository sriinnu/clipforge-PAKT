# PAKT Usage Examples

Practical examples for CLI, Node.js library, MCP integration, and API proxy patterns.

---

## CLI

### Compress JSON

```bash
# From file
pakt compress data.json

# From stdin
cat data.json | pakt compress --from json

# With specific layers
pakt compress data.json --layers 1,2,5
```

### Decompress PAKT back to JSON

```bash
pakt decompress compressed.pakt --to json
```

### Auto-detect direction

```bash
# Feeds JSON → gets PAKT
echo '{"name":"Alice","role":"dev"}' | pakt auto

# Feeds PAKT → gets JSON
echo '@from json
name: Alice
role: dev' | pakt auto
```

### Check savings

```bash
# Human-readable report
pakt report

# Machine-readable JSON (pipe to jq, dashboards, tokmeter)
pakt stats --json | jq '.totalSavedTokens'

# CSV export for spreadsheets
pakt stats --export > savings.csv

# Filter by time
pakt stats --today
pakt stats --week
```

### Inspect before compressing

```bash
pakt inspect data.json --model claude-sonnet
# Shows: format detection, token count, estimated savings, recommendation
```

---

## Node.js Library

### Basic compress/decompress

```typescript
import { compress, decompress } from '@sriinnu/pakt';

// Compress JSON
const result = compress('{"users":[{"name":"Alice","role":"dev"}]}');
console.log(result.compressed);
// @from json
// users [1]{name|role}:
//   Alice|dev

console.log(result.savings.totalPercent); // e.g., 35
console.log(result.savings.byLayer);      // { structural: 12, dictionary: 5, ... }

// Decompress back
const original = decompress(result.compressed);
console.log(original.text); // formatted JSON
console.log(original.data); // parsed JS object
```

### Context Engine (full conversation optimizer)

```typescript
import { createContextEngine } from '@sriinnu/pakt';

const engine = createContextEngine({
  maxContextTokens: 50_000,
  recentTurns: 5,
  strategy: 'progressive',
});

// Feed messages as conversation happens
engine.addMessage({ role: 'user', content: 'fix the auth bug' });
engine.addToolResult('read_file', largeJsonContent); // auto-compressed
engine.addMessage({ role: 'assistant', content: 'I see the issue...' });

// Get optimized context for API call
const { messages, savings } = engine.optimize();
console.log(`Saved ${savings.savedPercent}% (${savings.savedTokens} tokens)`);
console.log(`Breakdown:`, savings.breakdown);
// { toolResults: 180, historyCompression: 50, summarization: 0, deduplication: 30 }

// messages array is ready for the LLM API
```

### MCP Middleware Interceptor

```typescript
import { createPaktInterceptor } from '@sriinnu/pakt';

const interceptor = createPaktInterceptor({
  minTokens: 100,        // skip results under 100 tokens
  maxInputSize: 512_000, // skip results over 512KB
  formats: ['json', 'yaml', 'csv'],
  passthrough: ['pakt_*'], // don't compress PAKT's own results
});

// Auto-compress any tool result
const result = interceptor.processToolResult('read_file', bigJsonString);
if (result.compressed) {
  console.log(`Saved ${result.savings.savedTokens} tokens`);
}
// result.text is compressed if beneficial, original otherwise
```

### API Proxy Pattern (Anthropic SDK)

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { optimizeMessages } from '@sriinnu/pakt';

const anthropic = new Anthropic();

// Your conversation messages
const messages = [
  { role: 'user', content: 'analyze this data' },
  { role: 'assistant', content: '...', tool_use: { name: 'query_db', ... } },
  { role: 'tool', content: hugeJsonResult, tool_use_id: '...' },
  { role: 'user', content: 'now summarize it' },
];

// Compress tool results in-place before sending to API
const { messages: optimized, savings } = optimizeMessages(messages);
console.log(`Saved ${savings.totalSavedTokens} tokens on this call`);

const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  messages: optimized,
  max_tokens: 1024,
});
```

---

## MCP Server Integration

### Add PAKT to a custom MCP server

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerPaktTools } from '@sriinnu/pakt';

const server = new McpServer({
  name: 'my-agent',
  version: '1.0.0',
});

// Register all 7 PAKT tools
registerPaktTools(server);

// Connect via stdio
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Use PAKT tools programmatically

```typescript
import { handlePaktTool } from '@sriinnu/pakt';

// Compress
const compressed = handlePaktTool('pakt_compress', {
  text: '{"users": [{"name": "Alice"}]}',
  format: 'json',
});

// Explain why it compressed well
const explained = handlePaktTool('pakt_explain', {
  text: largeJsonPayload,
});
console.log(JSON.parse(explained.recommendation));

// Check savings
const savings = handlePaktTool('pakt_savings', { scope: 'all' });
console.log(savings.summary);
// "You've saved 1.3M tokens ($19.50) across 47 calls"
```

---

## Dashboard / Tokmeter Integration

### Read stats from CLI

```bash
# Get stats as JSON for any dashboard
pakt stats --json | your-dashboard-tool

# Export daily CSV
pakt stats --export >> ~/.tokmeter/pakt-savings.csv
```

### Read stats from Node.js

```typescript
import {
  readAllRecords,
  readProjectStats,
  readLifetimeStats,
} from '@sriinnu/pakt';

// All records across all sessions
const records = readAllRecords();

// Per-project breakdown
const projectStats = readProjectStats('clipforge-PAKT', 'claude-sonnet');
console.log(`${projectStats.project}: ${projectStats.totalSavedTokens} saved`);

// Lifetime across all projects
const lifetime = readLifetimeStats('claude-opus');
for (const p of lifetime.projects) {
  console.log(`${p.project}: $${p.costSaved?.input.toFixed(2)} saved`);
}
```

### Read raw JSONL files

Stats are stored as JSONL in `~/.pakt/stats/`. Each session is a separate file:

```
~/.pakt/stats/sess-agent-a1b2c3d4.jsonl
```

Line format:
```jsonl
{"t":"h","agent":"claude","pid":1234,"startedAt":1710000000000,"project":"my-app"}
{"t":"r","action":"compress","format":"json","inputTokens":500,"outputTokens":250,"savedTokens":250,"savingsPercent":50,"reversible":true,"timestamp":1710000001000}
{"t":"f","endedAt":1710000060000,"totalCalls":5}
```

---

## When PAKT Helps vs When It Doesn't

| Data Shape | Expected Savings | Example |
|-----------|-----------------|---------|
| JSON array of uniform objects (10+ rows) | **40-58%** | API responses, DB query results, test output |
| YAML configs (K8s, CI/CD) | **30-83%** | deployment.yaml, .github/workflows |
| Repetitive logs | **38-57%** | Structured log lines with timestamps |
| Small JSON configs (<200 tokens) | **Skip** (overhead exceeds savings) | package.json, tsconfig.json |
| Plain English prose | **0%** | Chat messages, docs, requirements |
| Code files | **0%** | Source code isn't structured data |
| CSV (already compact) | **-8% to +10%** | Depends on repetition |

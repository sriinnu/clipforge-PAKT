<p align="center">
  <img src="assets/pakt-logo.svg?v=2" alt="PAKT" height="60" />
</p>

<h3 align="center">ClipForge PAKT</h3>

<p align="center">
  The only prompt compressor that's <b>lossless</b>, <b>model-free</b>, and <b>built for structured data</b>.<br/>
  No inference cost, no hallucinations, no byte-level tricks an LLM can't see -- just fewer tokens for the same payload.<br/>
  <b>27-69% savings</b> on tabular / log / repetitive data. Provider caching makes repeated context cheap; PAKT makes the rest cheap.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@sriinnu/pakt"><img src="https://img.shields.io/npm/v/@sriinnu/pakt?color=6366f1&label=npm" alt="npm version" /></a>
  <a href="https://github.com/sriinnu/clipforge-PAKT/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b5cf6" alt="license" /></a>
  <img src="https://img.shields.io/badge/TypeScript-6-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <a href="https://github.com/sriinnu/clipforge-PAKT/actions"><img src="https://img.shields.io/github/actions/workflow/status/sriinnu/clipforge-PAKT/ci.yml?label=CI&color=22c55e" alt="CI" /></a>
  <a href="https://github.com/sriinnu/clipforge-PAKT/stargazers"><img src="https://img.shields.io/github/stars/sriinnu/clipforge-PAKT?color=f59e0b&style=flat" alt="GitHub stars" /></a>
  <a href="https://github.com/sriinnu/clipforge-PAKT/pulls"><img src="https://img.shields.io/badge/PRs-welcome-a855f7" alt="PRs welcome" /></a>
  <!-- SPONSOR-BADGES-START -->
  <!-- Sponsor / Buy Me a Coffee badges auto-reinsert here once stargazer count crosses
       SPONSOR_BADGE_MIN_STARS (see .github/workflows/sponsor-badge-watch.yml).
       Repo-level funding is still surfaced by GitHub's sidebar via .github/FUNDING.yml. -->
  <!-- SPONSOR-BADGES-END -->
</p>

<p align="center">
  <img src="https://img.shields.io/badge/repo%20Node.js-%3E%3D22-339933?logo=node.js&logoColor=white" alt="Repo Node.js" />
  <img src="https://img.shields.io/badge/Tauri-v2-24c8d8?logo=tauri&logoColor=white" alt="Tauri" />
  <img src="https://img.shields.io/badge/macOS-validated-111827?logo=apple&logoColor=white" alt="macOS validated" />
  <img src="https://img.shields.io/badge/Windows-tray%20target-2563eb?logo=windows&logoColor=white" alt="Windows tray target" />
  <img src="https://img.shields.io/badge/Linux-tray%20target-6d28d9?logo=linux&logoColor=white" alt="Linux tray target" />
</p>

---

## What is PAKT?

**PAKT** (Pipe-Aligned Kompact Text) is a lossless-first compression format that converts JSON, YAML, CSV, and mixed markdown content into a compact pipe-delimited syntax optimized for LLM token efficiency. Structured payloads often see **27-33% token savings** on JSON records, with higher gains on tabular and repetitive data (logs 57%, repetitive text 38-69%). Small, deeply-nested config objects can expand — run `pakt_inspect` or `pakt auto` first to confirm a payload is worth compressing before committing. Core lossless layers are `L1-L3`; `L4` is separately opt-in, budgeted, and lossy.

LLMs charge by the token. Structured data wastes tokens on syntax: braces, quotes, repeated keys, whitespace. PAKT eliminates the waste.

### Why not X?

- **LLMLingua / LLMLingua-2?** Neural compressors. They run a model to rewrite your prompt, which is lossy, model-dependent, and adds inference cost and latency. PAKT is deterministic, model-free, and free to run.
- **TOON format?** TOON is the core inspiration for PAKT's Layer 1 pipe-delimited syntax. PAKT extends it with a dictionary layer (L2), tokenizer-aware packing (L3), delta encoding for tabular arrays, multi-format input (JSON/YAML/CSV/Markdown/Text), and an MCP server for agents.
- **gzip / brotli?** They compress bytes, but the LLM API bills you on tokens after BPE tokenization. A gzipped prompt still costs full tokens once decoded. PAKT reshapes the text so the tokenizer itself produces fewer tokens.
- **Just minify JSON?** Free and worth doing -- but it only removes whitespace. PAKT minifies, then layers dictionary substitution and tokenizer-aware choices on top, typically doubling the savings.

### About ClipForge

ClipForge is the product suite built around PAKT. In this repository, that means:

- **[@sriinnu/pakt](./packages/pakt-core/)** -- The core library, CLI, and MCP server. This is the stable release surface for Node.js and TypeScript projects, plus agent hosts that need stdio tools for compress, auto, and inspect.
- **[ClipForge Playground](./apps/playground/)** -- A lightweight local web UI for trying JSON, YAML, CSV, and mixed markdown compression before wiring PAKT into a real workflow. It is a browser lab, not a release integration. Hosted playground: [pakt-4f9.pages.dev](https://pakt-4f9.pages.dev/).
- **[ClipForge Desktop](./apps/desktop/)** -- A Tauri desktop shell that is now primarily an **Agent Telemetry HQ**: the default tab is a live dashboard reading `~/.pakt/stats` JSONL files (today/7-day token savings, per-agent source table, latency percentiles, lossy share, sparklines). Clipboard compression is the second tab. History is backed by real SQLite via `tauri-plugin-sql` with automatic migration from legacy localStorage. macOS is the validated release path; Windows and Linux tray targets exist in source.
- **[ClipForge Browser Extension](./apps/extension/)** *(experimental, not yet published)* -- A Chrome extension with a popup, a dedicated full-tab Options page, context-menu actions, and input helpers for supported web LLM UIs: ChatGPT, Claude, Gemini, Slack web, and Gmail. Includes opt-in auto-compress-on-paste with a per-host site-allowlist editor. Store listing, privacy policy, and submission checklist are complete but the extension has not yet been submitted or smoke-tested on live sites.

The goal is simple: every token you send to an LLM should carry meaning, not syntax.

For agent workflows, the MCP server is the integration bridge. `pakt serve --stdio` exposes `pakt_compress`, `pakt_auto`, and `pakt_inspect` through the standard MCP transport, so stdio-based MCP clients can call the same toolset without custom protocol glue. The generic stdio path is verified in-repo; named hosts like Claude Desktop and Cursor are integration targets rather than a certification matrix. `pakt_inspect` is the recommended first call when deciding whether compression is worth it.

The app surfaces now align on shared layer profiles: `Structure only (L1)`, `Standard (L1+L2)`, `Tokenizer-aware (L1+L2+L3)`, and opt-in `Semantic (L1+L2+L3+L4)`. Semantic mode requires a positive `semanticBudget` and is explicitly lossy.

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

---

## Monorepo Structure

This is a [pnpm workspace](https://pnpm.io/workspaces) monorepo.

```
clipforge-PAKT/
  packages/
    pakt-core/          Core compression engine, CLI, and MCP server
    pakt-python/        Python client wrapper (pakt-client on PyPI)
  apps/
    playground/         Local web playground for trying PAKT inputs
    desktop/            ClipForge tray app (Tauri v2 + React)
    extension/          Experimental Chrome extension for supported LLM UIs
  docs/                 Format spec and guides
  assets/
    pakt-logo.svg       Logo wordmark (vector, no font deps)
    pakt-icon.svg       Chevron-pipe icon mark
  scripts/
    eval/               Comprehension eval harness (key-gated; --mock verified)
```

### Packages

| Package | npm | Description |
|---------|-----|-------------|
| [`@sriinnu/pakt`](./packages/pakt-core/) | [![npm](https://img.shields.io/npm/v/@sriinnu/pakt?color=6366f1&label=)](https://www.npmjs.com/package/@sriinnu/pakt) | PAKT compression engine -- the core library with API and CLI |
| [`pakt-client`](./packages/pakt-python/) | *(pending PyPI publish)* | Thin Python wrapper over PAKT CLI + MCP stdio. Zero deps, Python ≥ 3.10, Node ≥ 22 at runtime. |

---

## Quick Start

```bash
npm install @sriinnu/pakt
```

`@sriinnu/pakt` supports **Node 18+**. Monorepo development for this repository uses **Node 22+**.

```ts
import { compress, decompress, detect } from '@sriinnu/pakt';

// Compress JSON to PAKT
const result = compress('{"users": [{"name": "Alice", "role": "dev"}, {"name": "Bob", "role": "dev"}]}');
console.log(result.compressed);
console.log(`Saved ${result.savings.totalPercent}% tokens`);

// Decompress back to JSON
const original = decompress(result.compressed, 'json');
console.log(original.text);

// Detect input format
const detected = detect('name,role\nAlice,dev');
console.log(detected.format); // 'csv'
```

### Compressibility Scoring (0.6+)

```ts
import { estimateCompressibility } from '@sriinnu/pakt';

const score = estimateCompressibility(myJson);
console.log(score.score);    // 0.72
console.log(score.label);    // 'high'
console.log(score.profile);  // 'tokenizer' — recommended layer profile
console.log(score.breakdown); // { repetitionDensity, structuralOverhead, schemaUniformity, valueLengthScore }
```

### Delta Encoding (0.6+)

Delta encoding activates automatically on tabular arrays with 30%+ repeated adjacent values. No code change needed — `compress()` applies it as a post-pass on L1.

```
@from json
@compress delta
users [5]{name|role|dept|city}:
  Alice|engineer|platform|NYC
  Bob|~|~|~
  Charlie|~|~|SF
  Diana|designer|product|~
  Eve|~|~|~
```

The `~` sentinel replaces unchanged fields. Fully reversible via `decompress()`.

See the **[pakt-core README](./packages/pakt-core/README.md)** for comprehensive API documentation, CLI usage, format specification, and examples.

Core CLI example for opt-in lossy packing:

```bash
npx @sriinnu/pakt compress data.json --semantic-budget 120
```

Release-facing benchmark numbers live in **[docs/BENCHMARK-SNAPSHOT.md](./docs/BENCHMARK-SNAPSHOT.md)**.

For LLM round-trips, the core package now also exposes `interpretModelOutput()` so your app can auto-detect PAKT in a model response, repair minor syntax issues, and decompress valid replies back to JSON/YAML/CSV.

Try the hosted playground: **[pakt-4f9.pages.dev](https://pakt-4f9.pages.dev/)**.

### Root Workspace Commands

From the repo root, you can install, build, and boot each surface directly:

```bash
pnpm install
pnpm build
pnpm build:all
pnpm build:core
pnpm build:playground
pnpm build:extension
pnpm build:desktop:web
pnpm build:desktop
pnpm build:apps
pnpm test:core
pnpm test:playground
pnpm dev:playground
pnpm dev:extension
pnpm dev:desktop:web
pnpm dev:desktop
pnpm start:mcp
```

Local surface entrypoints:

```bash
pnpm dev:playground   # local playground
pnpm dev:extension    # extension dev build
pnpm dev:desktop:web  # desktop frontend only
pnpm dev:desktop      # real Tauri desktop shell
pnpm start:mcp        # core MCP server over stdio
```

Playground notes for release testing:

- Mixed-content restores embedded structured blocks semantically; exact original formatting may normalize.
- CSV is not always a win; some already-compact CSV can expand.
- Compare mode now includes an auto-pack lab; table-aware variants unlock for top-level CSV and top-level JSON arrays.
- The playground runs locally in the browser session and does not upload payloads.
- For mixed-content decompress, paste the PAKT-marked output back into the input area, then run `Decompress`.

CLI/MCP note:

- `semanticBudget` now cleanly opts into lossy `L4`; if you stay on `L1-L3`, the pipeline remains lossless.
- `pakt serve --stdio` now uses the official MCP SDK stdio transport, and embedders can register the same tools programmatically via `registerPaktTools()`.

### Cache Synergy Pack (0.11)

`RollingDictionary` is now wired into `handleCompress` (the MCP `pakt_compress` tool), so cross-turn alias reuse is on by default for explicit compress calls. Opt out by passing `statelessDict: true`. After the `@dict ... @end` block, PAKT emits a `@cache prefix-end` directive when a `cacheTarget` or `cacheDirective: true` is set; `cache-breakpoint.ts`'s `findCacheDirectiveOffset` returns the exact byte offset for placing a provider `cache_control` / `cachePoint` marker. Byte stability across turns is verified by `tests/cache-stability.test.ts`.

### Dictionary Placement (0.11)

`compress()` now accepts `dictPlacement: 'inline' | 'system'`. When `'system'`, the result carries `result.dictBlock` — the `@dict ... @end` block separated out for placement in the system prompt where provider caching is most effective. `decompress(body, { dict })` merges an externally-supplied dict block back in (inline wins on conflict). CLI: `--dict-placement system --dict-out <file>` on compress; `--dict <file>` on decompress. MCP: `dictPlacement` parameter.

### Provider Cache Adapters (0.11)

New pure functions exported from `src/middleware/provider-adapter.ts`:

- `buildAnthropicCacheHints(result, opts)` — produces `cache_control` message fragments for Anthropic's API (4-breakpoint budget, min-prefix gating at 2 048 / 4 096 tokens, TTL break-even math).
- `buildOpenAICacheHints(result)` — produces `prompt_cache_key` from a SHA-256 of the stable prefix.

Both are model-free, pure functions — no SDK coupling.

### Proxy Tool-Catalog Modes (0.11)

`pakt proxy --wrap "<server-cmd>" --tools slim` applies lossless-in-spirit one-way schema slimming + description caps to every upstream tool before the LLM sees it (measured byte savings logged). `pakt proxy --wrap "<server-cmd>" --tools search` exposes a 3-tool facade: `search_tools` / `get_tool_schema` answered locally; `call_tool` forwards the call but returns a structured error if the upstream tool schema was not fetched first — it is not yet a full transparent rewrite path.

### Compaction-Cooperative Context Engine (0.11)

Provider compaction blocks (e.g. `compact-2026-01-12` format) are now detected at ingestion and treated as opaque/immutable: they are skipped across dedup, aging, summarization, and fact-extraction passes. New config options: `providerCompactionThresholdTokens` and `headroomTokens` in the `savings` output. `engine.ts` was refactored from 592 → 384 LOC into focused submodules (`opaque-blocks.ts`, `tool-aging.ts`, `fact-extraction.ts`, `history-strategies.ts`).

### `pakt stats --json` (0.11)

The `--json` flag on `pakt stats` is now fully implemented. It emits a single JSON object with `schemaVersion: 1` to stdout (no ANSI, no decorative text) in both single-file and aggregate modes. The shape matches what `consumer-integration.md` §4 documents. Previously the flag was advertised but silently ignored.

### L3.5 Meta-token Layer (0.11, opt-in, experimental)

`src/layers/L3-5-metatoken.ts` adds a new opt-in layer that discovers recurring BPE token spans crossing word boundaries (the gap L2 substring mining misses), aliases them into the shared `@dict` block, and verifies per-span that token count strictly decreases before writing any rewrite. Decompression is handled by the existing `decompressL2` path — no new decompressor code. **Off in all built-in profiles by default.** Measured on bundled test fixtures (gpt-4o / o200k_base): ~3-4% additional savings on repetitive JSON/log payloads; 0% on non-repetitive data (safety gate fires). These are fixture-level measurements — actual savings are content-dependent.

### Python Client — `pakt-client` (0.11)

New package at `packages/pakt-python` — a thin Python wrapper over the PAKT CLI and MCP stdio server, intended for PyPI as `pakt-client` (not yet published). Zero runtime dependencies beyond the stdlib; Python ≥ 3.10; requires Node ≥ 22 at runtime (calls the PAKT CLI / MCP server as a subprocess). This is a wrapper, not a port — compression logic lives in the Node core. 25 tests across CLI-arg, discovery, parsing, and integration suites.

### Comprehension Eval Harness (0.11)

`scripts/eval/` measures whether models read PAKT-compressed payloads as accurately as raw JSON — because lossless on bytes does not guarantee lossless in the model's head. It uses **matched-pair scoring**: every question is asked of both formats and classified both-right / both-wrong / JSON-only / PAKT-only; both-wrong pairs are excluded as task-difficulty noise, and a two-sided exact sign test over the discordant pairs gates the verdict (only `p < 0.05` claims a format effect).

**Result** — comprehension suite, 36 questions × 4 runs = 144 paired observations, via the Claude Code CLI:

| | JSON | PAKT |
|---|------|------|
| Pooled accuracy | 73.6% | 70.8% |

The formats agreed on 124/144 questions; of the 20 where they diverged, PAKT was correct on 8 and JSON on 12 — a two-sided sign test gives **p = 0.50**, indistinguishable from chance. **PAKT is comprehension-neutral versus minified JSON: no statistically significant penalty.** Accuracy is measured *through the Claude Code agent harness* (the realistic setting for PAKT) without a thinking budget, which is why absolute numbers sit near ~72% — the ~21% both-wrong rate reflects task hardness and affects both formats equally.

Reproduce with `node scripts/eval/run.mjs --provider cli --cli claude` (uses your Claude Code / Codex subscription — no API key) or `--provider anthropic` with `ANTHROPIC_API_KEY` for a raw-model run. A separate 50-row `stress` suite exists but conflates format-reading with retrieval/arithmetic over large tables; see `scripts/eval/README.md` for why it answers a different question.

### New Brand Assets (0.11)

Chevron-pipe icon mark (`assets/pakt-icon.svg`), rewritten vector wordmark (`assets/pakt-logo.svg`, no font deps), full Tauri icon set, extension PNGs, playground favicon.

### Research Docs (0.11)

- `docs/research/2026-06-future-features.md` — ranked feature research
- `docs/research/2026-06-polyglot-port-options.md` — port evaluation; recommendation is protocol surfaces now, Rust core + bindings when demand proves

---

### Session Stats (0.6.2)

Track token savings across sessions with persistent, multi-agent support.

**MCP tool:** `pakt_stats` returns compression metrics. Use `scope: 'session'` for the current process (fast, default) or `scope: 'all'` to aggregate across all agents from disk.

**CLI:** `pakt stats` has two modes:

```bash
pakt stats data.json             # single-shot stats for one file
pakt stats                       # aggregate from persistent storage
pakt stats --today               # filter to today
pakt stats --week                # filter to last 7 days
pakt stats --agent research      # filter by agent name
pakt stats --active              # only running agents
pakt stats --compact             # archive old sessions
pakt stats --reset               # clear all stats
```

**Named agents:** `pakt serve --stdio --agent-name research` names the session for filtering.

Stats are persisted as per-agent JSONL files in `~/.pakt/stats/`. Each MCP server writes to its own file -- zero contention across 10+ concurrent agents. Old sessions are lazily compacted into daily summaries.

### Auto Context Compression (0.7)

PAKT automatically compresses data on every MCP tool call to reduce conversation context size. Compressed data stays in context and saves tokens on every subsequent turn.

- **Content-addressed dedup** -- SHA-256 hash cache (10MB byte-budget LRU) avoids re-compressing identical data
- **Text compression** -- line dedup + word n-gram dictionary. 57% savings on logs, 38% on repetitive text, 69% on identical lines
- **Whitespace normalization** -- trailing spaces, blank line runs stored as metadata for lossless restoration
- **Configurable tool description** -- `registerPaktTools(server, { autoDescription: '...' })` controls how aggressively the LLM uses auto-compression
- **Safe detection** -- `@from John` and `@warning chemicals` correctly detected as text, not PAKT. No false positives on `@username`, `@Override`, email headers
- **Input size caps** -- 512KB for auto, 1MB for explicit compress, 100KB for text compression. Prevents CPU DoS

| Input Type | Savings | Round-trip |
|---|---|---|
| JSON 10 records | 27% | Lossless |
| JSON 50 records | 33% | Lossless |
| Log lines (duplicates) | 57% | Lossless |
| Repetitive text | 38-69% | Lossless |
| Normal prose (no repetition) | 0% (passthrough) | Safe |

---

### Prompt Cache Integration (0.10)

LLM providers reward byte-identical prefixes. AWS Bedrock added 1-hour prompt-cache TTL via the `cachePoint` API (Jan 2026); Anthropic's direct API supports `cache_control` with default 5-minute TTL and a `ttl: "1h"` opt-in (Mar 2026). PAKT 0.10 makes the `@dict` block prefix-stable across turns and emits a cache breakpoint hint so consumers can place each provider's cache marker in the right spot.

```ts
import { compress } from '@sriinnu/pakt';

const result = compress(payload, { target: 'bedrock' });
// result.cacheBreakpoint = {
//   byteOffset: 142,                  // place cache_control here
//   recommendedTTLSeconds: 3600,      // bedrock supports 1h
//   target: 'bedrock'
// }
```

| Target       | TTL hint | Notes |
|--------------|----------|-------|
| `bedrock`    | 3600s    | AWS Bedrock `cachePoint` 1-hour TTL (Jan 2026) |
| `anthropic`  | 300s     | `cache_control` default; pass `ttl: "1h"` to override |
| `openai`     | 0s       | Auto-managed prefix cache, no TTL knob |
| `google`     | 0s       | Auto context cache, ≥32k tokens |

The byte offset lands right where the `@dict ... @end` block ends so the entire prefix (headers + dictionary) sits in the cacheable region. **Prefix byte-stability across turns requires the rolling dictionary**, which is engaged automatically via `pakt_auto` (MCP) — bare `compress()` calls regenerate the alias map per call. Use `pakt_auto` (or wire `seedAliases` yourself) when you need cross-turn cache hits.

### Context Engine (0.10)

Unified context-window optimizer for agent loops. Compresses tool results, deduplicates repeated content across turns, extracts key facts from old turns, and ages older tool outputs back to a configurable tail.

```ts
import { createContextEngine } from '@sriinnu/pakt';

const engine = createContextEngine({
  maxContextTokens: 50_000,
  recentTurns: 5,
  toolResultTailLines: 30,    // last 30 lines kept on aged tool outputs
});

engine.addMessage({ role: 'user', content: 'fix the auth bug' });
engine.addToolResult('read_file', bigJson);

const { messages, savings } = engine.optimize();
console.log(savings.breakdown);
// { toolResults, historyCompression, summarization, deduplication, toolResultAging }
```

**Tool-result aging** (Gemini-CLI pattern): when running tokens exceed `maxContextTokens`, the engine walks back-to-front, snaps the cutoff to the nearest user-message boundary (never splits a tool call mid-turn), and tail-truncates older tool outputs. Char-fallback handles long single-line payloads (minified JSON, base64 dumps).

---

## Key Features

- **Lossless by default** -- L1 (Structural), L2 (Dictionary), and L3 (Tokenizer-Aware) round-trip exactly. L4 (Semantic) is opt-in and explicitly lossy, gated by a `semanticBudget`.
- **Multi-format** -- JSON, YAML, CSV, Markdown, and Plain Text with auto-detection, so the same pipeline handles structured, tabular, and mixed content.
- **Tokenizer-aware via real BPE** -- Uses `gpt-tokenizer` to measure and pick tokens LLMs actually merge, not byte-level heuristics that vanish at the API boundary.
- **MCP + CLI + library, zero model dependency** -- `pakt serve --stdio` exposes seven tools to agents: `pakt_compress`, `pakt_auto`, `pakt_inspect`, `pakt_stats`, `pakt_explain`, `pakt_savings`, `pakt_dashboard`. Same logic ships as a CLI and a typed TypeScript library.
- **Prompt-cache aware (0.10)** -- `target: 'bedrock' | 'anthropic' | 'openai' | 'google'` returns a `cacheBreakpoint` hint with byte offset and recommended TTL. Combined with prefix-stable `@dict` (deterministic alias slots across turns), enables 90% input-token cost reduction on multi-turn agent loops via provider prompt caching.
- **Latency + lossy observability (0.10)** -- `pakt_stats` and `pakt_dashboard` now surface P50/P95/P99 latency percentiles and lossy-call accounting (count + tokens) so you can see whether traffic is bleeding latency or running through L4/PII redaction.
- **Cache synergy (0.11)** -- Rolling dictionary wired into `pakt_compress` for cross-turn alias reuse; `@cache prefix-end` directive emitted after `@dict` so consumers know exactly where to place provider cache markers; byte-stability verified by test suite.
- **Dictionary-as-system-prompt (0.11)** -- `dictPlacement: 'system'` separates the `@dict` block onto `result.dictBlock` for pinning to the system prompt (where provider caching is most effective). `decompress(body, { dict })` accepts an external dict. CLI: `--dict-placement system`.
- **Provider cache adapters (0.11)** -- `buildAnthropicCacheHints` and `buildOpenAICacheHints` are pure, model-free functions that produce the correct SDK fragment shapes for Anthropic `cache_control` (4-breakpoint budget, min-prefix gating) and OpenAI `prompt_cache_key` (stable-prefix SHA-256).
- **Proxy tool-catalog modes (0.11)** -- `pakt proxy --wrap "<server-cmd>" --tools slim` applies lossless-in-spirit schema compression to upstream tool definitions; `--tools search` exposes a 3-tool facade (search/schema answered locally; call forwarded with a documented limitation: not yet a full transparent rewrite path).
- **Compaction-safe context engine (0.11)** -- Provider compaction blocks treated as opaque/immutable across all context-engine passes. New `providerCompactionThresholdTokens` config; `headroomTokens` surfaced in savings output.
- **`pakt stats --json` (0.11)** -- `--json` flag fully implemented, emits `schemaVersion: 1` JSON to stdout in both single-file and aggregate modes.
- **Opt-in L3.5 meta-token layer (0.11, experimental)** -- Cross-word-boundary BPE span aliasing; off in all profiles by default; only writes rewrites that strictly reduce token count; ~3-4% additional savings on repetitive fixture data.
- **Python client — `pakt-client` (0.11)** -- Thin Python wrapper over PAKT CLI + MCP stdio (`packages/pakt-python`), zero stdlib-only deps, Python ≥ 3.10, Node ≥ 22 at runtime.
- **27-69% savings, content-dependent** -- 27-33% on JSON records, 57% on duplicate log lines, 38-69% on repetitive text. Small deeply-nested config objects can expand (measured: +25% on a ~160-line nested config). Use `pakt_inspect` or `pakt auto` first — they pass through payloads that don't compress. Full reproducible numbers in [docs/BENCHMARK-SNAPSHOT.md](./docs/BENCHMARK-SNAPSHOT.md).

---

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- [pnpm](https://pnpm.io/) >= 9

### Setup

```bash
git clone https://github.com/sriinnu/clipforge-PAKT.git
cd clipforge-PAKT
pnpm install

# Opt in to repo-managed git hooks (rejects Co-authored-by trailers, etc.)
git config core.hooksPath .githooks
```

### Commands

```bash
# Build all packages
pnpm build

# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run benchmarks
pnpm bench

# Clean build artifacts
pnpm clean
```

---

## Inspiration & Credits

### TOON Format

PAKT's core pipe-delimited syntax (Layer 1) is directly inspired by **[TOON Format v1.3](https://github.com/toon-format/spec)** -- the original compact notation for structured data, created by **[Nicholas Charlton](https://github.com/nichochar)** ([@nichochar](https://github.com/nichochar)). TOON demonstrated that structured data can be represented without the syntactic overhead of JSON while remaining unambiguous and machine-parseable. PAKT builds on this foundation by adding multi-format support, a dictionary compression layer, and guaranteed lossless round-tripping. TOON has implementations across Python, TypeScript, Go, Rust, .NET, Elixir, Java, and Julia -- a testament to the strength of its design.

### Key research

- **LLMLingua-2** (Microsoft, [arXiv:2403.12968](https://arxiv.org/abs/2403.12968), 2024) -- The closest neural competitor. PAKT achieves comparable savings on structured data without running a model.
- **Gist Token Study** (Deng et al., [arXiv:2412.17483](https://arxiv.org/abs/2412.17483), Dec 2024) -- Lossy compression fails on exact recall, which motivates PAKT's lossless-first L1-L3 design.
- **DeltaKV** (Hao et al., [arXiv:2602.08005](https://arxiv.org/abs/2602.08005), Feb 2026) -- Residual similarity compression, adapted as PAKT's delta encoding for tabular arrays.

Full citation list and survey: [docs/research.md](./docs/research.md).

---

## Related Projects

PAKT sits alongside a couple of sibling tools that round out the token economy — shrink, measure, monitor:

- **[tokmeter](https://github.com/sriinnu/tokmeter)** -- Token usage tracker for AI coding agents. Tracks consumption across 16+ agents through five surfaces: CLI, TUI, React web dashboard, MCP server ([Drishti](https://www.npmjs.com/package/@sriinnu/drishti)), and a macOS menu bar. Includes cost digests, cache-efficiency analytics, and a model advisor.
- **[Runic](https://github.com/sriinnu/Runic)** -- macOS menubar app monitoring AI usage, costs, and quotas across 26 providers in real time. Charts, forecasts, budget alerts, CSV/JSON export, widgets, and a bundled CLI. Local-only, zero telemetry.

PAKT reduces what you send; tokmeter and Runic tell you what you spent.

---

## Support

PAKT is maintained independently. If it saves you tokens and you'd like to back continued development, you can sponsor via [GitHub Sponsors](https://github.com/sponsors/sriinnu) or [Buy Me a Coffee](https://buymeacoffee.com/sriinnu). Issues, PRs, and stars help just as much.

---

## License

[MIT](./LICENSE) -- Srinivas Pendela

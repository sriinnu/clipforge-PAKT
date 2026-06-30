# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.11.0] - 2026-06-26

### Added

- **Agent context-engine layers.** Five additions to `createContextEngine()` plus new exports:
  - Cross-message shared `@shared` dictionary (default on, lossless): mines lines recurring across the whole message set, defines each once, and rewrites occurrences with `§N` aliases; round-trip + net-savings gated, opaque/summarized-safe, collision-safe. Exports `buildSharedDictionary` / `expandSharedDictionary`.
  - Query-aware extractive selection (`extractive` config, off by default; lossy but faithful): keeps query-relevant tool-result lines verbatim and folds the rest into an explicit elision marker. Deterministic IDF scoring — selection, not generation, so it cannot hallucinate. Exports `extractRelevant`; set the query via `setQuery()`.
  - Literal-aware code compaction (`compactCode` config, off by default): strips comments and redundant blank lines from code tool output using a real character-level lexer (string / template / regex aware), and bails to a no-op on any unterminated construct, so it is behavior-preserving. Exports `compactCode` / `looksLikeCode`.
  - Opt-in neural tier with a non-regression guarantee: `combineWithGuarantee()` keeps a pluggable neural compressor's output only when it is smaller **and** passes a caller-supplied fidelity gate, otherwise falls back to the deterministic result — the output is never larger than the baseline. No model is bundled.
  - New `ContextSavings.breakdown` fields: `sharedDictionary`, `extractive`, `codeCompaction`.
- **Per-layer Pareto frontier in the eval harness.** `scripts/eval/run.mjs --profiles a,b,c` (or `--frontier`) sweeps PAKT layer profiles and reports savings% vs comprehension accuracy per profile, each matched-paired against the shared JSON baseline with a sign test, plus a recommended no-loss frontier pick.
- **Cloudflare Pages deploy workflow.** `.github/workflows/deploy-playground.yml` builds the playground on push to `main` (and manual dispatch) and deploys it once `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets are set; until then it builds and skips the deploy with a notice.

- **Cache-synergy pack.** `RollingDictionary` wired into `handleCompress` (MCP `pakt_compress`) for cross-turn alias reuse; opt out with `statelessDict: true`. `@cache prefix-end` directive now emitted after `@dict ... @end` when `cacheTarget` is set or `cacheDirective: true`; `cache-breakpoint.ts::findCacheDirectiveOffset` returns the exact byte offset. Prefix byte-stability verified by `tests/cache-stability.test.ts`.
- **`dictPlacement: 'inline' | 'system'` option on `compress()`.** When `'system'`, the result carries `result.dictBlock` for placement in the system prompt (where provider caching is most effective). `decompress(body, { dict })` accepts an externally-supplied dict block (inline wins on conflict). CLI: `--dict-placement system` + `--dict-out <file>` on compress; `--dict <file>` on decompress. MCP: `dictPlacement` parameter.
- **Provider cache adapters (`src/middleware/provider-adapter.ts`).** New pure, model-free exports: `buildAnthropicCacheHints` (produces `cache_control` message fragments; 4-breakpoint budget; min-prefix gating at 2 048 / 4 096 tokens; TTL break-even math) and `buildOpenAICacheHints` (produces `prompt_cache_key` from a SHA-256 of the stable prefix).
- **Proxy tool-catalog modes.** `pakt proxy --wrap "<server-cmd>" --tools slim` applies lossless-in-spirit one-way schema compression + description caps to upstream tools (measured savings logged). `--tools search` exposes a 3-tool facade (`search_tools` / `get_tool_schema` answered locally; `call_tool` forwards but returns a documented structured error when the schema was not pre-fetched — not yet a full transparent rewrite path).
- **Compaction-cooperative context engine.** Provider compaction blocks (e.g. `compact-2026-01-12` format) treated as opaque/immutable: skipped across dedup, aging, summarization, and fact-extraction passes. New `providerCompactionThresholdTokens` config option; `headroomTokens` surfaced in `ContextSavings`. `engine.ts` refactored from 592 → 384 LOC into focused submodules (`opaque-blocks.ts`, `tool-aging.ts`, `fact-extraction.ts`, `history-strategies.ts`).
- **`pakt stats --json` fully implemented.** Emits a single JSON object (`schemaVersion: 1`) to stdout in both single-file and aggregate modes. Previously the flag was accepted but silently ignored.
- **L3.5 meta-token layer (`src/layers/L3-5-metatoken.ts` + `L3-5-metatoken-encode.ts`).** Opt-in (off in all profiles); discovers recurring BPE token spans crossing word boundaries and aliases them into the shared `@dict` block; per-span safety gate ensures token count strictly decreases before any rewrite. Decompression handled by existing `decompressL2` path. Measured on bundled fixtures (gpt-4o / o200k_base): ~3-4% additional savings on repetitive JSON/log data; 0% on non-repetitive data (safety gate fires). Experimental — actual savings are payload-dependent.
- **Python client — `pakt-client` (`packages/pakt-python`).** Thin wrapper over the PAKT CLI and MCP stdio server. Zero runtime dependencies (stdlib only); Python ≥ 3.10; Node ≥ 22 required at runtime. Published to PyPI as `pakt-client`. 25 tests across CLI-arg, discovery, parsing, and integration suites.
- **Comprehension eval harness (`scripts/eval/`).** Key-gated; `--mock` pipeline fully verified. A live run via the Claude Code CLI found PAKT comprehension-neutral vs minified JSON (PAKT 36/36, JSON 35/36; the one divergent question favored PAKT; sign-test p=1.00 — the suite runs near ceiling, so treat it as weak evidence of parity, not a PAKT win). Measured token savings on eval fixtures: tabular users 29%, logs 53%, nested config −25% (PAKT expands small deeply-nested configs under the standard profile; `pakt_inspect` exists for exactly this).
- **New brand assets.** Chevron-pipe icon mark (`assets/pakt-icon.svg`), rewritten vector wordmark (`assets/pakt-logo.svg`, no font deps), full Tauri icon set, extension PNGs, playground favicon.
- **Research docs.** `docs/research/2026-06-future-features.md` (ranked feature research) and `docs/research/2026-06-polyglot-port-options.md` (port evaluation; recommendation: protocol surfaces now, Rust core + bindings when demand proves).

### Changed

- **README rewritten as a plain, factual statement.** Dropped marketing claims (the "only ..." superlative, the "90% cost reduction" line that was the provider's cache, not PAKT's); surfaced where it does not help and the measured comprehension result; moved the version-stamped feature list to this CHANGELOG. Logo cache-busted (`pakt-logo.svg?v=2`); unreferenced `clipforge-logo.svg` removed.
- **Desktop repositioned as Agent Telemetry HQ.** Default tab is now a telemetry dashboard reading `~/.pakt/stats` JSONL files (today / 7-day savings, per-agent source table, latency percentiles, lossy share, sparklines). Clipboard compress is the second tab.
- **Desktop history is now real SQLite.** `tauri-plugin-sql` frontend API replaces old Rust stubs; legacy `localStorage` history migrated automatically on first open. macOS is the validated compile-and-run path; Windows and Linux are source targets.
- **Extension store prep complete.** `apps/extension/store/` contains listing copy, privacy policy, screenshots checklist, smoke-test script, and submission checklist. Extension remains unpublished and not yet smoke-tested on live sites.
- **Extension site-allowlist editor added.** Settings popup and Options page include a `siteWhitelist` editor for controlling which domains trigger auto-compress-on-paste.

### Stats

- `pakt-core` test suite grows with new tests for cache-stability, provider-adapter, dict-placement, meta-token layer, and proxy tool modes.

## [0.10.0] - 2026-05-08

### Added

- **Prompt-cache breakpoint hint.** New `target?: CacheTarget` option on `PaktOptions` (`'anthropic' | 'bedrock' | 'openai' | 'google'`). When set, `compress()` returns a `cacheBreakpoint: { byteOffset, recommendedTTLSeconds, target }` on the result identifying where the cacheable prefix ends so consumers can place provider `cache_control` / `cachePoint` markers correctly. AWS Bedrock 1h TTL (Jan 2026), Anthropic 5min default with 1h opt-in (Mar 2026), OpenAI/Google auto-managed. Header detection uses a known-marker whitelist so a body line starting with `@mention` or `@Component` cannot leak into the prefix and break byte-stability across turns.
- **Prefix-stable `@dict` for cross-turn cache hits.** `RollingDictionary.seed()` emits expansions in deterministic discovery order; `compressL2()` pins seeded expansions to fixed alias slots across turns. Engaged automatically via `pakt_auto` (MCP); bare `compress()` callers can pass `seedAliases` to opt in. Precondition for hitting Anthropic / OpenAI / Bedrock prompt caches.
- **Tool-result aging in the context engine.** New `createContextEngine({ toolResultTailLines: 30 })` option implements the Gemini-CLI back-to-front aging pattern: walks history newest-first, snaps the cutoff to the nearest user-message boundary (never splits a tool call mid-turn), and tail-truncates older tool outputs. Char-fallback handles long single-line payloads (minified JSON, base64) above ~1000 tokens and ~4000 chars. New `ContextSavings.breakdown.toolResultAging` field surfaces savings.
- **Latency + lossy observability on `pakt_stats` and `pakt_dashboard`.** New optional `durationMs` on `CallRecord`. New `latencyMs: { p50, p95, p99, avg, samples }` and `lossy: { count, inputTokens }` fields on `SessionStatsResult`, computed via nearest-rank percentiles with NaN/negative guards. Wired through MCP `executeTool` and the CLI compress path. New optional `outputFields` on `pakt_stats` / `pakt_dashboard` MCP contracts, all marked `required: false` for backward compatibility.
- **`CacheTarget` UI surface across all three apps.** Extension popup (segmented control), playground (dropdown + dedicated stat card), desktop tray (settings select). All surfaces also render the cache hint, mixed-format unavailability message, and a lossy badge when L4 / PII redact runs.
- **`docs/token-efficiency-roadmap.md`** with arxiv-cited tiered roadmap (CompactPrompt, ACON, PAACE, GenericAgent, etc.).

### Changed

- **`@sriinnu/pakt` exports `CacheTarget` and `CacheBreakpoint` types** from the package root for downstream typing.
- **MCP handler split.** `mcp/handler.ts` is now a slim dispatch; `pakt_explain`, `pakt_savings`, `pakt_dashboard` live in `mcp/handler-explain-savings-dashboard.ts` to keep each module under the project's LOC cap.
- **READMEs (root + `@sriinnu/pakt`)** add Prompt Cache Integration and Context Engine sections; MCP tools list grows from four to seven (adds `pakt_explain`, `pakt_savings`, `pakt_dashboard`); Bedrock/Anthropic per-provider naming disambiguated (`cachePoint` vs `cache_control`).
- **Tauri crate version aligned.** `apps/desktop/src-tauri/Cargo.toml` bumped from 0.8.0 to 0.10.0 to match every other workspace surface.

### Fixed

- **Conflict resolution.** Resolved 4 stash-pop conflicts blocking the branch: `cli-commands.ts`, `compress.ts`, `compress-helpers.ts`, `mcp/handler.ts`.
- **Extension `cacheTarget` round-trip.** `DEFAULT_SETTINGS` now declares `cacheTarget: undefined` so `chrome.storage.sync.get(defaults, ...)` actually fetches it AND the change-event listener's `key in DEFAULT_SETTINGS` gate lets cacheTarget changes through. Without this, picking "Bedrock" silently reverted on popup reload.
- **Browser-safe byte counting in `cache-breakpoint.ts`.** Replaced `Buffer.byteLength` (Node-only) with `TextEncoder().encode().length` so the extension popup, desktop renderer, and playground worker don't crash when a user enables `cacheTarget`.
- **Tool-result size guard in `addToolResult`.** New `MAX_TOOL_RESULT_BYTES = 1 MiB` cap pre-clamps adversarial or runaway tool output before tokenization or `split('\n')` materialization runs.
- **Defensive guards** on `computeCacheBreakpoint` (null/empty input → `null`, unknown target TTL → `0`) and on the desktop `setCacheTarget` setter + persist `merge` (tampered localStorage values coerce to `undefined`).
- **Compare view threads `cacheTarget`** through the worker bridge so the playground's profile sweep respects the option.

### Breaking (TypeScript only)

- **`ContextSavings.breakdown.toolResultAging: number`** is now a required field. Hand-constructed `ContextSavings` objects in tests / mocks need the new key.
- **`SessionStatsResult.latencyMs: { p50, p95, p99, avg, samples } | null`** and **`SessionStatsResult.lossy: { count, inputTokens }`** are now required. Hand-constructed result objects need both keys.

No runtime breaks — every new field is populated by the library on every code path. JS consumers who never touch these types are unaffected.

### Stats

- 1131 → 1157 tests on `@sriinnu/pakt` (+26 new across rolling-dict, MCP, cache-breakpoint, context-engine, session-stats).
- All four surfaces (`pakt-core`, `playground`, `extension`, `desktop`) build clean.

## [0.9.0] - 2026-04-29

### Added

- **L2 corpus-aware substring window sizing.** `findSubstringCandidates()` now drives its window ladder from a new `computeAdaptiveWindowSizes(values)` helper instead of the hard-coded `[32, 24, 20, 16, 12, 10, 8, 6]` list. The ladder is capped by the longest value in the corpus, extended to 40 / 48 / 64 when the corpus contains long URLs / paths / opaque tokens, and gains a 5-char window when more than half of the values are short. Lossless; only changes which substrings the L2 dictionary considers. 7 new tests in `tests/L2-adaptive-windows.test.ts`.
- **Browser extension Options page.** A dedicated full-tab settings surface (`apps/extension/src/options/`) is now registered via `manifest.options_ui` and reuses the popup `<Settings>` component. Two new persisted settings: `autoCompressOnPaste` (boolean) and `siteWhitelist` (string[]).
- **Auto-compress on paste in the browser extension.** When enabled, the content script intercepts `paste` events on supported LLM input boxes, runs `compress()` synchronously on the clipboard payload, and substitutes the PAKT-compressed text in place via `event.preventDefault()`. PAKT-already-compressed pastes and zero-savings pastes pass through untouched. Off by default.
- **Slack web + Gmail support in the browser extension.** `manifest.content_scripts.matches` and `shared/site-support.ts` extended with `app.slack.com` (Quill composer) and `mail.google.com` (`role="textbox"` composer) selectors. Adds two of the highest-traffic prompt-paste destinations to the existing ChatGPT / Claude / Gemini coverage.

### Changed

- **Desktop frontend bundle hand-split into seven chunks.** `apps/desktop/vite.config.ts` now declares `manualChunks` for `react-vendor`, `pakt-core` (isolates the gpt-tokenizer payload), `tauri-api`, and a generic `vendor` bucket; the SettingsPanel and HistoryPanel overlays are loaded via `React.lazy()` + `Suspense` from `MenuBarPanel.tsx`. The single 3,387 kB chunk shipped in 0.8.0 is replaced with an isolated 127 kB app chunk plus stable vendor chunks that cache independently across releases.
- **Component split for desktop and playground shells.** `MenuBarPanel.tsx` (696 → 378 LOC) and `apps/playground/src/App.tsx` (1099 → 430 LOC) refactored into focused sub-components and helper modules. No behavior change; brings every source file under the 450-LOC cap.
- **Repo-wide lint cleanup.** `pnpm lint` now reports 0 errors / 0 warnings across 256 files. The `noExcessiveCognitiveComplexity` flags in `compress.ts`, `L1-delta.ts`, `parse-body.ts`, `pii/redact.ts`, and `pii/detector.ts` were resolved by extracting helpers, not by suppression.

### Fixed

- **`needsQuoting()` covers ` %` substrings in scalar serialization** (`packages/pakt-core/src/serializer/format-scalar.ts`). Values containing a percent sign preceded by a space now serialize quoted, matching the round-trip contract for arbitrary strings.

## [0.8.0] - 2026-04-21

### Added

- **Numeric delta encoding for monotonic tabular columns.** Columns whose values form an integer arithmetic progression are now stored as `+N` / `-N` offsets against the previous row (a sibling of the existing `~` string-delta sentinel). Typical win on id / timestamp / counter columns is 15-25% on top of the existing L1 structural compression. Lossless; reverts cleanly on decompress.
- **Tokenizer-family awareness at L3 and in public APIs.** New exports `getTokenizerFamily(model)`, `getTokenizerFamilyInfo(model)`, and `countTokens(text, model)` let callers align the L3 merge-savings gate and downstream token counts with the target model (OpenAI `o200k_base` / `cl100k_base`, with a documented `cl100k_base` fallback for Claude and Llama). The info object returns `{ family, exact, approximationNote }` so consumers can warn users when the count is approximate.
- **Property-based fuzzers.** `tests/roundtrip-fuzz.test.ts` and `tests/L1-delta-sentinel-fuzz.test.ts` exhaustively probe L1 round-trips, including the `~` sentinel at every structurally-interesting position. The fuzzers surfaced the three lossless bugs fixed below.
- **Playground + Extension model selector.** Both surfaces expose a target-model picker that flows into `countTokens(..., model)` and shows the resolved tokenizer family (with an "approximate" badge for Claude / Llama).

### Fixed

- **Lossless round-trip for empty objects at any depth.** PAKT previously had no syntax for `key: {}` and silently collapsed nested empty objects to empty strings. The serializer now emits `key {}` for nested empty `ObjectNode`s and `- {}` for empty list items; the parser consumes the sentinels. Eight previously-documented `.fails()` tests now run as regular `it()` cases.
- **Lossless round-trip for primitive and nested-array list items.** `buildListArray` wrapped primitives as `{ value: <stringified> }`, which round-tripped to a `{value: "…"}` object instead of the original element. The builder now recurses into nested arrays and wraps primitives under a `_value` sentinel (matching the existing `_root` convention); `reverse/helpers.listItemToValue` unwraps the sentinel back to the original element type.
- **Lossless round-trip for inline arrays starting with a quoted scalar.** Inputs like `[\"~\", \"a\"]` fell through `parseArrayNode`'s bare-VALUE check into the list-array branch, leaking subsequent scalars as top-level keys. Dispatch now covers `VALUE` / `QUOTED_STRING` / `NUMBER` follow-tokens and `parseInlineArray` consumes the split token stream.

### Changed

- **10 MB input cap on `compress()`.** Inputs above the cap throw a typed error instead of being silently truncated. Implemented with an allocation-free byte counter so the cap check does not materialise the input.
- **L2 dictionary aliases now lex-ordered by expansion.** Greedy selection still picks winners by net-savings, but `$a`, `$b`, ... are assigned in lex order of the expansion afterwards. Two payloads that share the same high-frequency values now produce the same `@dict` block, preserving prompt-cache hits on Anthropic and OpenAI caching APIs across related calls. Round-trip is unchanged. Only affects callers relying on snapshot-style assertions over alias letters. Motivated by "Don't Break the Cache" (arXiv:2601.06007, Jan 2026).
- **README sharpened.** Explicit positioning against LLMLingua / LLMLingua-2 (neural, lossy, model-dependent), TOON (PAKT's L1 inspiration, extended with L2-L4), and byte-level compressors (gzip / brotli do not reduce tokens).

## [0.7.0] - 2026-04-06

### Added

- Auto context compression: PAKT compresses data automatically on every MCP tool call.
- Text compression with line dedup: identical lines replaced with `@L<N>` references (57% on logs, 69% on repetitive text).
- Word-boundary n-gram dictionary for text/markdown (38% on repetitive prose).
- Whitespace normalization: trailing spaces and blank line runs stored as metadata for lossless restoration.
- Content-addressed dedup cache: SHA-256 hash with byte-budget LRU eviction (10MB default, 500 entries).
- Configurable tool description via `registerPaktTools(server, { autoDescription })`.
- Input size caps: 512KB for `pakt_auto`, 1MB for `pakt_compress`, 100KB for text compression.
- `dedupHit` and `belowThreshold` output fields on `pakt_auto`.
- `dedupHits`, `dedupEntries`, `totalCompoundingSavings` on `pakt_stats`.
- Shared `replaceAll` utility in `utils/replace-all.ts`.

### Fixed

- PAKT detection false positives: `@from John`, `@warning chemicals`, `@Override` no longer detected as PAKT.
- Decompress passthrough: text starting with `@version`, `@username`, or any non-PAKT `@` prefix returns unchanged.
- Tabular cell quoting: values with spaces (e.g., "Alice Johnson") now quoted in pipe-delimited rows.
- Quoted key support: JSON keys with spaces, colons, pipes, newlines now round-trip correctly.
- `formatKey` handles `@`, `$`, `%`, `-` prefixes, empty strings, and all special characters.
- YAML inline arrays now use flow syntax `[v1, v2]` instead of block `- v1`.
- `@end` marker injection: decompressor uses line-anchored matching to avoid false matches in dict values.
- Alias collision: `$abc` in input now reserves both `$ab` and `$a` to prevent partial match corruption.
- `dedupMetadata` Map capped at 500 entries to prevent memory leak.
- Text decompression routing: `@from text` content without `@dict` now correctly bypasses AST parser.
- Repo-wide lint cleanup: zero errors, zero warnings across 210 files.

### Changed

- `pakt_auto` description refined: assertive but mentions 50-token threshold to reduce unnecessary MCP calls.
- `pakt_stats` description mentions compounding context savings and dedup cache efficiency.
- Version bumped to 0.7.0.

## [0.6.2] - 2026-04-05

### Added

- Session stats tracking: `pakt_stats` MCP tool for real-time token savings reporting.
- Persistent multi-agent stats: each MCP server writes to `~/.pakt/stats/` with per-agent JSONL files.
- `pakt stats` CLI command with dual mode: single-shot (with file) or persistent aggregate (no file).
- Stats filtering: `--today`, `--week`, `--agent <name>`, `--active` flags.
- Stats maintenance: `--compact` (archive old sessions), `--reset` (clear all).
- `--agent-name` flag for `pakt serve` to name agent sessions.
- `scope` parameter on `pakt_stats` MCP tool: `'session'` (fast, default) or `'all'` (reads disk).
- Session lifecycle: header/footer in JSONL files, lazy compaction on shutdown.
- Production readiness notes in `docs/wip-production-readiness.md`.

### Changed

- Version aligned to 0.6.2 across package.json, Cargo.toml, and VERSION export.
- CI lint step now uses `pnpm lint:advisory` (explicit advisory path).
- Desktop workflow splits macOS into ARM (macos-14) and Intel (macos-13) runners.
- Publish workflow validates tag-to-version match and runs tests before build.
- `pnpm --filter` syntax corrected in workflow build steps.

### Fixed

- DTS build error in `detect/index.ts`: null return on unreachable path (TS6 strict index access).
- DTS build error in `L1-decompress.ts`: `bodyToObject` renamed to correct `bodyToValue`.
- `Compressed tokens:` label alignment in `savings` command.

### Removed

- Standalone `release-publish.yml` workflow (redundant with `publish-pakt-npm.yml`).
- Stale "toon" keyword from package.json.

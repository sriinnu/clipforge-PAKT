# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

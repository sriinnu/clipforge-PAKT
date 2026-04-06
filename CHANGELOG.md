# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

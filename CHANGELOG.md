# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

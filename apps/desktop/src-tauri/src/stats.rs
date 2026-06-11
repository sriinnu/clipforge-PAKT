//! Read-only access to PAKT's persisted agent telemetry.
//!
//! pakt-core's MCP server / CLI writes JSONL session files to
//! `~/.pakt/stats/` (see `packages/pakt-core/src/stats/persister.ts`).
//! This module only does filesystem I/O — it ships the raw file contents
//! to the webview, where `src/telemetry/stats-schema.ts` owns the schema
//! parsing. Keeping the parsing in TypeScript means the record-format
//! logic lives in one pure, unit-testable module instead of being split
//! across two languages.

use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// Hard cap on bytes read per stats file. Session files are typically a
/// few kilobytes; anything larger is treated as corrupt and skipped so a
/// runaway file can never balloon the IPC payload.
const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;

/// One raw JSONL file from the stats directory.
#[derive(Serialize)]
pub struct StatsFile {
    /// File name without directory (e.g. `sess-claude-code-a1b2c3d4.jsonl`).
    pub name: String,
    /// Raw JSONL content, parsed on the frontend.
    pub content: String,
}

/// Snapshot of the entire stats directory, returned to the frontend.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsSnapshot {
    /// Whether the stats directory exists at all. `false` drives the
    /// "no agent telemetry yet" onboarding state in the UI.
    pub dir_exists: bool,
    /// All `*.jsonl` files found (sessions + `archive.jsonl`).
    pub files: Vec<StatsFile>,
}

/// Resolve the stats directory, mirroring pakt-core's persister:
/// `PAKT_STATS_DIR` env override first, then `~/.pakt/stats`.
fn stats_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("PAKT_STATS_DIR") {
        if !dir.is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    app.path()
        .home_dir()
        .ok()
        .map(|home| home.join(".pakt").join("stats"))
}

/// Read every `*.jsonl` file in the PAKT stats directory.
///
/// Never errors: a missing directory yields `dir_exists: false`, and
/// unreadable or oversized files are silently skipped, matching the
/// graceful-degradation posture of the persister itself.
#[tauri::command]
pub fn read_pakt_stats(app: tauri::AppHandle) -> StatsSnapshot {
    let Some(dir) = stats_dir(&app) else {
        return StatsSnapshot {
            dir_exists: false,
            files: Vec::new(),
        };
    };

    let Ok(entries) = fs::read_dir(&dir) else {
        // Directory absent (or unreadable) — telemetry hasn't started yet.
        return StatsSnapshot {
            dir_exists: false,
            files: Vec::new(),
        };
    };

    let mut files = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();

        // Skip symlinks — follow them would open a TOCTOU window and could
        // read files outside ~/.pakt/stats if the link is malicious or stale.
        if let Ok(sym_meta) = fs::symlink_metadata(&path) {
            if sym_meta.file_type().is_symlink() {
                continue;
            }
        }

        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if meta.len() > MAX_FILE_BYTES {
                continue;
            }
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if let Ok(content) = fs::read_to_string(&path) {
            files.push(StatsFile {
                name: name.to_string(),
                content,
            });
        }
    }

    StatsSnapshot {
        dir_exists: true,
        files,
    }
}

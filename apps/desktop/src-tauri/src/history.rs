//! SQLite-backed clipboard history storage.
//!
//! Persists clipboard compression/decompression operations so users
//! can review, search, and reuse past transformations. Uses
//! `tauri-plugin-sql` for SQLite database access.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tauri_plugin_sql::{Migration, MigrationKind};

/// Maximum number of history entries to keep. Oldest entries are pruned
/// when this limit is exceeded.
const MAX_HISTORY_ENTRIES: i64 = 100;

/// A single clipboard history entry representing one compress/decompress operation.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HistoryEntry {
    /// Auto-incremented row ID (0 when inserting a new entry).
    pub id: i64,
    /// Unix timestamp in milliseconds when the operation occurred.
    pub timestamp: i64,
    /// The original clipboard text before transformation.
    pub input: String,
    /// The transformed clipboard text after compression/decompression.
    pub output: String,
    /// The format or compression method used (e.g. "compressed", "decompressed").
    pub format: String,
    /// Number of tokens saved by the transformation.
    pub saved_tokens: i64,
}

/// Return the database migrations for initializing the history table.
///
/// This is used during plugin setup to ensure the schema exists.
pub fn get_migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create_history_table",
        sql: "CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            input TEXT NOT NULL,
            output TEXT NOT NULL,
            format TEXT NOT NULL,
            saved_tokens INTEGER NOT NULL DEFAULT 0
        )",
        kind: MigrationKind::Up,
    }]
}

/// Add a new entry to the clipboard history.
///
/// After insertion, if the total number of entries exceeds [`MAX_HISTORY_ENTRIES`],
/// the oldest entries are deleted to stay within the limit.
///
/// Returns the row ID of the newly inserted entry.
#[tauri::command]
pub async fn add_history_entry<R: Runtime>(
    app: AppHandle<R>,
    entry: HistoryEntry,
) -> Result<i64, String> {
    // TODO: Verify exact tauri-plugin-sql v2 API for executing queries.
    // The plugin exposes a `Database` struct via `app.state()` or direct API.
    // Below is the intended SQL logic:
    //
    // INSERT INTO history (timestamp, input, output, format, saved_tokens)
    // VALUES (?, ?, ?, ?, ?)
    //
    // Then prune if necessary:
    // DELETE FROM history WHERE id NOT IN (
    //   SELECT id FROM history ORDER BY timestamp DESC LIMIT 100
    // )

    let _ = (app, entry);

    // Placeholder: return 0 until plugin wiring is finalized
    Ok(0)
}

/// Retrieve the most recent history entries.
///
/// Returns up to `limit` entries (default 50), ordered by most recent first.
#[tauri::command]
pub async fn get_history<R: Runtime>(
    app: AppHandle<R>,
    limit: Option<i64>,
) -> Result<Vec<HistoryEntry>, String> {
    let _limit = limit.unwrap_or(50).min(MAX_HISTORY_ENTRIES);

    // TODO: Execute SQL query via tauri-plugin-sql:
    // SELECT * FROM history ORDER BY timestamp DESC LIMIT ?

    let _ = app;

    Ok(vec![])
}

/// Search history entries by matching against input or output text.
///
/// Performs a case-insensitive LIKE search on both the `input` and `output` columns.
#[tauri::command]
pub async fn search_history<R: Runtime>(
    app: AppHandle<R>,
    query: String,
) -> Result<Vec<HistoryEntry>, String> {
    // TODO: Execute SQL query via tauri-plugin-sql:
    // SELECT * FROM history
    // WHERE input LIKE '%' || ? || '%'
    //    OR output LIKE '%' || ? || '%'
    // ORDER BY timestamp DESC
    // LIMIT 50

    let _ = (app, query);

    Ok(vec![])
}

/// Delete all history entries.
#[tauri::command]
pub async fn clear_history<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    // TODO: Execute SQL query via tauri-plugin-sql:
    // DELETE FROM history

    let _ = app;

    Ok(())
}

/// Delete a single history entry by its ID.
#[tauri::command]
pub async fn delete_history_entry<R: Runtime>(
    app: AppHandle<R>,
    id: i64,
) -> Result<(), String> {
    // TODO: Execute SQL query via tauri-plugin-sql:
    // DELETE FROM history WHERE id = ?

    let _ = (app, id);

    Ok(())
}

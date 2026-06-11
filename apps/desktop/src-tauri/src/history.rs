//! SQLite schema migrations for the clipboard history database.
//!
//! Data access happens entirely on the frontend via
//! `@tauri-apps/plugin-sql` (`Database.load("sqlite:clipforge_history.db")`
//! in `src/stores/historyStore.ts`); this module only owns the schema.
//! The migrations are registered with `tauri_plugin_sql::Builder` in
//! [`crate::run`].

use tauri_plugin_sql::{Migration, MigrationKind};

/// Return the database migrations for initializing the history table.
///
/// Applied automatically by the SQL plugin the first time the frontend
/// loads the `sqlite:clipforge_history.db` database.
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

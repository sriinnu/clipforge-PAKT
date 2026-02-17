//! ClipForge desktop application — Tauri v2 backend.
//!
//! This crate wires together the native modules that power the
//! ClipForge menubar/tray application:
//!
//! - **tray** — system tray icon and context menu
//! - **clipboard** — read, write, and watch the system clipboard
//! - **hotkeys** — global keyboard shortcuts
//! - **history** — SQLite-backed clipboard transformation history

mod clipboard;
mod history;
mod hotkeys;
mod tray;

/// Entry point for the Tauri application.
///
/// Initialises plugins, registers IPC command handlers, sets up the
/// system tray and global shortcuts, then starts the event loop.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // --- Plugins ---
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .build(),
        )
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(
                    "sqlite:clipforge_history.db",
                    history::get_migrations(),
                )
                .build(),
        )
        // --- Managed State ---
        .manage(clipboard::ClipboardState::default())
        // --- IPC Command Handlers ---
        .invoke_handler(tauri::generate_handler![
            clipboard::read_clipboard,
            clipboard::write_clipboard,
            clipboard::start_clipboard_watch,
            clipboard::stop_clipboard_watch,
            history::add_history_entry,
            history::get_history,
            history::search_history,
            history::clear_history,
            history::delete_history_entry,
        ])
        // --- App Setup ---
        .setup(|app| {
            let handle = app.handle().clone();

            // System tray
            if let Err(e) = tray::setup_tray(&handle) {
                eprintln!("Failed to setup system tray: {}", e);
            }

            // Global shortcuts
            if let Err(e) = hotkeys::register_shortcuts(&handle) {
                eprintln!("Failed to register global shortcuts: {}", e);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ClipForge");
}

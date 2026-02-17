//! Clipboard monitoring and read/write operations.
//!
//! Provides Tauri IPC commands for reading from, writing to, and
//! watching the system clipboard. Uses `tauri-plugin-clipboard-manager`
//! for cross-platform clipboard access.

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Shared state to track the last known clipboard content for change detection.
pub struct ClipboardState {
    pub last_content: Mutex<String>,
    pub watching: Mutex<bool>,
}

impl Default for ClipboardState {
    fn default() -> Self {
        Self {
            last_content: Mutex::new(String::new()),
            watching: Mutex::new(false),
        }
    }
}

/// Read the current text content from the system clipboard.
///
/// Returns the clipboard text or an error if the clipboard is empty
/// or contains non-text content.
#[tauri::command]
pub async fn read_clipboard<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    app.clipboard()
        .read_text()
        .map_err(|e| format!("Failed to read clipboard: {}", e))
}

/// Write text content to the system clipboard.
///
/// Replaces whatever is currently on the clipboard with the provided text.
#[tauri::command]
pub async fn write_clipboard<R: Runtime>(
    app: AppHandle<R>,
    text: String,
) -> Result<(), String> {
    app.clipboard()
        .write_text(&text)
        .map_err(|e| format!("Failed to write clipboard: {}", e))
}

/// Start polling the clipboard for changes.
///
/// Spawns a background thread that checks the clipboard every 500ms.
/// When new content is detected, a `"clipboard-changed"` event is emitted
/// to the frontend with the new text as the payload.
///
/// Only one watcher runs at a time; calling this again while already
/// watching is a no-op.
#[tauri::command]
pub async fn start_clipboard_watch<R: Runtime + 'static>(
    app: AppHandle<R>,
    state: State<'_, ClipboardState>,
) -> Result<(), String> {
    // Prevent multiple watchers from running simultaneously
    {
        let mut watching = state.watching.lock().map_err(|e| e.to_string())?;
        if *watching {
            return Ok(());
        }
        *watching = true;
    }

    let app_handle = app.clone();

    // Spawn a background thread for clipboard polling
    std::thread::spawn(move || {
        let mut last_content = String::new();

        loop {
            // Check if we should stop watching
            if let Some(cb_state) = app_handle.try_state::<ClipboardState>() {
                let watching = cb_state.watching.lock().unwrap_or_else(|e| e.into_inner());
                if !*watching {
                    break;
                }
            }

            // Read the current clipboard content
            if let Ok(current) = app_handle.clipboard().read_text() {
                if current != last_content && !current.is_empty() {
                    last_content = current.clone();

                    // Update shared state
                    if let Some(cb_state) = app_handle.try_state::<ClipboardState>() {
                        if let Ok(mut last) = cb_state.last_content.lock() {
                            *last = current.clone();
                        }
                    }

                    // Emit change event to the frontend
                    let _ = app_handle.emit("clipboard-changed", &current);
                }
            }

            std::thread::sleep(Duration::from_millis(500));
        }
    });

    Ok(())
}

/// Stop the clipboard watcher if it is running.
#[tauri::command]
pub async fn stop_clipboard_watch(
    state: State<'_, ClipboardState>,
) -> Result<(), String> {
    let mut watching = state.watching.lock().map_err(|e| e.to_string())?;
    *watching = false;
    Ok(())
}

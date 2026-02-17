//! Global hotkey registration for ClipForge.
//!
//! Registers system-wide keyboard shortcuts using `tauri-plugin-global-shortcut`.
//! Each shortcut emits a named event that the React frontend handles.

use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

/// Register all global keyboard shortcuts.
///
/// | Shortcut         | Event emitted            | Purpose                       |
/// |------------------|--------------------------|-------------------------------|
/// | Cmd+Shift+C      | `shortcut-compress`      | Compress clipboard content    |
/// | Cmd+Shift+R      | `shortcut-decompress`    | Decompress clipboard content  |
/// | Cmd+Shift+T      | `shortcut-token-count`   | Count tokens in clipboard     |
/// | Cmd+Shift+H      | `shortcut-history`       | Open clipboard history panel  |
/// | Cmd+Shift+D      | `shortcut-toggle-auto`   | Toggle auto-compression mode  |
pub fn register_shortcuts<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(), Box<dyn std::error::Error>> {
    let shortcuts: &[(&str, &str)] = &[
        ("CmdOrCtrl+Shift+C", "shortcut-compress"),
        ("CmdOrCtrl+Shift+R", "shortcut-decompress"),
        ("CmdOrCtrl+Shift+T", "shortcut-token-count"),
        ("CmdOrCtrl+Shift+H", "shortcut-history"),
        ("CmdOrCtrl+Shift+D", "shortcut-toggle-auto"),
    ];

    for (accelerator, event_name) in shortcuts {
        let shortcut: Shortcut = accelerator.parse()?;
        let event = event_name.to_string();
        let app_handle = app.clone();

        app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event_state| {
            if event_state.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                let _ = app_handle.emit(&event, ());
            }
        })?;
    }

    Ok(())
}

/// Unregister all global shortcuts.
pub fn unregister_all<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    app.global_shortcut().unregister_all()?;
    Ok(())
}

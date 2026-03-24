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

use tauri::{
    window::{Effect, EffectState, EffectsBuilder},
    Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow,
};

const PANEL_WIDTH: u32 = 760;
const PANEL_HEIGHT: u32 = 700;
const PANEL_EDGE_MARGIN: i32 = 16;
const PANEL_VERTICAL_OFFSET: i32 = 12;

fn position_window_near_anchor<R: Runtime>(
    window: &WebviewWindow<R>,
    anchor: Option<PhysicalPosition<f64>>,
) {
    let Ok(size) = window.outer_size() else {
        return;
    };

    let monitor = anchor
        .and_then(|point| window.monitor_from_point(point.x, point.y).ok().flatten())
        .or_else(|| window.current_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        return;
    };

    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let width = size.width as i32;
    let height = size.height as i32;

    let anchor_x = anchor
        .map(|point| point.x.round() as i32)
        .unwrap_or(monitor_position.x + (monitor_size.width as i32 / 2));
    let anchor_y = anchor
        .map(|point| point.y.round() as i32)
        .unwrap_or(monitor_position.y + PANEL_VERTICAL_OFFSET);

    let min_x = monitor_position.x + PANEL_EDGE_MARGIN;
    let max_x = monitor_position.x + monitor_size.width as i32 - width - PANEL_EDGE_MARGIN;
    let min_y = monitor_position.y + PANEL_VERTICAL_OFFSET;
    let max_y = monitor_position.y + monitor_size.height as i32 - height - PANEL_EDGE_MARGIN;

    let x = (anchor_x - (width / 2)).clamp(min_x, max_x.max(min_x));
    let y = (anchor_y + PANEL_VERTICAL_OFFSET).clamp(min_y, max_y.max(min_y));

    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn configure_shell_window<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.hide();
    let _ = window.set_skip_taskbar(true);
    let _ = window.set_resizable(false);
    let _ = window.set_maximizable(false);
    let _ = window.set_minimizable(false);
    let _ = window.set_always_on_top(true);
    let _ = window.set_size(PhysicalSize::new(PANEL_WIDTH, PANEL_HEIGHT));

    #[cfg(target_os = "macos")]
    {
        let _ = window.set_visible_on_all_workspaces(true);
        let _ = window.set_shadow(true);
        let _ = window.set_effects(
            EffectsBuilder::new()
                .effect(Effect::HudWindow)
                .state(EffectState::Active)
                .build(),
        );
    }
}

/// Entry point for the Tauri application.
///
/// Initialises plugins, registers IPC command handlers, sets up the
/// system tray and global shortcuts, then starts the event loop.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
            }
            #[cfg(target_os = "macos")]
            tauri::WindowEvent::Focused(false) if window.label() == "main" => {
                let _ = window.hide();
            }
            _ => {}
        })
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

            #[cfg(target_os = "macos")]
            {
                let _ = handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
                let _ = handle.set_dock_visibility(false);
            }

            if let Some(window) = app.get_webview_window("main") {
                configure_shell_window(&window);
            }

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

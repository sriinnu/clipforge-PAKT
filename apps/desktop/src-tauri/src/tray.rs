//! System tray setup for ClipForge desktop app.
//!
//! Creates the menu bar tray icon with context menu items
//! for clipboard compression, decompression, history, and settings.

use tauri::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};

/// Menu item identifiers for matching in the event handler.
const MENU_OPEN: &str = "open";
const MENU_COMPRESS: &str = "compress";
const MENU_DECOMPRESS: &str = "decompress";
const MENU_HISTORY: &str = "history";
const MENU_SETTINGS: &str = "settings";
const MENU_QUIT: &str = "quit";

/// Set up the system tray icon and context menu.
///
/// Creates a tray icon with the following menu items:
/// - Open ClipForge (shows the main window)
/// - Compress Clipboard (Cmd+Shift+C)
/// - Decompress Clipboard (Cmd+Shift+R)
/// - History (Cmd+Shift+H)
/// - Settings...
/// - Quit ClipForge
///
/// Left-clicking the tray icon toggles the main window visibility.
pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    let open_item = MenuItem::with_id(app, MENU_OPEN, "Open ClipForge", true, None::<&str>)?;
    let compress_item = MenuItem::with_id(
        app,
        MENU_COMPRESS,
        "Compress Clipboard",
        true,
        Some("CmdOrCtrl+Shift+C"),
    )?;
    let decompress_item = MenuItem::with_id(
        app,
        MENU_DECOMPRESS,
        "Decompress Clipboard",
        true,
        Some("CmdOrCtrl+Shift+R"),
    )?;
    let history_item = MenuItem::with_id(
        app,
        MENU_HISTORY,
        "History",
        true,
        Some("CmdOrCtrl+Shift+H"),
    )?;
    let settings_item = MenuItem::with_id(app, MENU_SETTINGS, "Settings...", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, MENU_QUIT, "Quit ClipForge", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &open_item,
            &PredefinedMenuItem::separator(app)?,
            &compress_item,
            &decompress_item,
            &PredefinedMenuItem::separator(app)?,
            &history_item,
            &settings_item,
            &PredefinedMenuItem::separator(app)?,
            &quit_item,
        ],
    )?;

    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("ClipForge - Clipboard Compressor")
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(handle_tray_event)
        .build(app)?;

    Ok(())
}

/// Handle context menu item clicks.
fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    match event.id().as_ref() {
        MENU_OPEN => show_main_window(app),
        MENU_COMPRESS => {
            let _ = app.emit("shortcut-compress", ());
        }
        MENU_DECOMPRESS => {
            let _ = app.emit("shortcut-decompress", ());
        }
        MENU_HISTORY => {
            let _ = app.emit("shortcut-history", ());
        }
        MENU_SETTINGS => {
            let _ = app.emit("open-settings", ());
        }
        MENU_QUIT => {
            app.exit(0);
        }
        _ => {}
    }
}

/// Handle tray icon click events — left click toggles the main window.
fn handle_tray_event<R: Runtime>(tray: &TrayIcon<R>, event: TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        let app = tray.app_handle();
        show_main_window(app);
    }
}

/// Show and focus the main application window.
fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

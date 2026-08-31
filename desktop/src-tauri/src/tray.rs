// tray.rs — system tray with context menu.
//
// Provides a persistent system tray icon with quick-access menu items:
// Show/Hide Quill, Open Workspace, Sync Now, Quit.
// The tray keeps the app running after the window is closed.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

/// Build the system tray icon and attach it to the app.
pub fn setup_tray(app: &AppHandle) -> Result<(), String> {
    let show_item = MenuItem::with_id(app, "show", "Show Quill", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let hide_item = MenuItem::with_id(app, "hide", "Hide Quill", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let workspace_item = MenuItem::with_id(app, "workspace", "Open Workspace", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let sync_item = MenuItem::with_id(app, "sync", "Sync Now", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)
        .map_err(|e| e.to_string())?;

    let menu = Menu::with_items(
        app,
        &[&show_item, &hide_item, &workspace_item, &sync_item, &quit_item],
    )
    .map_err(|e| e.to_string())?;

    let _tray = TrayIconBuilder::with_id("quill-tray")
        .tooltip("Quill Desktop")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            "hide" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }
            "workspace" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                    let _ = win.emit("tray-open-workspace", ());
                }
            }
            "sync" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.emit("tray-sync-now", ());
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window("main") {
                    if win.is_visible().unwrap_or(false) {
                        let _ = win.hide();
                    } else {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;

    Ok(())
}

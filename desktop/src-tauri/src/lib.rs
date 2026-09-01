// lib.rs — Tauri builder + command registration + tray setup.

mod fs_bridge;
mod gateway;
mod sync_bridge;
mod system_bridge;
mod tray;

use std::sync::Mutex;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Single-instance: prevent multiple Quill desktop instances from running.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .manage(Mutex::new(gateway::GatewayProcess {
            child: None,
            port: 8200,
            auth_disabled: true,
        }))
        .invoke_handler(tauri::generate_handler![
            // Filesystem bridge
            fs_bridge::pick_folder_blocking,
            fs_bridge::validate_path,
            fs_bridge::list_tree,
            fs_bridge::open_in_manager,
            fs_bridge::read_file_text,
            fs_bridge::write_file_text,
            fs_bridge::rename_path,
            fs_bridge::delete_path,
            fs_bridge::create_directory,
            fs_bridge::get_file_info,
            fs_bridge::search_files,
            // System bridge
            system_bridge::get_clipboard_text,
            system_bridge::set_clipboard_text,
            system_bridge::get_clipboard_image_base64,
            system_bridge::show_notification,
            system_bridge::read_system_info,
            system_bridge::set_window_always_on_top,
            system_bridge::minimize_window,
            system_bridge::toggle_maximize_window,
            system_bridge::set_window_size,
            system_bridge::center_window,
            system_bridge::hide_window,
            system_bridge::show_window,
            // Sync bridge
            sync_bridge::sync_workspace,
            sync_bridge::sync_status,
            sync_bridge::cancel_sync,
            // Gateway management
            gateway::start_gateway,
            gateway::stop_gateway,
            gateway::gateway_status,
        ])
        .on_window_event(|window, event| {
            // On close, hide to tray instead of quitting (if tray is available).
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .setup(|app| {
            // Setup system tray.
            if let Err(e) = tray::setup_tray(app.handle()) {
                eprintln!("Failed to setup tray: {}", e);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

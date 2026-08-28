// lib.rs — Tauri builder + command registration.

mod fs_bridge;
mod system_bridge;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

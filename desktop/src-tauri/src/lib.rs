// lib.rs — Tauri builder + command registration.

mod fs_bridge;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            fs_bridge::pick_folder_blocking,
            fs_bridge::validate_path,
            fs_bridge::list_tree,
            fs_bridge::open_in_manager,
            fs_bridge::read_file_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

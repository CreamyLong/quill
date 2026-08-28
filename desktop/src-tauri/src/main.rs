// Quill Desktop — Tauri 2 main entry point.
//
// Bridges the Next.js frontend to native filesystem operations:
//   • pick_folder      → native folder picker → absolute path
//   • validate_path    → check absolute path exists & is writable
//   • list_tree        → recursive directory listing (JSON)
//   • read_file_text   → read UTF-8 text for preview
//   • open_in_manager  → reveal in Finder / Explorer / Nautilus

// Prevents additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    quill_desktop_lib::run()
}

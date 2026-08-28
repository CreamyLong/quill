// system_bridge.rs — clipboard, notifications, and system-info commands.
//
// Clipboard goes through `tauri_plugin_clipboard_manager` (write/read text,
// read image as PNG bytes). Notifications go through
// `tauri_plugin_notification`, which maps to UNUserNotificationCenter on
// macOS, Windows toast notifications, and libnotify/DBus on Linux.
// System info is read via `sysinfo` and reduced to a small JSON shape.

use base64::Engine as _;
use serde::Serialize;
use sysinfo::System;
use tauri::command;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_notification::NotificationExt;

// ─────────────────────────────────────────────────────────────────────────
// Clipboard
// ─────────────────────────────────────────────────────────────────────────

/// Read text from the system clipboard. Returns null when the clipboard
/// holds no text (empty string) or the read fails.
#[command]
pub async fn get_clipboard_text(app: tauri::AppHandle) -> Result<Option<String>, String> {
    match app.clipboard().read_text() {
        Ok(text) if text.is_empty() => Ok(None),
        Ok(text) => Ok(Some(text)),
        Err(_) => Ok(None),
    }
}

/// Write text to the system clipboard.
#[command]
pub async fn set_clipboard_text(app: tauri::AppHandle, text: String) -> Result<(), String> {
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

/// Read an image from the system clipboard as base64-encoded PNG bytes.
/// Returns null when the clipboard holds no image.
#[command]
pub async fn get_clipboard_image_base64(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let img = match app.clipboard().read_image() {
        Ok(img) => img,
        Err(_) => return Ok(None),
    };
    let rgba = img.rgba().to_vec();
    let (width, height) = (img.width(), img.height());
    // Encode the raw RGBA into PNG off the async runtime — image encoding is
    // CPU-bound and the clipboard plugin hands us a plain buffer, not a future.
    let png = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let mut out = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new(std::io::Cursor::new(&mut out));
        image::ImageEncoder::write_image(
            encoder,
            &rgba,
            width,
            height,
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| e.to_string())?;
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Some(base64::engine::general_purpose::STANDARD.encode(png)))
}

// ─────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────

/// Show a system notification. `level` is informational only for now —
/// every backend renders it as a normal notification.
#[command]
pub async fn show_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
    level: Option<String>,
) -> Result<(), String> {
    let _ = level;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

// ─────────────────────────────────────────────────────────────────────────
// System info
// ─────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct SystemInfo {
    pub os_name: String,
    pub os_version: String,
    pub kernel: String,
    pub arch: String,
    pub hostname: String,
    pub total_memory_bytes: u64,
    pub used_memory_bytes: u64,
    pub available_memory_bytes: u64,
    pub cpu_count: usize,
    pub cpu_brand: String,
    pub cpu_usage_percent: f32,
}

/// Snapshot of host system info. CPU usage needs two samples to be
/// meaningful, so we take a short blocking measurement (refresh_interval).
#[command]
pub async fn read_system_info() -> Result<SystemInfo, String> {
    // sysinfo's CPU usage needs a refresh delta; run it on the blocking pool.
    tauri::async_runtime::spawn_blocking(|| {
        let mut sys = System::new();
        sys.refresh_cpu_usage();
        std::thread::sleep(std::time::Duration::from_millis(200));
        sys.refresh_cpu_usage();
        sys.refresh_memory();

        let cpus = sys.cpus();
        let cpu_brand = cpus.first().map(|c| c.brand().trim().to_string()).unwrap_or_default();
        let cpu_usage = cpus.iter().map(|c| c.cpu_usage()).sum::<f32>()
            / cpus.len().max(1) as f32;

        Ok(SystemInfo {
            os_name: System::name().unwrap_or_default(),
            os_version: System::os_version().unwrap_or_default(),
            kernel: System::kernel_version().unwrap_or_default(),
            arch: System::cpu_arch(),
            hostname: System::host_name().unwrap_or_default(),
            total_memory_bytes: sys.total_memory(),
            used_memory_bytes: sys.used_memory(),
            available_memory_bytes: sys.available_memory(),
            cpu_count: cpus.len(),
            cpu_brand,
            cpu_usage_percent: cpu_usage,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ─────────────────────────────────────────────────────────────────────────
// Window management
// ─────────────────────────────────────────────────────────────────────────

use tauri::Manager;

fn main_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())
}

/// Pin/unpin the main window above all others.
#[command]
pub async fn set_window_always_on_top(
    app: tauri::AppHandle,
    flag: bool,
) -> Result<(), String> {
    main_window(&app)?
        .set_always_on_top(flag)
        .map_err(|e| e.to_string())
}

/// Minimize the main window.
#[command]
pub async fn minimize_window(app: tauri::AppHandle) -> Result<(), String> {
    main_window(&app)?.minimize().map_err(|e| e.to_string())
}

/// Toggle between maximized and restored.
#[command]
pub async fn toggle_maximize_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = main_window(&app)?;
    if window.is_maximized().map_err(|e| e.to_string())? {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

/// Resize the main window (logical pixels; DPI is handled by tao).
#[command]
pub async fn set_window_size(
    app: tauri::AppHandle,
    width: f64,
    height: f64,
) -> Result<(), String> {
    main_window(&app)?
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| e.to_string())
}

/// Center the main window on the current monitor.
#[command]
pub async fn center_window(app: tauri::AppHandle) -> Result<(), String> {
    main_window(&app)?.center().map_err(|e| e.to_string())
}

/// Hide the main window (keeps the process running; pair with a tray icon).
#[command]
pub async fn hide_window(app: tauri::AppHandle) -> Result<(), String> {
    main_window(&app)?.hide().map_err(|e| e.to_string())
}

/// Show (and focus) the main window after a hide.
#[command]
pub async fn show_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = main_window(&app)?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

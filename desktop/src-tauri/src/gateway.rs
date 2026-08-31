// gateway.rs — auto-start the TypeScript Gateway as a child process.
//
// The desktop app manages the Gateway lifecycle: starts it on launch,
// monitors its health, and shuts it down on exit. This eliminates the
// need for users to run `make dev` manually.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;

use tauri::command;
use tauri::Manager;

/// Gateway process handle, stored in Tauri state.
pub struct GatewayProcess {
    pub child: Option<std::process::Child>,
    pub port: u16,
    pub auth_disabled: bool,
}

impl GatewayProcess {
    /// Kill the child process on drop.
    pub fn shutdown(&mut self) {
        if let Some(child) = &mut self.child {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.child = None;
    }
}

impl Drop for GatewayProcess {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Find the Gateway binary (node) and the backend entrypoint.
fn find_gateway_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    // In production, resources are bundled alongside the app.
    // In dev, we look for the backend directory relative to the project root.
    let resource_path = app.path().resource_dir().map_err(|e| e.to_string())?;
    let candidates = [
        resource_path.join("backend/dist/gateway.js"),
        resource_path.join("backend/packages/harness/dist/gateway.js"),
    ];
    for p in &candidates {
        if p.exists() {
            return Ok((PathBuf::from("node"), p.clone()));
        }
    }
    // Fallback: assume `node` is on PATH and backend is at a known location.
    Ok((
        PathBuf::from("node"),
        resource_path.join("backend/dist/gateway.js"),
    ))
}

/// Start the Gateway as a child process.
#[command]
pub async fn start_gateway(
    app: tauri::AppHandle,
    port: Option<u16>,
    auth_disabled: Option<bool>,
) -> Result<u16, String> {
    let port = port.unwrap_or(8200);
    let auth_disabled = auth_disabled.unwrap_or(true);

    // Check if already running.
    let state = app.state::<Mutex<GatewayProcess>>();
    {
        let gp = state.lock().map_err(|e| e.to_string())?;
        if gp.child.is_some() {
            return Ok(gp.port);
        }
    }

    let (node_bin, entrypoint) = find_gateway_paths(&app)?;
    if !entrypoint.exists() {
        return Err(format!(
            "Gateway entrypoint not found at: {}. Please build the backend first: cd backend && npm run build",
            entrypoint.display()
        ));
    }

    let mut cmd = std::process::Command::new(&node_bin);
    cmd.arg(&entrypoint)
        .env("SCITOPS_PORT", port.to_string())
        .env("QUILL_ENV", "desktop")
        .env("QUILL_CONFIG_PATH", "config.yaml")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if auth_disabled {
        cmd.env("QUILL_AUTH_DISABLED", "1");
    }

    let child = cmd.spawn().map_err(|e| format!("Failed to start gateway: {}", e))?;

    {
        let mut gp = state.lock().map_err(|e| e.to_string())?;
        gp.child = Some(child);
        gp.port = port;
        gp.auth_disabled = auth_disabled;
    }

    // Spawn a background task to log gateway output.
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = app_clone;
        // In a real implementation, we'd pipe stdout/stderr to a log file.
    });

    Ok(port)
}

/// Stop the Gateway child process.
#[command]
pub async fn stop_gateway(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Mutex<GatewayProcess>>();
    let mut gp = state.lock().map_err(|e| e.to_string())?;
    gp.shutdown();
    Ok(())
}

/// Check if the Gateway is currently running.
#[command]
pub async fn gateway_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let state = app.state::<Mutex<GatewayProcess>>();
    let gp = state.lock().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "running": gp.child.is_some(),
        "port": gp.port,
        "auth_disabled": gp.auth_disabled,
    }))
}

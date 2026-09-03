// gateway.rs — auto-start the TypeScript Gateway as a child process.
//
// The desktop app manages the Gateway lifecycle: starts it on launch,
// monitors its health, and shuts it down on exit. This eliminates the
// need for users to run `make dev` manually.
//
// The Gateway is launched via its launcher script (backend/scripts/gateway_server.mjs),
// NOT the compiled server/gateway.js directly — the launcher wires up the agent
// graph, model catalogue, checkpointer, and store before handing off to the server.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;

use tauri::command;
use tauri::Manager;

/// Gateway process handle, stored in Tauri state.
pub struct GatewayProcess {
    pub child: Option<std::process::Child>,
    pub port: u16,
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

/// Find the Gateway launcher script (gateway_server.mjs) and the node binary.
///
/// The launcher script is the real entrypoint — it assembles the agent graph,
/// model catalogue, checkpointer and store, then starts the HTTP server.
/// `dist/gateway.js` alone is NOT runnable.
fn find_gateway_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    // The launcher script lives at the repo root: backend/scripts/gateway_server.mjs.
    // In production it is bundled as a Tauri resource; in dev we resolve it
    // relative to the manifest dir (CARGO_MANIFEST_DIR = .../desktop/src-tauri).
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
    let dev_repo_root = PathBuf::from(&manifest_dir).join("../..");

    let candidates = [
        // Production: bundled resource path.
        app.path()
            .resource_dir()
            .ok()
            .map(|r| r.join("backend/scripts/gateway_server.mjs")),
        // Dev: repo root / backend/scripts/gateway_server.mjs.
        Some(dev_repo_root.join("backend/scripts/gateway_server.mjs")),
    ];

    for c in candidates.iter().flatten() {
        if c.exists() {
            return Ok((PathBuf::from("node"), c.clone()));
        }
    }

    Err(format!(
        "Gateway launcher not found. Searched: {}. Build the backend (cd backend && npm run build) and ensure backend/scripts/gateway_server.mjs exists.",
        dev_repo_root.join("backend/scripts/gateway_server.mjs").display()
    ))
}

/// Start the Gateway as a child process.
#[command]
pub async fn start_gateway(
    app: tauri::AppHandle,
    port: Option<u16>,
) -> Result<u16, String> {
    let port = port.unwrap_or(8200);

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
            "Gateway launcher not found at: {}. Build the backend first: cd backend && npm run build",
            entrypoint.display()
        ));
    }

    // Resolve an absolute config path so the Gateway reads the repo-root config.yaml
    // regardless of the child process's working directory.
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
    let config_path = PathBuf::from(&manifest_dir)
        .join("../../config.yaml")
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from("config.yaml"));

    let mut cmd = std::process::Command::new(&node_bin);
    cmd.arg(&entrypoint)
        .env("QUILL_PORT", port.to_string())
        .env("QUILL_ENV", "desktop")
        .env("QUILL_CONFIG_PATH", config_path.to_string_lossy().as_ref())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to start gateway: {}", e))?;

    // CRITICAL: drain stdout/stderr on background threads. If we pipe but never
    // read, the OS pipe buffer (~64KB) fills up and the child blocks forever
    // on its next write, hanging the Gateway.
    let stdout = child.stdout.take().expect("stdout was piped");
    let stderr = child.stderr.take().expect("stderr was piped");
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            println!("[gateway] {line}");
        }
    });
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            eprintln!("[gateway-err] {line}");
        }
    });

    {
        let mut gp = state.lock().map_err(|e| e.to_string())?;
        gp.child = Some(child);
        gp.port = port;
    }

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
    }))
}

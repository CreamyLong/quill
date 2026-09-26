// gateway.rs — auto-start the TypeScript Gateway + Next.js frontend server
// as child processes.
//
// The desktop app manages the full local stack: it starts the Gateway
// (port 8200) and the Next standalone server (port 3100), waits for both to
// answer HTTP, then navigates the window to the frontend. This makes the
// packaged app self-contained ("out of the box") — no `make dev` needed.
//
// Production layout (bundled by prepare-bundle.mjs as Tauri resources):
//   Resources/bundles/backend-bundle/{scripts/,dist/,node_modules/,package.json}
//   Resources/bundles/frontend-bundle/{server.js,.quill-dist/static/,public/}
//   Resources/bundles/config.example.yaml
//
// Dev layout falls back to the repo checkout via CARGO_MANIFEST_DIR.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;

use tauri::command;
use tauri::Manager;

pub const GATEWAY_PORT: u16 = 8200;
pub const FRONTEND_PORT: u16 = 3100;

/// Child process handles, stored in Tauri state.
pub struct GatewayProcess {
    pub gateway: Option<std::process::Child>,
    pub frontend: Option<std::process::Child>,
    pub port: u16,
    pub frontend_port: u16,
    pub last_error: Option<String>,
}

impl GatewayProcess {
    pub fn shutdown(&mut self) {
        if let Some(child) = &mut self.gateway {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(child) = &mut self.frontend {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.gateway = None;
        self.frontend = None;
    }
}

impl Drop for GatewayProcess {
    fn drop(&mut self) {
        self.shutdown();
    }
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/// Where the bundled backend lives (production: Tauri resources).
fn backend_bundle_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
    let candidates = [
        // Production: bundled resource.
        app.path().resource_dir().ok().map(|r| r.join("bundles").join("backend-bundle")),
        // Dev: repo checkout (desktop/src-tauri/../.. = repo root).
        Some(PathBuf::from(&manifest_dir).join("../../backend")),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|p| p.join("scripts/gateway_server.mjs").exists())
}

/// Where the bundled frontend server lives (production: Tauri resources).
fn frontend_bundle_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
    let candidates = [
        // Production: bundled resource.
        app.path().resource_dir().ok().map(|r| r.join("bundles").join("frontend-bundle")),
        // Dev: Next standalone output from a prepare-bundle run.
        Some(PathBuf::from(&manifest_dir).join("../../frontend/.quill-dist/standalone")),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|p| p.join("server.js").exists())
}

/// Resolve the config the gateway should read. First run copies the bundled
/// config.example.yaml into the app data dir; afterwards the user's copy is
/// used directly. In dev, the repo-root config.yaml wins when present.
fn resolve_config(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
    let dev_config = PathBuf::from(&manifest_dir).join("../../config.yaml");
    if dev_config.exists() {
        return dev_config.canonicalize().map_err(|e| e.to_string());
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {e}"))?;
    let user_config = data_dir.join("config.yaml");
    if user_config.exists() {
        return Ok(user_config);
    }

    // First run: seed the user config from the bundled example.
    let example = app
        .path()
        .resource_dir()
        .ok()
        .map(|r| r.join("bundles").join("config.example.yaml"))
        .filter(|p| p.exists())
        .or_else(|| {
            let dev_example = PathBuf::from(&manifest_dir).join("../../config.example.yaml");
            dev_example.exists().then_some(dev_example)
        })
        .ok_or_else(|| "config.example.yaml not found in bundle".to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    std::fs::copy(&example, &user_config).map_err(|e| format!("failed to seed config: {e}"))?;
    Ok(user_config)
}

// ---------------------------------------------------------------------------
// Health probing
// ---------------------------------------------------------------------------

/// True when something on the port answers HTTP (any status code).
fn port_answers_http(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{port}/health");
    let output = std::process::Command::new("curl")
        .args(["-s", "-o", "/dev/null", "-m", "2", "--noproxy", "*", "-w", "%{http_code}", &url])
        .output();
    match output {
        Ok(out) => {
            let code = String::from_utf8_lossy(&out.stdout);
            let code = code.trim();
            !code.is_empty() && code != "000"
        }
        Err(_) => false,
    }
}

/// Wait until the port answers HTTP (up to `timeout_secs`).
fn wait_healthy(port: u16, timeout_secs: u32) -> bool {
    for _ in 0..timeout_secs {
        if port_answers_http(port) {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
    false
}

/// Locate a usable `node` binary; Err carries a user-facing message.
///
/// GUI apps on macOS inherit launchd's minimal PATH (/usr/bin:/bin:…), which
/// excludes Homebrew/Volta/etc., so probe well-known install locations too.
fn find_node() -> Result<String, String> {
    let probe = |bin: &str| {
        std::process::Command::new(bin)
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };
    if probe("node") {
        return Ok("node".to_string());
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        "/opt/homebrew/bin/node".to_string(),                 // Homebrew (Apple Silicon)
        "/usr/local/bin/node".to_string(),                    // Homebrew (Intel) / manual
        format!("{home}/.volta/bin/node"),                    // Volta
        format!("{home}/.local/bin/node"),                    // manual user install
        format!("{home}/.nvm/versions/node/current/bin/node"), // nvm "current" symlink
        format!("{home}/.fnm/node-versions/current/bin/node"), // fnm
    ];
    for bin in candidates {
        if !bin.is_empty() && probe(&bin) {
            return Ok(bin);
        }
    }
    Err(
        "Node.js (18 or newer) is required to run Quill Desktop, but `node` was not found. \
         Install it from https://nodejs.org (or via Homebrew: `brew install node`) and restart Quill."
            .to_string(),
    )
}

/// PATH entries to prepend for child processes so the gateway can find
/// shells/tools even when launched from the GUI environment.
fn extended_path(node_bin: &str) -> String {
    let mut dirs: Vec<String> = vec![];
    if let Some(dir) = Path::new(node_bin).parent() {
        dirs.push(dir.to_string_lossy().into_owned());
    }
    dirs.push("/opt/homebrew/bin".into());
    dirs.push("/usr/local/bin".into());
    if let Ok(home) = std::env::var("HOME") {
        dirs.push(format!("{home}/.local/bin"));
    }
    let existing = std::env::var("PATH").unwrap_or_default();
    dirs.retain(|d| !d.is_empty());
    dirs.push(existing);
    // Windows uses ';' as the PATH separator; everything else uses ':'.
    let sep = if cfg!(windows) { ";" } else { ":" };
    dirs.join(sep)
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

fn spawn_with_drain(
    node_bin: &str,
    entrypoint: &Path,
    envs: Vec<(String, String)>,
    log_name: &str,
    log_dir: Option<&Path>,
) -> Result<std::process::Child, String> {
    let mut cmd = std::process::Command::new(node_bin);
    cmd.arg(entrypoint);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    // GUI apps inherit a minimal PATH; extend it so children find node/tools.
    cmd.env("PATH", extended_path(node_bin));
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to start {}: {}", entrypoint.display(), e))?;

    // Log file — the only visibility into children when launched from the
    // GUI (stdout/stderr of GUI apps go nowhere).
    let log_file = log_dir.map(|d| {
        let _ = std::fs::create_dir_all(d);
        d.join(log_name)
    });

    // CRITICAL: drain stdout/stderr on background threads. If we pipe but never
    // read, the OS pipe buffer (~64KB) fills up and the child blocks forever.
    if let Some(stdout) = child.stdout.take() {
        let log_file = log_file.clone();
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader, Write};
            let mut sink: Option<std::fs::File> = log_file.and_then(|p| std::fs::OpenOptions::new().create(true).append(true).open(p).ok());
            for line in BufReader::new(stdout).lines().flatten() {
                println!("[server] {line}");
                if let Some(f) = sink.as_mut() {
                    let _ = writeln!(f, "{line}");
                }
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let log_file = log_file.clone();
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader, Write};
            let mut sink: Option<std::fs::File> = log_file.and_then(|p| std::fs::OpenOptions::new().create(true).append(true).open(p).ok());
            for line in BufReader::new(stderr).lines().flatten() {
                eprintln!("[server-err] {line}");
                if let Some(f) = sink.as_mut() {
                    let _ = writeln!(f, "[stderr] {line}");
                }
            }
        });
    }
    Ok(child)
}

/// Start the Gateway and the frontend server (idempotent). Returns the
/// frontend origin the window should navigate to.
#[command]
pub async fn start_gateway(app: tauri::AppHandle, port: Option<u16>) -> Result<u16, String> {
    let gateway_port = port.unwrap_or(GATEWAY_PORT);
    let state = app.state::<Mutex<GatewayProcess>>();

    {
        let gp = state.lock().map_err(|e| e.to_string())?;
        if gp.gateway.is_some() || gp.frontend.is_some() {
            return Ok(gp.frontend_port);
        }
    }

    let node_bin = find_node()?;

    // ---- Gateway ----------------------------------------------------------
    let backend_dir = backend_bundle_dir(&app).ok_or_else(|| {
        "Gateway bundle not found. In dev, run `cd backend && npm run build`; \
         in production the bundle ships inside the app."
            .to_string()
    })?;
    let entrypoint = backend_dir.join("scripts/gateway_server.mjs");
    let config_path = resolve_config(&app)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {e}"))?;
    let log_dir = app_data.join("logs");

    let mut gateway_child: Option<std::process::Child> = None;
    if port_answers_http(gateway_port) {
        // A healthy server already owns the port (e.g. a gateway from a
        // previous launch) — reuse it instead of failing to bind.
        println!("[gateway] port {gateway_port} already answers; reusing");
    } else {
        gateway_child = Some(spawn_with_drain(
            &node_bin,
            &entrypoint,
            vec![
                ("QUILL_PORT".into(), gateway_port.to_string()),
                ("QUILL_ENV".into(), "desktop".into()),
                ("QUILL_CONFIG_PATH".into(), config_path.to_string_lossy().into_owned()),
                ("QUILL_PROJECT_ROOT".into(), app_data.to_string_lossy().into_owned()),
            ],
            "gateway.log",
            Some(&log_dir),
        )?);
        if !wait_healthy(gateway_port, 60) {
            if let Some(mut child) = gateway_child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            let msg = "Gateway did not become healthy within 60s".to_string();
            {
                let mut gp = state.lock().map_err(|e| e.to_string())?;
                gp.last_error = Some(msg.clone());
            }
            return Err(msg);
        }
    }

    // ---- Frontend ---------------------------------------------------------
    let frontend_dir = frontend_bundle_dir(&app).ok_or_else(|| {
        "Frontend bundle not found. Run `node desktop/scripts/prepare-bundle.mjs` \
         (or `pnpm tauri build`, which runs it automatically)."
            .to_string()
    })?;
    let frontend_entry = frontend_dir.join("server.js");

    let mut frontend_child: Option<std::process::Child> = None;
    if port_answers_http(FRONTEND_PORT) {
        println!("[frontend] port {FRONTEND_PORT} already answers; reusing");
    } else {
        frontend_child = Some(spawn_with_drain(
            &node_bin,
            &frontend_entry,
            vec![
                ("PORT".into(), FRONTEND_PORT.to_string()),
                ("HOSTNAME".into(), "127.0.0.1".into()),
            ],
            "frontend.log",
            Some(&log_dir),
        )?);
        if !wait_healthy(FRONTEND_PORT, 60) {
            if let Some(mut child) = frontend_child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            let msg = "Frontend server did not become healthy within 60s".to_string();
            {
                let mut gp = state.lock().map_err(|e| e.to_string())?;
                gp.last_error = Some(msg.clone());
            }
            return Err(msg);
        }
    }

    {
        let mut gp = state.lock().map_err(|e| e.to_string())?;
        gp.gateway = gateway_child;
        gp.frontend = frontend_child;
        gp.port = gateway_port;
        gp.frontend_port = FRONTEND_PORT;
        gp.last_error = None;
    }

    // ---- Navigate the window to the local frontend ------------------------
    if let Some(win) = app.get_webview_window("main") {
        let url = format!("http://127.0.0.1:{FRONTEND_PORT}/");
        let _ = win.eval(&format!("window.location.replace('{url}')"));
    }

    Ok(FRONTEND_PORT)
}

/// Stop both child processes.
#[command]
pub async fn stop_gateway(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Mutex<GatewayProcess>>();
    let mut gp = state.lock().map_err(|e| e.to_string())?;
    gp.shutdown();
    Ok(())
}

/// Status of both local servers.
#[command]
pub async fn gateway_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let state = app.state::<Mutex<GatewayProcess>>();
    let gp = state.lock().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "running": gp.gateway.is_some() || gp.frontend.is_some(),
        "gateway_port": gp.port,
        "frontend_port": gp.frontend_port,
        "frontend_origin": format!("http://127.0.0.1:{}/", gp.frontend_port),
        "last_error": gp.last_error,
    }))
}

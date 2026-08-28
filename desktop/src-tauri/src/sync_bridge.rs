// sync_bridge.rs — workspace sync engine (local ⇄ Gateway).
//
// Mirrors OpenWork's desktop-cloud-sync surface at the protocol level:
// the desktop walks a workspace, diffs a manifest against the server, and
// uploads only the changed files, emitting progress events the UI can
// subscribe to (`sync-progress` / `sync-done`).
//
// Protocol (Gateway REST):
//   POST {gateway_url}/api/desktop/sync/manifest
//        body: { files: [{ path, size, modified }] }
//        resp: { changed: [path, ...] }
//   POST {gateway_url}/api/desktop/sync/file
//        multipart: file=<bytes>, path=<relpath>
//        resp: { ok: true }
//
// One sync runs at a time (global in-flight state); `cancel_sync` flips an
// atomic flag the upload loop checks between files.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{command, Emitter};
use walkdir::WalkDir;

// ─────────────────────────────────────────────────────────────────────────
// Wire types
// ─────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ManifestEntry {
    pub path: String,
    pub size: u64,
    pub modified: u64,
}

#[derive(Debug, Serialize)]
struct ManifestRequest<'a> {
    files: &'a [ManifestEntry],
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ManifestResponse {
    changed: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncPhase {
    Idle,
    Scanning,
    Diffing,
    Uploading,
    Done,
    Failed,
    Cancelled,
}

/// Serializable snapshot of the sync state for `sync_status` and events.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub phase: SyncPhase,
    pub total_files: usize,
    pub changed_files: usize,
    pub uploaded_files: usize,
    pub current_path: Option<String>,
    pub error: Option<String>,
}

impl SyncStatus {
    fn idle() -> Self {
        Self {
            phase: SyncPhase::Idle,
            total_files: 0,
            changed_files: 0,
            uploaded_files: 0,
            current_path: None,
            error: None,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Global in-flight state
// ─────────────────────────────────────────────────────────────────────────

static SYNC_STATE: Mutex<Option<SyncStatus>> = Mutex::new(None);
static CANCEL_FLAG: AtomicBool = AtomicBool::new(false);

fn set_status(status: SyncStatus) {
    if let Ok(mut guard) = SYNC_STATE.lock() {
        *guard = Some(status);
    }
}

fn cancelled() -> bool {
    CANCEL_FLAG.load(Ordering::Relaxed)
}

// Deserialize helper used by ManifestResponse.
use serde::Deserialize;

// ─────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────

/// Kick off an incremental sync of the local workspace to the Gateway.
/// Emits `sync-progress` (SyncStatus) after each stage and `sync-done`
/// (SyncStatus) with the terminal state.
#[command]
pub async fn sync_workspace(
    app: tauri::AppHandle,
    local_path: String,
    gateway_url: String,
    token: Option<String>,
) -> Result<(), String> {
    let root = PathBuf::from(&local_path);
    if !root.is_dir() {
        return Err(format!("Workspace is not a directory: {local_path}"));
    }
    let gateway_url = gateway_url.trim_end_matches('/').to_string();

    // Single in-flight sync: refuse concurrent runs rather than queueing,
    // so the UI never shows two interleaved progress streams.
    {
        let guard = SYNC_STATE.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Err("A sync is already in progress".to_string());
        }
    }
    CANCEL_FLAG.store(false, Ordering::Relaxed);

    // ── Phase 1: scan ──────────────────────────────────────────────────
    let mut status = SyncStatus {
        phase: SyncPhase::Scanning,
        ..SyncStatus::idle()
    };
    let _ = app.emit("sync-progress", status.clone());
    set_status(status.clone());

    let files = tokio::task::spawn_blocking(move || -> Result<Vec<ManifestEntry>, String> {
        scan_workspace(&root)
    })
    .await
    .map_err(|e| e.to_string())??;
    status.total_files = files.len();
    let _ = app.emit("sync-progress", status.clone());
    set_status(status.clone());

    // ── Phase 2: diff against the server manifest ─────────────────────
    status.phase = SyncPhase::Diffing;
    let _ = app.emit("sync-progress", status.clone());
    set_status(status.clone());

    let client = reqwest::Client::new();
    let mut req = client
        .post(format!("{gateway_url}/api/desktop/sync/manifest"))
        .json(&ManifestRequest { files: &files });
    if let Some(token) = token.as_deref() {
        req = req.bearer_auth(token);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("manifest request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "manifest endpoint returned {}: is the Gateway desktop-sync router enabled?",
            resp.status()
        ));
    }
    let body: ManifestResponse = resp
        .json()
        .await
        .map_err(|e| format!("invalid manifest response: {e}"))?;
    let changed_set: std::collections::HashSet<String> = body.changed.into_iter().collect();

    let changed: Vec<&ManifestEntry> = files
        .iter()
        .filter(|f| changed_set.contains(&f.path))
        .collect();
    status.changed_files = changed.len();
    status.phase = SyncPhase::Uploading;
    let _ = app.emit("sync-progress", status.clone());
    set_status(status.clone());

    // ── Phase 3: upload changed files ─────────────────────────────────
    for entry in changed {
        if cancelled() {
            status.phase = SyncPhase::Cancelled;
            status.current_path = None;
            let _ = app.emit("sync-done", status.clone());
            set_status(status);
            return Ok(());
        }
        status.current_path = Some(entry.path.clone());
        let _ = app.emit("sync-progress", status.clone());
        set_status(status.clone());

        let abs_path = PathBuf::from(&local_path).join(&entry.path);
        let file_bytes = tokio::fs::read(&abs_path)
            .await
            .map_err(|e| format!("read {}: {e}", entry.path))?;
        let part = reqwest::multipart::Part::bytes(file_bytes)
            .file_name(entry.path.rsplit('/').next().unwrap_or("file").to_string());
        let form = reqwest::multipart::Form::new()
            .text("path", entry.path.clone())
            .part("file", part);

        let mut req = client
            .post(format!("{gateway_url}/api/desktop/sync/file"))
            .multipart(form);
        if let Some(token) = token.as_deref() {
            req = req.bearer_auth(token);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| format!("upload {}: {e}", entry.path))?;
        if !resp.status().is_success() {
            let code = resp.status();
            let detail = resp.text().await.unwrap_or_default();
            let msg = format!("upload {} failed: {} {}", entry.path, code, detail);
            status.phase = SyncPhase::Failed;
            status.error = Some(msg.clone());
            status.current_path = None;
            let _ = app.emit("sync-done", status.clone());
            set_status(status);
            return Err(msg);
        }
        status.uploaded_files += 1;
    }

    // ── Phase 4: done ─────────────────────────────────────────────────
    status.phase = SyncPhase::Done;
    status.current_path = None;
    let _ = app.emit("sync-done", status.clone());
    set_status(status);
    Ok(())
}

/// Snapshot of the current sync state (idle when nothing has run yet).
#[command]
pub async fn sync_status() -> Result<SyncStatus, String> {
    match SYNC_STATE.lock().map_err(|e| e.to_string())?.clone() {
        Some(status) => Ok(status),
        None => Ok(SyncStatus::idle()),
    }
}

/// Request cancellation of the in-flight sync. The upload loop checks this
/// between files; already-uploaded files are kept server-side.
#[command]
pub async fn cancel_sync() -> Result<(), String> {
    CANCEL_FLAG.store(true, Ordering::Relaxed);
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/// Walk the workspace and build the sync manifest (skips VCS/build noise).
fn scan_workspace(root: &Path) -> Result<Vec<ManifestEntry>, String> {
    // WalkDir silently yields a single entry for a file root instead of an
    // error — reject it here so callers can't sync a lone file as a workspace.
    if !root.is_dir() {
        return Err(format!("Workspace is not a directory: {}", root.display()));
    }
    let mut files: Vec<ManifestEntry> = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| !should_ignore_sync(e.path()))
    {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().is_file() {
            continue;
        }
        let abs = entry.path();
        let rel = abs
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if rel.is_empty() {
            continue;
        }
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        files.push(ManifestEntry {
            path: rel,
            size: meta.len(),
            modified,
        });
    }
    Ok(files)
}

fn should_ignore_sync(p: &Path) -> bool {
    p.file_name()
        .map(|n| {
            matches!(
                n.to_str(),
                Some(
                    ".git" | ".svn" | ".hg" | "node_modules" | "__pycache__" | ".next"
                        | "target" | ".venv" | ".DS_Store" | ".scitops"
                )
            )
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_workspace_skips_noise_and_uses_forward_slashes() {
        let root = std::env::temp_dir().join(format!("quill_sync_scan_{}", std::process::id()));
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::create_dir_all(root.join("src/nested")).unwrap();
        std::fs::write(root.join("top.txt"), "a").unwrap();
        std::fs::write(root.join("src/nested/deep.rs"), "b").unwrap();
        std::fs::write(root.join("node_modules/pkg/junk.js"), "c").unwrap();

        let files = scan_workspace(&root).expect("scan should succeed");
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert!(paths.contains(&"top.txt"));
        assert!(paths.contains(&"src/nested/deep.rs"), "relative paths use forward slashes");
        assert!(!paths.iter().any(|p| p.contains("node_modules")), "build noise skipped");

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn scan_workspace_rejects_file_root() {
        let file = std::env::temp_dir().join(format!("quill_sync_notdir_{}", std::process::id()));
        std::fs::write(&file, "x").unwrap();
        assert!(scan_workspace(&file).is_err());
        std::fs::remove_file(&file).ok();
    }
}

// Keep HashMap in scope for future manifest caching (path → last synced mtime).
#[allow(dead_code)]
type ManifestCache = HashMap<String, u64>;

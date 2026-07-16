// fs_bridge.rs — native filesystem commands exposed to the WebView frontend.
//
// Tauri 2.7 API: `tauri_plugin_dialog::DialogExt::file()` on an AppHandle or
// Window returns a `FileDialogBuilder`. `.blocking_pick_folder()` returns
// `Option<PathBuf>`.

use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use serde::Serialize;
use tauri::command;

// ─────────────────────────────────────────────────────────────────────────
// Response types
// ─────────────────────────────────────────────────────────────────────────

const MAX_DEPTH: usize = 6;
const MAX_ENTRIES: usize = 2000;

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum FsNode {
    File {
        name: String,
        path: String,
        size: u64,
        modified: Option<u64>,
    },
    Directory {
        name: String,
        path: String,
        children: Vec<FsNode>,
    },
}

#[derive(Debug, Serialize)]
pub struct PickFolderResult {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct ValidateResult {
    pub valid: bool,
    pub absolute_path: Option<String>,
    pub is_dir: bool,
    pub readable: bool,
    pub writable: bool,
    pub error: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────

/// Open the **native** folder-picker dialog → absolute path.
#[command]
pub fn pick_folder_blocking(
    app: tauri::AppHandle,
) -> Result<Option<PickFolderResult>, String> {
    use tauri_plugin_dialog::DialogExt;

    let maybe = app
        .dialog()
        .file()
        .set_title("Select Workspace Folder")
        .blocking_pick_folder();
    Ok(maybe.map(|p| {
        // tauri_plugin_dialog 2.7 returns FilePath; convert to string.
        let abs = p.to_string().to_string();
        let name = Path::new(&abs)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        PickFolderResult { path: abs, name }
    }))
}

/// Validate an absolute path on the host filesystem.
#[command]
pub async fn validate_path(input_path: String) -> ValidateResult {
    let p = Path::new(&input_path);
    if !p.is_absolute() {
        return ValidateResult {
            valid: false,
            absolute_path: Some(input_path),
            is_dir: false,
            readable: false,
            writable: false,
            error: Some("Path must be absolute".to_string()),
        };
    }
    let canon = p.canonicalize().ok();
    let resolved = canon.as_deref().unwrap_or(p);
    let readable = fs::metadata(resolved).is_ok();
    let writable = probe_writable(resolved);
    ValidateResult {
        valid: resolved.is_dir() || resolved.is_file(),
        absolute_path: Some(resolved.to_string_lossy().to_string()),
        is_dir: resolved.is_dir(),
        readable,
        writable,
        error: None,
    }
}

/// Recursively list the directory tree.
#[command]
pub async fn list_tree(root_path: String) -> Result<FsNode, String> {
    let root = PathBuf::from(&root_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {root_path}"));
    }
    walk_dir(&root, 0).map_err(|e| e.to_string())
}

/// Reveal a path in the OS file manager.
#[command]
pub async fn open_in_manager(path: String) -> Result<(), String> {
    open::that(path).map_err(|e| e.to_string())
}

/// Read a text file for in-app preview.
#[command]
pub async fn read_file_text(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

fn walk_dir(root: &Path, depth: usize) -> anyhow::Result<FsNode> {
    let mut entries: Vec<_> = fs::read_dir(root)
        .map_err(|e| anyhow::anyhow!("read_dir {root:?}: {e}"))?
        .collect();
    entries.sort_by_key(|e| e.as_ref().map(|d| d.file_name()).unwrap_or_default());
    let mut children: Vec<FsNode> = Vec::new();
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if should_ignore(&path) {
            continue;
        }
        let meta = entry.metadata()?;
        let name = entry.file_name().to_string_lossy().to_string();
        let rel = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().to_string();
        if meta.is_dir() {
            if depth < MAX_DEPTH {
                children.push(walk_dir(&path, depth + 1)?);
            }
        } else if children.len() < MAX_ENTRIES {
            children.push(FsNode::File {
                name,
                path: rel,
                size: meta.len(),
                modified: meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs()),
            });
        }
    }
    Ok(FsNode::Directory {
        name: root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        path: "".to_string(),
        children,
    })
}

fn should_ignore(p: &Path) -> bool {
    p.file_name()
        .map(|n| {
            matches!(
                n.to_str(),
                Some(".git" | ".svn" | ".hg" | "node_modules" | "__pycache__" | ".next" | "target" | ".venv" | ".DS_Store")
            )
        })
        .unwrap_or(false)
}

fn probe_writable(path: &Path) -> bool {
    let probe = path.join(".scitops_write_probe_tmp");
    match fs::File::create(&probe) {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

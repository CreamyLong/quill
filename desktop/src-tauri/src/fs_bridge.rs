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
const MAX_SEARCH_RESULTS: usize = 500;

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

/// File metadata returned by `get_file_info`.
#[derive(Debug, Serialize)]
pub struct FileInfo {
    pub exists: bool,
    pub is_dir: bool,
    pub is_file: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: Option<u64>,
    pub created: Option<u64>,
    pub readonly: bool,
    pub absolute_path: String,
    pub extension: Option<String>,
}

/// Search result entry for `search_files`.
#[derive(Debug, Serialize)]
pub struct SearchHit {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
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

/// Write UTF-8 text to a file. Creates parent directories when missing.
#[command]
pub async fn write_file_text(path: String, content: String, append: Option<bool>) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    if append.unwrap_or(false) {
        use std::io::Write;
        let mut f = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&p)
            .map_err(|e| e.to_string())?;
        f.write_all(content.as_bytes()).map_err(|e| e.to_string())
    } else {
        fs::write(&p, content).map_err(|e| e.to_string())
    }
}

/// Rename (move) a file or directory.
#[command]
pub async fn rename_path(from: String, to: String) -> Result<(), String> {
    let src = PathBuf::from(&from);
    if !src.exists() {
        return Err(format!("Source does not exist: {from}"));
    }
    let dst = PathBuf::from(&to);
    // Refuse to overwrite an existing destination — the caller decides how to
    // handle collisions instead of the shell silently clobbering data.
    if dst.exists() {
        return Err(format!("Destination already exists: {to}"));
    }
    if let Some(parent) = dst.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::rename(&src, &dst).map_err(|e| e.to_string())
}

/// Delete a file or a directory (recursively for directories).
#[command]
pub async fn delete_path(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {path}"));
    }
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&p).map_err(|e| e.to_string())
    }
}

/// Create a directory, including any missing parent directories.
#[command]
pub async fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// Read metadata for a file or directory.
#[command]
pub async fn get_file_info(path: String) -> FileInfo {
    let p = PathBuf::from(&path);
    let resolved = p.canonicalize().unwrap_or_else(|_| p.clone());
    let abs = resolved.to_string_lossy().to_string();
    match fs::symlink_metadata(&resolved) {
        Ok(meta) => {
            let file_type = meta.file_type();
            let file_meta = if file_type.is_symlink() {
                fs::metadata(&resolved).ok()
            } else {
                Some(meta.clone())
            };
            let file_meta = file_meta.unwrap_or(meta);
            FileInfo {
                exists: true,
                is_dir: file_meta.is_dir(),
                is_file: file_meta.is_file(),
                is_symlink: file_type.is_symlink(),
                size: file_meta.len(),
                modified: unix_secs(file_meta.modified().ok()),
                created: unix_secs(file_meta.created().ok()),
                readonly: file_meta.permissions().readonly(),
                absolute_path: abs,
                extension: resolved
                    .extension()
                    .map(|e| e.to_string_lossy().to_string()),
            }
        }
        Err(_) => FileInfo {
            exists: false,
            is_dir: false,
            is_file: false,
            is_symlink: false,
            size: 0,
            modified: None,
            created: None,
            readonly: false,
            absolute_path: abs,
            extension: resolved
                .extension()
                .map(|e| e.to_string_lossy().to_string()),
        },
    }
}

/// Search files under `root` whose file name matches a glob-style pattern
/// (`*` and `?` wildcards, case-insensitive). Results are capped.
#[command]
pub async fn search_files(root: String, pattern: String) -> Result<Vec<SearchHit>, String> {
    let root = PathBuf::from(&root);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", root.display()));
    }
    if pattern.trim().is_empty() {
        return Err("Pattern must not be empty".to_string());
    }
    let needle = pattern.to_lowercase();
    let mut hits: Vec<SearchHit> = Vec::new();
    for entry in WalkDir::new(&root)
        .max_depth(MAX_DEPTH + 4)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| !should_ignore(e.path()))
    {
        if hits.len() >= MAX_SEARCH_RESULTS {
            break;
        }
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if !glob_match(&name, &needle) {
            continue;
        }
        if path == root {
            continue;
        }
        let is_dir = entry.file_type().is_dir();
        let size = if is_dir {
            0
        } else {
            entry.metadata().map(|m| m.len()).unwrap_or(0)
        };
        hits.push(SearchHit {
            path: path.to_string_lossy().to_string(),
            name: entry.file_name().to_string_lossy().to_string(),
            is_dir,
            size,
        });
    }
    Ok(hits)
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

fn unix_secs(time: Option<std::time::SystemTime>) -> Option<u64> {
    time.and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
}

/// Case-insensitive glob matching supporting `*` (any sequence) and
/// `?` (any single char). Everything else is a literal match.
fn glob_match(name: &str, pattern: &str) -> bool {
    // Iterative two-pointer glob to avoid deep recursion on `*`-heavy
    // patterns like `*a*a*a*`.
    let s: Vec<char> = name.chars().collect();
    let p: Vec<char> = pattern.chars().collect();
    let (mut si, mut pi) = (0usize, 0usize);
    let (mut star_p, mut star_s) = (usize::MAX, 0usize);
    while si < s.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == s[si]) {
            si += 1;
            pi += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star_p = pi;
            star_s = si;
            pi += 1;
        } else if star_p != usize::MAX {
            pi = star_p + 1;
            star_s += 1;
            si = star_s;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glob_matches_literal() {
        assert!(glob_match("main.rs", "main.rs"));
        assert!(!glob_match("main.rs", "lib.rs"));
    }

    #[test]
    fn glob_matches_star() {
        assert!(glob_match("main.rs", "*.rs"));
        assert!(glob_match("a.tar.gz", "*.gz"));
        assert!(glob_match("anything", "*"));
        assert!(!glob_match("main.ts", "*.rs"));
    }

    #[test]
    fn glob_matches_question_mark() {
        assert!(glob_match("a1b", "a?b"));
        assert!(!glob_match("ab", "a?b"));
    }

    #[test]
    fn glob_handles_leading_star() {
        // Leading `*` exercises the backtracking path (star_s advancement).
        assert!(glob_match("src-main.rs", "*main.rs"));
        assert!(glob_match("xaaay", "x*y"));
        assert!(glob_match("a-b-c.txt", "*-c.txt"));
        assert!(!glob_match("a-b-d.txt", "*-c.txt"));
    }

    #[test]
    fn search_files_hits_and_caps() {
        let root = std::env::temp_dir().join(format!("quill_search_test_{}", std::process::id()));
        let sub = root.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(root.join("alpha.txt"), "a").unwrap();
        std::fs::write(sub.join("alpha-beta.txt"), "b").unwrap();
        std::fs::write(sub.join("other.md"), "c").unwrap();

        let hits = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(search_files(root.to_string_lossy().to_string(), "alpha*".into()))
            .expect("search should succeed");
        let names: Vec<&str> = hits.iter().map(|h| h.name.as_str()).collect();
        assert!(names.contains(&"alpha.txt"));
        assert!(names.contains(&"alpha-beta.txt"));
        assert!(!names.contains(&"other.md"));

        // Empty pattern is rejected.
        let err = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(search_files(root.to_string_lossy().to_string(), "  ".into()));
        assert!(err.is_err());

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn get_file_info_reports_missing() {
        let info = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(get_file_info("/nonexistent/quill/test/path".into()));
        assert!(!info.exists);
    }

    #[test]
    fn file_crud_roundtrip() {
        let root = std::env::temp_dir().join(format!("quill_crud_test_{}", std::process::id()));
        let file = root.join("nested").join("note.txt");
        let rt = tokio::runtime::Runtime::new().unwrap();

        // write (auto-creates parents) → info → rename → delete
        rt.block_on(write_file_text(
            file.to_string_lossy().to_string(),
            "hello".into(),
            None,
        ))
        .expect("write should succeed");
        let info = rt.block_on(get_file_info(file.to_string_lossy().to_string()));
        assert!(info.exists && info.is_file && info.size == 5);

        let renamed = root.join("renamed.txt");
        rt.block_on(rename_path(
            file.to_string_lossy().to_string(),
            renamed.to_string_lossy().to_string(),
        ))
        .expect("rename should succeed");
        assert!(!file.exists() && renamed.exists());

        // Refuse to overwrite.
        std::fs::write(root.join("existing.txt"), "x").unwrap();
        let err = rt.block_on(rename_path(
            renamed.to_string_lossy().to_string(),
            root.join("existing.txt").to_string_lossy().to_string(),
        ));
        assert!(err.is_err(), "rename must refuse to overwrite");

        rt.block_on(delete_path(root.to_string_lossy().to_string()))
            .expect("recursive delete should succeed");
        assert!(!root.exists());
    }
}

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

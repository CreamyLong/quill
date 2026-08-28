# Quill Desktop (Tauri 2)

Desktop shell for Quill using Tauri 2 (Rust + System WebView). Replaces the
browser's restricted File System Access API with native dialogs and direct
filesystem operations on the host.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Tauri 2 Application                            │
│  ┌───────────────────────────────────────────┐  │
│  │  WebView (Next.js frontend, same codebase) │  │
│  └───────────────┬───────────────────────────┘  │
│                  │ invoke("command", args)       │
│  ┌───────────────▼───────────────────────────┐  │
│  │  Rust Backend (src-tauri/)                │  │
│  │  fs_bridge.rs      — file CRUD + search    │  │
│  │  system_bridge.rs  — clipboard/notify/win  │  │
│  │  sync_bridge.rs    — workspace sync        │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

The existing TypeScript backend (`backend/`) is still used for the agent runtime
(Gateway, LangGraph, subagents). Tauri embeds or proxies to it. The Rust layer
*only* handles filesystem operations and system integration the browser cannot.

## Command surface

### `fs_bridge.rs` — file operations
| Command | Purpose |
| --- | --- |
| `pick_folder_blocking` | Native folder picker → absolute path |
| `validate_path` | Check absolute path exists / readable / writable |
| `list_tree` | Recursive directory walk (depth 6, 2000 entries) |
| `open_in_manager` | Reveal in Finder / Explorer / Nautilus |
| `read_file_text` / `write_file_text` | UTF-8 text I/O (write auto-creates parents, supports append) |
| `rename_path` | Move/rename (refuses to overwrite destination) |
| `delete_path` | Delete file, or directory recursively |
| `create_directory` | `mkdir -p` semantics |
| `get_file_info` | Metadata: size/type/timestamps/readonly/symlink |
| `search_files` | Case-insensitive glob (`*`/`?`) walk, capped at 500 hits |

### `system_bridge.rs` — system integration
| Command | Purpose |
| --- | --- |
| `get_clipboard_text` / `set_clipboard_text` | Text clipboard |
| `get_clipboard_image_base64` | Clipboard image → base64 PNG |
| `show_notification` | System notification (UNUserNotificationCenter / Windows toast / libnotify) |
| `read_system_info` | OS, kernel, arch, memory, CPU snapshot |
| `set_window_always_on_top` / `minimize_window` / `toggle_maximize_window` | Window state |
| `set_window_size` / `center_window` | Window geometry |
| `hide_window` / `show_window` | Tray-style background operation |

### `sync_bridge.rs` — workspace sync (OpenWork desktop-cloud-sync pattern)
| Command | Purpose |
| --- | --- |
| `sync_workspace(local_path, gateway_url, token)` | Scan → manifest diff → upload changed files |
| `sync_status` | Snapshot of current sync state |
| `cancel_sync` | Cancel flag checked between uploads |

Events: `sync-progress` and `sync-done` carry a `SyncStatus` snapshot
(`phase`: `scanning → diffing → uploading → done/failed/cancelled`).
Server-side contract: `POST /api/desktop/sync/manifest` (manifest in,
changed list out) and `POST /api/desktop/sync/file` (multipart upload).

## Prerequisites

```bash
# 1. Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# 2. Tauri CLI
cargo install tauri-cli

# 3. System deps (macOS — already has Xcode CLT)
# Linux: sudo apt install libwebkit2gtk-4.1-dev build-essential \
#   curl wget file libssl-dev libayatana-appindicator3-dev librsvg2-dev
# Windows: unchanged (MSVC + WebView2 runtime)
```

## Development

```bash
cd desktop
npm install
npm run tauri dev
# First build compiles Rust (~3-5 min), subsequent are incremental.
```

## Build (production)

```bash
npm run tauri build
# Output: src-tauri/target/release/bundle/
#   macOS → .dmg / .app
#   Windows → .msi / .exe
#   Linux → .AppImage / .deb
```

## How it replaces the browser approach

| Browser (broken)                        | Tauri 2 desktop (works)                              |
| --------------------------------------- | ---------------------------------------------------- |
| `window.showDirectoryPicker()` → name only | `tauri_plugin_dialog` → **absolute path**            |
| `fetch("/api/threads/{id}/files/tree")` | `invoke("list_tree", { path })` → native Rust walk   |
| Can't open Finder/Explorer              | `invoke("open_in_manager", { path })` → `open::that` |
| Sandbox = virtual `/mnt/user-data`      | Sandbox = **real host path** (override in backend)   |

## Integration points with the existing backend

1. The TS `backend/` (Gateway + LangGraph) is bundled as a child process
   (`tauri_plugin_shell`) or reached via HTTP on `localhost:8001`.
2. The Next.js frontend is built (`next build`) and served from Tauri's
   `dist/` folder (dev: proxies to `localhost:3000`; prod: serves static files).
3. Workspace directory picked in Rust is forwarded to the Gateway via
   `configurable.workspace_directory` on every run request.

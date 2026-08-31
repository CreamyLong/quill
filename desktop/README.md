# 🪶 Quill Desktop

Desktop shell for Quill using **Tauri 2** (Rust + System WebView). Replaces the browser's restricted File System Access API with native dialogs and direct filesystem operations on the host.

<div align="center">

[English](README.md) · [中文](../../README_zh.md) · [한국어](../../README_ko.md) · [日本語](../../README_ja.md) · [Français](../../README_fr.md) · [Русский](../../README_ru.md) · [Español](../../README_es.md) · [العربية](../../README_ar.md)

</div>

---

## 📸 Features

| Feature | Description |
|---------|-------------|
| **Native File Access** | Open any folder on your host filesystem — no virtual `/mnt` sandbox |
| **System Tray** | Runs in background; quick access via tray menu |
| **Auto-Start Gateway** | Launches the TS Gateway automatically — no `make dev` needed |
| **Workspace Sync** | Incremental sync between local workspace and Gateway |
| **System Integration** | Clipboard, notifications, window management, file manager reveal |
| **Auto-Update** | Built-in updater via Tauri v2 |
| **Single Instance** | Prevents multiple Quill desktop instances |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Tauri 2 Application                                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  WebView (Next.js frontend, shared codebase)           │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  tauri-fs-client.ts   — filesystem bridge       │  │  │
│  │  │  tauri-system.ts      — clipboard/notify/window  │  │  │
│  │  │  tauri-sync.ts        — workspace sync           │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │ invoke("command", args)           │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │  Rust Backend (src-tauri/src/)                         │  │
│  │  fs_bridge.rs      — file CRUD + search (10 commands)  │  │
│  │  system_bridge.rs  — clipboard/notify/window (9 cmd)   │  │
│  │  sync_bridge.rs    — workspace sync (3 commands)       │  │
│  │  gateway.rs        — auto-start TS Gateway (3 cmd)     │  │
│  │  tray.rs           — system tray + context menu        │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
          │
          │ HTTP (localhost)
          ▼
┌─────────────────────────────────────────────────────────────┐
│  TypeScript Gateway (auto-launched child process)            │
│  Port 8200 (configurable) · LangGraph runtime               │
│  + Desktop Sync API (/api/desktop/sync/*)                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

```bash
# 1. Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# 2. Install Node.js dependencies
cd ../..
make install

# 3. Build the backend (required for desktop to launch Gateway)
cd backend && npm run build
```

### Development

```bash
# One-command desktop dev (builds frontend, starts Gateway, launches Tauri)
make desktop

# Or manually:
cd desktop
npm install
npm run tauri dev
```

The first build compiles Rust (~3-5 min), subsequent builds are incremental.

### Production Build

```bash
cd desktop
npm run tauri build

# Output: src-tauri/target/release/bundle/
#   macOS → .dmg / .app
#   Windows → .msi / .exe
#   Linux → .AppImage / .deb
```

---

## 📖 Usage

### First Launch

1. **Start Quill Desktop** — the app auto-launches the Gateway on port 8200
2. **System Tray** — Quill appears in your system tray (menu bar on macOS)
3. **Open Workspace** — click "Open Workspace" in the tray menu or sidebar
4. **Select Folder** — native folder picker lets you choose any directory on your host

### Workspace Sync

The desktop can sync your local workspace with the Gateway for backup and multi-device access:

1. **Manual Sync** — Tray menu → "Sync Now" or Settings → Sync
2. **Auto Sync** — Enable in Settings → Sync → Auto-sync interval
3. **Progress** — Sync progress appears in the status bar

Sync protocol:
```
Desktop (Rust)                          Gateway (TypeScript)
     │                                         │
     ├── POST /api/desktop/sync/manifest ─────►│  (submit file list)
     │◄── { changed: ["file1", "file2"] } ─────┤  (get changed files)
     ├── POST /api/desktop/sync/file ─────────►│  (upload file 1)
     ├── POST /api/desktop/sync/file ─────────►│  (upload file 2)
     │◄── { phase: "done" } ──────────────────┤  (sync complete)
```

### System Tray Menu

| Menu Item | Action |
|-----------|--------|
| **Show/Hide Quill** | Toggle window visibility |
| **Open Workspace** | Open workspace directory picker |
| **Sync Now** | Trigger manual workspace sync |
| **Quit** | Exit the application |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + ,` | Open Settings |
| `Cmd/Ctrl + N` | New chat |
| `Cmd/Ctrl + B` | Toggle sidebar |
| `Cmd/Ctrl + P` | Command palette |

---

## 🔧 Configuration

### Gateway Port

Override the default Gateway port (8200):

```bash
# Environment variable
QUILL_GATEWAY_PORT=9000 npm run tauri dev

# Or in tauri.conf.json
{
  "build": {
    "devUrl": "http://localhost:9000"
  }
}
```

### Auth Mode

By default, desktop mode runs with auth disabled (single-user `default` admin):

```bash
# Enable auth (requires login)
QUILL_AUTH_DISABLED=0 npm run tauri dev
```

### Sync Configuration

Edit `config.yaml`:

```yaml
desktop:
  sync:
    enabled: true
    auto_sync_interval_minutes: 30
    max_file_size_mb: 50
    blocked_patterns:
      - ".git/**"
      - "node_modules/**"
      - ".next/**"
      - "*.tmp"
```

---

## 🛠️ Command Reference

### Filesystem Bridge (`fs_bridge.rs`) — 10 commands

| Command | Purpose |
|---------|---------|
| `pick_folder_blocking` | Native folder picker → absolute path |
| `validate_path` | Check absolute path exists / readable / writable |
| `list_tree` | Recursive directory walk (depth 6, 2000 entries) |
| `open_in_manager` | Reveal in Finder / Explorer / Nautilus |
| `read_file_text` / `write_file_text` | UTF-8 text I/O (write auto-creates parents) |
| `rename_path` | Move/rename (refuses to overwrite destination) |
| `delete_path` | Delete file, or directory recursively |
| `create_directory` | `mkdir -p` semantics |
| `get_file_info` | Metadata: size/type/timestamps/readonly/symlink |
| `search_files` | Case-insensitive glob (`*`/`?`) walk, capped at 500 hits |

### System Bridge (`system_bridge.rs`) — 9 commands

| Command | Purpose |
|---------|---------|
| `get_clipboard_text` / `set_clipboard_text` | Text clipboard |
| `get_clipboard_image_base64` | Clipboard image → base64 PNG |
| `show_notification` | System notification (macOS/Windows/Linux) |
| `read_system_info` | OS, kernel, arch, memory, CPU snapshot |
| `set_window_always_on_top` / `minimize_window` / `toggle_maximize_window` | Window state |
| `set_window_size` / `center_window` | Window geometry |
| `hide_window` / `show_window` | Tray-style background operation |

### Sync Bridge (`sync_bridge.rs`) — 3 commands

| Command | Purpose |
|---------|---------|
| `sync_workspace(local_path, gateway_url, token)` | Scan → manifest diff → upload changed files |
| `sync_status` | Snapshot of current sync state |
| `cancel_sync` | Cancel flag checked between uploads |

Events: `sync-progress` and `sync-done` carry a `SyncStatus` snapshot (`phase`: `scanning → diffing → uploading → done/failed/cancelled`).

### Gateway Management (`gateway.rs`) — 3 commands

| Command | Purpose |
|---------|---------|
| `start_gateway(port?, auth_disabled?)` | Launch TS Gateway as child process |
| `stop_gateway` | Gracefully stop the Gateway |
| `gateway_status` | Check if Gateway is running |

---

## 🔄 How It Replaces the Browser Approach

| Browser (broken) | Tauri 2 desktop (works) |
|---|---|
| `window.showDirectoryPicker()` → name only | `tauri_plugin_dialog` → **absolute path** |
| `fetch("/api/threads/{id}/files/tree")` | `invoke("list_tree", { path })` → native Rust walk |
| Can't open Finder/Explorer | `invoke("open_in_manager", { path })` → `open::that` |
| Sandbox = virtual `/mnt/user-data` | Sandbox = **real host path** (override in backend) |
| Manual `make dev` to start Gateway | **Auto-launches Gateway** as child process |
| No background operation | **System tray** keeps app running |
| No auto-update | **Built-in updater** via Tauri v2 |

---

## 🐛 Troubleshooting

### White window / config pages dead
The frontend talks to the TS Gateway over localhost TCP. IDE port-forwarding and tunnel tools can occupy loopback ports in a *zombie* state. `make desktop` probes candidate ports (gateway: 8200-8202, frontend: 3200-3202) and skips unresponsive ones.

Check a suspect port:
```bash
curl -m 3 --noproxy '*' http://127.0.0.1:<port>/health
```
Empty reply means a zombie; find the owner with `lsof -i TCP:<port> -P`.

### Gateway won't start
```bash
# Check if the backend is built
cd backend && npm run build

# Check if the port is in use
lsof -i TCP:8200 -P

# Try a different port
QUILL_GATEWAY_PORT=8201 npm run tauri dev
```

### Login wall
The desktop flow starts with `QUILL_AUTH_DISABLED=1` (built-in mode; inert when `QUILL_ENV=production`), which renders the workspace as the built-in admin `default` user instead of redirecting to `/login`.

### Sync not working
```bash
# Check sync status
curl http://localhost:8200/api/desktop/sync/status

# Check if files are being registered
curl -X POST http://localhost:8200/api/desktop/sync/manifest \
  -H "Content-Type: application/json" \
  -d '{"files": [{"path": "test.txt", "size": 100, "modified": 1700000000}]}'
```

---

## 📜 License

[Apache 2.0](../../LICENSE)

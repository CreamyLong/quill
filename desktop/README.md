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
│  │  • pick_folder()       → native dialog     │  │
│  │  • validate_path()     → absolute path     │  │
│  │  • list_tree()         → recursive walk    │  │
│  │  • open_in_manager()   → Finder/Explorer   │  │
│  │  • read_file() / write_file() / run_cmd()  │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

The existing TypeScript backend (`backend/`) is still used for the agent runtime
(Gateway, LangGraph, subagents). Tauri embeds or proxies to it. The Rust layer
*only* handles filesystem operations the browser cannot.

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

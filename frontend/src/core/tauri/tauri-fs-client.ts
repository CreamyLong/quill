/**
 * Tauri filesystem bridge client.
 *
 * Delegates folder picking, path validation, tree listing, and file reveal
 * to the native Tauri host over IPC. Falls back gracefully when running in a
 * plain browser (no Tauri context).
 *
 * This is the drop-in replacement for the browser-only File System Access API
 * that could not return absolute paths.
 */

import type { FileTreeNode } from "@/components/workspace/workspace-file-tree/use-file-tree";

/** Absolute path of the picked folder, or null if user cancelled. */
export interface PickResult {
  path: string;
  name: string;
}

let _invoke: (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null = null;

/** Lazily resolve the Tauri `invoke` function (only available in Tauri app). */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!_invoke) {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      throw new Error("tauri-invoke-unavailable");
    }
    try {
      // Dynamic import via indirect eval so Next.js/webpack does NOT try to
      // statically resolve `@tauri-apps/api/core` at build time — the package
      // only exists inside the Tauri desktop shell, not in the web frontend.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<{
        invoke: <U>(cmd: string, args?: Record<string, unknown>) => Promise<U>;
      }>;
      const mod = await dynamicImport("@tauri-apps/api/core");
      _invoke = mod.invoke;
    } catch {
      throw new Error("tauri-invoke-unavailable");
    }
  }
  return _invoke<T>(cmd, args ?? {});
}

/** True when running inside the Tauri desktop shell. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Open the native folder-picker dialog. Returns absolute path or null. */
export async function pickFolder(): Promise<PickResult | null> {
  if (!isTauri()) {
    throw new Error("Folder picker requires the Tauri desktop app");
  }
  return invoke<PickResult | null>("pick_folder_blocking");
}

/** Validate an absolute path on the host filesystem. */
export async function validatePath(
  inputPath: string,
): Promise<{ valid: boolean; absolutePath: string | null; isDir: boolean; error: string | null }> {
  if (!isTauri()) {
    // Browser mode: cannot probe the host FS, but we can do basic shape
    // validation. The backend will authoritative-check at submit time.
    const looksAbsolute = /^(?:[a-zA-Z]:[\\/]|[\\/]|[~])/.test(inputPath);
    return {
      valid: looksAbsolute,
      absolutePath: inputPath,
      isDir: false, // unknown until backend confirms
      error: looksAbsolute ? null : "Please enter an absolute path (e.g. /Users/you/project)",
    };
  }
  return invoke<{
    valid: boolean;
    absolute_path: string | null;
    is_dir: boolean;
    readable: boolean;
    writable: boolean;
    error: string | null;
  }>("validate_path", { inputPath }).then((r) => ({
    valid: r.valid && r.is_dir,
    absolutePath: r.absolute_path,
    isDir: r.is_dir,
    error: r.error,
  }));
}

/**
 * Recursively list the directory tree at `rootPath` (absolute).
 * Adapts the Rust `FsNode` wire shape into the `FileTreeNode` the
 * `useFileTree` hook consumes.
 */
export async function listTree(rootPath: string): Promise<FileTreeNode> {
  if (!isTauri()) {
    throw new Error("listTree requires the Tauri desktop app");
  }
  const node = await invoke<RustFsNode>("list_tree", { rootPath });
  return adaptNode(node);
}

/** Reveal a path in the native file manager (Finder/Explorer/Nautilus). */
export async function openInManager(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("open_in_manager", { path });
}

// ────────────────────────────────────────────────────────────────────────
// Rust → TS shape adapter
// ────────────────────────────────────────────────────────────────────────

interface RustFileNode {
  type: "file";
  name: string;
  path: string;
  size: number;
  modified?: number;
}
interface RustDirNode {
  type: "directory";
  name: string;
  path: string;
  children: RustFsNode[];
}
type RustFsNode = RustFileNode | RustDirNode;

function adaptNode(n: RustFsNode): FileTreeNode {
  if (n.type === "file") {
    return {
      name: n.name,
      path: n.path,
      type: "file",
      size: n.size,
      modified: n.modified ? new Date(n.modified * 1000).toISOString() : undefined,
    };
  }
  return {
    name: n.name,
    path: n.path,
    type: "directory",
    children: n.children.map(adaptNode),
  };
}

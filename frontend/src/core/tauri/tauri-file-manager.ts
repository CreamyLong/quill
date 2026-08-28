/**
 * Tauri file-manager bridge client.
 *
 * Wraps the full file-CRUD command set exposed by the desktop shell
 * (`fs_bridge.rs`): write/rename/delete/create/info/search. Follows the same
 * graceful-degradation pattern as `tauri-fs-client.ts` — every call is a
 * no-op (or a typed error) when running in a plain browser.
 */

import { invoke, isTauri } from "./tauri-fs-client";

/** Metadata for a file or directory on the host filesystem. */
export interface HostFileInfo {
  exists: boolean;
  isDir: boolean;
  isFile: boolean;
  isSymlink: boolean;
  size: number;
  modified: number | null; // unix seconds
  created: number | null; // unix seconds
  readonly: boolean;
  absolutePath: string;
  extension: string | null;
}

/** A single search hit from `search_files`. */
export interface HostSearchHit {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
}

/** Throw a typed error when not running inside the Tauri desktop shell. */
function requireTauri(op: string): void {
  if (!isTauri()) {
    throw new Error(`${op} requires the Quill desktop app`);
  }
}

/** Write UTF-8 text to a file. Creates parent directories when missing. */
export async function writeFileText(path: string, content: string, append = false): Promise<void> {
  requireTauri("writeFileText");
  await invoke("write_file_text", { path, content, append });
}

/** Read a text file for in-app preview. */
export async function readFileText(path: string): Promise<string> {
  requireTauri("readFileText");
  return invoke<string>("read_file_text", { path });
}

/** Rename (move) a file or directory. Refuses to overwrite an existing destination. */
export async function renamePath(from: string, to: string): Promise<void> {
  requireTauri("renamePath");
  await invoke("rename_path", { from, to });
}

/** Delete a file, or a directory recursively. */
export async function deletePath(path: string): Promise<void> {
  requireTauri("deletePath");
  await invoke("delete_path", { path });
}

/** Create a directory, including any missing parent directories. */
export async function createDirectory(path: string): Promise<void> {
  requireTauri("createDirectory");
  await invoke("create_directory", { path });
}

/** Read metadata for a file or directory. Never throws for missing paths. */
export async function getFileInfo(path: string): Promise<HostFileInfo> {
  requireTauri("getFileInfo");
  return invoke<HostFileInfo>("get_file_info", { path });
}

/**
 * Search files under `root` whose file name matches a glob-style pattern
 * (`*` and `?` wildcards, case-insensitive). Results are capped (500).
 */
export async function searchFiles(root: string, pattern: string): Promise<HostSearchHit[]> {
  requireTauri("searchFiles");
  return invoke<HostSearchHit[]>("search_files", { root, pattern });
}

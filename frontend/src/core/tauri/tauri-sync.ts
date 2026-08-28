/**
 * Tauri workspace-sync bridge client.
 *
 * Wraps the incremental workspace sync engine (`sync_bridge.rs`): scan →
 * manifest diff → chunked upload, with progress events the UI can subscribe
 * to. Follows the same graceful-degradation pattern as `tauri-fs-client.ts`.
 */

import { invoke, isTauri } from "./tauri-fs-client";

/** Terminal/current phase of a sync run. */
export type SyncPhase =
  | "idle"
  | "scanning"
  | "diffing"
  | "uploading"
  | "done"
  | "failed"
  | "cancelled";

/** Progress snapshot emitted during a sync (`sync-progress` / `sync-done`). */
export interface SyncStatus {
  phase: SyncPhase;
  totalFiles: number;
  changedFiles: number;
  uploadedFiles: number;
  currentPath: string | null;
  error: string | null;
}

/** Throw a typed error when not running inside the Tauri desktop shell. */
function requireTauri(op: string): void {
  if (!isTauri()) {
    throw new Error(`${op} requires the Quill desktop app`);
  }
}

/**
 * Start an incremental sync of the local workspace to the Gateway.
 *
 * Resolves when the sync loop finishes (success, failure, or cancel — check
 * the final `sync-status`/`sync-done` event for the terminal phase). Throws
 * synchronously for precondition errors (bad path, sync already running).
 */
export async function syncWorkspace(
  localPath: string,
  gatewayUrl: string,
  token?: string | null,
): Promise<void> {
  requireTauri("syncWorkspace");
  await invoke("sync_workspace", {
    localPath,
    gatewayUrl,
    token: token ?? null,
  });
}

/** Snapshot of the current sync state (idle when nothing has run yet). */
export async function getSyncStatus(): Promise<SyncStatus> {
  requireTauri("getSyncStatus");
  return invoke<SyncStatus>("sync_status");
}

/** Request cancellation of the in-flight sync (checked between files). */
export async function cancelSync(): Promise<void> {
  requireTauri("cancelSync");
  await invoke("cancel_sync");
}

// ────────────────────────────────────────────────────────────────────────
// Progress events
// ────────────────────────────────────────────────────────────────────────

type SyncEventName = "sync-progress" | "sync-done";
type SyncListener = (status: SyncStatus) => void;

const listeners = new Map<SyncEventName, Set<SyncListener>>();
let unlisten: (() => void) | null = null;

/**
 * Subscribe to sync progress/termination events. Returns an unsubscribe
 * function. Lazily attaches the Tauri event listener on first subscriber.
 */
export async function onSyncEvent(
  name: SyncEventName,
  listener: SyncListener,
): Promise<() => void> {
  requireTauri("onSyncEvent");
  if (!listeners.has(name)) {
    listeners.set(name, new Set());
  }
  listeners.get(name)!.add(listener);

  if (!unlisten) {
    // Dynamic import via indirect eval — same pattern as tauri-fs-client —
    // so webpack never statically resolves @tauri-apps/api/event.
    const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<{
      listen: <T>(event: string, cb: (e: { payload: T }) => void) => Promise<() => void>;
    }>;
    const mod = await dynamicImport("@tauri-apps/api/event");
    const stops = await Promise.all([
      mod.listen<SyncStatus>("sync-progress", (e) => {
        listeners.get("sync-progress")?.forEach((fn) => fn(e.payload));
      }),
      mod.listen<SyncStatus>("sync-done", (e) => {
        listeners.get("sync-done")?.forEach((fn) => fn(e.payload));
      }),
    ]);
    unlisten = () => stops.forEach((stop) => stop());
  }

  return () => {
    listeners.get(name)?.delete(listener);
  };
}

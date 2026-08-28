/**
 * Tauri system bridge client.
 *
 * Wraps clipboard access, system notifications, and host system info
 * exposed by the desktop shell (`system_bridge.rs`). Follows the same
 * graceful-degradation pattern as `tauri-fs-client.ts` — every call throws
 * a typed error when running in a plain browser.
 */

import { invoke, isTauri } from "./tauri-fs-client";

/** Host system snapshot returned by `read_system_info`. */
export interface HostSystemInfo {
  osName: string;
  osVersion: string;
  kernel: string;
  arch: string;
  hostname: string;
  totalMemoryBytes: number;
  usedMemoryBytes: number;
  availableMemoryBytes: number;
  cpuCount: number;
  cpuBrand: string;
  cpuUsagePercent: number;
}

export type NotificationLevel = "info" | "success" | "warning" | "error";

/** Throw a typed error when not running inside the Tauri desktop shell. */
function requireTauri(op: string): void {
  if (!isTauri()) {
    throw new Error(`${op} requires the Quill desktop app`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Clipboard
// ────────────────────────────────────────────────────────────────────────

/** Read text from the system clipboard (null when it holds no text). */
export async function getClipboardText(): Promise<string | null> {
  requireTauri("getClipboardText");
  return invoke<string | null>("get_clipboard_text");
}

/** Write text to the system clipboard. */
export async function setClipboardText(text: string): Promise<void> {
  requireTauri("setClipboardText");
  await invoke("set_clipboard_text", { text });
}

/**
 * Read an image from the system clipboard as a base64-encoded PNG data URL
 * (`data:image/png;base64,...`). Returns null when the clipboard holds no
 * image.
 */
export async function getClipboardImageDataUrl(): Promise<string | null> {
  requireTauri("getClipboardImageDataUrl");
  const base64 = await invoke<string | null>("get_clipboard_image_base64");
  return base64 === null ? null : `data:image/png;base64,${base64}`;
}

// ────────────────────────────────────────────────────────────────────────
// Notifications
// ────────────────────────────────────────────────────────────────────────

/** Show a system notification (UNUserNotificationCenter / toast / libnotify). */
export async function showNotification(
  title: string,
  body: string,
  level: NotificationLevel = "info",
): Promise<void> {
  requireTauri("showNotification");
  await invoke("show_notification", { title, body, level });
}

// ────────────────────────────────────────────────────────────────────────
// System info
// ────────────────────────────────────────────────────────────────────────

/** Snapshot of host system info (OS, memory, CPU). */
export async function readSystemInfo(): Promise<HostSystemInfo> {
  requireTauri("readSystemInfo");
  return invoke<HostSystemInfo>("read_system_info");
}

// ────────────────────────────────────────────────────────────────────────
// Window management
// ────────────────────────────────────────────────────────────────────────

/** Pin/unpin the main window above all others. */
export async function setWindowAlwaysOnTop(flag: boolean): Promise<void> {
  requireTauri("setWindowAlwaysOnTop");
  await invoke("set_window_always_on_top", { flag });
}

/** Minimize the main window. */
export async function minimizeWindow(): Promise<void> {
  requireTauri("minimizeWindow");
  await invoke("minimize_window");
}

/** Toggle between maximized and restored. */
export async function toggleMaximizeWindow(): Promise<void> {
  requireTauri("toggleMaximizeWindow");
  await invoke("toggle_maximize_window");
}

/** Resize the main window (logical pixels). */
export async function setWindowSize(width: number, height: number): Promise<void> {
  requireTauri("setWindowSize");
  await invoke("set_window_size", { width, height });
}

/** Center the main window on the current monitor. */
export async function centerWindow(): Promise<void> {
  requireTauri("centerWindow");
  await invoke("center_window");
}

/** Hide the main window (process keeps running). */
export async function hideWindow(): Promise<void> {
  requireTauri("hideWindow");
  await invoke("hide_window");
}

/** Show (and focus) the main window after a hide. */
export async function showWindow(): Promise<void> {
  requireTauri("showWindow");
  await invoke("show_window");
}

/**
 * API client for work tasks (work workspace).
 *
 * Tasks are named contexts bound to a local folder. Each task groups multiple
 * conversation threads. A task is auto-created from a folder name and can be
 * renamed later.
 */

import { fetch } from "../api/fetcher";
import { getBackendBaseURL } from "../config";

export interface WorkTask {
  task_id: string;
  name: string;
  folder_path: string;
  created_at: string;
  updated_at: string;
}

/**
 * List all work tasks, optionally filtered by folder path.
 */
export async function listTasks(folderPath?: string): Promise<WorkTask[]> {
  const base = `${getBackendBaseURL()}/api/tasks`;
  const params = new URLSearchParams();
  if (folderPath) params.set("folder_path", folderPath);
  const qs = params.toString();
  const res = await fetch(`${base}${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`Failed to list tasks: ${res.status}`);
  return (await res.json()) as WorkTask[];
}

/**
 * Create a work task for a folder. If a task already exists for that folder,
 * returns the existing one (dedup by folder_path).
 *
 * @param folderPath - absolute path to the local directory
 * @param name - optional task name (defaults to folder basename)
 */
export async function createTask(
  folderPath: string,
  name?: string,
): Promise<WorkTask> {
  const res = await fetch(`${getBackendBaseURL()}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder_path: folderPath, name }),
  });
  if (!res.ok) throw new Error(`Failed to create task: ${res.status}`);
  return (await res.json()) as WorkTask;
}

/**
 * Rename a work task.
 */
export async function renameTask(taskId: string, name: string): Promise<WorkTask> {
  const res = await fetch(`${getBackendBaseURL()}/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to rename task: ${res.status}`);
  return (await res.json()) as WorkTask;
}

/**
 * Delete a work task.
 */
export async function deleteTask(taskId: string): Promise<void> {
  const res = await fetch(`${getBackendBaseURL()}/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete task: ${res.status}`);
}

/**
 * Get a single work task by id.
 */
export async function getTask(taskId: string): Promise<WorkTask | null> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/tasks/${encodeURIComponent(taskId)}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to get task: ${res.status}`);
  return (await res.json()) as WorkTask;
}

/**
 * List threads belonging to a task.
 */
export async function listTaskThreads(taskId: string): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/tasks/${encodeURIComponent(taskId)}/threads`,
  );
  if (!res.ok) throw new Error(`Failed to list task threads: ${res.status}`);
  return (await res.json()) as Array<Record<string, unknown>>;
}

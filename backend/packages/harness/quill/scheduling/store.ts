/**
 * Persistence for scheduled task definitions.
 *
 * - `FileScheduledTaskStore`: atomic JSON file under the runtime home
 *   (`<runtimeHome>/scheduled_tasks.json` by default). The write pattern
 *   (tmp sibling + rename) mirrors `config/config_writer.ts`.
 * - `MemoryScheduledTaskStore`: in-memory implementation for tests and
 *   for gateway configurations where a persistent store is not desired.
 */

import fs from "node:fs";
import path from "node:path";

import type { ScheduledTask } from "./types.js";
import { runtimeHome } from "../config/runtime_paths.js";

/** On-disk document shape. */
interface TaskFileDocument {
  version: 1;
  tasks: ScheduledTask[];
}

function defaultPath(): string {
  return path.join(runtimeHome(), "scheduled_tasks.json");
}

export class FileScheduledTaskStore {
  private readonly filePath: string;

  constructor(filePath: string = defaultPath()) {
    this.filePath = filePath;
  }

  private readAll(): ScheduledTask[] {
    try {
      if (!fs.existsSync(this.filePath)) {
        return [];
      }
      const raw = fs.readFileSync(this.filePath, "utf-8");
      if (!raw.trim()) {
        return [];
      }
      const doc = JSON.parse(raw) as TaskFileDocument;
      return Array.isArray(doc.tasks) ? doc.tasks : [];
    } catch {
      // Corrupt or unreadable file: treat as empty rather than crash the gateway.
      return [];
    }
  }

  private writeAll(tasks: ScheduledTask[]): void {
    const doc: TaskFileDocument = { version: 1, tasks };
    const content = JSON.stringify(doc, null, 2);
    const tmp = `${this.filePath}.tmp`;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(tmp, content, "utf-8");
    fs.renameSync(tmp, this.filePath);
  }

  list(): ScheduledTask[] {
    return this.readAll();
  }

  get(id: string): ScheduledTask | null {
    return this.readAll().find((t) => t.id === id) ?? null;
  }

  save(task: ScheduledTask): void {
    const tasks = this.readAll();
    const idx = tasks.findIndex((t) => t.id === task.id);
    if (idx >= 0) {
      tasks[idx] = task;
    } else {
      tasks.push(task);
    }
    this.writeAll(tasks);
  }

  delete(id: string): boolean {
    const tasks = this.readAll();
    const next = tasks.filter((t) => t.id !== id);
    if (next.length === tasks.length) {
      return false;
    }
    this.writeAll(next);
    return true;
  }
}

export class MemoryScheduledTaskStore {
  private tasks: ScheduledTask[] = [];

  list(): ScheduledTask[] {
    return [...this.tasks];
  }

  get(id: string): ScheduledTask | null {
    return this.tasks.find((t) => t.id === id) ?? null;
  }

  save(task: ScheduledTask): void {
    const idx = this.tasks.findIndex((t) => t.id === task.id);
    if (idx >= 0) {
      this.tasks[idx] = task;
    } else {
      this.tasks.push(task);
    }
  }

  delete(id: string): boolean {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx < 0) {
      return false;
    }
    this.tasks.splice(idx, 1);
    return true;
  }
}

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { FileScheduledTaskStore, MemoryScheduledTaskStore } from "../store.ts";
import type { ScheduledTask } from "../types.ts";

const sampleTask: ScheduledTask = {
  id: "abc",
  name: "Morning Brief",
  prompt: "Write the morning brief.",
  schedule: { kind: "cron", expression: "0 8 * * *" },
  thread_id: null,
  enabled: true,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  last_run_at: null,
  last_status: null,
  last_run_id: null,
  next_run_at: "2026-01-02T08:00:00.000Z",
  run_count: 0,
};

describe("MemoryScheduledTaskStore", () => {
  it("round-trips save/get/list/delete", () => {
    const store = new MemoryScheduledTaskStore();
    expect(store.list()).toEqual([]);
    store.save(sampleTask);
    expect(store.get("abc")).toEqual(sampleTask);
    store.delete("abc");
    expect(store.get("abc")).toBeNull();
    expect(store.delete("abc")).toBe(false);
  });

  it("upserts on save with the same id", () => {
    const store = new MemoryScheduledTaskStore();
    store.save(sampleTask);
    store.save({ ...sampleTask, name: "Renamed" });
    expect(store.list()).toHaveLength(1);
    expect(store.get("abc")!.name).toBe("Renamed");
  });
});

describe("FileScheduledTaskStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "quill-sched-test-"));
    filePath = path.join(dir, "scheduled_tasks.json");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty when the file does not exist", () => {
    const store = new FileScheduledTaskStore(filePath);
    expect(store.list()).toEqual([]);
    expect(store.get("missing")).toBeNull();
  });

  it("round-trips save/get/list/delete and persists to disk", () => {
    const store = new FileScheduledTaskStore(filePath);
    store.save(sampleTask);
    // A second store instance reads from the same file (real persistence).
    const reloaded = new FileScheduledTaskStore(filePath);
    expect(reloaded.get("abc")).toEqual(sampleTask);
    reloaded.delete("abc");
    expect(reloaded.get("abc")).toBeNull();
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("creates parent directories on save", () => {
    const nested = path.join(dir, "a", "b", "tasks.json");
    const store = new FileScheduledTaskStore(nested);
    store.save(sampleTask);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it("recovers from a corrupt file by treating it as empty", () => {
    fs.writeFileSync(filePath, "{ this is not json", "utf-8");
    const store = new FileScheduledTaskStore(filePath);
    expect(store.list()).toEqual([]);
    store.save(sampleTask);
    expect(store.get("abc")).toEqual(sampleTask);
  });

  it("writes atomically (no .tmp sibling left behind)", () => {
    const store = new FileScheduledTaskStore(filePath);
    store.save(sampleTask);
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

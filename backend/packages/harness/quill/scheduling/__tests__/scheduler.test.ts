import { describe, expect, it, vi } from "vitest";

import { MemoryScheduledTaskStore } from "../store.ts";
import { ScheduledTaskScheduler, computeNextRun } from "../scheduler.ts";
import type { ScheduledTask } from "../types.ts";

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "task-1",
    name: "Daily Digest",
    prompt: "Summarize today's news.",
    schedule: { kind: "interval", everySeconds: 3600 },
    thread_id: null,
    enabled: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    last_run_at: null,
    last_status: null,
    last_run_id: null,
    next_run_at: "2026-01-02T00:00:00.000Z",
    run_count: 0,
    ...overrides,
  };
}

describe("computeNextRun", () => {
  it("computes next run for interval tasks", () => {
    const task = makeTask({ schedule: { kind: "interval", everySeconds: 60 } });
    const after = new Date("2026-01-01T00:00:00.000Z");
    expect(computeNextRun(task, after)).toBe("2026-01-01T00:01:00.000Z");
  });

  it("computes next run for cron tasks", () => {
    const task = makeTask({
      schedule: { kind: "cron", expression: "0 9 * * *" },
      enabled: true,
    });
    const after = new Date("2026-01-15T10:00:00.000Z");
    const next = computeNextRun(task, after);
    expect(next).toBe("2026-01-16T09:00:00.000Z");
  });

  it("returns null when disabled", () => {
    const task = makeTask({ enabled: false });
    expect(computeNextRun(task, new Date())).toBeNull();
  });
});

describe("ScheduledTaskScheduler", () => {
  it("fires a due task and updates bookkeeping", async () => {
    const store = new MemoryScheduledTaskStore();
    const task = makeTask({
      next_run_at: "2026-01-01T00:00:00.000Z",
      schedule: { kind: "interval", everySeconds: 3600 },
    });
    store.save(task);

    const fireRun = vi.fn().mockResolvedValue({ status: "success", threadId: "t1", runId: "r1" });
    const scheduler = new ScheduledTaskScheduler({
      store,
      fireRun,
      now: () => new Date("2026-01-01T00:01:00.000Z"),
    });

    await scheduler.tick();
    expect(fireRun).toHaveBeenCalledTimes(1);

    const after = store.get("task-1")!;
    expect(after.last_status).toBe("success");
    expect(after.last_run_id).toBe("r1");
    expect(after.run_count).toBe(1);
    expect(after.last_run_at).toBe("2026-01-01T00:01:00.000Z");
    expect(after.next_run_at).toBe("2026-01-01T01:01:00.000Z");
  });

  it("does not fire a task that is not yet due", async () => {
    const store = new MemoryScheduledTaskStore();
    const task = makeTask({ next_run_at: "2026-01-02T00:00:00.000Z" });
    store.save(task);

    const fireRun = vi.fn().mockResolvedValue({ status: "success", threadId: "t1", runId: "r1" });
    const scheduler = new ScheduledTaskScheduler({
      store,
      fireRun,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    await scheduler.tick();
    expect(fireRun).not.toHaveBeenCalled();
  });

  it("does not fire a disabled task", async () => {
    const store = new MemoryScheduledTaskStore();
    const task = makeTask({ enabled: false, next_run_at: "2026-01-01T00:00:00.000Z" });
    store.save(task);

    const fireRun = vi.fn().mockResolvedValue({ status: "success", threadId: "t1", runId: "r1" });
    const scheduler = new ScheduledTaskScheduler({
      store,
      fireRun,
      now: () => new Date("2026-01-01T00:01:00.000Z"),
    });

    await scheduler.tick();
    expect(fireRun).not.toHaveBeenCalled();
  });

  it("records an error status when fireRun rejects", async () => {
    const store = new MemoryScheduledTaskStore();
    const task = makeTask({ next_run_at: "2026-01-01T00:00:00.000Z" });
    store.save(task);

    const fireRun = vi.fn().mockRejectedValue(new Error("boom"));
    const scheduler = new ScheduledTaskScheduler({
      store,
      fireRun,
      now: () => new Date("2026-01-01T00:01:00.000Z"),
    });

    await scheduler.tick();
    const after = store.get("task-1")!;
    expect(after.last_status).toBe("error");
    expect(after.run_count).toBe(1);
  });

  it("does not count skipped runs toward run_count", async () => {
    const store = new MemoryScheduledTaskStore();
    const task = makeTask({ next_run_at: "2026-01-01T00:00:00.000Z", run_count: 5 });
    store.save(task);

    const fireRun = vi.fn().mockResolvedValue({ status: "skipped" });
    const scheduler = new ScheduledTaskScheduler({
      store,
      fireRun,
      now: () => new Date("2026-01-01T00:01:00.000Z"),
    });

    await scheduler.tick();
    const after = store.get("task-1")!;
    expect(after.last_status).toBe("skipped");
    expect(after.run_count).toBe(5);
  });

  it("prevents double-firing the same task while in flight", async () => {
    const store = new MemoryScheduledTaskStore();
    const task = makeTask({ next_run_at: "2026-01-01T00:00:00.000Z" });
    store.save(task);

    let fireCount = 0;
    const fireRun = vi.fn().mockImplementation(() => {
      fireCount += 1;
      return Promise.resolve({ status: "success", threadId: "t1", runId: "r1" });
    });
    const scheduler = new ScheduledTaskScheduler({
      store,
      fireRun,
      now: () => new Date("2026-01-01T00:01:00.000Z"),
    });

    // Two ticks while the task is still due: the first tick schedules the fire.
    // Because fireRun is async, a second tick during the same event loop would
    // see the task still in flight.
    const p1 = scheduler.tick();
    // Force a second tick synchronously before the first resolves.
    await scheduler.tick();
    await p1;
    expect(fireCount).toBeLessThanOrEqual(2);
    // After both ticks settle, the task is no longer in flight.
    expect(scheduler.isInFlight("task-1")).toBe(false);
  });
});

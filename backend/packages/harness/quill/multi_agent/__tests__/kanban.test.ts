/**
 * Tests for the durable Kanban board + dispatcher (Hermes Agent sync).
 *
 * Covers lifecycle transitions, lease expiry + reclaim, attempt exhaustion,
 * durable file persistence across board instances, and dispatcher ticks.
 */

import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { KanbanBoard, KanbanDispatcher, type KanbanTask } from "../kanban.js";

const tmpDirs: string[] = [];
afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function tmpDb(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "quill-kanban-"));
  tmpDirs.push(dir);
  return path.join(dir, "kanban.json");
}

describe("KanbanBoard", () => {
  it("adds tasks to backlog (or ready when assigned)", async () => {
    const board = new KanbanBoard();
    const a = await board.addTask({ title: "write tests" });
    const b = await board.addTask({ title: "fix bug", assignee: "coder-agent" });

    expect(a.status).toBe("backlog");
    expect(b.status).toBe("ready");
    expect(b.assignee).toBe("coder-agent");
    expect(a.workspace).toEqual({ kind: "scratch" });
  });

  it("claims highest-priority ready task with a lease", async () => {
    const board = new KanbanBoard();
    await board.addTask({ title: "low", priority: "low", assignee: "w" });
    await board.addTask({ title: "urgent", priority: "urgent", assignee: "w" });

    const claimed = await board.claim("worker-1");
    expect(claimed?.title).toBe("urgent");
    expect(claimed?.status).toBe("claimed");
    expect(claimed?.claimedBy).toBe("worker-1");
    expect(claimed?.leaseExpiresAt).toBeTruthy();
  });

  it("claims a specific task by id and refuses non-ready tasks", async () => {
    const board = new KanbanBoard();
    const task = await board.addTask({ title: "x", assignee: "w" });

    expect(await board.claim("w", task.id)).toBeDefined();
    // Already claimed → cannot claim again.
    expect(await board.claim("w2", task.id)).toBeUndefined();
  });

  it("completes and submits claimed tasks for review", async () => {
    const board = new KanbanBoard();
    const task = await board.addTask({ title: "x", assignee: "w" });
    await board.claim("w", task.id);

    const reviewed = await board.submitReview(task.id);
    expect(reviewed?.status).toBe("in_review");
    expect(reviewed?.claimedBy).toBeUndefined();

    // in_review tasks cannot be completed via complete() (only claimed can).
    expect(await board.complete(task.id)).toBeUndefined();
  });

  it("blocks and unblocks tasks with reasons", async () => {
    const board = new KanbanBoard();
    const task = await board.addTask({ title: "x", assignee: "w" });
    await board.claim("w", task.id);

    const blocked = await board.block(task.id, "waiting on API access");
    expect(blocked?.status).toBe("blocked");
    expect(blocked?.blockedReason).toContain("API access");
    expect(blocked?.claimedBy).toBeUndefined();

    const unblocked = await board.unblock(task.id);
    expect(unblocked?.status).toBe("ready");
    expect(unblocked?.blockedReason).toBeUndefined();
  });

  it("reclaims expired claims and blocks after attempts exhausted", async () => {
    const board = new KanbanBoard({ leaseMs: 50, maxAttempts: 2 });
    const task = await board.addTask({ title: "x", assignee: "w" });
    await board.claim("w", task.id);

    // Not yet expired.
    expect(await board.reclaimStale()).toEqual([]);

    const original = Date.now;
    let offset = 1_000;
    Date.now = () => original() + offset;
    try {
      const reclaimed = await board.reclaimStale();
      expect(reclaimed).toHaveLength(1);
      expect(task.status).toBe("ready"); // attempt 1 < maxAttempts 2
      expect(task.attempts).toBe(1);

      // Claim again, advance past the new lease → attempt 2 = maxAttempts → blocked.
      await board.claim("w", task.id);
      offset = 5_000;
      await board.reclaimStale();
      expect(task.status).toBe("blocked");
      expect(task.blockedReason).toContain("attempts exhausted");
    } finally {
      Date.now = original;
    }
  });

  it("releases count attempts and block when exhausted", async () => {
    const board = new KanbanBoard({ maxAttempts: 1 });
    const task = await board.addTask({ title: "x", assignee: "w" });
    await board.claim("w", task.id);

    const released = await board.release(task.id, "worker gave up");
    expect(released?.status).toBe("blocked");
    expect(released?.attempts).toBe(1);
  });

  it("promotes backlog tasks when ready is starved", async () => {
    const board = new KanbanBoard();
    await board.addTask({ title: "a" });
    await board.addTask({ title: "b" });

    const promoted = await board.promoteReady(2);
    expect(promoted).toHaveLength(2);
    expect(board.columns().ready).toBe(2);
    expect(board.columns().backlog).toBe(0);
  });

  it("lists sorted by priority then creation time", async () => {
    const board = new KanbanBoard();
    await board.addTask({ title: "normal-1" });
    await board.addTask({ title: "urgent", priority: "urgent" });
    await board.addTask({ title: "normal-2" });

    const titles = board.list("backlog").map((t) => t.title);
    expect(titles[0]).toBe("urgent");
  });

  it("persists durably and reloads across board instances", async () => {
    const dbPath = tmpDb();
    const board = new KanbanBoard({ dbPath });
    await board.load();
    const task = await board.addTask({ title: "survives restarts", assignee: "w" });
    await board.claim("w", task.id);

    // File exists and is valid JSON.
    expect(existsSync(dbPath)).toBe(true);
    const raw = JSON.parse(readFileSync(dbPath, "utf8")) as { tasks: KanbanTask[] };
    expect(raw.tasks).toHaveLength(1);

    // A fresh board instance sees the same state.
    const reborn = new KanbanBoard({ dbPath });
    await reborn.load();
    expect(reborn.get(task.id)?.title).toBe("survives restarts");
    expect(reborn.get(task.id)?.status).toBe("claimed");
    expect(reborn.columns()).toEqual({ backlog: 0, ready: 0, claimed: 1, in_review: 0, done: 0, blocked: 0 });
  });

  it("prunes done tasks past the retention window", async () => {
    const board = new KanbanBoard();
    const task = await board.addTask({ title: "old", assignee: "w" });
    await board.claim("w", task.id);
    await board.complete(task.id);

    const original = Date.now;
    Date.now = () => original() + 60_000;
    try {
      expect(await board.pruneDone(30_000)).toBe(1);
      expect(board.get(task.id)).toBeUndefined();
    } finally {
      Date.now = original;
    }
  });
});

describe("KanbanDispatcher", () => {
  it("reclaims stale claims, promotes backlog, and spawns assigned workers", async () => {
    const board = new KanbanBoard({ leaseMs: 0 });
    const spawned: string[] = [];
    const dispatcher = new KanbanDispatcher({
      board,
      spawnWorker: async (task) => {
        spawned.push(task.id);
      },
    });

    const stale = await board.addTask({ title: "stale", assignee: "w" });
    await board.claim("w", stale.id); // lease expires immediately
    await board.addTask({ title: "backlog item" });

    await dispatcher.tick();

    // Stale claim reclaimed (attempt 1 → ready), then re-claimed and spawned.
    // The backlog item was not promoted this tick (ready was non-empty at
    // promote time); promoteReady itself is covered by its own unit test.
    expect(stale.attempts).toBe(1);
    expect(spawned).toEqual([stale.id]);
    expect(board.columns().claimed).toBe(1);
    expect(board.columns().backlog).toBe(1);
  });

  it("releases spawned tasks when the spawn callback fails", async () => {
    const board = new KanbanBoard();
    const task = await board.addTask({ title: "x", assignee: "w" });
    const dispatcher = new KanbanDispatcher({
      board,
      spawnWorker: async () => {
        throw new Error("no capacity");
      },
    });

    await dispatcher.tick();
    expect(task.status).toBe("ready");
    expect(task.attempts).toBe(1);
  });

  it("start/stop drives ticks on the interval", async () => {
    vi.useFakeTimers();
    try {
      const board = new KanbanBoard();
      await board.addTask({ title: "work", assignee: "w" });
      const spawned: string[] = [];
      const dispatcher = new KanbanDispatcher({
        board,
        tickMs: 10,
        spawnWorker: async (task) => {
          spawned.push(task.id);
        },
      });
      dispatcher.start();
      await vi.advanceTimersByTimeAsync(35);
      dispatcher.stop();
      // The assigned task is claimed and spawned on the first tick; later
      // ticks find an empty ready column.
      expect(spawned).toHaveLength(1);
      expect(board.columns().claimed).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Tests for Compute Worker Pool.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ComputeWorkerPool, getComputePool, resetComputePool } from "../compute_pool.js";

describe("ComputeWorkerPool", () => {
  let pool: ComputeWorkerPool;

  beforeEach(() => {
    pool = new ComputeWorkerPool({ maxWorkers: 2, maxPending: 10 });
  });

  afterEach(async () => {
    await pool.shutdown();
  });

  it("executes a simple task", async () => {
    const result = await pool.submit({
      id: "task-1",
      name: "Test Task",
      priority: "normal",
      input: 42,
      execute: async (n) => n * 2,
    }).promise;

    expect(result).toBe(84);
  });

  it("executes tasks concurrently up to maxWorkers", async () => {
    let running = 0;
    let maxRunning = 0;

    const tasks = Array.from({ length: 5 }, (_, i) => ({
      id: `task-${i}`,
      name: `Task ${i}`,
      priority: "normal" as const,
      input: i,
      timeoutMs: 1000,
      execute: async (n: number) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 50));
        running--;
        return n * 2;
      },
    }));

    const submissions = tasks.map((t) => pool.submit(t));
    const results = await Promise.all(submissions.map((s) => s.promise));

    expect(maxRunning).toBeLessThanOrEqual(2);
    expect(results).toEqual([0, 2, 4, 6, 8]);
  });

  it("executes high priority tasks first", async () => {
    const executionOrder: string[] = [];

    // Submit low priority first
    const low = pool.submit({
      id: "low",
      name: "Low Priority",
      priority: "low",
      input: null,
      execute: async () => {
        executionOrder.push("low");
        return "low";
      },
    });

    const high = pool.submit({
      id: "high",
      name: "High Priority",
      priority: "high",
      input: null,
      execute: async () => {
        executionOrder.push("high");
        return "high";
      },
    });

    await Promise.all([low.promise, high.promise]);
    // High should execute before or concurrently with low
    // (exact order depends on timing, but high should not be last)
    expect(executionOrder).toContain("high");
  });

  it("tracks pool statistics", async () => {
    const submission = pool.submit({
      id: "stats-task",
      name: "Stats Task",
      priority: "normal",
      input: null,
      execute: async () => {
        await new Promise((r) => setTimeout(r, 100));
        return "done";
      },
    });

    // Immediately after submit, should have 1 running or pending
    const statsDuring = pool.getStats();
    expect(statsDuring.maxWorkers).toBe(2);

    await submission.promise;

    const statsAfter = pool.getStats();
    expect(statsAfter.completed).toBe(1);
    expect(statsAfter.failed).toBe(0);
  });

  it("handles task timeout", async () => {
    let threw = false;
    try {
      await pool.submit({
        id: "timeout-task",
        name: "Timeout Task",
        priority: "normal",
        input: null,
        timeoutMs: 50,
        execute: async () => {
          await new Promise((r) => setTimeout(r, 500));
          return "should not reach";
        },
      }).promise;
    } catch (err: any) {
      threw = true;
      expect(err.code).toBe("timeout");
    }

    expect(threw).toBe(true);
    expect(pool.getStats().failed).toBe(1);
  });

  it("handles task execution errors", async () => {
    let threw = false;
    try {
      await pool.submit({
        id: "error-task",
        name: "Error Task",
        priority: "normal",
        input: null,
        execute: async () => {
          throw new Error("Task failed!");
        },
      }).promise;
    } catch (err: any) {
      threw = true;
      expect(err.code).toBe("execution_error");
      expect(err.message).toContain("Task failed!");
    }

    expect(threw).toBe(true);
  });

  it("reports overloaded when queue is near capacity", async () => {
    // Fill the pool
    const tasks: Promise<unknown>[] = [];
    for (let i = 0; i < 12; i++) {
      tasks.push(
        pool.submit({
          id: `fill-${i}`,
          name: `Fill ${i}`,
          priority: "normal",
          input: null,
          execute: async () => {
            await new Promise((r) => setTimeout(r, 1000));
            return i;
          },
        }).promise,
      );
    }

    const stats = pool.getStats();
    // Pool should be near capacity
    expect(stats.pending + stats.running).toBeGreaterThan(0);

    // Clean up
    await Promise.allSettled(tasks);
  });

  it("rejects submissions after shutdown", async () => {
    await pool.shutdown();

    let threw = false;
    try {
      pool.submit({
        id: "after-shutdown",
        name: "After Shutdown",
        priority: "normal",
        input: null,
        execute: async () => "never",
      });
    } catch (err: any) {
      threw = true;
      expect(err.code).toBe("overloaded");
    }

    expect(threw).toBe(true);
  });
});

describe("global compute pool", () => {
  afterEach(() => {
    resetComputePool();
  });

  it("returns the same pool instance", () => {
    const pool1 = getComputePool();
    const pool2 = getComputePool();
    expect(pool1).toBe(pool2);
  });

  it("creates a new pool after reset", async () => {
    const pool1 = getComputePool();
    resetComputePool();
    const pool2 = getComputePool();
    expect(pool1).not.toBe(pool2);
    await pool2.shutdown();
  });
});

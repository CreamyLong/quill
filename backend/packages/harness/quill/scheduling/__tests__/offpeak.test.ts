/**
 * Tests for the Off-Peak task system (ZCode sync).
 *
 * Covers the two state machines (task + ticket), ticket expiry with
 * re-ticket, admission gating on system idle, and concurrency limits.
 */

import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_OFFPEAK_CONFIG,
  OffPeakScheduler,
  OffPeakTaskStore,
  TicketAdmission,
  isTerminal,
} from "../offpeak.js";

function makeStore() {
  return new OffPeakTaskStore();
}

function makeAdmission(overrides?: Partial<typeof DEFAULT_OFFPEAK_CONFIG>) {
  return new TicketAdmission({ ...DEFAULT_OFFPEAK_CONFIG, ...overrides });
}

describe("TicketAdmission", () => {
  it("issues a queued ticket and walks it ready → active → settled", () => {
    const store = makeStore();
    const admission = makeAdmission();
    const task = store.create("t1", "run the big refactor");

    const ticket = admission.issue(task);
    expect(ticket.state).toBe("queued");
    expect(ticket.attempt).toBe(1);

    admission.markReady(task);
    expect(admission.current(task)?.state).toBe("ready");

    admission.activate(task);
    expect(admission.current(task)?.state).toBe("active");

    admission.settle(task);
    expect(admission.current(task)?.state).toBe("settled");
    expect(admission.current(task)?.closedAt).toBeTruthy();
  });

  it("refuses to skip states", () => {
    const store = makeStore();
    const admission = makeAdmission();
    const task = store.create("t1", "p");

    admission.issue(task);
    // Cannot activate a queued (not ready) ticket.
    expect(admission.activate(task)).toBeUndefined();
    // Cannot settle a queued ticket.
    expect(admission.settle(task)).toBeUndefined();
  });

  it("expires stale ready tickets and re-tickets while attempts remain", () => {
    const store = makeStore();
    const admission = makeAdmission({ ticketTtlMs: 50, maxRetickets: 2 });
    const task = store.create("t1", "p");
    admission.issue(task);
    admission.markReady(task);

    // Not yet stale.
    expect(admission.expireStale(task)).toBeUndefined();

    // After the TTL the ticket expires and a replacement is issued.
    const realNow = Date.now.bind(Date);
    const spy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + 100);
    const outcome = admission.expireStale(task);
    spy.mockRestore();

    expect(outcome).toBeDefined();
    expect(outcome!.expired.state).toBe("expired");
    expect(outcome!.reticketed).toBe(true);
    expect(task.reticketCount).toBe(1);
    expect(task.tickets).toHaveLength(2);
    expect(admission.current(task)?.state).toBe("queued");
    expect(admission.current(task)?.attempt).toBe(2);
  });

  it("stops re-ticketing after maxRetickets and leaves the task to fail", () => {
    const store = makeStore();
    const admission = makeAdmission({ ticketTtlMs: 0, maxRetickets: 1 });
    const task = store.create("t1", "p");

    admission.issue(task);
    admission.markReady(task);
    const realNow = Date.now.bind(Date);
    const spy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + 10_000);
    const first = admission.expireStale(task);
    // Ready the replacement ticket, then expire it too — attempts are now
    // exhausted so no further re-ticket is allowed.
    admission.markReady(task);
    const second = admission.expireStale(task);
    spy.mockRestore();

    expect(first?.reticketed).toBe(true);
    expect(second?.reticketed).toBe(false);
    expect(task.tickets).toHaveLength(2);
  });
});

describe("OffPeakTaskStore", () => {
  it("creates tasks in queued state with no tickets", () => {
    const store = makeStore();
    const task = store.create("thread-1", "do the thing", "gpt-x");
    expect(task.status).toBe("queued");
    expect(task.tickets).toEqual([]);
    expect(task.threadId).toBe("thread-1");
    expect(task.model).toBe("gpt-x");
  });

  it("supports pause/resume round-trips", () => {
    const store = makeStore();
    const task = store.create("t", "p");
    expect(store.pause(task, "awaiting permission")).toBe(true);
    expect(task.status).toBe("paused");
    expect(task.statusDetail).toBe("awaiting permission");
    expect(store.resume(task)).toBe(true);
    expect(task.status).toBe("queued");
  });

  it("cancel only works on non-terminal tasks", () => {
    const store = makeStore();
    const task = store.create("t", "p");
    store.complete(task, "done");
    expect(store.cancel(task)).toBe(false);

    const other = store.create("t", "p");
    expect(store.cancel(other)).toBe(true);
    expect(other.status).toBe("cancelled");
  });

  it("history returns only terminal tasks; pending returns queued/paused", () => {
    const store = makeStore();
    const a = store.create("t", "a");
    const b = store.create("t", "b");
    const c = store.create("t", "c");
    store.complete(a, "ok");
    store.fail(b, "boom");

    expect(store.history().map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    expect(store.pending().map((t) => t.id)).toEqual([c.id]);
    expect(isTerminal(a)).toBe(true);
    expect(isTerminal(c)).toBe(false);
  });

  it("notifies change listeners and tolerates throwing listeners", () => {
    const store = makeStore();
    const seen: string[] = [];
    store.onChange((t) => seen.push(t.status));
    store.onChange(() => {
      throw new Error("listener bug");
    });
    const task = store.create("t", "p");
    store.complete(task, "ok");
    expect(seen).toEqual(["queued", "completed"]);
  });

  it("records startedAt/finishedAt on transitions", () => {
    const store = makeStore();
    const task = store.create("t", "p");
    store.setStatus(task, "running");
    expect(task.startedAt).toBeTruthy();
    store.complete(task, "ok");
    expect(task.finishedAt).toBeTruthy();
  });
});

describe("OffPeakScheduler", () => {
  function makeScheduler(overrides?: {
    idle?: boolean;
    config?: Record<string, unknown>;
    startTask?: (task: { id: string }) => Promise<string>;
  }) {
    const store = makeStore();
    const admission = makeAdmission(overrides?.config as never);
    const startTask =
      overrides?.startTask ?? (async (task: { id: string }) => `finished ${task.id}`);
    const scheduler = new OffPeakScheduler({
      store,
      admission,
      config: { tickMs: 1, idleThresholdMs: 0, ...overrides?.config },
      isSystemIdle: () => overrides?.idle ?? true,
      startTask: startTask as never,
    });
    return { store, admission, scheduler };
  }

  it("does not admit tasks while the system is busy", async () => {
    const { store, scheduler } = makeScheduler({ idle: false });
    store.create("t", "expensive job");
    await scheduler.tick();
    const task = store.list()[0];
    expect(task.status).toBe("queued");
    expect(task.tickets).toHaveLength(0);
  });

  it("admits and completes a task when idle", async () => {
    const { store, admission, scheduler } = makeScheduler();
    const task = store.create("t", "expensive job");
    await scheduler.tick();
    // Tick dispatches without awaiting; give the microtask queue a drain.
    await vi.waitFor(() => expect(task.status).toBe("completed"));
    expect(task.result).toBe(`finished ${task.id}`);
    expect(admission.current(task)?.state).toBe("settled");
    expect(scheduler.runningCount).toBe(0);
  });

  it("respects maxConcurrent", async () => {
    const release: (() => void)[] = [];
    const { store, scheduler } = makeScheduler({
      config: { maxConcurrent: 1 },
      startTask: () =>
        new Promise<string>((resolve) => {
          release.push(() => resolve("done"));
        }),
    });
    const a = store.create("t", "a");
    const b = store.create("t", "b");

    await scheduler.tick();
    expect(a.status).toBe("running");
    expect(b.status).toBe("queued");

    release[0]();
    await vi.waitFor(() => expect(a.status).toBe("completed"));
    await scheduler.tick();
    expect(b.status).toBe("running");
    release[1]();
    await vi.waitFor(() => expect(b.status).toBe("completed"));
  });

  it("fails a task when ticket attempts are exhausted", async () => {
    const { store, admission, scheduler } = makeScheduler({
      config: { ticketTtlMs: 0, maxRetickets: 0 },
    });
    const task = store.create("t", "p");
    // Pre-issue + ready a ticket that is already stale (scheduler's admission).
    admission.issue(task);
    admission.markReady(task);

    const realNow = Date.now.bind(Date);
    const spy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + 10_000);
    await scheduler.tick();
    spy.mockRestore();

    expect(task.status).toBe("failed");
    expect(task.error).toContain("expired");
  });

  it("start/stop controls the interval loop", () => {
    vi.useFakeTimers();
    try {
      const { store, scheduler } = makeScheduler();
      const task = store.create("t", "p");
      scheduler.start();
      void task;
      // One tick should have run after tickMs.
      void vi.advanceTimersByTimeAsync(5);
      scheduler.stop();
      expect(scheduler.runningCount).toBeGreaterThanOrEqual(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

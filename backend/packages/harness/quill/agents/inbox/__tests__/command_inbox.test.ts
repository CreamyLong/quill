/**
 * Tests for the CommandInbox (ZCode sync).
 *
 * Covers busy/idle admission, FIFO order, bounded queues, cancel/reorder/
 * clear, and pruning.
 */

import { describe, expect, it, vi } from "vitest";

import { CommandInbox, type QueuedMessage } from "../command_inbox.js";

describe("CommandInbox", () => {
  it("admits messages immediately when the agent is idle", () => {
    const admitted: QueuedMessage[] = [];
    const inbox = new CommandInbox({ onAdmit: (m) => admitted.push(m) });

    const message = inbox.submit("t1", "hello");
    expect(message.status).toBe("admitted");
    expect(admitted).toHaveLength(1);
    expect(inbox.pending("t1")).toHaveLength(0);
  });

  it("queues messages while the agent is busy and admits FIFO on idle", () => {
    const admitted: QueuedMessage[] = [];
    const inbox = new CommandInbox({ onAdmit: (m) => admitted.push(m) });

    inbox.setBusy("t1");
    const a = inbox.submit("t1", "first");
    const b = inbox.submit("t1", "second");
    const c = inbox.submit("t1", "third");

    expect(a.status).toBe("queued");
    expect(b.status).toBe("queued");
    expect(inbox.pending("t1").map((m) => m.content)).toEqual(["first", "second", "third"]);

    // First idle → first message admitted, others still queued.
    const admitted1 = inbox.setIdle("t1");
    expect(admitted1?.id).toBe(a.id);
    expect(a.status).toBe("admitted");
    expect(inbox.pending("t1").map((m) => m.content)).toEqual(["second", "third"]);

    // Simulate the run starting from the admitted message.
    inbox.setBusy("t1");
    const admitted2 = inbox.setIdle("t1");
    expect(admitted2?.id).toBe(b.id);

    inbox.setBusy("t1");
    const admitted3 = inbox.setIdle("t1");
    expect(admitted3?.id).toBe(c.id);

    expect(admitted.map((m) => m.id)).toEqual([a.id, b.id, c.id]);
  });

  it("keeps per-thread queues independent", () => {
    const inbox = new CommandInbox();
    inbox.setBusy("t1");
    inbox.setBusy("t2");

    inbox.submit("t1", "for t1");
    const t2msg = inbox.submit("t2", "for t2");

    expect(inbox.pending("t1")).toHaveLength(1);
    expect(inbox.pending("t2")).toHaveLength(1);

    const admitted = inbox.setIdle("t2");
    expect(admitted?.id).toBe(t2msg.id);
    expect(inbox.pending("t1")).toHaveLength(1);
  });

  it("cancels a queued message and resequeuences positions", () => {
    const inbox = new CommandInbox();
    inbox.setBusy("t");
    const a = inbox.submit("t", "a");
    const b = inbox.submit("t", "b");
    const c = inbox.submit("t", "c");

    expect(inbox.cancel(b.id)?.status).toBe("cancelled");
    // Cannot cancel twice or cancel admitted messages.
    expect(inbox.cancel(b.id)).toBeUndefined();

    expect(inbox.pending("t").map((m) => m.content)).toEqual(["a", "c"]);
    expect(inbox.pending("t")[0].position).toBe(0);
    expect(inbox.pending("t")[1].position).toBe(1);
    void a;
    void c;
  });

  it("reorders queued messages with position clamping", () => {
    const inbox = new CommandInbox();
    inbox.setBusy("t");
    const a = inbox.submit("t", "a");
    const b = inbox.submit("t", "b");
    const c = inbox.submit("t", "c");

    // Move "c" to the front; clamp out-of-range positions.
    inbox.reorder(c.id, -5);
    expect(inbox.pending("t").map((m) => m.content)).toEqual(["c", "a", "b"]);

    inbox.reorder(c.id, 99);
    expect(inbox.pending("t").map((m) => m.content)).toEqual(["a", "b", "c"]);
    void a;
    void b;
  });

  it("clears a thread queue and reports how many were dropped", () => {
    const inbox = new CommandInbox();
    inbox.setBusy("t");
    inbox.setBusy("t2");
    inbox.submit("t", "a");
    inbox.submit("t", "b");
    const other = inbox.submit("t2", "other-thread-msg");

    expect(inbox.clear("t")).toBe(2);
    expect(inbox.pending("t")).toHaveLength(0);
    // Other threads untouched — clear is per-thread.
    expect(inbox.get(other.id)?.status).toBe("queued");
  });

  it("drops the oldest message when the per-thread cap is hit", () => {
    const inbox = new CommandInbox({ maxQueuedPerThread: 2 });
    inbox.setBusy("t");
    const a = inbox.submit("t", "a");
    inbox.submit("t", "b");
    const c = inbox.submit("t", "c"); // over cap → oldest dropped

    expect(a.status).toBe("dropped");
    expect(a.statusDetail).toContain("per-thread");
    expect(inbox.pending("t").map((m) => m.content)).toEqual(["b", "c"]);
  });

  it("drops the submission when the global cap is hit", () => {
    const inbox = new CommandInbox({ maxQueuedTotal: 1 });
    inbox.setBusy("t1");
    inbox.setBusy("t2");
    inbox.submit("t1", "a");
    const b = inbox.submit("t2", "b"); // global cap → this one dropped

    expect(b.status).toBe("dropped");
    expect(b.statusDetail).toContain("global");
    expect(inbox.pending("t1")).toHaveLength(1);
  });

  it("prunes terminal messages older than the retention window", () => {
    const inbox = new CommandInbox();
    const message = inbox.submit("t", "old admitted");
    expect(message.status).toBe("admitted");

    const realNow = Date.now.bind(Date);
    const spy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + 60_000);
    const removed = inbox.prune(30_000);
    spy.mockRestore();

    expect(removed).toBe(1);
    expect(inbox.get(message.id)).toBeUndefined();
  });

  it("notifies change listeners for every transition", () => {
    const events: Array<{ id: string; status: string }> = [];
    const inbox = new CommandInbox({ onChange: (m) => events.push({ id: m.id, status: m.status }) });

    inbox.setBusy("t");
    const a = inbox.submit("t", "a");
    inbox.cancel(a.id);

    expect(events.map((e) => e.status)).toEqual(["queued", "cancelled"]);
  });

  it("recent() returns messages newest-first across statuses", () => {
    const inbox = new CommandInbox();
    inbox.setBusy("t");
    const a = inbox.submit("t", "a");
    const b = inbox.submit("t", "b");

    const recent = inbox.recent("t");
    expect(recent[0].id).toBe(b.id);
    expect(recent[1].id).toBe(a.id);
  });
});

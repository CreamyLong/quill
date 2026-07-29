import { describe, expect, it } from "vitest";

import { sanitizeLegacyCommandRepr } from "../store/base.ts";
import { MemoryRunEventStore } from "../store/memory.ts";

/** Insert one event through the public put() API. */
async function put(
  store: MemoryRunEventStore,
  runId: string,
  event_type: string,
  category: string,
  content: unknown,
  metadata: Record<string, unknown>,
) {
  return store.put({
    thread_id: "thread-1",
    run_id: runId,
    event_type,
    category,
    content,
    metadata,
  });
}

describe("RunEventStore.listEvents filters", () => {
  it("filters by event_types", async () => {
    const store = new MemoryRunEventStore();
    await put(store, "r1", "subagent.start", "subagent", "a", { task_id: "k1" });
    await put(store, "r1", "subagent.step", "subagent", "b", { task_id: "k1" });
    await put(store, "r1", "message", "message", "msg", {});

    const steps = await store.listEvents("thread-1", "r1", {
      event_types: ["subagent.step"],
    });
    expect(steps.map((e) => e.event_type)).toEqual(["subagent.step"]);
    expect(steps[0]!.content).toBe("b");
  });

  it("filters by task_id", async () => {
    const store = new MemoryRunEventStore();
    await put(store, "r1", "subagent.step", "subagent", "s1", { task_id: "k1" });
    await put(store, "r1", "subagent.step", "subagent", "s2", { task_id: "k2" });
    await put(store, "r1", "subagent.step", "subagent", "s3", { task_id: "k1" });

    const k1 = await store.listEvents("thread-1", "r1", { task_id: "k1" });
    expect(k1.map((e) => e.content)).toEqual(["s1", "s3"]);
  });

  it("filters by category", async () => {
    const store = new MemoryRunEventStore();
    await put(store, "r1", "subagent.step", "subagent", "a", { task_id: "k1" });
    await put(store, "r1", "message", "message", "msg", {});

    const subagent = await store.listEvents("thread-1", "r1", { category: "subagent" });
    expect(subagent).toHaveLength(1);
    expect(subagent[0]!.event_type).toBe("subagent.step");
  });

  it("forward-paginates with after_seq cursor", async () => {
    const store = new MemoryRunEventStore();
    for (let i = 0; i < 6; i++) {
      await put(store, "r1", "subagent.step", "subagent", `s${i}`, { task_id: "k1" });
    }
    const all = await store.listEvents("thread-1", "r1", { limit: 100 });
    expect(all).toHaveLength(6);
    const lastSeq = all[all.length - 1]!.seq;

    // Page 1: first 2
    const p1 = await store.listEvents("thread-1", "r1", { limit: 2 });
    expect(p1).toHaveLength(2);
    const afterSeq = p1[p1.length - 1]!.seq;

    // Page 2: next after cursor
    const p2 = await store.listEvents("thread-1", "r1", { limit: 100, after_seq: afterSeq });
    expect(p2.map((e) => e.content)).toEqual(["s2", "s3", "s4", "s5"]);
    // last page returns fewer than limit (no has_more)
    const p3 = await store.listEvents("thread-1", "r1", { limit: 100, after_seq: lastSeq });
    expect(p3).toHaveLength(0);
  });

  it("sanitizes legacy Command(update=...) repr in listMessages", async () => {
    const store = new MemoryRunEventStore();
    // Legacy buggy content: str(Command(update={'messages':[ToolMessage(content='actual result')]}))
    await put(store, "r1", "llm.tool.result", "message", "Command(update={'messages':[ToolMessage(content='actual result')]})", {});
    // Normal structured content — should pass through unchanged.
    await put(store, "r1", "llm.ai.response", "message", { type: "ai", content: "normal answer" }, {});
    // Plain string that does NOT start with "Command(update=" — unchanged.
    await put(store, "r1", "llm.tool.result", "message", "just a plain tool result", {});

    const messages = await store.listMessages("thread-1", { limit: 100 });
    expect(messages).toHaveLength(3);
    expect(messages[0]!.content).toBe("actual result");
    expect(messages[1]!.content).toEqual({ type: "ai", content: "normal answer" });
    expect(messages[2]!.content).toBe("just a plain tool result");
  });

  it("sanitizes legacy Command repr in listEvents", async () => {
    const store = new MemoryRunEventStore();
    await put(store, "r1", "llm.tool.result", "message", "Command(update={'messages':[ToolMessage(content='extracted')]})", {});

    const events = await store.listEvents("thread-1", "r1", { limit: 100 });
    expect(events).toHaveLength(1);
    expect(events[0]!.content).toBe("extracted");
  });

  it("sanitizes legacy Command repr in listMessagesByRun", async () => {
    const store = new MemoryRunEventStore();
    await put(store, "r1", "llm.tool.result", "message", "Command(update={'messages':[ToolMessage(content='by-run value')]})", {});

    const messages = await store.listMessagesByRun("thread-1", "r1", { limit: 100 });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe("by-run value");
  });

  it("leaves non-matching Command-like strings unchanged", async () => {
    const store = new MemoryRunEventStore();
    // Starts with "Command(update=" but has no ToolMessage inside — returned as-is.
    await put(store, "r1", "llm.tool.result", "message", "Command(update={'goto': 'NODE_X'})", {});

    const messages = await store.listMessages("thread-1", { limit: 100 });
    expect(messages[0]!.content).toBe("Command(update={'goto': 'NODE_X'})");
  });

  it("combines task_id + after_seq for subagent backfill paging", async () => {
    const store = new MemoryRunEventStore();
    for (let i = 0; i < 4; i++) {
      await put(store, "r1", "subagent.step", "subagent", `k1-s${i}`, { task_id: "k1" });
    }
    for (let i = 0; i < 4; i++) {
      await put(store, "r1", "subagent.step", "subagent", `k2-s${i}`, { task_id: "k2" });
    }
    // Page through k1 only.
    const page1 = await store.listEvents("thread-1", "r1", { task_id: "k1", limit: 2, event_types: ["subagent.step"] });
    expect(page1.map((e) => e.content)).toEqual(["k1-s0", "k1-s1"]);
    const next = await store.listEvents("thread-1", "r1", {
      task_id: "k1",
      limit: 2,
      after_seq: page1[page1.length - 1]!.seq,
      event_types: ["subagent.step"],
    });
    expect(next.map((e) => e.content)).toEqual(["k1-s2", "k1-s3"]);
  });
});

describe("sanitizeLegacyCommandRepr", () => {
  it("extracts single-quoted ToolMessage content", () => {
    expect(
      sanitizeLegacyCommandRepr("Command(update={'messages':[ToolMessage(content='hello')]})"),
    ).toBe("hello");
  });

  it("extracts double-quoted ToolMessage content", () => {
    expect(
      sanitizeLegacyCommandRepr('Command(update={"messages":[ToolMessage(content="hello")]}'),
    ).toBe("hello");
  });

  it("returns non-string content unchanged", () => {
    expect(sanitizeLegacyCommandRepr({ type: "tool", content: "x" })).toEqual({ type: "tool", content: "x" });
    expect(sanitizeLegacyCommandRepr(42)).toBe(42);
    expect(sanitizeLegacyCommandRepr(null)).toBe(null);
  });

  it("returns plain strings unchanged", () => {
    expect(sanitizeLegacyCommandRepr("just a normal string")).toBe("just a normal string");
  });

  it("returns Command-without-ToolMessage unchanged", () => {
    expect(sanitizeLegacyCommandRepr("Command(update={'goto': 'X'})")).toBe(
      "Command(update={'goto': 'X'})",
    );
  });
});

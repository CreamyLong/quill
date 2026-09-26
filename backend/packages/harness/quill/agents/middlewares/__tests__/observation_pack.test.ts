/**
 * Tests for ObservationPack (SoL-Pi pattern, awesome-harness-engineering).
 *
 * Covers threshold packing, content-addressed dedupe, exact paged recall,
 * LRU eviction, TTL expiry, and the middleware tool-call wrapper.
 */

import { describe, expect, it } from "vitest";

import { ObservationStore, createObservationPackMiddleware } from "../observation_pack.js";

function bigText(chars: number, seed = "x"): string {
  return seed.repeat(chars);
}

describe("ObservationStore", () => {
  it("passes small results through unchanged", () => {
    const store = new ObservationStore({ thresholdChars: 100 });
    const out = store.pack("read_file", "short content");
    expect(out).toBe("short content");
    expect(store.size).toBe(0);
  });

  it("packs large results into a handle card", () => {
    const store = new ObservationStore({ thresholdChars: 100 });
    const content = bigText(500);
    const out = store.pack("bash", content);

    expect(out).not.toBe(content);
    expect(out).toContain("obs://");
    expect(out).toContain("[ObservationPack]");
    expect(out).toContain("bash");
    expect(out).toContain("500 chars");
    expect(store.size).toBe(1);
  });

  it("dedupes identical content to the same handle (stable across repeats)", () => {
    const store = new ObservationStore({ thresholdChars: 100 });
    const content = bigText(500, "a");

    const first = store.pack("bash", content);
    const second = store.pack("bash", content);

    const handle1 = first.match(/obs:\/\/([0-9a-f]+)/)![1];
    const handle2 = second.match(/obs:\/\/([0-9a-f]+)/)![1];
    expect(handle1).toBe(handle2);
    expect(second).toContain("seen 2×");
    expect(store.size).toBe(1);
  });

  it("different content gets different handles", () => {
    const store = new ObservationStore({ thresholdChars: 100 });
    store.pack("bash", bigText(500, "a"));
    store.pack("bash", bigText(500, "b"));
    expect(store.size).toBe(2);
  });

  it("recalls exact character pages", () => {
    const store = new ObservationStore({ thresholdChars: 10 });
    const content = "0123456789abcdefghij"; // 20 chars
    const card = store.pack("read_file", content);
    const id = card.match(/obs:\/\/([0-9a-f]+)/)![1];

    const page1 = store.recall(`obs://${id}`, 0, 10);
    expect(page1).toMatchObject({ offset: 0, total: 20, hasMore: true });
    expect(page1!.text).toBe("0123456789");

    const page2 = store.recall(`obs://${id}`, 10, 10);
    expect(page2!.text).toBe("abcdefghij");
    expect(page2!.hasMore).toBe(false);

    // Out-of-range offset clamps to the end.
    const clamped = store.recall(`obs://${id}`, 99, 5);
    expect(clamped!.offset).toBe(20);
    expect(clamped!.text).toBe("");
  });

  it("resolve() returns the full record", () => {
    const store = new ObservationStore({ thresholdChars: 10 });
    const card = store.pack("read_file", "0123456789abcdefghij");
    const id = card.match(/obs:\/\/([0-9a-f]+)/)![1];

    const record = store.resolve(`obs://${id}`);
    expect(record?.tool).toBe("read_file");
    expect(record?.length).toBe(20);
    expect(record?.content).toBe("0123456789abcdefghij");
  });

  it("evicts least-recently-used entries at capacity", () => {
    const store = new ObservationStore({ thresholdChars: 10, maxEntries: 2 });
    const a = store.pack("t", bigText(50, "a"));
    store.pack("t", bigText(50, "b"));
    store.pack("t", bigText(50, "c")); // evicts a (LRU)

    expect(store.size).toBe(2);
    const idA = a.match(/obs:\/\/([0-9a-f]+)/)![1];
    expect(store.resolve(`obs://${idA}`)).toBeUndefined();
  });

  it("refreshes LRU recency on repeated access", () => {
    const store = new ObservationStore({ thresholdChars: 10, maxEntries: 2 });
    const a = store.pack("t", bigText(50, "a"));
    store.pack("t", bigText(50, "b"));
    store.pack("t", bigText(50, "a")); // refresh a; b is now LRU
    store.pack("t", bigText(50, "c")); // evicts b

    const idA = a.match(/obs:\/\/([0-9a-f]+)/)![1];
    expect(store.resolve(`obs://${idA}`)).toBeDefined();
    expect(store.size).toBe(2);
  });

  it("expires records past the TTL", () => {
    const store = new ObservationStore({ thresholdChars: 10, ttlMs: 50 });
    const card = store.pack("t", bigText(50, "a"));
    const id = card.match(/obs:\/\/([0-9a-f]+)/)![1];

    const original = Date.now;
    Date.now = () => original() + 100;
    try {
      expect(store.list()).toEqual([]);
      expect(store.recall(`obs://${id}`)).toBeUndefined();
    } finally {
      Date.now = original;
    }
  });

  it("recall of unknown handles returns undefined", () => {
    const store = new ObservationStore();
    expect(store.recall("obs://deadbeef0000")).toBeUndefined();
    expect(store.recall("not-a-handle")).toBeUndefined();
  });
});

describe("createObservationPackMiddleware", () => {
  it("wraps large tool results and leaves small ones alone", async () => {
    const middleware = createObservationPackMiddleware({ thresholdChars: 50 });
    const wrapped = middleware.wrapToolCall!;

    // Small result passes through.
    const small = await wrapped(
      { name: "read_file", args: {}, tool_call_id: "1", state: {} as never },
      async () => ({ content: "tiny" }) as never,
    );
    expect((small as { content: string }).content).toBe("tiny");

    // Large result is packed.
    const large = await wrapped(
      { name: "bash", args: {}, tool_call_id: "2", state: {} as never },
      async () => ({ content: bigText(500) }) as never,
    );
    const content = (large as { content: string }).content;
    expect(content).toContain("obs://");
    expect(content).not.toBe(bigText(500));
  });

  it("exposes the shared store for recall tooling", () => {
    const middleware = createObservationPackMiddleware({ thresholdChars: 10 });
    expect(middleware.name).toBe("observation_pack");
    expect(middleware.store).toBeInstanceOf(ObservationStore);

    const card = middleware.store.pack("t", "0123456789abcdefghij");
    const id = card.match(/obs:\/\/([0-9a-f]+)/)![1];
    expect(middleware.store.recall(`obs://${id}`, 0, 5)!.text).toBe("01234");
  });

  it("passes non-string (multimodal) content through untouched", async () => {
    const middleware = createObservationPackMiddleware({ thresholdChars: 10 });
    const blocks = [{ type: "image", data: "x".repeat(10_000) }];
    const result = await middleware.wrapToolCall!(
      { name: "view_image", args: {}, tool_call_id: "3", state: {} as never },
      async () => ({ content: blocks }) as never,
    );
    expect((result as { content: unknown }).content).toBe(blocks);
  });
});

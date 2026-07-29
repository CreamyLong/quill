/**
 * Regression test for Bug 1: /history endpoint loses original messages after
 * summarization.
 *
 * The /history endpoint used to read messages from checkpoint state alone, which
 * SummarizationMiddleware mutates in place — removing original human messages
 * before the summary point. After the fix, /history reads from the event store
 * (append-only log) which preserves all original messages, and splices them
 * into the state snapshot returned to the SDK.
 */

import http from "node:http";

import { describe, expect, it } from "vitest";

import { MemoryRunEventStore } from "../../runtime/events/store/memory.ts";
import { createGatewayServer } from "../gateway.ts";

/** Minimal POST helper. */
function post(url: string, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, json: JSON.parse(chunks) });
          } catch {
            reject(new Error(`non-JSON response: ${chunks.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

describe("GET /threads/{id}/history (Bug 1 fix)", () => {
  it("returns event-store messages even when checkpoint holds only a summary", async () => {
    // Pre-populate the event store with original messages as if a run had
    // written them before summarization fired.
    const eventStore = new MemoryRunEventStore();
    const threadId = "test-thread-1";
    await eventStore.put({
      thread_id: threadId,
      run_id: "run-original",
      event_type: "llm.human.input",
      category: "message",
      content: { type: "human", content: "最新伊美局势", id: "h1" },
      metadata: { caller: "user" },
    });
    await eventStore.put({
      thread_id: threadId,
      run_id: "run-original",
      event_type: "llm.ai.response",
      category: "message",
      content: { type: "ai", content: "Here is the analysis...", id: "a1" },
      metadata: { caller: "lead_agent" },
    });

    // Create a gateway with the pre-populated event store and NO graph
    // (we only test the /history route, which doesn't invoke the graph).
    const server = createGatewayServer({
      graph: undefined as any,
      models: [],
      eventStore,
    });

    // Create the thread via the API so the gateway knows about it.
    const port = 0;
    await new Promise<void>((resolve) => server.server.listen(0, resolve));
    const addr = server.server.address();
    const base = `http://localhost:${(addr as any).port}`;

    try {
      // Create thread.
      const created = await post(`${base}/api/threads`, {});
      expect(created.status).toBe(200);
      const tid = created.json.thread_id;

      // Pre-populate event store for this actual thread id.
      await eventStore.put({
        thread_id: tid,
        run_id: "run-1",
        event_type: "llm.human.input",
        category: "message",
        content: { type: "human", content: "first question", id: "m1" },
        metadata: { caller: "user" },
      });
      await eventStore.put({
        thread_id: tid,
        run_id: "run-1",
        event_type: "llm.ai.response",
        category: "message",
        content: { type: "ai", content: "first answer", id: "m2" },
        metadata: { caller: "lead_agent" },
      });
      await eventStore.put({
        thread_id: tid,
        run_id: "run-2",
        event_type: "llm.human.input",
        category: "message",
        content: { type: "human", content: "second question", id: "m3" },
        metadata: { caller: "user" },
      });

      // Call /history — the checkpoint (t.values.messages) is empty because
      // no run has executed through the graph, but the event store has the
      // original messages. The fix splices them into the response.
      const history = await post(`${base}/api/threads/${tid}/history`, {});
      expect(history.status).toBe(200);
      expect(Array.isArray(history.json)).toBe(true);
      expect(history.json.length).toBe(1);

      const values = history.json[0].values;
      expect(values).toBeDefined();
      const messages = values.messages ?? [];
      expect(messages.length).toBe(3);
      expect(messages[0].content).toBe("first question");
      expect(messages[1].content).toBe("first answer");
      expect(messages[2].content).toBe("second question");
    } finally {
      server.server.close();
    }
  });

  it("falls back to checkpoint messages when event store is empty", async () => {
    const eventStore = new MemoryRunEventStore();
    const server = createGatewayServer({
      graph: undefined as any,
      models: [],
      eventStore,
    });

    await new Promise<void>((resolve) => server.server.listen(0, resolve));
    const addr = server.server.address();
    const base = `http://localhost:${(addr as any).port}`;

    try {
      const created = await post(`${base}/api/threads`, {});
      const tid = created.json.thread_id;

      // No events written — event store is empty for this thread.
      // /history should fall back to checkpoint (t.values.messages), which
      // is empty for a freshly created thread.
      const history = await post(`${base}/api/threads/${tid}/history`, {});
      expect(history.status).toBe(200);
      const values = history.json[0].values;
      expect(values.messages).toEqual([]);
    } finally {
      server.server.close();
    }
  });
});

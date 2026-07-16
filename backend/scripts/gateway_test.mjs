/**
 * End-to-end test for the TS gateway server using a fake chat model.
 *
 * Verifies the LangGraph-SDK SSE contract without needing a real API key:
 *   - metadata event carries run_id; Content-Location header is set
 *   - messages (messages-tuple) events carry the AI reply
 *   - final values event holds [system?, human, ai] with NO duplicate human
 *   - multi-turn: a second run on the same thread retains prior history
 *
 * Run: cd backend && npm run build && npm run gateway:test
 */

import assert from "node:assert";

import { FakeListChatModel } from "@langchain/core/utils/testing";
import { MemorySaver } from "@langchain/langgraph";

import { createQuillAgent } from "../dist/packages/harness/quill/agents/factory.js";
import { createGatewayServer } from "../dist/packages/harness/quill/server/gateway.js";

const PORT = 8199;
const BASE = `http://localhost:${PORT}`;

function buildServer(responses) {
  const model = new FakeListChatModel({ responses });
  const graph = createQuillAgent({
    model,
    systemPrompt: "You are a tester.",
    planMode: false,
    checkpointer: new MemorySaver(),
  });
  return createGatewayServer({
    graph,
    models: [
      {
        id: "fake",
        name: "fake",
        model: "fake",
        display_name: "Fake",
      },
    ],
  });
}

/** Read an SSE response body and parse it into [{event, data}] records. */
async function readSse(res) {
  const events = [];
  let cur = {};
  let buffer = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("event: ")) cur.event = line.slice(7);
      else if (line.startsWith("data: ")) cur.data = line.slice(6);
      else if (line === "") {
        if (cur.event) events.push(cur);
        cur = {};
      }
    }
  }
  if (cur.event) events.push(cur);
  return events;
}

async function postRun(threadId, text, id) {
  const res = await fetch(`${BASE}/api/threads/${threadId}/runs/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assistant_id: "lead_agent",
      input: {
        messages: [{ type: "human", id, content: [{ type: "text", text }] }],
      },
      stream_mode: ["messages-tuple", "values", "updates"],
      context: { thread_id: threadId },
    }),
  });
  return res;
}

function finalValuesMessages(events) {
  const values = events.filter((e) => e.event === "values");
  assert.ok(values.length > 0, "expected at least one values event");
  return JSON.parse(values[values.length - 1].data).messages ?? [];
}

async function main() {
  const server = buildServer(["Hello there, friend.", "Second answer."]);
  await new Promise((resolve) => server.listen(PORT, resolve));

  try {
    // --- create thread ---
    const created = await (
      await fetch(`${BASE}/api/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).json();
    const threadId = created.thread_id;
    assert.ok(threadId, "thread create returned no id");

    // --- turn 1 ---
    const res1 = await postRun(threadId, "hi", "h1");
    assert.strictEqual(res1.status, 200, "run stream should be 200");
    const contentLocation = res1.headers.get("content-location");
    assert.match(
      contentLocation ?? "",
      /\/threads\/.+\/runs\/.+/,
      "Content-Location header must encode run_id",
    );
    const events1 = await readSse(res1);

    const meta = events1.find((e) => e.event === "metadata");
    assert.ok(meta, "missing metadata event");
    assert.ok(JSON.parse(meta.data).run_id, "metadata missing run_id");

    const msgEvents = events1.filter((e) => e.event === "messages");
    assert.ok(msgEvents.length > 0, "expected messages-tuple events");
    const aiText = msgEvents
      .map((e) => {
        const [m] = JSON.parse(e.data);
        return m.type === "ai" ? String(m.content ?? "") : "";
      })
      .join("");
    assert.ok(
      aiText.includes("Hello there"),
      `AI reply not streamed via messages events (got: ${JSON.stringify(aiText)})`,
    );

    const msgs1 = finalValuesMessages(events1);
    const types1 = msgs1.map((m) => m.type);
    assert.strictEqual(
      types1.filter((t) => t === "human").length,
      1,
      `expected exactly one human message, got ${JSON.stringify(types1)}`,
    );
    assert.ok(types1.includes("ai"), "final values missing AI reply");
    assert.ok(types1.includes("system"), "system prompt should be present in persisted state");
    console.log("✓ turn 1: metadata + streamed AI reply + no duplicate human");

    // --- turn 2: multi-turn memory on same thread ---
    const res2 = await postRun(threadId, "again", "h2");
    const events2 = await readSse(res2);
    const msgs2 = finalValuesMessages(events2);
    const humanCount = msgs2.filter((m) => m.type === "human").length;
    const aiCount = msgs2.filter((m) => m.type === "ai").length;
    assert.strictEqual(humanCount, 2, `expected 2 human messages after turn 2, got ${humanCount}`);
    assert.ok(aiCount >= 2, `expected >=2 AI messages after turn 2, got ${aiCount}`);
    console.log("✓ turn 2: prior history retained, no duplication (multi-turn memory works)");

    // --- thread search reflects state ---
    const search = await (
      await fetch(`${BASE}/api/threads/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50 }),
      })
    ).json();
    assert.ok(Array.isArray(search) && search.length === 1, "search should return the thread");
    assert.ok(search[0].values.title, "thread should have an auto-derived title");
    console.log("✓ thread search returns thread with derived title");

    console.log("\nAll gateway tests passed.");
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

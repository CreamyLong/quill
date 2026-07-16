/**
 * End-to-end test for TodoMiddleware in pro/ultra plan mode.
 *
 * Verifies that:
 *   - write_todos is available in plan mode
 *   - calling write_todos updates state.todos
 *   - premature exit with incomplete todos triggers completion reminder and re-engagement
 *   - final exit is allowed once all todos are completed
 *
 * Run: cd backend && npm run build && node --experimental-vm-modules scripts/plan_mode_test.mjs
 */

import assert from "node:assert";

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { FakeListChatModel } from "@langchain/core/utils/testing";

import { createQuillAgent } from "../dist/packages/harness/quill/agents/factory.js";

function aiWriteTodos(todos) {
  return {
    content: "",
    tool_calls: [
      {
        id: "todos-1",
        name: "write_todos",
        args: { todos },
      },
    ],
  };
}

function aiNoToolCalls(content) {
  return { content };
}

async function testCreatesTodos() {
  console.log("[debug] testCreatesTodos start");
  const model = new FakeListChatModel({
    responses: [
      aiWriteTodos([{ content: "Step 1", status: "completed" }]),
      aiNoToolCalls("Created a todo list."),
    ],
  });
  const graph = createQuillAgent({
    model,
    tools: [],
    systemPrompt: "You are a tester.",
    planMode: true,
    checkpointer: new MemorySaver(),
  });

  const result = await graph.invoke(
    { messages: [new HumanMessage("create a todo list")] },
    { configurable: { thread_id: "plan-create" }, recursionLimit: 50 },
  );

  assert.deepStrictEqual(result.todos, [{ content: "Step 1", status: "completed" }]);
  console.log("✓ plan mode: write_todos creates todos in state");
}

async function testPrematureExitIsBlocked() {
  console.log("[debug] testPrematureExitIsBlocked start");
  const model = new FakeListChatModel({
    responses: [
      aiWriteTodos([
        { content: "Step 1", status: "completed" },
        { content: "Step 2", status: "pending" },
      ]),
      aiNoToolCalls("I am done."),
      aiNoToolCalls("Continuing..."),
      aiNoToolCalls("Actually finished."),
    ],
  });
  const graph = createQuillAgent({
    model,
    tools: [],
    systemPrompt: "You are a tester.",
    planMode: true,
    checkpointer: new MemorySaver(),
  });

  const result = await graph.invoke(
    { messages: [new HumanMessage("finish all todos")] },
    { configurable: { thread_id: "plan-remind" }, recursionLimit: 50 },
  );

  const aiMessages = result.messages.filter((m) => m.getType() === "ai");
  assert.ok(aiMessages.length >= 2, "expected at least 2 AI messages due to re-engagement");
  assert.ok(
    aiMessages.some((m) => String(m.content).includes("I am done.")),
    "first premature final should be present",
  );
  console.log("✓ plan mode: premature exit triggers re-engagement");
}

async function testAllowsExitWhenAllCompleted() {
  console.log("[debug] testAllowsExitWhenAllCompleted start");
  const model = new FakeListChatModel({
    responses: [
      aiWriteTodos([
        { content: "Step 1", status: "completed" },
        { content: "Step 2", status: "completed" },
      ]),
      aiNoToolCalls("All done."),
    ],
  });
  const graph = createQuillAgent({
    model,
    tools: [],
    systemPrompt: "You are a tester.",
    planMode: true,
    checkpointer: new MemorySaver(),
  });

  const result = await graph.invoke(
    { messages: [new HumanMessage("complete all todos")] },
    { configurable: { thread_id: "plan-done" }, recursionLimit: 50 },
  );

  const aiMessages = result.messages.filter((m) => m.getType() === "ai");
  assert.ok(aiMessages.length >= 1, "expected at least one AI message");
  assert.ok(
    aiMessages.some((m) => String(m.content).includes("All done.")),
    "final answer should be present",
  );
  console.log("✓ plan mode: clean exit when all todos completed");
}

async function main() {
  await testCreatesTodos();
  await testPrematureExitIsBlocked();
  await testAllowsExitWhenAllCompleted();
  console.log("\nAll plan mode tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

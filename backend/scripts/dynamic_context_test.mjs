/**
 * Test the ported dynamic-context middleware.
 *
 * Run: cd backend && npm run build && node --experimental-vm-modules scripts/dynamic_context_test.mjs
 */

import assert from "node:assert";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { dynamicContextMiddleware, isDynamicContextReminder } from "../dist/packages/harness/quill/agents/middlewares/dynamic_context_middleware.js";
import { setMemoryConfig, getMemoryConfig } from "../dist/packages/harness/quill/config/memory_config.js";

async function testFirstTurnInjection() {
  const originalConfig = getMemoryConfig();
  setMemoryConfig({ ...originalConfig, enabled: true, injectionEnabled: true });

  const middleware = dynamicContextMiddleware({ getMemoryContext: () => "" });
  const userMsg = new HumanMessage({ content: "Hello", id: "msg-1" });
  const state = { messages: [userMsg] };
  const update = middleware.beforeModel(state);
  assert.ok(update, "expected an update");
  const msgs = update.messages;
  assert.strictEqual(msgs.length, 2, "expected system reminder + user clone");
  assert.ok(msgs[0] instanceof SystemMessage, "first message should be SystemMessage");
  assert.ok(isDynamicContextReminder(msgs[0]), "system reminder should be marked");
  assert.ok(msgs[1] instanceof HumanMessage, "second message should be HumanMessage");
  assert.strictEqual(msgs[1].id, "msg-1__user", "user message id should be swapped");
  assert.ok(String(msgs[0].content).includes("<current_date>"), "reminder should contain current date");

  console.log("✓ first-turn dynamic-context injection");
}

async function testNoDuplicateInjection() {
  const originalConfig = getMemoryConfig();
  setMemoryConfig({ ...originalConfig, enabled: true, injectionEnabled: true });

  const middleware = dynamicContextMiddleware({ getMemoryContext: () => "" });
  const userMsg = new HumanMessage({ content: "Hello", id: "msg-1" });
  const state1 = { messages: [userMsg] };
  const update1 = middleware.beforeModel(state1);
  const messages = update1.messages;

  // Second call with already-injected messages should be a no-op.
  const state2 = { messages: messages };
  const update2 = middleware.beforeModel(state2);
  assert.deepStrictEqual(update2, {}, "expected no update when reminder already present");
  console.log("✓ no duplicate injection");
}

async function testMidnightCrossing() {
  const originalConfig = getMemoryConfig();
  setMemoryConfig({ ...originalConfig, enabled: true, injectionEnabled: true });

  const middleware = dynamicContextMiddleware({ getMemoryContext: () => "" });
  const userMsg = new HumanMessage({ content: "Hello", id: "msg-1" });
  const state1 = { messages: [userMsg] };
  const update1 = middleware.beforeModel(state1);
  const injected = update1.messages;

  // Simulate an old date in the existing reminder.
  injected[0].additional_kwargs["reminder_date"] = "2020-01-01, Wednesday";

  const nextUser = new HumanMessage({ content: "Follow up", id: "msg-2" });
  const state2 = { messages: [...injected, nextUser] };
  const update2 = middleware.beforeModel(state2);
  assert.ok(update2 && update2.messages, "expected date-update injection");
  assert.strictEqual(update2.messages.length, 2, "expected reminder + user clone");
  assert.strictEqual(update2.messages[1].id, "msg-2__user", "current user message id swapped");
  console.log("✓ midnight crossing injects date update");
}

async function main() {
  await testFirstTurnInjection();
  await testNoDuplicateInjection();
  await testMidnightCrossing();
  console.log("\nAll dynamic-context tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

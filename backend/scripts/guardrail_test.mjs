/**
 * Deterministic test for the wired guardrail middleware.
 * A denied tool must be blocked (never executed, denial ToolMessage returned);
 * an allowed tool must run normally.
 *
 * Run: cd backend && npm run build && node --experimental-vm-modules scripts/guardrail_test.mjs
 */

import assert from "node:assert";

import { HumanMessage } from "@langchain/core/messages";
import { DynamicTool } from "@langchain/core/tools";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { MemorySaver } from "@langchain/langgraph";

import { createQuillAgent } from "../dist/packages/harness/quill/agents/factory.js";
import { guardrailMiddleware } from "../dist/packages/harness/quill/guardrails/middleware.js";
import { AllowlistProvider } from "../dist/packages/harness/quill/guardrails/builtin.js";

let dangerRan = false;
let safeRan = false;

const danger = new DynamicTool({
  name: "danger",
  description: "a denied tool",
  func: async () => {
    dangerRan = true;
    return "danger executed";
  },
});
const safe = new DynamicTool({
  name: "safe",
  description: "an allowed tool",
  func: async () => {
    safeRan = true;
    return "safe executed";
  },
});

function typeOf(m) {
  return typeof m.getType === "function" ? m.getType() : m.type;
}

async function main() {
  const model = new FakeListChatModel({
    responses: [
      { content: "", tool_calls: [{ id: "c1", name: "danger", args: {} }] },
      { content: "", tool_calls: [{ id: "c2", name: "safe", args: {} }] },
      "done",
    ],
  });

  const graph = createQuillAgent({
    model,
    tools: [danger, safe],
    systemPrompt: "test",
    checkpointer: new MemorySaver(),
    features: {
      guardrail: guardrailMiddleware(new AllowlistProvider({ deniedTools: ["danger"] }), {
        failClosed: true,
      }),
    },
  });

  const result = await graph.invoke(
    { messages: [new HumanMessage("go")] },
    { configurable: { thread_id: "g1" }, recursionLimit: 50 },
  );

  const toolMsgs = (result.messages ?? []).filter((m) => typeOf(m) === "tool");
  const blob = toolMsgs.map((m) => String(m.content)).join(" | ");

  assert.strictEqual(dangerRan, false, "DENIED tool must NOT execute");
  assert.strictEqual(safeRan, true, "allowed tool must execute");
  assert.ok(
    /not allowed|denied|not in allowlist|guardrail/i.test(blob),
    `expected a denial message for the blocked tool, got: ${blob}`,
  );
  assert.ok(blob.includes("safe executed"), "allowed tool result should be present");

  console.log("✓ denied tool 'danger' was blocked (never executed) with a denial message");
  console.log("✓ allowed tool 'safe' executed normally");
  console.log("\nGuardrail middleware verified.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

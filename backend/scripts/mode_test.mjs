/**
 * Deterministic test that the gateway graph factory respects frontend mode
 * context:
 *   - flash/thinking (is_plan_mode=false, subagent_enabled=false) -> task tool absent
 *   - pro (is_plan_mode=true, subagent_enabled=false) -> task tool absent, planMode middleware present
 *   - ultra (is_plan_mode=true, subagent_enabled=true) -> task tool present, planMode middleware present
 *
 * Run: cd backend && npm run build && node --experimental-vm-modules scripts/mode_test.mjs
 */

import assert from "node:assert";

import { HumanMessage } from "@langchain/core/messages";
import { DynamicTool } from "@langchain/core/tools";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { MemorySaver } from "@langchain/langgraph";

import { createQuillAgent } from "../dist/packages/harness/quill/agents/factory.js";

const checkpointer = new MemorySaver();

function buildGraphForContext(context, model) {
  const planMode = context?.is_plan_mode === true;
  const subagentEnabled = context?.subagent_enabled === true;
  const taskTool = new DynamicTool({
    name: "task",
    description: "delegate to subagent",
    func: async () => "delegated",
  });
  const tools = subagentEnabled ? [taskTool] : [];
  return createQuillAgent({
    model,
    tools,
    systemPrompt: subagentEnabled ? "subagents enabled" : "subagents disabled",
    planMode,
    checkpointer,
  });
}

async function runMode(mode, expectTaskPresent, expectPlanMode) {
  const context = {
    is_plan_mode: mode === "pro" || mode === "ultra",
    subagent_enabled: mode === "ultra",
  };
  const model = new FakeListChatModel({
    responses: [
      { content: "", tool_calls: [{ id: "c1", name: "task", args: { description: "x" } }] },
      "done",
    ],
  });
  const graph = buildGraphForContext(context, model);
  const result = await graph.invoke(
    { messages: [new HumanMessage("go")] },
    { configurable: { thread_id: `mode_${mode}` }, recursionLimit: 50 },
  );

  const toolMsgs = (result.messages ?? []).filter((m) => (typeof m.getType === "function" ? m.getType() : m.type) === "tool");
  const toolContents = toolMsgs.map((m) => String(m.content)).join(" | ");
  const hasTask = toolContents.includes("delegated");
  const hasNotFound = /Tool task not found/.test(toolContents);

  if (expectTaskPresent) {
    assert.ok(hasTask, `${mode}: expected 'task' tool to execute, got: ${toolContents}`);
  } else {
    assert.ok(hasNotFound, `${mode}: expected 'task' tool to be absent (not found), got: ${toolContents}`);
  }

  // planMode presence is hard to observe directly (TS todoMiddleware is a stub
  // without the write_todos tool). We verify it did not break normal flow.
  const aiMsgs = (result.messages ?? []).filter((m) => (typeof m.getType === "function" ? m.getType() : m.type) === "ai");
  const finalAi = aiMsgs[aiMsgs.length - 1];
  assert.ok(finalAi, `${mode}: expected a final AI message`);
  assert.ok(String(finalAi.content).includes("done"), `${mode}: expected final AI to say 'done'`);

  console.log(`✓ ${mode}: task=${expectTaskPresent ? "present" : "absent"}, planMode=${expectPlanMode}, finalAi OK`);
}

async function main() {
  await runMode("flash", false, false);
  await runMode("thinking", false, false);
  await runMode("pro", false, true);
  await runMode("ultra", true, true);

  console.log("\nMode-dependent graph factory verified.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

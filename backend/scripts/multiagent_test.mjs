/**
 * Deterministic test of multi-agent collaboration (lead -> task -> subagent).
 *
 * Uses FakeListChatModel so it runs in milliseconds and asserts the wiring:
 *   - the lead agent calls the `task` tool,
 *   - the task tool runs a real subagent graph,
 *   - the subagent's report flows back as the tool result,
 *   - the lead synthesizes a final answer that includes the report.
 *
 * Run: cd backend && npm run build && node --experimental-vm-modules scripts/multiagent_test.mjs
 */

import assert from "node:assert";

import { HumanMessage } from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { DynamicTool } from "@langchain/core/tools";
import { MemorySaver } from "@langchain/langgraph";

import { createQuillAgent } from "../dist/packages/harness/quill/agents/factory.js";
import { createTaskTool } from "../dist/packages/harness/quill/tools/builtins/task_tool.js";

let subagentRan = false;

// A fake search tool the subagent can call.
const fakeSearch = new DynamicTool({
  name: "semantic_search",
  description: "fake search",
  func: async () => JSON.stringify({ hits: [{ doc_id: "d1", title: "Base editing review" }] }),
});

// Subagent: one tool call, then a report.
function buildSubagent() {
  const model = new FakeListChatModel({
    responses: [
      { content: "", tool_calls: [{ id: "s1", name: "semantic_search", args: { query: "x" } }] },
      "SUBAGENT REPORT: found doc_id=d1 'Base editing review'.",
    ],
  });
  return createQuillAgent({
    model,
    tools: [fakeSearch],
    systemPrompt: "You are a research subagent.",
    checkpointer: new MemorySaver(),
  });
}

async function runSubagent({ subagentType, description, prompt }, config) {
  subagentRan = true;
  // `prompt` is the detailed task body; the subagent must receive it (not the
  // short `description` label).
  const taskBody = prompt || description;
  assert.ok(taskBody.includes("CRISPR"), "subagent should receive the delegated task body");
  const g = buildSubagent();
  const res = await g.invoke(
    { messages: [new HumanMessage(taskBody)] },
    { configurable: { thread_id: `sub-${subagentType}-${Date.now()}` }, recursionLimit: 50 },
  );
  const msgs = res.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].getType() === "ai") return String(msgs[i].content ?? "");
  }
  return "";
}

async function main() {
  const taskTool = createTaskTool({
    runSubagent,
    defaultSubagent: "research",
    subagents: [{ name: "research", description: "literature specialist" }],
  });

  // Lead: delegate via `task`, then synthesize. Mirrors the real lead-agent
  // prompt, which teaches the model to call task(description=<short>, prompt=<detailed>, subagent_type=...).
  const leadModel = new FakeListChatModel({
    responses: [
      {
        content: "",
        tool_calls: [
          {
            id: "t1",
            name: "task",
            args: {
              description: "CRISPR base editing survey",
              prompt: "Survey CRISPR base editing key directions.",
              subagent_type: "research",
            },
          },
        ],
      },
      "FINAL: Per the subagent, base editing review doc_id=d1 covers the key directions.",
    ],
  });

  const lead = createQuillAgent({
    model: leadModel,
    tools: [taskTool],
    systemPrompt: "You are the lead agent. Delegate research via `task`.",
    checkpointer: new MemorySaver(),
  });

  const result = await lead.invoke(
    { messages: [new HumanMessage("Survey CRISPR base editing.")] },
    { configurable: { thread_id: "lead-1" }, recursionLimit: 50 },
  );

  const msgs = result.messages ?? [];
  const types = msgs.map((m) => m.getType());

  assert.ok(subagentRan, "subagent was never executed");
  assert.ok(types.includes("tool"), "no tool message — `task` tool did not run");

  const toolMsg = msgs.find((m) => m.getType() === "tool");
  assert.ok(
    String(toolMsg.content).includes("SUBAGENT REPORT"),
    `task result should carry the subagent report, got: ${String(toolMsg?.content).slice(0, 120)}`,
  );

  const finalAi = [...msgs].reverse().find((m) => m.getType() === "ai");
  assert.ok(
    String(finalAi.content).includes("FINAL"),
    "lead agent did not produce a final synthesized answer",
  );

  console.log("✓ lead agent delegated to `task` tool");
  console.log("✓ subagent executed (with its own tool call) and returned a report");
  console.log("✓ report flowed back to the lead as the tool result");
  console.log("✓ lead synthesized the final answer");
  console.log("\nMulti-agent collaboration plumbing verified.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

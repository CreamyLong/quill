/**
 * Diagnostic: verify that pro mode (planMode=true) assembles the
 * TodoMiddleware and exposes the `write_todos` tool to the model.
 *
 * Run: cd backend && npm run build && node --experimental-vm-modules scripts/diagnose_todo.mjs
 */

import assert from "node:assert";

import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";

import { createQuillAgent } from "../dist/packages/harness/quill/agents/factory.js";
import { applyPromptTemplate } from "../dist/packages/harness/quill/agents/lead_agent/prompt.js";

// A fake model that emits a write_todos tool call on the first turn,
// then a plain "done" on the second. This lets us observe whether the
// graph recognises write_todos (ToolMessage with "Updated todo list")
// or rejects it ("Tool write_todos not found").
class FakeTodoModel {
  constructor() {
    this.callCount = 0;
    this.lastMessages = null;
  }
  async invoke(messages) {
    this.lastMessages = messages;
    this.callCount += 1;
    if (this.callCount === 1) {
      // Return an AIMessage with a write_todos tool call.
      const { AIMessage } = await import("@langchain/core/messages");
      return new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "tc_write_todos_1",
            name: "write_todos",
            args: {
              todos: [
                { content: "Step 1: plan", status: "in_progress" },
                { content: "Step 2: execute", status: "pending" },
              ],
            },
          },
        ],
      });
    }
    const { AIMessage } = await import("@langchain/core/messages");
    return new AIMessage({ content: "done" });
  }
  bindTools() {
    return this;
  }
  withConfig() {
    return this;
  }
}

async function main() {
  console.log("=== Diagnosing TodoMiddleware assembly in pro mode ===\n");

  // --- Case 1: planMode=true (pro mode) ---
  // Reproduce the production wiring (post-fix):
  // - applyPromptTemplate({ subagentEnabled: false, ... }) — no planMode
  //   parameter; pro mode does NOT alter the system prompt (mirrors Python).
  // - createQuillAgent({ ..., planMode: true }) — planMode still controls
  //   whether TodoMiddleware joins the middleware chain.
  // - TodoMiddleware.wrapModelCall injects <todo_list_system> into the system
  //   message at runtime; this is the ONLY prompt-level difference in pro mode.
  const proSystemPrompt = applyPromptTemplate({
    subagentEnabled: false,
    maxConcurrentSubagents: 3,
    appConfig: null,
    availableSkills: null,
    deferredNames: new Set(),
  });
  console.log("[pro mode] applyPromptTemplate output (first 400 chars):", proSystemPrompt.slice(0, 400));
  console.log("[pro mode] output contains <plan_mode>:", proSystemPrompt.includes("<plan_mode>"));
  console.log();

  {
    const model = new FakeTodoModel();
    const checkpointer = new MemorySaver();
    const graph = createQuillAgent({
      model,
      tools: [],
      systemPrompt: proSystemPrompt,
      planMode: true,
      checkpointer,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("Please help me with a multi-step task.")] },
      { configurable: { thread_id: "pro_test" }, recursionLimit: 50 },
    );

    const toolMsgs = (result.messages ?? []).filter(
      (m) => (typeof m.getType === "function" ? m.getType() : m.type) === "tool",
    );
    const toolContents = toolMsgs.map((m) => String(m.content));
    const todos = result.todos;

    console.log("[pro mode] model.callCount:", model.callCount);
    console.log("[pro mode] tool messages:", toolContents);
    console.log("[pro mode] todos:", JSON.stringify(todos));

    const hasNotFound = toolContents.some((c) => /Tool write_todos not found/.test(c));
    const hasUpdated = toolContents.some((c) => /Updated todo list/.test(c));

    console.log("[pro mode] write_todos not found:", hasNotFound);
    console.log("[pro mode] write_todos updated:", hasUpdated);

    // After the fix, <plan_mode> must NOT appear in the system prompt
    // (matches Python apply_prompt_template, which has no plan_mode parameter).
    // <todo_list_system> is injected by TodoMiddleware at runtime and MUST appear.
    const systemMsgs = (model.lastMessages ?? []).filter(
      (m) => (typeof m.getType === "function" ? m.getType() : m.type) === "system",
    );
    const systemContent = systemMsgs.map((m) => String(m.content)).join("\n---\n");
    const hasPlanMode = systemContent.includes("<plan_mode>");
    const hasTodoSystem = systemContent.includes("<todo_list_system>");
    console.log("[pro mode] system has <plan_mode>:", hasPlanMode);
    console.log("[pro mode] system has <todo_list_system>:", hasTodoSystem);

    assert.ok(hasUpdated, "pro mode: expected write_todos to be recognised, got: " + toolContents);
    assert.ok(!hasPlanMode, "pro mode: <plan_mode> should NOT be in system prompt (was the bug source)");
    assert.ok(hasTodoSystem, "pro mode: expected <todo_list_system> in system prompt");
    console.log("\n[PASS] pro mode: write_todos tool is assembled and prompt matches Python.\n");
  }

  // --- Case 2: planMode=false (flash mode) ---
  {
    const model = new FakeTodoModel();
    const checkpointer = new MemorySaver();
    const graph = createQuillAgent({
      model,
      tools: [],
      systemPrompt: "You are a helpful assistant.",
      planMode: false,
      checkpointer,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("hi")] },
      { configurable: { thread_id: "flash_test" }, recursionLimit: 50 },
    );

    const toolMsgs = (result.messages ?? []).filter(
      (m) => (typeof m.getType === "function" ? m.getType() : m.type) === "tool",
    );
    const toolContents = toolMsgs.map((m) => String(m.content));

    console.log("[flash mode] tool messages:", toolContents);
    const hasNotFound = toolContents.some((c) => /Tool write_todos not found/.test(c));
    console.log("[flash mode] write_todos not found:", hasNotFound);

    assert.ok(hasNotFound, "flash mode: expected write_todos to be absent (not found), got: " + toolContents);
    console.log("\n[PASS] flash mode: write_todos tool is correctly absent.\n");
  }

  console.log("=== All diagnostics passed ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

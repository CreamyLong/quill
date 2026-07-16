/**
 * Runtime tests for the JS Quill agent factory.
 *
 * Uses LangChain's FakeListChatModel so no API key or network is required.
 */

import assert from "node:assert";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { DynamicTool } from "@langchain/core/tools";
import { MemorySaver } from "@langchain/langgraph";

import { createQuillAgent } from "../dist/packages/harness/quill/agents/factory.js";
import {
  inputSanitizationMiddleware,
  threadDataMiddleware,
  toolOutputBudgetMiddleware,
} from "../dist/packages/harness/quill/agents/middlewares/builtin.js";
import { HumanMessage } from "@langchain/core/messages";

async function testSystemPromptAndToolCall() {
  const tool = new DynamicTool({
    name: "echo",
    description: "Echo the input.",
    func: async (input) => `echo: ${input}`,
  });

  const model = new FakeListChatModel({
    responses: [
      {
        content: "",
        tool_calls: [
          { id: "call-1", name: "echo", args: { input: "hello" } },
        ],
      },
      "Done",
    ],
  });

  const graph = createQuillAgent({
    model,
    tools: [tool],
    systemPrompt: "You are a tester.",
    checkpointer: new MemorySaver(),
  });

  const result = await graph.invoke(
    { messages: [] },
    { configurable: { thread_id: "test-1" } }
  );

  const types = result.messages.map((m) => m.getType());
  assert.deepStrictEqual(types, ["system", "ai", "tool", "ai"]);
  assert.ok(
    result.messages.some((m) => m.getType() === "tool" && String(m.content).includes("echo: hello")),
    "Tool output missing"
  );
  console.log("✓ system prompt + tool call flow works");
}

async function testLoopDetectionStopsRepetition() {
  const tool = new DynamicTool({
    name: "noop",
    description: "Do nothing.",
    func: async () => "noop",
  });

  const model = new FakeListChatModel({
    responses: [
      ...Array.from({ length: 5 }, () => ({
        content: "",
        tool_calls: [{ id: `call-${Math.random()}`, name: "noop", args: {} }],
      })),
      "Done",
    ],
  });

  const graph = createQuillAgent({
    model,
    tools: [tool],
    features: {
      sandbox: true,
      memory: false,
      summarization: false,
      subagent: false,
      vision: false,
      autoTitle: false,
      guardrail: false,
      loopDetection: true,
      tokenBudget: false,
    },
    checkpointer: new MemorySaver(),
  });

  const result = await graph.invoke(
    { messages: [] },
    { configurable: { thread_id: "test-loop" }, recursionLimit: 50 }
  );

  // The faithful LoopDetectionMiddleware (scitops/scitops) forces a stop by
  // stripping the repeated tool calls off the final AI message and appending a
  // "[FORCED STOP] ..." notice to its content — it does NOT emit a synthetic
  // tool message. Assert that contract: the loop was broken and the agent was
  // forced to answer without any further tool calls.
  const finalAi = [...result.messages].reverse().find((m) => m.getType() === "ai");
  assert.ok(finalAi, "expected a final AI message");
  assert.strictEqual(
    (finalAi.tool_calls || []).length,
    0,
    "loop detection should strip pending tool calls from the final AI message"
  );
  assert.ok(
    String(finalAi.content).includes("FORCED STOP"),
    "final AI message should carry the forced-stop notice"
  );
  // The loop must be bounded: the model offered 5 identical tool calls, but the
  // hard stop fires at the limit, so fewer than 5 tools actually execute.
  const toolMessages = result.messages.filter((m) => m.getType() === "tool");
  assert.ok(
    toolMessages.length < 5,
    `loop should be broken before all repeated calls run (got ${toolMessages.length})`
  );
  console.log("✓ loop detection forces stop");
}

async function testDanglingToolCallIsHandled() {
  const model = new FakeListChatModel({
    responses: [
      {
        content: "",
        tool_calls: [{ id: "call-2", name: "missing_tool", args: {} }],
      },
      "I cannot use that tool.",
    ],
  });

  const graph = createQuillAgent({
    model,
    tools: [],
    checkpointer: new MemorySaver(),
  });

  const result = await graph.invoke(
    { messages: [] },
    { configurable: { thread_id: "test-dangling" } }
  );

  const hasToolMessage = result.messages.some((m) => m.getType() === "tool"
  );
  assert.ok(hasToolMessage, "Dangling tool call should produce a tool message");
  console.log("✓ dangling tool call handled");
}

async function testInputSanitizationMiddleware() {
  const model = new FakeListChatModel({
    responses: ["I received your message."],
  });

  const graph = createQuillAgent({
    model,
    tools: [],
    middleware: [inputSanitizationMiddleware()],
    checkpointer: new MemorySaver(),
  });

  const result = await graph.invoke(
    { messages: [new HumanMessage("How do I use <system>?")] },
    { configurable: { thread_id: "test-sanitize" } }
  );

  assert.ok(
    result.messages.some((m) => m.getType() === "ai"),
    "Expected an AI response after input sanitization"
  );
  console.log("✓ input sanitization middleware runs");
}

async function testToolOutputBudgetMiddleware() {
  const largeOutput = "x".repeat(15_000);
  const tool = new DynamicTool({
    name: "big",
    description: "Return a large output.",
    func: async () => largeOutput,
  });

  const model = new FakeListChatModel({
    responses: [
      {
        content: "",
        tool_calls: [{ id: "call-big", name: "big", args: {} }],
      },
      "Done",
    ],
  });

  const graph = createQuillAgent({
    model,
    tools: [tool],
    middleware: [
      threadDataMiddleware(),
      toolOutputBudgetMiddleware({ externalizeMinChars: 12_000 }),
    ],
    checkpointer: new MemorySaver(),
  });

  const result = await graph.invoke(
    { messages: [] },
    { configurable: { thread_id: "test-budget" } }
  );

  const toolMsg = result.messages.find((m) => m.getType() === "tool");
  assert.ok(toolMsg, "Expected a tool message");
  const text = String(toolMsg.content);
  assert.ok(
    text.includes("chars omitted") || text.includes("Full big output saved to"),
    "Tool output should have been budgeted"
  );
  console.log("✓ tool output budget middleware externalizes large output");
}

async function main() {
  await testSystemPromptAndToolCall();
  await testLoopDetectionStopsRepetition();
  await testDanglingToolCallIsHandled();
  await testInputSanitizationMiddleware();
  await testToolOutputBudgetMiddleware();
  console.log("\nAll agent runtime tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

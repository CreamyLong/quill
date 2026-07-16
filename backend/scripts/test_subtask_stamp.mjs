import { FakeListChatModel } from "@langchain/core/utils/testing";
import { MemorySaver } from "@langchain/langgraph";
import { createTaskTool } from "../dist/packages/harness/quill/tools/builtins/task_tool.js";
import { createQuillAgent } from "../dist/packages/harness/quill/agents/factory.js";
import { HumanMessage } from "@langchain/core/messages";

async function testStamp() {
  const taskTool = createTaskTool({
    runSubagent: async () => "subagent report",
    subagents: [{ name: "research", description: "research subagent" }],
    defaultSubagent: "research",
  });

  const model = new FakeListChatModel({
    responses: [
      {
        content: "",
        tool_calls: [{ id: "task-1", name: "task", args: { description: "do research", prompt: "research the topic and report back" } }],
      },
      "Done",
    ],
  });

  const graph = createQuillAgent({
    model,
    tools: [taskTool],
    systemPrompt: "You are a tester.",
    checkpointer: new MemorySaver(),
  });

  const result = await graph.invoke(
    { messages: [new HumanMessage("test")] },
    { configurable: { thread_id: "test-stamp" } }
  );

  const toolMessage = result.messages.find((m) => m.getType() === "tool" && m.tool_call_id === "task-1");
  if (!toolMessage) {
    console.error("No task tool message found");
    process.exit(1);
  }
  console.log("tool content:", toolMessage.content);
  console.log("additional_kwargs:", JSON.stringify(toolMessage.additional_kwargs));
  if (toolMessage.additional_kwargs?.subagent_status !== "completed") {
    console.error("FAIL: subagent_status not stamped as completed");
    process.exit(1);
  }
  console.log("PASS: subagent_status stamped correctly");
}

testStamp().catch((e) => {
  console.error(e);
  process.exit(1);
});

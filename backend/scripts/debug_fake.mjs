import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";

const model = new FakeListChatModel({
  responses: [
    { content: "", tool_calls: [{ id: "todos-1", name: "write_todos", args: { todos: [{ content: "Step 1", status: "pending" }] } }] },
    { content: "Done." },
  ],
});

const bound = model.bindTools([{ name: "write_todos", description: "x", schema: { type: "object", properties: {} } }]);
const r1 = await bound.invoke([new HumanMessage("hi")]);
console.log("r1:", r1);
const r2 = await bound.invoke([new HumanMessage("hi"), r1, { type: "tool", content: "ok", tool_call_id: "todos-1" }]);
console.log("r2:", r2);

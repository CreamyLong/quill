import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { MemorySaver, StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { FakeListChatModel } from "@langchain/core/utils/testing";

const graph = new StateGraph(Annotation.Root({
  messages: Annotation({ reducer: (a, b) => [...a, ...b], default: () => [] }),
}))
  .addNode("model", async (state) => {
    return { messages: [new AIMessage("hi")] };
  })
  .addEdge(START, "model")
  .addEdge("model", "model")
  .compile({ checkpointer: new MemorySaver() });

try {
  await graph.invoke(
    { messages: [new HumanMessage("x")] },
    { configurable: { thread_id: "r" }, recursionLimit: 5 }
  );
  console.log("no error");
} catch (e) {
  console.log("error:", e.message);
}

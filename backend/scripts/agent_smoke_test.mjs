/**
 * Smoke test for the JS LangGraph agent runtime.
 *
 * Usage:
 *   cd backend && npm run build && npm run agent:smoke
 *
 * This only verifies that `createQuillAgent` compiles a runnable graph; it
 * does not call any LLM API unless OPENAI_API_KEY is set.
 */

import { ChatOpenAI } from "@langchain/openai";

import { createQuillAgent } from "../dist/packages/harness/quill/agents/factory.js";

async function main() {
  const apiKey = process.env.OPENAI_API_KEY ?? "sk-test";
  const model = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0,
    openAIApiKey: apiKey,
  });

  const graph = createQuillAgent({
    model,
    systemPrompt: "You are a helpful assistant.",
    planMode: true,
  });

  console.log("Agent graph compiled successfully.");
  console.log("invoke available:", typeof graph.invoke === "function");
  console.log("stream available:", typeof graph.stream === "function");

  if (process.env.OPENAI_API_KEY) {
    const result = await graph.invoke({ messages: [] });
    console.log("Run completed. Final message count:", result.messages?.length ?? 0);
  } else {
    console.log("Set OPENAI_API_KEY to run a live invocation.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

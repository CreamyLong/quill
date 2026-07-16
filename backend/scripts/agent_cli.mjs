/**
 * Minimal CLI for the JS Quill agent runtime.
 *
 * Usage:
 *   cd backend && npm run build && OPENAI_API_KEY=... node scripts/agent_cli.mjs "What is React?"
 *
 * This demonstrates that the TypeScript agent runtime can receive a user
 * question and stream back an answer.
 */

import { ChatOpenAI } from "@langchain/openai";
import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";

import { createQuillAgent } from "../dist/packages/harness/quill/agents/factory.js";
import { getAppConfig } from "../dist/packages/harness/quill/config/app_config.js";
import { buildChatModel, pickModelConfig } from "./model_factory.mjs";

async function main() {
  const question = process.argv[2];
  if (!question) {
    console.error("Usage: node scripts/agent_cli.mjs <question>");
    process.exit(1);
  }

  const appConfig = getAppConfig();
  const modelConfig = pickModelConfig(appConfig);
  const apiKey = modelConfig.api_key ?? process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error("Set OPENAI_API_KEY or configure a model api_key to run the agent.");
    process.exit(1);
  }

  const model = buildChatModel(modelConfig);

  const checkpointer = new MemorySaver();

  const graph = createQuillAgent({
    model,
    systemPrompt:
      "You are Quill, a helpful research assistant. Answer questions concisely and accurately.",
    planMode: false,
    checkpointer,
  });

  const threadId = process.env.QUILL_THREAD_ID ?? "cli-default";
  const config = { configurable: { thread_id: threadId } };

  console.log(`Using model: ${modelConfig.name} (${modelConfig.model})`);
  console.log(`Question: ${question}\n`);
  console.log("Answer:\n");

  let lastContent = "";
  for await (const event of graph.stream(
    { messages: [new HumanMessage(question)] },
    { ...config, streamMode: "messages" }
  )) {
    const [message] = event;
    if (message?.content) {
      const chunk = String(message.content).slice(lastContent.length);
      process.stdout.write(chunk);
      lastContent = String(message.content);
    }
  }

  console.log("\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

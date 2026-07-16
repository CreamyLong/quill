import { updateMemoryFromConversation } from "./dist/packages/harness/quill/agents/memory/updater.js";

const messages = [
  { type: "human", content: "My name is Alice and I work on DHODH inhibitors." },
  { type: "ai", content: "Nice to meet you, Alice. I'll remember you work on DHODH inhibitors." },
];

try {
  const ok = await updateMemoryFromConversation(messages, "test-thread", null, false, false, null);
  console.log("memory update result:", ok);
} catch (err) {
  console.error("failed:", err);
  process.exit(1);
}

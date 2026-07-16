/**
 * Unit test for the summarization middleware.
 * Verifies it compresses long history at a human boundary without splitting
 * tool pairs, and no-ops for short conversations.
 *
 * Run: cd backend && npm run build && node --experimental-vm-modules scripts/summarization_test.mjs
 */

import assert from "node:assert";

import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";

import { summarizationMiddleware } from "../dist/packages/harness/quill/agents/middlewares/builtin.js";

function typeOf(m) {
  return typeof m.getType === "function" ? m.getType() : m.type;
}

async function main() {
  const model = new FakeListChatModel({ responses: ["CONCISE SUMMARY of earlier turns."] });
  const mw = summarizationMiddleware({ model, maxMessages: 10, keepRecent: 4 });

  // Build a long history: 8 complete turns (human, ai) + a final human/ai, all with ids.
  const messages = [new SystemMessage({ content: "sys", id: "s0" })];
  for (let i = 0; i < 9; i++) {
    messages.push(new HumanMessage({ content: `q${i}`, id: `h${i}` }));
    // Every 3rd turn uses a tool_call/tool pair to test pair safety.
    if (i % 3 === 0) {
      messages.push(new AIMessage({ content: "", id: `a${i}`, tool_calls: [{ id: `tc${i}`, name: "x", args: {} }] }));
      messages.push(new ToolMessage({ content: "tool out", id: `t${i}`, tool_call_id: `tc${i}` }));
      messages.push(new AIMessage({ content: `done ${i}`, id: `af${i}` }));
    } else {
      messages.push(new AIMessage({ content: `ans ${i}`, id: `a${i}` }));
    }
  }

  const nonSystemBefore = messages.filter((m) => typeOf(m) !== "system").length;
  const out = await mw.beforeModel({ messages });
  assert.ok(out && Array.isArray(out.messages), "middleware should return message updates");

  const removals = out.messages.filter((m) => typeOf(m) === "remove");
  const summaries = out.messages.filter((m) => typeOf(m) === "system");
  assert.ok(removals.length > 0, "should remove old messages");
  assert.strictEqual(summaries.length, 1, "should add exactly one summary system message");
  assert.ok(
    String(summaries[0].content).includes("CONCISE SUMMARY"),
    "summary should contain the model output",
  );

  // Apply removals to compute the resulting message set and check pair safety.
  const removedIds = new Set(removals.map((m) => m.id));
  const kept = messages.filter((m) => !removedIds.has(m.id));
  const keptNonSystem = kept.filter((m) => typeOf(m) !== "system");
  // The first kept non-system message must be a human (safe boundary).
  assert.strictEqual(typeOf(keptNonSystem[0]), "human", "kept slice must start at a human boundary");
  // No orphan tool message: every tool msg's preceding message set still has its ai tool_call.
  for (let i = 0; i < keptNonSystem.length; i++) {
    if (typeOf(keptNonSystem[i]) === "tool") {
      const tcId = keptNonSystem[i].tool_call_id;
      const hasCall = keptNonSystem.some(
        (m) => typeOf(m) === "ai" && (m.tool_calls || []).some((tc) => tc.id === tcId),
      );
      assert.ok(hasCall, `orphan tool message ${tcId} — tool pair was split`);
    }
  }
  console.log(`✓ summarized ${removals.length} old messages (of ${nonSystemBefore}) into 1 note`);
  console.log("✓ kept slice starts at a human boundary; no tool pairs split");

  // Short conversation → no-op.
  const shortMsgs = [
    new SystemMessage({ content: "sys", id: "s" }),
    new HumanMessage({ content: "hi", id: "h" }),
    new AIMessage({ content: "hello", id: "a" }),
  ];
  const shortOut = await mw.beforeModel({ messages: shortMsgs });
  assert.deepStrictEqual(shortOut, {}, "short conversation should not be summarized");
  console.log("✓ short conversation left untouched");

  console.log("\nSummarization middleware verified.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

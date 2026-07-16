/**
 * Regression test: the TS `task` tool must accept the three-arg shape the
 * lead-agent prompt teaches the model to call —
 *   task(description=<short>, prompt=<detailed task>, subagent_type=...)
 * — and hand the *prompt* (not the short description) to the subagent.
 *
 * Before the fix the schema had no `prompt` field, so Zod silently dropped it
 * and the subagent received only "Tencent financial data" as its entire task
 * (Ultra-mode "subtask did nothing" symptom).
 *
 * Run: cd backend && npm run build && node scripts/repro_task_schema.mjs
 */

import { createTaskTool } from "../dist/packages/harness/quill/tools/builtins/task_tool.js";

let captured = null;
const taskTool = createTaskTool({
  runSubagent: async (args) => {
    captured = args;
    return "subagent report";
  },
  defaultSubagent: "research",
  subagents: [{ name: "research", description: "literature specialist" }],
});

// 1. The canonical shape from the lead-agent prompt examples.
const canonical = {
  description: "Tencent financial data",
  prompt: "Research Tencent's Q3 earnings, revenue breakdown, and analyst ratings. Summarize in 3 bullets.",
  subagent_type: "research",
};
await taskTool.invoke(canonical, { toolCall: { id: "t1", name: "task" } });
console.log("[canonical] subagent received:", JSON.stringify(captured));
const canonicalOk =
  captured.prompt === canonical.prompt &&
  captured.description === canonical.description &&
  captured.subagentType === "research";

// 2. Schema validation: `prompt` is required (matches Python). A call that
//    omits it must be rejected by Zod so the subagent is never started with an
//    empty task — surfacing the error early instead of silently doing nothing.
captured = null;
const descriptionOnly = { description: "Do the thing.", subagent_type: "research" };
let schemaRejected = false;
try {
  await taskTool.invoke(descriptionOnly, { toolCall: { id: "t2", name: "task" } });
} catch (err) {
  schemaRejected = /prompt/i.test(err instanceof Error ? err.message : String(err));
}
console.log(`[desc-only] schema rejected missing 'prompt': ${schemaRejected}`);
const fallbackOk = schemaRejected;

console.log("\n=== Results ===");
console.log(`canonical (description+prompt+type): ${canonicalOk ? "PASS" : "FAIL"}`);
console.log(`fallback  (description only):       ${fallbackOk ? "PASS (schema rejects)" : "FAIL"}`);

if (canonicalOk && fallbackOk) {
  console.log("\n[PASS] `prompt` is required and forwarded to the subagent; Ultra subtasks get real work.");
  process.exit(0);
} else {
  console.log("\n[FAIL] `prompt` handling is broken.");
  process.exit(2);
}

/**
 * Test deferred MCP tool binding and tool_search promotion.
 *
 * Run: cd backend && npm run build && node --experimental-vm-modules scripts/tool_search_test.mjs
 */

import assert from "node:assert";

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

import { createToolSearchTool } from "../dist/packages/harness/quill/tools/builtins/tool_search_tool.js";
import { toolSearchMiddleware } from "../dist/packages/harness/quill/agents/middlewares/tool_search_middleware.js";
import { deferredToolFilterMiddleware } from "../dist/packages/harness/quill/agents/middlewares/deferred_tool_filter_middleware.js";

function makeFakeTool(name, description) {
  return tool(
    async () => "ok",
    {
      name,
      description,
      schema: z.object({}),
    }
  );
}

async function testToolSearchTool() {
  const catalog = [
    { name: "search_papers", description: "Search academic papers" },
    { name: "semantic_search", description: "Semantic search" },
    { name: "bash", description: "Run shell commands" },
  ];
  const searchTool = createToolSearchTool(catalog);
  const result = await searchTool.invoke({ query: "papers" });
  const parsed = JSON.parse(result);
  assert.ok(parsed.ok, "expected tool_search to succeed");
  assert.deepStrictEqual(parsed.promoted, ["search_papers"]);
  assert.strictEqual(parsed.results.length, 1);
  console.log("✓ tool_search filters catalog and returns promoted names");
}

async function testToolSearchMiddleware() {
  const deferred = new Set(["search_papers", "semantic_search"]);
  const mw = toolSearchMiddleware(deferred, "hash-1");

  const ai = new AIMessage({
    content: "",
    tool_calls: [{ id: "tc-1", name: "tool_search", args: { query: "papers" } }],
  });
  const toolMsg = { content: JSON.stringify({ ok: true, promoted: ["search_papers"] }), tool_call_id: "tc-1" };
  const { ToolMessage } = await import("@langchain/core/messages");
  const state = { messages: [new HumanMessage("hi"), ai, new ToolMessage(toolMsg)] };

  const update = mw.afterAgent(state);
  assert.ok(update, "expected promotion update");
  assert.deepStrictEqual(update.promoted, { catalog_hash: "hash-1", names: ["search_papers"] });
  console.log("✓ toolSearchMiddleware updates state.promoted");
}

async function testDeferredFilter() {
  const deferred = new Set(["search_papers"]);
  const filter = deferredToolFilterMiddleware(deferred, "hash-1");

  const allTools = [makeFakeTool("search_papers", ""), makeFakeTool("web_search", "")];
  const request = { messages: [], tools: allTools, state: { promoted: { catalog_hash: "hash-1", names: ["search_papers"] } } };
  let passedRequest = null;
  await filter.wrapModelCall(request, async (req) => {
    passedRequest = req;
    return new AIMessage("ok");
  });
  assert.deepStrictEqual(passedRequest.tools.map((t) => t.name), ["search_papers", "web_search"]);

  const hiddenRequest = { messages: [], tools: allTools, state: {} };
  await filter.wrapModelCall(hiddenRequest, async (req) => {
    passedRequest = req;
    return new AIMessage("ok");
  });
  assert.deepStrictEqual(passedRequest.tools.map((t) => t.name), ["web_search"]);
  console.log("✓ deferredToolFilterMiddleware hides/shows tools by promotion state");
}

async function main() {
  await testToolSearchTool();
  await testToolSearchMiddleware();
  await testDeferredFilter();
  console.log("\nAll tool_search tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

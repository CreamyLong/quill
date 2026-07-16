#!/usr/bin/env node
import { randomUUID } from "node:crypto";

const GATEWAY = "http://localhost:8123";
async function newThread() {
  const resp = await fetch(`${GATEWAY}/api/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const data = await resp.json();
  return data.thread_id;
}

// Explicit tool-pointing + slash skill tests.
const TESTS = [
  {
    name: "Test A — Explicit task subagent delegation",
    prompt: "请使用 task 工具委派一个 research 类型的 subagent，让它调研 LSTM 和 Transformer 在时间序列预测上的差异。然后基于 subagent 返回的结果给我总结。不要自己直接调用 web_search，必须用 task 工具。",
    expectTools: ["task"],
  },
  {
    name: "Test B — Explicit search_papers MCP tool",
    prompt: "请调用 search_papers 工具，搜索 'CRISPR cancer therapy' 相关论文，列出 3 篇论文的标题和 DOI。",
    expectTools: ["search_papers"],
  },
  {
    name: "Test C — Explicit semantic_search MCP tool",
    prompt: "请调用 semantic_search 工具，检索 'gastric cancer drug binding affinity' 相关文献，返回前 5 条结果。",
    expectTools: ["semantic_search"],
  },
  {
    name: "Test D — /chart-visualization slash skill (lightweight, no install)",
    prompt: "/chart-visualization 用以下数据生成柱状图：苹果 30, 香蕉 45, 橙子 25, 葡萄 60",
    expectSkillInject: true,
    expectTools: ["bash"],
  },
];

async function sendRun(threadId, prompt, mode = "ultra") {
  const runId = randomUUID();
  const url = `${GATEWAY}/api/threads/${threadId}/runs/stream`;
  const isPlan = mode === "ultra" || mode === "pro";
  const isSub = mode === "ultra";
  const isThink = mode === "ultra" || mode === "thinking";
  const body = {
    assistant_id: "agent",
    input: { messages: [{ role: "user", content: prompt }] },
    metadata: { mode },
    // Frontend puts mode flags in body.context (NOT config.configurable).
    // gateway.ts line 1374 reads body.context and passes it to buildGraphForContext.
    context: {
      mode,
      thinking_enabled: isThink,
      is_plan_mode: isPlan,
      subagent_enabled: isSub,
      reasoning_effort: mode === "ultra" ? "high" : mode === "pro" ? "medium" : "minimal",
    },
    config: {
      recursion_limit: 100,
    },
    stream: true,
    run_id: runId,
  };
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const toolCalls = new Set();
  let finalText = "";
  let skillInjected = false;
  let eventCount = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("event: ")) continue;
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        eventCount++;
        const msgs = Array.isArray(parsed) ? parsed : [parsed];
        for (const m of msgs) {
          if (!m || typeof m !== "object") continue;
          if (Array.isArray(m.tool_calls)) {
            for (const tc of m.tool_calls) {
              const name = tc?.name || tc?.tool_call?.name;
              if (name) toolCalls.add(name);
            }
          }
          if (Array.isArray(m.tool_call_chunks)) {
            for (const tc of m.tool_call_chunks) {
              if (tc?.name) toolCalls.add(tc.name);
            }
          }
          if (m.role === "system" || m.type === "system") {
            const content = typeof m.content === "string" ? m.content : "";
            if (content.includes("<skill_system>") || content.includes("SKILL.md") || content.includes("diffdock")) {
              skillInjected = true;
            }
          }
          if ((m.role === "ai" || m.type === "ai") && typeof m.content === "string" && m.content.length > 0) {
            finalText = m.content;
          }
        }
      } catch {}
    }
  }
  return { toolCalls: [...toolCalls], finalText, skillInjected, eventCount };
}

console.log(`Gateway: ${GATEWAY}\n`);
for (let i = 0; i < TESTS.length; i++) {
  const test = TESTS[i];
  console.log(`\n========== ${test.name} ==========`);
  console.log(`Prompt: ${test.prompt}`);
  const threadId = await newThread();
  console.log(`Thread: ${threadId}`);
  const start = Date.now();
  try {
    const result = await sendRun(threadId, test.prompt, "ultra");
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`Elapsed: ${elapsed}s | Events: ${result.eventCount}`);
    const tools = result.toolCalls.length > 0 ? result.toolCalls.join(", ") : "(none)";
    console.log(`Tool calls: ${tools}`);
    if (test.expectSkillInject) {
      console.log(`Skill injected: ${result.skillInjected ? "YES" : "NO"}`);
    }
    const found = test.expectTools.filter((t) => result.toolCalls.includes(t));
    const missing = test.expectTools.filter((t) => !result.toolCalls.includes(t));
    if (found.length > 0) console.log(`Found: ${found.join(", ")}`);
    if (missing.length > 0) console.log(`MISSING: ${missing.join(", ")}`);
    const preview = result.finalText.slice(0, 200).replace(/\n/g, " ");
    console.log(`Final: ${preview}${result.finalText.length > 200 ? "..." : ""}`);
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`FAILED after ${elapsed}s: ${err.message}`);
  }
}
console.log("\n========== Done ==========\n");

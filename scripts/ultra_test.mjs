#!/usr/bin/env node
import { randomUUID } from "node:crypto";

const GATEWAY = "http://localhost:8123";
// Use a fresh thread per test to avoid context bleed.
async function newThread() {
  const resp = await fetch(`${GATEWAY}/api/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const data = await resp.json();
  return data.thread_id;
}

const TESTS = [
  {
    name: "Test 1 — MCP (Sciverse search_papers)",
    prompt: "搜索关于 CRISPR 基因编辑在癌症治疗中应用的最新研究论文，给出 3 篇代表性论文的标题和 DOI。",
    expectTools: ["search_papers", "semantic_search"],
  },
  {
    name: "Test 2 — Subagent delegation (task tool)",
    prompt: "对比分析 LSTM 和 Transformer 在时间序列预测上的优缺点，分别从原理、性能、计算成本三个角度展开。",
    expectTools: ["task"],
  },
  {
    name: "Test 3 — Skill activation (/deepwiki slash)",
    prompt: "/deepwiki 查看 vercel/next.js 的文档，介绍 getServerSideProps 的用法",
    expectTools: [],
    expectSkillInject: true,
  },
  {
    name: "Test 4 — Sandbox file tools",
    prompt: "在 /mnt/user-data 下创建一个名为 hello.txt 的文件，内容是 Hello Quill。然后用 read_file 读取它确认内容。",
    expectTools: ["write_file", "read_file"],
  },
  {
    name: "Test 5 — Ultra integrated (cancer drug + binding energy)",
    prompt: "胃癌的治疗方法，找出药物分子，并计算结合能",
    expectTools: ["task", "search_papers"],
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
        // SSE data is always an array of messages for "messages" events.
        const msgs = Array.isArray(parsed) ? parsed : [parsed];
        for (const m of msgs) {
          if (!m || typeof m !== "object") continue;
          // Capture tool calls.
          if (Array.isArray(m.tool_calls)) {
            for (const tc of m.tool_calls) {
              const name = tc?.name || tc?.tool_call?.name;
              if (name) toolCalls.add(name);
            }
          }
          if (Array.isArray(m.tool_call_chunks)) {
            for (const tc of m.tool_call_chunks) {
              const name = tc?.name;
              if (name) toolCalls.add(name);
            }
          }
          // Capture skill injection in system messages.
          if (m.role === "system" || m.type === "system") {
            const content = typeof m.content === "string" ? m.content : "";
            if (content.includes("<skill_system>") || content.includes("SKILL.md")) {
              skillInjected = true;
            }
          }
          // Capture final AI text (only when content is non-empty).
          if ((m.role === "ai" || m.type === "ai") && typeof m.content === "string" && m.content.length > 0) {
            finalText = m.content;
          }
        }
      } catch {
        // ignore partial JSON
      }
    }
  }

  return {
    toolCalls: [...toolCalls],
    finalText,
    skillInjected,
    eventCount,
  };
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
    if (test.expectTools.length > 0) {
      const found = test.expectTools.filter((t) => result.toolCalls.includes(t));
      const missing = test.expectTools.filter((t) => !result.toolCalls.includes(t));
      if (found.length > 0) console.log(`Expected found: ${found.join(", ")}`);
      if (missing.length > 0) console.log(`Expected MISSING: ${missing.join(", ")}`);
    }
    const preview = result.finalText.slice(0, 150).replace(/\n/g, " ");
    console.log(`Final text: ${preview}${result.finalText.length > 150 ? "..." : ""}`);
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`FAILED after ${elapsed}s: ${err.message}`);
  }
}

console.log("\n========== Done ==========\n");

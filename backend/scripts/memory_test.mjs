/**
 * Test the ported memory updater and prompt formatter.
 *
 * Run: cd backend && npm run build && node --experimental-vm-modules scripts/memory_test.mjs
 */

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { HumanMessage, AIMessage } from "@langchain/core/messages";

import {
  MemoryUpdater,
  updateMemoryFromConversation,
  formatMemoryForInjection,
  getMemoryContext,
  FileMemoryStorage,
  createEmptyMemory,
} from "../dist/packages/harness/quill/agents/memory/index.js";
import { setMemoryConfig, getMemoryConfig } from "../dist/packages/harness/quill/config/memory_config.js";

function makeMockModel(responseContent) {
  return {
    async invoke(prompt) {
      return { content: responseContent };
    },
  };
}

function withTempStorage(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quill-memory-test-"));
  const storage = new FileMemoryStorage();
  const originalGet = FileMemoryStorage.prototype.getMemoryFilePath;
  FileMemoryStorage.prototype.getMemoryFilePath = function () {
    return path.join(dir, "memory.json");
  };
  try {
    return fn(storage);
  } finally {
    FileMemoryStorage.prototype.getMemoryFilePath = originalGet;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testFormatMemoryForInjection() {
  const memory = createEmptyMemory();
  memory.user.workContext.summary = "Software engineer at Acme";
  memory.facts.push({
    id: "fact_1",
    content: "Likes TypeScript",
    category: "preference",
    confidence: 0.95,
  });
  const text = formatMemoryForInjection(memory, 2000, {
    useTiktoken: false,
    guaranteedCategories: ["correction"],
    guaranteedTokenBudget: 500,
  });
  assert.ok(text.includes("Software engineer at Acme"), "expected work context");
  assert.ok(text.includes("Likes TypeScript"), "expected fact");
  console.log("✓ formatMemoryForInjection works");
}

async function testMemoryUpdate() {
  const originalConfig = getMemoryConfig();
  const config = {
    ...originalConfig,
    enabled: true,
    injectionEnabled: true,
    maxFacts: 100,
    factConfidenceThreshold: 0.7,
    modelName: null,
  };
  setMemoryConfig(config);

  const result = withTempStorage(async (storage) => {
    const updater = new MemoryUpdater({ memoryConfig: config, storage });

    const response = JSON.stringify({
      user: {
        workContext: { summary: "Engineer", shouldUpdate: true },
        personalContext: { summary: "", shouldUpdate: false },
        topOfMind: { summary: "", shouldUpdate: false },
      },
      history: {
        recentMonths: { summary: "", shouldUpdate: false },
        earlierContext: { summary: "", shouldUpdate: false },
        longTermBackground: { summary: "", shouldUpdate: false },
      },
      newFacts: [
        { content: "Enjoys coding in TypeScript", category: "preference", confidence: 0.9 },
      ],
      factsToRemove: [],
    });

    // Inject a mock model by replacing the private getter.
    updater.getModel = () => makeMockModel(response);

    const messages = [
      new HumanMessage("I enjoy coding in TypeScript"),
      new AIMessage("That's great!"),
    ];

    const ok = await updater.updateMemory(messages, "thread-1", null, false, false, null);
    assert.ok(ok, "expected memory update to succeed");

    const memory = storage.load();
    assert.strictEqual(memory.user.workContext.summary, "Engineer");
    assert.strictEqual(memory.facts.length, 1);
    assert.strictEqual(memory.facts[0].content, "Enjoys coding in TypeScript");

    return true;
  });
  assert.ok(result);
  console.log("✓ MemoryUpdater persists facts and summaries");
}

async function testGetMemoryContext() {
  const originalConfig = getMemoryConfig();
  const config = {
    ...originalConfig,
    enabled: true,
    injectionEnabled: true,
    maxInjectionTokens: 2000,
    tokenCounting: "char",
    guaranteedCategories: ["correction"],
  };
  setMemoryConfig(config);

  withTempStorage((storage) => {
    const memory = createEmptyMemory();
    memory.facts.push({
      id: "fact_1",
      content: "Prefers dark mode",
      category: "preference",
      confidence: 0.8,
    });
    storage.save(memory, null, null);
    const ctx = getMemoryContext(null, null, { memoryConfig: config, storage });
    assert.ok(ctx.includes("<memory>"), "expected memory XML wrapper");
    assert.ok(ctx.includes("Prefers dark mode"), "expected fact in context");
  });
  console.log("✓ getMemoryContext formats memory block");
}

async function main() {
  await testFormatMemoryForInjection();
  await testMemoryUpdate();
  await testGetMemoryContext();
  console.log("\nAll memory tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Diagnostic: reproduce ultra-mode subagent failure and verify the
 * llmErrorHandlingMiddleware fix.
 *
 * Builds a real SubagentExecutor and runs execute() with two fake models:
 *   1. FakeOkModel    — always returns a final answer (baseline)
 *   2. FakeErrorModel — always throws a transient LLM error (reproduces the
 *      "3 subtasks failed" symptom). Before the fix, the error propagated
 *      uncaught and the subagent ended with status=failed. After the fix,
 *      llmErrorHandlingMiddleware retries 3x then returns a graceful fallback
 *      AIMessage, so the subagent ends with status=completed.
 *
 * Run: cd backend && npm run build && node scripts/diagnose_subagent.mjs
 */

import { AIMessage } from "@langchain/core/messages";

import { SubagentExecutor } from "../dist/packages/harness/quill/subagents/executor.js";
import { getSubagentConfig, getAvailableSubagentNames } from "../dist/packages/harness/quill/subagents/registry.js";
import { getAppConfig } from "../dist/packages/harness/quill/config/app_config.js";

// A fake model that returns a plain final answer on the first turn.
class FakeOkModel {
  constructor() { this.callCount = 0; this.lastMessages = null; }
  async invoke(messages) {
    this.lastMessages = messages;
    this.callCount += 1;
    return new AIMessage({ content: "Tencent stock dropped due to macro headwinds and regulatory concerns." });
  }
  bindTools() { return this; }
  withConfig() { return this; }
}

// A fake model that always throws a transient error (simulates rate-limit /
// timeout / 503 from the LLM provider). This reproduces the ultra-mode
// "all 3 subtasks failed" symptom when llmErrorHandlingMiddleware is absent.
class FakeErrorModel {
  constructor() { this.callCount = 0; }
  async invoke() {
    this.callCount += 1;
    const err = new Error("503 Service Unavailable: upstream LLM provider rate limited");
    err.status = 503;
    err.name = "InternalServerError";
    throw err;
  }
  bindTools() { return this; }
  withConfig() { return this; }
}

async function runOne({ label, name, cfg, appConfig, modelFactory }) {
  console.log(`\n--- [${label}] subagent='${name}' ---`);
  const fakeModel = modelFactory();
  const executor = new SubagentExecutor(cfg, [], {
    appConfig,
    parentModel: appConfig?.models?.[0]?.name ?? "test-model",
    threadId: `diag-${name}-${label}-${Date.now()}`,
    modelFactory: () => fakeModel,
  });

  try {
    const result = await executor.execute("Why is Tencent stock price dropping? Research and summarize.");
    console.log(`[result] status=${result.status}`);
    console.log(`[result] error=${result.error ?? "(none)"}`);
    console.log(`[result] result=${(result.result ?? "").slice(0, 240)}`);
    console.log(`[result] aiMessages.length=${result.aiMessages.length}`);
    if (result.aiMessages.length > 0) {
      const last = result.aiMessages[result.aiMessages.length - 1];
      const fallback = last.additional_kwargs?.scitops_error_fallback;
      if (fallback) {
        console.log(`[result] fallback=true reason=${last.additional_kwargs?.error_reason} type=${last.additional_kwargs?.error_type}`);
      } else {
        console.log(`[result] fallback=false`);
      }
    }
    console.log(`[fake] model.callCount=${fakeModel.callCount}`);
    return result;
  } catch (err) {
    console.log(`[exception] ${err instanceof Error ? err.stack : String(err)}`);
    return null;
  }
}

async function main() {
  console.log("=== Diagnosing ultra-mode subagent failure ===\n");

  const appConfig = (() => { try { return getAppConfig(); } catch { return null; } })();
  console.log("[diag] appConfig:", appConfig ? "loaded" : "null");
  if (appConfig) {
    console.log("[diag] appConfig.models:", JSON.stringify(appConfig.models?.map((m) => m.name) ?? []));
    console.log("[diag] appConfig.toolSearch.enabled:", appConfig.toolSearch?.enabled);
  }

  const subagentNames = getAvailableSubagentNames({ appConfig });
  console.log("[diag] available subagents:", subagentNames);

  let baselineOk = 0;
  let errorCaseCompleted = 0;
  let errorCaseFailed = 0;

  for (const name of subagentNames) {
    const cfg = getSubagentConfig(name, { appConfig });
    if (!cfg) continue;
    console.log(`\n[cfg] model=${cfg.model} maxTurns=${cfg.maxTurns} timeout=${cfg.timeoutSeconds}s`);

    // 1. Baseline: a healthy model should complete.
    const baseline = await runOne({
      label: "ok", name, cfg, appConfig, modelFactory: () => new FakeOkModel(),
    });
    if (baseline?.status === "completed") baselineOk += 1;

    // 2. Error case: a model that always throws 503. Before the fix this
    //    ended with status=failed; after the fix the LLM error middleware
    //    returns a graceful fallback AIMessage so the subagent completes.
    const errorCase = await runOne({
      label: "err", name, cfg, appConfig, modelFactory: () => new FakeErrorModel(),
    });
    if (errorCase?.status === "completed") errorCaseCompleted += 1;
    else if (errorCase?.status === "failed") errorCaseFailed += 1;
  }

  console.log("\n=== Summary ===");
  console.log(`baseline (FakeOkModel)      completed: ${baselineOk}/${subagentNames.length}`);
  console.log(`error   (FakeErrorModel)   completed: ${errorCaseCompleted}/${subagentNames.length}`);
  console.log(`error   (FakeErrorModel)      failed: ${errorCaseFailed}/${subagentNames.length}`);

  if (errorCaseFailed > 0) {
    console.log("\n[FAIL] Subagent still hard-fails on LLM errors — llmErrorHandlingMiddleware is NOT intercepting.");
    process.exit(2);
  } else if (errorCaseCompleted === subagentNames.length) {
    console.log("\n[PASS] Subagent gracefully degrades on LLM errors — llmErrorHandlingMiddleware is intercepting as expected.");
  } else {
    console.log("\n[WARN] Unexpected status distribution — inspect logs above.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

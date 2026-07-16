/**
 * Test that the ported quill.models.factory can build the configured models.
 *
 * Run: cd backend && npm run build && node --experimental-vm-modules scripts/model_factory_test.mjs
 */

import assert from "node:assert";

import { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { createChatModel } from "../dist/packages/harness/quill/models/factory.js";
import { getAppConfig } from "../dist/packages/harness/quill/config/app_config.js";

async function main() {
  const appConfig = getAppConfig();
  assert.ok(appConfig.models.length > 0, "expected at least one model in config");

  for (const cfg of appConfig.models) {
    const model = createChatModel(cfg.name, false, { appConfig, attachTracing: false });
    assert.ok(model instanceof BaseChatModel, `${cfg.name}: expected BaseChatModel instance`);
    console.log(`✓ ${cfg.name} (${cfg.use}) -> ${model.constructor.name}`);
  }

  // Also verify thinking mode builds when the model advertises supports_thinking.
  const thinkingModels = appConfig.models.filter((m) => m.supportsThinking);
  for (const cfg of thinkingModels) {
    const model = createChatModel(cfg.name, true, { appConfig, attachTracing: false });
    assert.ok(model instanceof BaseChatModel, `${cfg.name} thinking: expected BaseChatModel instance`);
    console.log(`✓ ${cfg.name} (thinking enabled) -> ${model.constructor.name}`);
  }

  console.log("\nModel factory test passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

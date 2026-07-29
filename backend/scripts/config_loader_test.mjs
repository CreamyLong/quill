/**
 * Tests for the TS config loader.
 */

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  loadAppConfigFromFile,
  resolveConfigPath,
  resolveEnvVariables,
  resetAppConfig,
  setAppConfig,
  getAppConfig,
} from "../dist/packages/harness/quill/config/app_config.js";

function withTempConfig(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quill-config-test-"));
  const file = path.join(dir, "config.yaml");
  fs.writeFileSync(file, content, "utf-8");
  try {
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testResolveEnvVariables() {
  process.env.QUILL_TEST_SECRET = "shh";
  assert.strictEqual(resolveEnvVariables("$QUILL_TEST_SECRET"), "shh");
  assert.deepStrictEqual(resolveEnvVariables({ key: "$QUILL_TEST_SECRET" }), {
    key: "shh",
  });
  assert.deepStrictEqual(resolveEnvVariables(["$QUILL_TEST_SECRET"]), ["shh"]);
  assert.strictEqual(resolveEnvVariables(42), 42);
  delete process.env.QUILL_TEST_SECRET;
  console.log("✓ resolveEnvVariables works");
}

function testLoadMinimalConfig() {
  withTempConfig(
    `log_level: debug\nmodels:\n  - name: test-model\n    use: langchain_openai:ChatOpenAI\n    model: gpt-4o-mini\nsandbox:\n  use: quill.sandbox.local:LocalSandboxProvider\n`,
    (file) => {
      const cfg = loadAppConfigFromFile(file);
      assert.strictEqual(cfg.logLevel, "debug");
      assert.strictEqual(cfg.models.length, 1);
      assert.strictEqual(cfg.models[0].name, "test-model");
      assert.strictEqual(cfg.sandbox.use, "quill.sandbox.local:LocalSandboxProvider");
    }
  );
  console.log("✓ loadAppConfigFromFile parses minimal config");
}

function testLoadWithEnvVar() {
  process.env.QUILL_API_KEY = "test-key";
  withTempConfig(
    `models:\n  - name: env-model\n    use: langchain_openai:ChatOpenAI\n    model: gpt-4o-mini\n    api_key: $QUILL_API_KEY\n`,
    (file) => {
      const cfg = loadAppConfigFromFile(file);
      assert.strictEqual(cfg.models[0].api_key, "test-key");
    }
  );
  delete process.env.QUILL_API_KEY;
  console.log("✓ loadAppConfigFromFile resolves environment variables");
}

function testToolConfigPreservesExtraKeys() {
  withTempConfig(
    `models:\n  - name: m\n    use: langchain_openai:ChatOpenAI\n    model: gpt-4o-mini\ntools:\n  - name: web_search\n    group: web\n    use: quill.community.tavily.tools:webSearchTool\n    api_key: secret-key\n    max_results: 7\n`,
    (file) => {
      const cfg = loadAppConfigFromFile(file);
      assert.strictEqual(cfg.tools.length, 1);
      const tool = cfg.tools[0];
      assert.strictEqual(tool.name, "web_search");
      assert.strictEqual(tool.group, "web");
      assert.strictEqual(tool.use, "quill.community.tavily.tools:webSearchTool");
      // Extra provider-specific keys must survive (mirrors buildModelConfig).
      assert.strictEqual(tool.api_key, "secret-key");
      assert.strictEqual(tool.max_results, 7);
    }
  );
  console.log("✓ buildToolConfig preserves extra provider keys");
}

function testGetAppConfigDefault() {
  resetAppConfig();
  // Isolate from any ambient config.yaml in the real project root by pointing
  // the loader at an empty temp dir, so we exercise the "no config" fallback.
  const prevRoot = process.env.QUILL_PROJECT_ROOT;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quill-cfg-"));
  process.env.QUILL_PROJECT_ROOT = tmpRoot;
  try {
    resetAppConfig();
    const cfg = getAppConfig();
    assert.strictEqual(cfg.logLevel, "info");
    assert.strictEqual(cfg.models.length, 0);
  } finally {
    if (prevRoot === undefined) delete process.env.QUILL_PROJECT_ROOT;
    else process.env.QUILL_PROJECT_ROOT = prevRoot;
    resetAppConfig();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  console.log("✓ getAppConfig returns default when no config file exists");
}

async function main() {
  testResolveEnvVariables();
  testLoadMinimalConfig();
  testLoadWithEnvVar();
  testToolConfigPreservesExtraKeys();
  testGetAppConfigDefault();
  console.log("\nAll config loader tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

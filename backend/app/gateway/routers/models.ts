/**
 * Models API router.
 *
 * GET    /api/models           — list configured models (full details)
 * PUT    /api/models           — replace entire models array
 * PATCH  /api/models/:name     — update a single model by name
 * DELETE /api/models/:name     — remove a model by name
 * POST   /api/models/validate  — validate a model config without saving
 * GET    /api/models/providers — list available provider plugins
 */

import { Router } from "express";

import { getAppConfig } from "../../../packages/harness/quill/config/app_config.js";
import {
  validateModelEntries,
  validateSingleModel,
  writeConfigModelsAndReload,
  patchConfigModelAndReload,
  removeConfigModelAndReload,
} from "../../../packages/harness/quill/config/config_writer.js";
import { resolveCapabilities } from "../../../packages/harness/quill/models/capabilities.js";
import { listProviders } from "../../../packages/harness/quill/models/provider_registry.js";

const router = Router();

/** GET /api/models — list configured models with full details. */
router.get("/", (_req, res) => {
  const config = getAppConfig();
  const models = (config.models ?? []).map((m) => {
    const entry = m as Record<string, unknown>;
    const validation = validateSingleModel(entry);
    return {
      name: m.name,
      model: m.model,
      use: m.use,
      display_name: m.displayName ?? m.display_name ?? null,
      description: (m.description as string | null) ?? null,
      base_url: (m.base_url ?? m.api_base ?? m.baseUrl ?? null) as string | null,
      supports_thinking: (m.supportsThinking ?? m.supports_thinking ?? false) as boolean,
      supports_vision: (m.supportsVision ?? m.supports_vision ?? false) as boolean,
      supports_reasoning_effort:
        (m.supportsReasoningEffort ?? m.supports_reasoning_effort ?? false) as boolean,
      // Runtime-resolved capabilities.
      capabilities: resolveCapabilities(entry),
      // Credential status.
      has_credentials: validation.hasCredentials,
      // Validation warnings.
      warnings: validation.warnings,
    };
  });
  res.json({ models, token_usage: { enabled: false } });
});

/** PUT /api/models — replace entire models array. */
router.put("/", (req, res) => {
  const models = req.body?.models;
  if (!models) {
    res.status(400).json({ error: "Missing 'models' in request body" });
    return;
  }

  const validation = validateModelEntries(models);
  if (!validation.valid) {
    res.status(400).json({
      error: "Invalid models",
      details: validation.errors,
      results: validation.results,
    });
    return;
  }

  try {
    writeConfigModelsAndReload(models as unknown[]);
    res.json({ success: true, models });
  } catch (err) {
    console.error("[models] Failed to write config:", err);
    res.status(500).json({ error: "Failed to save models config" });
  }
});

/** PATCH /api/models/:name — update a single model by name. */
router.patch("/:name", (req, res) => {
  const name = req.params.name;
  const model = req.body;
  if (!model || typeof model !== "object") {
    res.status(400).json({ error: "Missing model in request body" });
    return;
  }

  const validation = validateSingleModel(model);
  if (!validation.valid) {
    res.status(400).json({
      error: "Invalid model",
      details: validation.errors,
      warnings: validation.warnings,
    });
    return;
  }

  try {
    // Ensure the name in the path matches the body.
    const modelWithName = { ...model, name };
    patchConfigModelAndReload(name, modelWithName);
    res.json({ success: true, model: modelWithName });
  } catch (err) {
    console.error("[models] Failed to patch model:", err);
    res.status(500).json({ error: "Failed to update model" });
  }
});

/** DELETE /api/models/:name — remove a model by name. */
router.delete("/:name", (req, res) => {
  const name = req.params.name;
  try {
    const removed = removeConfigModelAndReload(name);
    if (!removed) {
      res.status(404).json({ error: `Model '${name}' not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[models] Failed to remove model:", err);
    res.status(500).json({ error: "Failed to remove model" });
  }
});

/** POST /api/models/validate — validate a model config without saving. */
router.post("/validate", (req, res) => {
  const model = req.body;
  const validation = validateSingleModel(model);
  res.json(validation);
});

/** GET /api/models/providers — list available provider plugins. */
router.get("/providers", (_req, res) => {
  const providers = listProviders().map((p) => ({
    id: p.id,
    name: p.name,
    logo: p.logo ?? null,
    auth_methods: p.authMethods,
    config_fields: p.configFields,
    default_capabilities: p.defaultCapabilities,
    class_path: p.classPath,
  }));
  res.json({ providers });
});

export default router;

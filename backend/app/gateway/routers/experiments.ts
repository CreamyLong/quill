/**
 * Experiment API Routes — CRUD + hot-reload.
 *
 * Express router for managing experiments:
 *   GET    /api/experiments              — list all experiments
 *   POST   /api/experiments              — create a new experiment
 *   GET    /api/experiments/:id          — get a single experiment
 *   PUT    /api/experiments/:id          — update an experiment
 *   DELETE /api/experiments/:id          — delete an experiment
 *   POST   /api/experiments/:id/enable   — enable an experiment
 *   POST   /api/experiments/:id/disable  — disable an experiment
 *   GET    /api/experiments/:id/report   — get experiment report
 *   GET    /api/experiments/:id/metrics  — get variant metrics
 *   POST   /api/experiments/:id/reset    — reset metrics
 *   GET    /api/experiments/modules      — list registered modules
 *   GET    /api/experiments/modules/:key/variants — list variants for a module
 *   POST   /api/experiments/modules/:key/switch   — switch active variant
 *
 * @module app/gateway/routers/experiments
 */

import { Router, type Request, type Response } from "express";

import {
  getExperimentSuite,
  getExperiment,
  getExperimentsForModule,
  upsertExperiment,
  removeExperiment,
  validateExperiment,
  type ExperimentConfig,
} from "../../../packages/harness/quill/experiments/config.js";
import {
  listModuleKeys,
  listVariants,
  switchVariant,
  getRegistration,
  resetMetrics,
  type AlgorithmModuleKey,
} from "../../../packages/harness/quill/experiments/registry.js";
import { getVariantComparison } from "../../../packages/harness/quill/experiments/runtime.js";
import { generateReport, formatReport } from "../../../packages/harness/quill/experiments/evaluation.js";

export const experimentsRouter = Router();

// ---------------------------------------------------------------------------
// Experiment CRUD
// ---------------------------------------------------------------------------

/** GET /api/experiments — list all experiments. */
experimentsRouter.get("/", (_req: Request, res: Response) => {
  const suite = getExperimentSuite();
  res.json(suite);
});

/** POST /api/experiments — create a new experiment. */
experimentsRouter.post("/", (req: Request, res: Response) => {
  const config = req.body as ExperimentConfig;
  const errors = validateExperiment(config);
  if (errors.length > 0) {
    res.status(400).json({ error: "Validation failed", details: errors });
    return;
  }
  const suite = upsertExperiment(config);
  res.status(201).json(suite);
});

/** GET /api/experiments/modules — list registered algorithm modules. */
experimentsRouter.get("/modules", (_req: Request, res: Response) => {
  const keys = listModuleKeys();
  const modules = keys.map((key) => {
    const reg = getRegistration(key);
    return {
      key,
      variants: reg?.variants ?? [],
      activeVariant: reg?.activeVariant ?? null,
    };
  });
  res.json({ modules });
});

/** GET /api/experiments/modules/:key/variants — list variants for a module. */
experimentsRouter.get("/modules/:key/variants", (req: Request, res: Response) => {
  const key = req.params.key as AlgorithmModuleKey;
  const variants = listVariants(key);
  const reg = getRegistration(key);
  res.json({
    key,
    variants,
    activeVariant: reg?.activeVariant ?? null,
  });
});

/** POST /api/experiments/modules/:key/switch — switch active variant. */
experimentsRouter.post("/modules/:key/switch", (req: Request, res: Response) => {
  const key = req.params.key as AlgorithmModuleKey;
  const { variant } = req.body as { variant: string };
  if (!variant) {
    res.status(400).json({ error: "variant is required" });
    return;
  }
  const success = switchVariant(key, variant);
  if (!success) {
    res.status(404).json({ error: `Variant "${variant}" not found for module "${key}"` });
    return;
  }
  const reg = getRegistration(key);
  res.json({ key, activeVariant: reg?.activeVariant });
});

/** GET /api/experiments/:id — get a single experiment. */
experimentsRouter.get("/:id", (req: Request, res: Response) => {
  const experiment = getExperiment(req.params.id as string);
  if (!experiment) {
    res.status(404).json({ error: "Experiment not found" });
    return;
  }
  res.json(experiment);
});

/** PUT /api/experiments/:id — update an experiment. */
experimentsRouter.put("/:id", (req: Request, res: Response) => {
  const config = req.body as ExperimentConfig;
  config.id = req.params.id as string;
  const errors = validateExperiment(config);
  if (errors.length > 0) {
    res.status(400).json({ error: "Validation failed", details: errors });
    return;
  }
  const suite = upsertExperiment(config);
  res.json(suite);
});

/** DELETE /api/experiments/:id — delete an experiment. */
experimentsRouter.delete("/:id", (req: Request, res: Response) => {
  const suite = removeExperiment(req.params.id as string);
  res.json(suite);
});

// ---------------------------------------------------------------------------
// Experiment Control
// ---------------------------------------------------------------------------

/** POST /api/experiments/:id/enable — enable an experiment. */
experimentsRouter.post("/:id/enable", (req: Request, res: Response) => {
  const experiment = getExperiment(req.params.id as string);
  if (!experiment) {
    res.status(404).json({ error: "Experiment not found" });
    return;
  }
  experiment.enabled = true;
  const suite = upsertExperiment(experiment);
  res.json(suite);
});

/** POST /api/experiments/:id/disable — disable an experiment. */
experimentsRouter.post("/:id/disable", (req: Request, res: Response) => {
  const experiment = getExperiment(req.params.id as string);
  if (!experiment) {
    res.status(404).json({ error: "Experiment not found" });
    return;
  }
  experiment.enabled = false;
  const suite = upsertExperiment(experiment);
  res.json(suite);
});

// ---------------------------------------------------------------------------
// Experiment Results
// ---------------------------------------------------------------------------

/** GET /api/experiments/:id/report — get experiment report. */
experimentsRouter.get("/:id/report", (req: Request, res: Response) => {
  const experiment = getExperiment(req.params.id as string);
  if (!experiment) {
    res.status(404).json({ error: "Experiment not found" });
    return;
  }
  const report = generateReport(experiment);
  res.json(report);
});

/** GET /api/experiments/:id/report/text — get human-readable report. */
experimentsRouter.get("/:id/report/text", (req: Request, res: Response) => {
  const experiment = getExperiment(req.params.id as string);
  if (!experiment) {
    res.status(404).json({ error: "Experiment not found" });
    return;
  }
  const report = generateReport(experiment);
  res.type("text/plain").send(formatReport(report));
});

/** GET /api/experiments/:id/metrics — get variant metrics. */
experimentsRouter.get("/:id/metrics", (req: Request, res: Response) => {
  const experiment = getExperiment(req.params.id as string);
  if (!experiment) {
    res.status(404).json({ error: "Experiment not found" });
    return;
  }
  const comparison = getVariantComparison(experiment.moduleKey);
  res.json({ moduleKey: experiment.moduleKey, variants: comparison });
});

/** POST /api/experiments/:id/reset — reset metrics for all variants. */
experimentsRouter.post("/:id/reset", (req: Request, res: Response) => {
  const experiment = getExperiment(req.params.id as string);
  if (!experiment) {
    res.status(404).json({ error: "Experiment not found" });
    return;
  }
  for (const v of experiment.variants) {
    resetMetrics(experiment.moduleKey, v.variant);
  }
  res.json({ message: "Metrics reset", moduleKey: experiment.moduleKey });
});

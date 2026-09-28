/**
 * Experiment Persistence — store and track experiment runs over time.
 *
 * Researchers can save experiment runs, compare results across time,
 * and track the history of experiments. Runs are stored under
 * `.scitops/experiment-runs/` as JSON files.
 *
 * @module experiments/persistence
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { projectRoot } from "../config/runtime_paths.js";
import type { ExperimentConfig } from "./config.js";
import type { ExperimentReport } from "./evaluation.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single experiment run record. */
export interface ExperimentRun {
  /** Unique run ID. */
  runId: string;
  /** The experiment configuration used. */
  experiment: ExperimentConfig;
  /** The report generated from this run. */
  report: ExperimentReport;
  /** ISO timestamp of when the run was recorded. */
  recordedAt: string;
  /** Optional notes from the researcher. */
  notes?: string;
  /** Tags for filtering. */
  tags?: string[];
}

/** Collection of all experiment runs. */
export interface ExperimentRunCollection {
  version: number;
  runs: ExperimentRun[];
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const RUNS_DIR = path.join(projectRoot(), ".scitops", "experiment-runs");
const RUNS_FILE = path.join(RUNS_DIR, "runs.json");

/** Cached run collection. */
let cachedCollection: ExperimentRunCollection | null = null;

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

/**
 * Load the run collection from disk.
 */
export function loadRunCollection(): ExperimentRunCollection {
  if (cachedCollection) return cachedCollection;

  if (!fs.existsSync(RUNS_FILE)) {
    cachedCollection = { version: 1, runs: [] };
    return cachedCollection;
  }

  try {
    const raw = fs.readFileSync(RUNS_FILE, "utf-8");
    cachedCollection = JSON.parse(raw) as ExperimentRunCollection;
  } catch {
    cachedCollection = { version: 1, runs: [] };
  }
  return cachedCollection;
}

/**
 * Get the cached run collection (or load from disk).
 */
export function getRunCollection(): ExperimentRunCollection {
  return loadRunCollection();
}

/**
 * Save the run collection to disk and invalidate cache.
 */
export function saveRunCollection(collection: ExperimentRunCollection): void {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const tmp = `${RUNS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(collection, null, 2), "utf-8");
  fs.renameSync(tmp, RUNS_FILE);
  cachedCollection = collection;
}

/**
 * Record a new experiment run.
 */
export function recordExperimentRun(
  experiment: ExperimentConfig,
  report: ExperimentReport,
  options?: { notes?: string; tags?: string[] },
): ExperimentRun {
  const collection = loadRunCollection();
  const run: ExperimentRun = {
    runId: randomUUID(),
    experiment,
    report,
    recordedAt: new Date().toISOString(),
    notes: options?.notes,
    tags: options?.tags,
  };
  collection.runs.push(run);
  saveRunCollection(collection);
  return run;
}

/**
 * Get a single run by ID.
 */
export function getRun(runId: string): ExperimentRun | undefined {
  return loadRunCollection().runs.find((r) => r.runId === runId);
}

/**
 * List all runs for an experiment.
 */
export function listRunsForExperiment(experimentId: string): ExperimentRun[] {
  return loadRunCollection().runs
    .filter((r) => r.experiment.id === experimentId)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

/**
 * List all runs.
 */
export function listAllRuns(): ExperimentRun[] {
  return loadRunCollection().runs
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

/**
 * Remove a run by ID.
 */
export function removeRun(runId: string): ExperimentRunCollection {
  const collection = loadRunCollection();
  collection.runs = collection.runs.filter((r) => r.runId !== runId);
  saveRunCollection(collection);
  return collection;
}

/**
 * Invalidate the cache (force reload on next access).
 */
export function resetRunCache(): void {
  cachedCollection = null;
}

// ---------------------------------------------------------------------------
// Comparison and Analysis
// ---------------------------------------------------------------------------

/**
 * Compare two runs of the same experiment.
 */
export function compareRuns(runIdA: string, runIdB: string): RunComparison | null {
  const runA = getRun(runIdA);
  const runB = getRun(runIdB);
  if (!runA || !runB) return null;

  const comparison: RunComparison = {
    runA: { runId: runA.runId, recordedAt: runA.recordedAt, winner: runA.report.verdict.winner },
    runB: { runId: runB.runId, recordedAt: runB.recordedAt, winner: runB.report.verdict.winner },
    variantChanges: [],
  };

  // Compare per-variant metrics
  const variantsA = new Map(runA.report.variants.map((v) => [v.variant, v]));
  const variantsB = new Map(runB.report.variants.map((v) => [v.variant, v]));

  for (const [variantName, variantA] of variantsA) {
    const variantB = variantsB.get(variantName);
    if (!variantB) continue;

    const successRateA = variantA.metrics.executions > 0
      ? variantA.metrics.successes / variantA.metrics.executions
      : 0;
    const successRateB = variantB.metrics.executions > 0
      ? variantB.metrics.successes / variantB.metrics.executions
      : 0;

    comparison.variantChanges.push({
      variant: variantName,
      successRateDiff: successRateB - successRateA,
      latencyDiff: variantB.metrics.avgLatencyMs - variantA.metrics.avgLatencyMs,
      executionsDiff: variantB.metrics.executions - variantA.metrics.executions,
    });
  }

  return comparison;
}

/** Result of comparing two runs. */
export interface RunComparison {
  runA: { runId: string; recordedAt: string; winner: string | null };
  runB: { runId: string; recordedAt: string; winner: string | null };
  variantChanges: Array<{
    variant: string;
    successRateDiff: number;
    latencyDiff: number;
    executionsDiff: number;
  }>;
}

/**
 * Get statistics about all runs.
 */
export function getRunStats(): {
  totalRuns: number;
  totalExperiments: number;
  byExperiment: Record<string, number>;
  byTag: Record<string, number>;
} {
  const collection = loadRunCollection();
  const byExperiment: Record<string, number> = {};
  const byTag: Record<string, number> = {};

  for (const run of collection.runs) {
    byExperiment[run.experiment.id] = (byExperiment[run.experiment.id] ?? 0) + 1;
    for (const tag of run.tags ?? []) {
      byTag[tag] = (byTag[tag] ?? 0) + 1;
    }
  }

  return {
    totalRuns: collection.runs.length,
    totalExperiments: Object.keys(byExperiment).length,
    byExperiment,
    byTag,
  };
}

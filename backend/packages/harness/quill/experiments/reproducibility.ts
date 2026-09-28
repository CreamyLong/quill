/**
 * Reproducibility — experiment versioning and snapshot management.
 *
 * Researchers can:
 *   - Save experiment configurations with full metadata
 *   - Reproduce previous experiments exactly
 *   - Track changes across experiment versions
 *   - Compare results across versions
 *
 * Inspired by:
 *   - ZCode's task configuration storage
 *   - OpenWork's Daytona sandbox reproducibility
 *   - awesome-harness-engineering's metadata pinning
 *
 * @module experiments/reproducibility
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { projectRoot } from "../config/runtime_paths.js";
import type { ExperimentConfig } from "./config.js";
import type { BenchmarkRunResult } from "./benchmark.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A snapshot of an experiment configuration. */
export interface ExperimentSnapshot {
  /** Unique snapshot ID. */
  snapshotId: string;
  /** The experiment configuration. */
  experiment: ExperimentConfig;
  /** Git commit hash (if available). */
  gitCommit?: string;
  /** Platform information. */
  platform: {
    os: string;
    arch: string;
    nodeVersion: string;
  };
  /** Environment variables (sanitized). */
  env: Record<string, string>;
  /** ISO timestamp of snapshot creation. */
  createdAt: string;
  /** Optional description. */
  description?: string;
}

/** A versioned experiment with its history. */
export interface VersionedExperiment {
  experimentId: string;
  versions: ExperimentSnapshot[];
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const SNAPSHOTS_DIR = path.join(projectRoot(), ".scitops", "snapshots");

/**
 * Save an experiment snapshot.
 */
export function saveSnapshot(
  experiment: ExperimentConfig,
  options?: { description?: string },
): ExperimentSnapshot {
  const snapshotId = `snap_${Date.now()}_${randomId()}`;
  const snapshot: ExperimentSnapshot = {
    snapshotId,
    experiment: { ...experiment },
    gitCommit: getGitCommit(),
    platform: {
      os: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
    },
    env: sanitizeEnv(process.env),
    createdAt: new Date().toISOString(),
    description: options?.description,
  };

  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  const file = path.join(SNAPSHOTS_DIR, `${snapshotId}.json`);
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2), "utf-8");

  return snapshot;
}

/**
 * Load a snapshot by ID.
 */
export function loadSnapshot(snapshotId: string): ExperimentSnapshot | null {
  const file = path.join(SNAPSHOTS_DIR, `${snapshotId}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as ExperimentSnapshot;
  } catch {
    return null;
  }
}

/**
 * List all snapshots for an experiment.
 */
export function listSnapshotsForExperiment(experimentId: string): ExperimentSnapshot[] {
  if (!fs.existsSync(SNAPSHOTS_DIR)) return [];
  const files = fs.readdirSync(SNAPSHOTS_DIR).filter((f) => f.endsWith(".json"));
  const snapshots: ExperimentSnapshot[] = [];
  for (const file of files) {
    try {
      const snapshot = JSON.parse(fs.readFileSync(path.join(SNAPSHOTS_DIR, file), "utf-8")) as ExperimentSnapshot;
      if (snapshot.experiment.id === experimentId) {
        snapshots.push(snapshot);
      }
    } catch {
      // Skip invalid snapshots
    }
  }
  return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Compare two snapshots and return differences.
 */
export function compareSnapshots(
  snapshotA: ExperimentConfig,
  snapshotB: ExperimentConfig,
): SnapshotDiff {
  const changes: string[] = [];

  if (snapshotA.name !== snapshotB.name) changes.push(`name: "${snapshotA.name}" → "${snapshotB.name}"`);
  if (snapshotA.moduleKey !== snapshotB.moduleKey) changes.push(`moduleKey: "${snapshotA.moduleKey}" → "${snapshotB.moduleKey}"`);
  if (snapshotA.enabled !== snapshotB.enabled) changes.push(`enabled: ${snapshotA.enabled} → ${snapshotB.enabled}`);

  // Compare variants
  const variantsA = new Map(snapshotA.variants.map((v) => [v.variant, v.weight]));
  const variantsB = new Map(snapshotB.variants.map((v) => [v.variant, v.weight]));
  for (const [name, weight] of variantsA) {
    const other = variantsB.get(name);
    if (other === undefined) {
      changes.push(`variant "${name}" removed`);
    } else if (other !== weight) {
      changes.push(`variant "${name}" weight: ${weight} → ${other}`);
    }
  }
  for (const [name] of variantsB) {
    if (!variantsA.has(name)) {
      changes.push(`variant "${name}" added`);
    }
  }

  // Compare criteria
  if (JSON.stringify(snapshotA.criteria) !== JSON.stringify(snapshotB.criteria)) {
    changes.push("criteria changed");
  }

  return {
    identical: changes.length === 0,
    changes,
  };
}

/** Result of comparing two snapshots. */
export interface SnapshotDiff {
  identical: boolean;
  changes: string[];
}

// ---------------------------------------------------------------------------
// Reproducibility Report
// ---------------------------------------------------------------------------

/**
 * Generate a reproducibility report for a benchmark run.
 */
export function generateReproducibilityReport(result: BenchmarkRunResult): string {
  const lines: string[] = [];

  lines.push(`# Reproducibility Report`);
  lines.push(``);
  lines.push(`## Run Information`);
  lines.push(`- **Run ID:** ${result.runId}`);
  lines.push(`- **Name:** ${result.name}`);
  lines.push(`- **Started:** ${result.startedAt}`);
  lines.push(`- **Finished:** ${result.finishedAt}`);
  lines.push(``);

  lines.push(`## Models Evaluated`);
  for (const m of result.models) {
    lines.push(`- **${m.model.name}** (${m.model.provider})`);
  }
  lines.push(``);

  lines.push(`## Environment`);
  lines.push(`- **Platform:** ${process.platform} ${process.arch}`);
  lines.push(`- **Node Version:** ${process.version}`);
  lines.push(``);

  lines.push(`## Results Summary`);
  lines.push(`- **Winner:** ${result.winner ?? "N/A"}`);
  lines.push(`- **Models Compared:** ${result.models.length}`);
  lines.push(``);

  lines.push(`## How to Reproduce`);
  lines.push(``);
  lines.push(`1. Ensure you have the same model configurations`);
  lines.push(`2. Run the benchmark with the same suite`);
  lines.push(`3. Compare results using the statistical tests provided`);
  lines.push(``);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function getGitCommit(): string | undefined {
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    return execSync("git rev-parse HEAD", { cwd: projectRoot(), encoding: "utf-8" }).trim();
  } catch {
    return undefined;
  }
}

function sanitizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const sanitized: Record<string, string> = {};
  const sensitiveKeys = ["KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIAL", "AUTH"];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (sensitiveKeys.some((s) => key.toUpperCase().includes(s))) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

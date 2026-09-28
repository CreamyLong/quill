/**
 * Dataset Management — upload, version, and manage benchmark datasets.
 *
 * Researchers can upload datasets (JSON/JSONL), version them, and pin
 * specific versions for reproducible experiments. Datasets are stored
 * under `.scitops/datasets/` with content-addressed storage.
 *
 * @module experiments/datasets
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { projectRoot } from "../config/runtime_paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single dataset entry. */
export interface DatasetEntry {
  /** Unique dataset ID. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description of the dataset. */
  description?: string;
  /** Dataset format. */
  format: "json" | "jsonl" | "csv";
  /** Number of records in the dataset. */
  recordCount: number;
  /** Content hash for integrity verification. */
  contentHash: string;
  /** Version number. */
  version: number;
  /** Tags for filtering. */
  tags?: string[];
  /** Arbitrary metadata. */
  metadata?: Record<string, unknown>;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
}

/** A dataset version entry. */
export interface DatasetVersion {
  version: number;
  contentHash: string;
  recordCount: number;
  createdAt: string;
  description?: string;
}

/** Collection of all datasets. */
export interface DatasetCollection {
  version: number;
  datasets: DatasetEntry[];
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const DATASETS_DIR = path.join(projectRoot(), ".scitops", "datasets");
const DATASETS_FILE = path.join(DATASETS_DIR, "datasets.json");

/** Cached dataset collection. */
let cachedCollection: DatasetCollection | null = null;

/** Listeners for config changes. */
type ConfigListener = (collection: DatasetCollection) => void;
const configListeners: ConfigListener[] = [];

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

/**
 * Load the dataset collection from disk.
 */
export function loadDatasetCollection(): DatasetCollection {
  if (cachedCollection) return cachedCollection;

  if (!fs.existsSync(DATASETS_FILE)) {
    cachedCollection = { version: 1, datasets: [] };
    return cachedCollection;
  }

  try {
    const raw = fs.readFileSync(DATASETS_FILE, "utf-8");
    cachedCollection = JSON.parse(raw) as DatasetCollection;
  } catch {
    cachedCollection = { version: 1, datasets: [] };
  }
  return cachedCollection;
}

/**
 * Get the cached dataset collection (or load from disk).
 */
export function getDatasetCollection(): DatasetCollection {
  return loadDatasetCollection();
}

/**
 * Get a single dataset by ID.
 */
export function getDataset(id: string): DatasetEntry | undefined {
  return loadDatasetCollection().datasets.find((d) => d.id === id);
}

/**
 * Save the dataset collection to disk and invalidate cache.
 */
export function saveDatasetCollection(collection: DatasetCollection): void {
  fs.mkdirSync(DATASETS_DIR, { recursive: true });
  const tmp = `${DATASETS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(collection, null, 2), "utf-8");
  fs.renameSync(tmp, DATASETS_FILE);
  cachedCollection = collection;
  for (const l of configListeners) {
    l(collection);
  }
}

/**
 * Add or update a dataset.
 */
export function upsertDataset(dataset: DatasetEntry): DatasetCollection {
  const collection = loadDatasetCollection();
  const idx = collection.datasets.findIndex((d) => d.id === dataset.id);
  const now = new Date().toISOString();
  if (idx >= 0) {
    collection.datasets[idx] = { ...dataset, updatedAt: now };
  } else {
    collection.datasets.push({ ...dataset, createdAt: now, updatedAt: now });
  }
  saveDatasetCollection(collection);
  return collection;
}

/**
 * Remove a dataset by ID.
 */
export function removeDataset(id: string): DatasetCollection {
  const collection = loadDatasetCollection();
  collection.datasets = collection.datasets.filter((d) => d.id !== id);
  saveDatasetCollection(collection);
  return collection;
}

/**
 * Invalidate the cache (force reload on next access).
 */
export function resetDatasetCache(): void {
  cachedCollection = null;
}

/**
 * Subscribe to config changes.
 */
export function onConfigChange(listener: ConfigListener): () => void {
  configListeners.push(listener);
  return () => {
    const idx = configListeners.indexOf(listener);
    if (idx >= 0) configListeners.splice(idx, 1);
  };
}

// ---------------------------------------------------------------------------
// Dataset Upload and Versioning
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 hash of content.
 */
export function computeContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Upload a dataset from raw content.
 */
export function uploadDataset(options: {
  id: string;
  name: string;
  description?: string;
  format: "json" | "jsonl" | "csv";
  content: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}): DatasetEntry {
  const hash = computeContentHash(options.content);
  const existing = getDataset(options.id);
  const version = existing ? existing.version + 1 : 1;

  // Count records based on format
  let recordCount = 0;
  if (options.format === "jsonl") {
    recordCount = options.content.split("\n").filter((l) => l.trim()).length;
  } else if (options.format === "json") {
    try {
      const parsed = JSON.parse(options.content);
      recordCount = Array.isArray(parsed) ? parsed.length : 1;
    } catch {
      recordCount = 1;
    }
  } else {
    recordCount = options.content.split("\n").filter((l) => l.trim()).length - 1; // minus header
  }

  // Store the content file
  const contentDir = path.join(DATASETS_DIR, "files");
  fs.mkdirSync(contentDir, { recursive: true });
  const contentFile = path.join(contentDir, `${options.id}_v${version}.json`);
  fs.writeFileSync(contentFile, options.content, "utf-8");

  const dataset: DatasetEntry = {
    id: options.id,
    name: options.name,
    description: options.description,
    format: options.format,
    recordCount,
    contentHash: hash,
    version,
    tags: options.tags,
    metadata: options.metadata,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  upsertDataset(dataset);
  return dataset;
}

/**
 * Read dataset content by ID and optional version.
 */
export function readDatasetContent(id: string, version?: number): string | null {
  const dataset = getDataset(id);
  if (!dataset) return null;

  const targetVersion = version ?? dataset.version;
  const contentFile = path.join(DATASETS_DIR, "files", `${id}_v${targetVersion}.json`);

  if (!fs.existsSync(contentFile)) return null;
  return fs.readFileSync(contentFile, "utf-8");
}

/**
 * List all versions of a dataset.
 */
export function listDatasetVersions(id: string): DatasetVersion[] {
  const dataset = getDataset(id);
  if (!dataset) return [];

  const versions: DatasetVersion[] = [];
  for (let v = 1; v <= dataset.version; v++) {
    const contentFile = path.join(DATASETS_DIR, "files", `${id}_v${v}.json`);
    if (fs.existsSync(contentFile)) {
      const content = fs.readFileSync(contentFile, "utf-8");
      versions.push({
        version: v,
        contentHash: computeContentHash(content),
        recordCount: dataset.recordCount,
        createdAt: dataset.createdAt,
      });
    }
  }
  return versions;
}

/**
 * Validate a dataset's integrity by checking its content hash.
 */
export function validateDatasetIntegrity(id: string, version?: number): boolean {
  const dataset = getDataset(id);
  if (!dataset) return false;

  const targetVersion = version ?? dataset.version;
  const content = readDatasetContent(id, targetVersion);
  if (content === null) return false;

  const hash = computeContentHash(content);
  return hash === dataset.contentHash;
}

// ---------------------------------------------------------------------------
// Dataset Statistics
// ---------------------------------------------------------------------------

/**
 * Get statistics about the dataset collection.
 */
export function getDatasetStats(): {
  totalDatasets: number;
  totalRecords: number;
  byFormat: Record<string, number>;
  byTag: Record<string, number>;
} {
  const collection = loadDatasetCollection();
  const byFormat: Record<string, number> = {};
  const byTag: Record<string, number> = {};
  let totalRecords = 0;

  for (const dataset of collection.datasets) {
    byFormat[dataset.format] = (byFormat[dataset.format] ?? 0) + 1;
    totalRecords += dataset.recordCount;
    for (const tag of dataset.tags ?? []) {
      byTag[tag] = (byTag[tag] ?? 0) + 1;
    }
  }

  return {
    totalDatasets: collection.datasets.length,
    totalRecords,
    byFormat,
    byTag,
  };
}

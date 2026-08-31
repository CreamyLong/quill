/**
 * Desktop sync API router.
 *
 * Implements the server-side contract for workspace sync from the Tauri
 * desktop shell. The desktop walks a local workspace, submits a manifest,
 * and uploads only the changed files.
 *
 * Endpoints:
 *   POST /api/desktop/sync/manifest  — manifest diff
 *   POST /api/desktop/sync/file      — file upload
 *   GET  /api/desktop/sync/status    — sync config
 */

import { Router } from "express";
import multer from "multer";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as crypto from "node:crypto";

import type {
  ManifestRequest,
  ManifestResponse,
  FileUploadResponse,
  SyncStatusResponse,
} from "./desktop-sync.types.js";

const router = Router();

// In-memory store of file checksums (path → { size, modified, hash }).
// In production, this would be persisted in the database.
const _fileRegistry = new Map<string, { size: number; modified: number; hash: string }>();

// Multer config: store uploads in temp directory, 50MB limit.
const upload = multer({
  dest: "/tmp/quill-sync-uploads/",
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Default sync configuration.
const SYNC_CONFIG: SyncStatusResponse = {
  enabled: true,
  max_file_size: 50 * 1024 * 1024, // 50MB
  max_total_files: 10000,
  allowed_patterns: ["*"],
  blocked_patterns: [
    ".git/**",
    "node_modules/**",
    ".next/**",
    "target/**",
    "*.tmp",
    "*.log",
    ".DS_Store",
    "Thumbs.db",
  ],
};

/**
 * Check if a path matches any of the blocked patterns.
 */
function isBlocked(relPath: string, patterns: string[]): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  for (const pattern of patterns) {
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3);
      if (normalized.startsWith(prefix)) return true;
    } else if (pattern.includes("*")) {
      // Simple glob: convert to regex.
      const regexStr = pattern
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*");
      if (new RegExp(`^${regexStr}$`).test(normalized)) return true;
    } else if (normalized === pattern) {
      return true;
    }
  }
  return false;
}

/**
 * Compute a simple hash of file content for change detection.
 */
async function computeFileHash(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
}

// ────────────────────────────────────────────────────────────────────────
// Routes
// ────────────────────────────────────────────────────────────────────────

/**
 * POST /api/desktop/sync/manifest
 *
 * Submit a manifest of local files. Returns the list of files that need
 * to be uploaded (changed or new).
 */
router.post("/manifest", async (req, res) => {
  try {
    const body = req.body as ManifestRequest;
    if (!body || !Array.isArray(body.files)) {
      res.status(400).json({ error: "Invalid manifest: files array required" });
      return;
    }

    const changed: string[] = [];

    for (const entry of body.files) {
      // Skip blocked patterns.
      if (isBlocked(entry.path, SYNC_CONFIG.blocked_patterns)) {
        continue;
      }

      // Check if file has changed.
      const existing = _fileRegistry.get(entry.path);
      if (!existing || existing.size !== entry.size || existing.modified !== entry.modified) {
        changed.push(entry.path);
      }
    }

    const response: ManifestResponse = {
      changed,
      server_total: _fileRegistry.size,
    };

    res.json(response);
  } catch (err) {
    console.error("[desktop-sync] Manifest error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/desktop/sync/file
 *
 * Upload a single file (multipart/form-data with "file" field).
 * The "path" field specifies the relative path within the workspace.
 */
router.post("/file", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    const relPath = req.body.path as string;
    if (!relPath) {
      res.status(400).json({ error: "No path provided" });
      return;
    }

    // Validate path (prevent directory traversal).
    const normalized = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
    if (isBlocked(normalized, SYNC_CONFIG.blocked_patterns)) {
      res.status(403).json({ error: "File type blocked" });
      return;
    }

    // Compute hash and update registry.
    const hash = await computeFileHash(req.file.path);
    _fileRegistry.set(normalized, {
      size: req.file.size,
      modified: Math.floor(Date.now() / 1000),
      hash,
    });

    // Clean up temp file.
    await fs.unlink(req.file.path).catch(() => {});

    const response: FileUploadResponse = {
      success: true,
      path: normalized,
    };

    res.json(response);
  } catch (err) {
    console.error("[desktop-sync] Upload error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/desktop/sync/status
 *
 * Get sync configuration and current status.
 */
router.get("/status", (_req, res) => {
  res.json({
    ...SYNC_CONFIG,
    registered_files: _fileRegistry.size,
  });
});

export default router;

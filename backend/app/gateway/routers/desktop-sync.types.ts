/**
 * Desktop sync API request/response contracts.
 *
 * Protocol between the Tauri desktop shell (sync_bridge.rs) and the Gateway:
 *   POST /api/desktop/sync/manifest  — submit local manifest, get changed list
 *   POST /api/desktop/sync/file      — upload a single changed file (multipart)
 *   GET  /api/desktop/sync/status    — get sync configuration and status
 */

/** A single file entry in the manifest. */
export interface ManifestEntry {
  /** Relative path from workspace root. */
  path: string;
  /** File size in bytes. */
  size: number;
  /** Last modified timestamp (epoch seconds). */
  modified: number;
}

/** Request body for manifest diff. */
export interface ManifestRequest {
  files: ManifestEntry[];
  /** Workspace root path (absolute, for server-side validation). */
  workspace_root?: string | null;
}

/** Response: which files need to be uploaded. */
export interface ManifestResponse {
  /** Relative paths that have changed or are new. */
  changed: string[];
  /** Total files on server (for progress display). */
  server_total?: number;
}

/** Response for file upload. */
export interface FileUploadResponse {
  success: boolean;
  path: string;
  message?: string;
}

/** Sync configuration and status. */
export interface SyncStatusResponse {
  enabled: boolean;
  /** Maximum file size in bytes (default 50MB). */
  max_file_size: number;
  /** Maximum total files per sync (default 10000). */
  max_total_files: number;
  /** Allowed file patterns (glob). */
  allowed_patterns: string[];
  /** Blocked file patterns (glob). */
  blocked_patterns: string[];
}

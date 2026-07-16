/**
 * Uploads API request/response contracts.
 */

export interface UploadedFileInfo {
  filename: string;
  size: number;
  path: string;
  virtual_path: string;
  artifact_url: string;
  extension?: string | null;
  modified?: number | null;
  original_filename?: string | null;
  markdown_file?: string | null;
  markdown_path?: string | null;
  markdown_virtual_path?: string | null;
  markdown_artifact_url?: string | null;
}

export interface UploadResponse {
  success: boolean;
  files: UploadedFileInfo[];
  message: string;
  skipped_files?: string[];
}

export interface UploadListResponse {
  files: UploadedFileInfo[];
  count: number;
}

export interface UploadLimits {
  max_files: number;
  max_file_size: number;
  max_total_size: number;
}

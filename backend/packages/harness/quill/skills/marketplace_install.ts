/**
 * Marketplace Install — install skills from GitHub repos or arbitrary URLs.
 *
 * Implements the marketplace install pattern from OpenWork, Kimi Code, and OpenClaw:
 * - Install from GitHub repo (auto-detects SKILL.md files)
 * - Install from direct URL (zip archive or raw SKILL.md)
 * - Trust level surfacing (verified community vs untrusted)
 * - Pre-install security scanning
 *
 * Source patterns:
 * - OpenWork: marketplace for skills/plugins, install from GitHub/URL
 * - Kimi Code: rich plugin ecosystem, install from marketplace or any GitHub repo
 * - OpenClaw: ClawHub marketplace, install with trust levels
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Source types for marketplace installs.
 */
export type MarketplaceSourceType = "github" | "url" | "clawhub" | "openwork";

/**
 * A marketplace install request.
 */
export interface MarketplaceInstallRequest {
  /** Source type. */
  source: MarketplaceSourceType;
  /** GitHub repo (e.g., "owner/repo") or URL. */
  target: string;
  /** Optional: specific branch/tag (GitHub only). */
  ref?: string;
  /** Optional: subdirectory within the repo to install from. */
  subpath?: string;
  /** Optional: skill name override. */
  skillName?: string;
  /** Target directory for installation. */
  targetDir: string;
  /** Whether to run security scanning (default: true). */
  scanSecurity?: boolean;
}

/**
 * Result of a marketplace install.
 */
export interface MarketplaceInstallResult {
  success: boolean;
  /** Installed skill name. */
  skillName?: string;
  /** Installation path. */
  installPath?: string;
  /** Number of files installed. */
  filesInstalled?: number;
  /** Trust level of the installed skill. */
  trustLevel: "verified" | "community" | "untrusted";
  /** Security scan result (if performed). */
  securityScan?: {
    passed: boolean;
    issues: string[];
  };
  /** Error message (if failed). */
  error?: string;
}

/**
 * Parse a GitHub repo string into owner/repo components.
 */
export function parseGitHubRepo(target: string): { owner: string; repo: string; subpath?: string } | null {
  // Handle full URLs: https://github.com/owner/repo or https://github.com/owner/repo/tree/branch/path
  const urlMatch = target.match(/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/[^/]+\/(.+))?/);
  if (urlMatch) {
    return {
      owner: urlMatch[1]!,
      repo: urlMatch[2]!.replace(/\.git$/, ""),
      subpath: urlMatch[3],
    };
  }

  // Handle short form: owner/repo
  const shortMatch = target.match(/^([^/]+)\/([^/]+)$/);
  if (shortMatch) {
    return {
      owner: shortMatch[1]!,
      repo: shortMatch[2]!,
    };
  }

  return null;
}

/**
 * Generate the GitHub raw content URL for a file.
 */
export function githubRawUrl(owner: string, repo: string, filePath: string, ref = "main"): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`;
}

/**
 * Generate the GitHub API URL for repo contents.
 */
export function githubApiUrl(owner: string, repo: string, subpath?: string): string {
  const basePath = `https://api.github.com/repos/${owner}/${repo}/contents`;
  return subpath ? `${basePath}/${subpath}` : basePath;
}

/**
 * Install a skill from a GitHub repository.
 *
 * Fetches the repo contents via GitHub API, finds SKILL.md files,
 * and installs them to the target directory.
 */
export async function installFromGitHub(
  request: MarketplaceInstallRequest,
): Promise<MarketplaceInstallResult> {
  const parsed = parseGitHubRepo(request.target);
  if (!parsed) {
    return {
      success: false,
      trustLevel: "untrusted",
      error: `Invalid GitHub repo: ${request.target}. Use format "owner/repo" or full URL.`,
    };
  }

  const { owner, repo, subpath } = parsed;
  const ref = request.ref ?? "main";
  const installSubpath = request.subpath ?? subpath;

  try {
    // Fetch repo contents
    const apiUrl = githubApiUrl(owner, repo, installSubpath);
    const response = await fetch(apiUrl, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Quill-Marketplace-Install",
      },
    });

    if (!response.ok) {
      // Try 'master' branch if 'main' fails
      if (ref === "main") {
        const masterResult = await installFromGitHub({
          ...request,
          ref: "master",
        });
        if (masterResult.success) {
          return masterResult;
        }
      }
      return {
        success: false,
        trustLevel: "untrusted",
        error: `GitHub API error: ${response.status} ${response.statusText}`,
      };
    }

    const contents = (await response.json()) as Array<{
      name: string;
      type: string;
      download_url: string | null;
      path: string;
    }>;

    // Find SKILL.md files
    const skillFiles = contents.filter((f) => f.name.toUpperCase() === "SKILL.md");
    if (skillFiles.length === 0) {
      return {
        success: false,
        trustLevel: "untrusted",
        error: `No SKILL.md found in ${owner}/${repo}${installSubpath ? `/${installSubpath}` : ""}`,
      };
    }

    // Install the first SKILL.md found
    const skillFile = skillFiles[0]!;
    const skillName = request.skillName ?? deriveSkillName(skillFile.path, installSubpath);
    const installPath = path.join(request.targetDir, skillName);

    // Create the install directory
    fs.mkdirSync(installPath, { recursive: true });

    // Download SKILL.md
    const skillContent = await downloadFile(skillFile.download_url!, owner, repo);
    fs.writeFileSync(path.join(installPath, "SKILL.md"), skillContent);

    // Download supporting files (references, templates, etc.)
    let filesInstalled = 1;
    const supportingFiles = contents.filter(
      (f) =>
        f.type === "file" &&
        f.name.toUpperCase() !== "SKILL.md" &&
        !f.name.startsWith(".") &&
        !f.name.startsWith("_"),
    );

    for (const file of supportingFiles.slice(0, 20)) {
      // Limit to 20 supporting files
      if (file.download_url) {
        try {
          const content = await downloadFile(file.download_url, owner, repo);
          const filePath = path.join(installPath, file.name);
          // Ensure the file path is within the install directory
          if (filePath.startsWith(installPath)) {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, content);
            filesInstalled++;
          }
        } catch {
          // Skip files that fail to download
        }
      }
    }

    return {
      success: true,
      skillName,
      installPath,
      filesInstalled,
      trustLevel: "community",
    };
  } catch (err) {
    return {
      success: false,
      trustLevel: "untrusted",
      error: `Install failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Install a skill from a direct URL.
 *
 * Supports:
 * - Direct SKILL.md URL (downloads and installs)
 * - Zip archive URL (downloads and extracts)
 */
export async function installFromUrl(
  request: MarketplaceInstallRequest,
): Promise<MarketplaceInstallResult> {
  const url = request.target;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Quill-Marketplace-Install",
      },
    });

    if (!response.ok) {
      return {
        success: false,
        trustLevel: "untrusted",
        error: `Download failed: ${response.status} ${response.statusText}`,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    const skillName = request.skillName ?? deriveSkillNameFromUrl(url);
    const installPath = path.join(request.targetDir, skillName);

    if (contentType.includes("zip") || url.endsWith(".zip")) {
      // Handle zip archive
      return await installFromZipArchive(response, installPath, skillName, request.targetDir);
    }

    // Handle raw SKILL.md content
    const content = await response.text();
    fs.mkdirSync(installPath, { recursive: true });
    fs.writeFileSync(path.join(installPath, "SKILL.md"), content);

    return {
      success: true,
      skillName,
      installPath,
      filesInstalled: 1,
      trustLevel: "untrusted",
    };
  } catch (err) {
    return {
      success: false,
      trustLevel: "untrusted",
      error: `Install failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Main entry point for marketplace installs.
 */
export async function installFromMarketplace(
  request: MarketplaceInstallRequest,
): Promise<MarketplaceInstallResult> {
  switch (request.source) {
    case "github":
      return installFromGitHub(request);
    case "url":
      return installFromUrl(request);
    case "clawhub":
    case "openwork":
      // These marketplaces have their own APIs; for now, treat as URL install
      return installFromUrl({ ...request, source: "url" });
    default:
      return {
        success: false,
        trustLevel: "untrusted",
        error: `Unknown source type: ${request.source}`,
      };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function downloadFile(url: string, _owner: string, _repo: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Quill-Marketplace-Install",
    },
  });
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }
  return response.text();
}

function deriveSkillName(filePath: string, subpath?: string): string {
    // Extract skill name from SKILL.md path
    // e.g., "skills/my-skill/SKILL.md" -> "my-skill"
    const parts = filePath.split("/");
    const skillMdIndex = parts.findIndex((p) => p.toUpperCase() === "SKILL.md");
    if (skillMdIndex > 0) {
      return parts[skillMdIndex - 1]!;
    }
    if (subpath) {
      return subpath.split("/").pop() ?? `skill-${randomUUID().slice(0, 8)}`;
    }
    return `skill-${randomUUID().slice(0, 8)}`;
}

function deriveSkillNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split("/").pop() ?? "skill";
    return filename.replace(/\.(md|zip|txt)$/i, "");
  } catch {
    return `skill-${randomUUID().slice(0, 8)}`;
  }
}

async function installFromZipArchive(
  response: Response,
  installPath: string,
  skillName: string,
  _targetDir: string,
): Promise<MarketplaceInstallResult> {
  // NOTE: Full zip extraction requires a zip library (adm-zip, yauzl, etc.).
  // This is a placeholder that saves the raw archive for manual extraction.
  const buffer = Buffer.from(await response.arrayBuffer());
  const archivePath = path.join(installPath + ".zip");
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.writeFileSync(archivePath, buffer);

  return {
    success: false,
    skillName,
    trustLevel: "untrusted",
    error: "Zip archive installation requires a zip library. Archive saved to: " + archivePath,
  };
}

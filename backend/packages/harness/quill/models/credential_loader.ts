/**
 * Auto-load credentials from Claude Code CLI and Codex CLI.
 *
 * Implements two credential strategies:
 *   1. Claude Code OAuth token from explicit env vars or an exported credentials file
 *      - Uses Authorization: Bearer header (NOT x-api-key)
 *      - Requires anthropic-beta: oauth-2025-04-20,claude-code-20250219
 *      - Supports $CLAUDE_CODE_OAUTH_TOKEN, $CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR, and $ANTHROPIC_AUTH_TOKEN
 *      - Override path with $CLAUDE_CODE_CREDENTIALS_PATH
 *   2. Codex CLI token from ~/.codex/auth.json
 *      - Uses chatgpt.com/backend-api/codex/responses endpoint
 *      - Supports both legacy top-level tokens and current nested tokens shape
 *      - Override path with $CODEX_AUTH_PATH
 *
 * TS port of `quill.models.credential_loader`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Required beta headers for Claude Code OAuth tokens. */
export const OAUTH_ANTHROPIC_BETAS = "oauth-2025-04-20,claude-code-20250219,interleaved-thinking-2025-05-14";

/** Check if a token is a Claude Code OAuth token (not a standard API key). */
export function isOauthToken(token: unknown): boolean {
  return typeof token === "string" && token.includes("sk-ant-oat");
}

/** Claude Code CLI OAuth credential. */
export class ClaudeCodeCredential {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  source: string;

  constructor(fields: { accessToken: string; refreshToken?: string; expiresAt?: number; source?: string }) {
    this.accessToken = fields.accessToken;
    this.refreshToken = fields.refreshToken ?? "";
    this.expiresAt = fields.expiresAt ?? 0;
    this.source = fields.source ?? "";
  }

  get isExpired(): boolean {
    if (this.expiresAt <= 0) {
      return false;
    }
    return Date.now() > this.expiresAt - 60_000; // 1 min buffer
  }
}

/** Codex CLI credential. */
export class CodexCliCredential {
  accessToken: string;
  accountId: string;
  source: string;

  constructor(fields: { accessToken: string; accountId?: string; source?: string }) {
    this.accessToken = fields.accessToken;
    this.accountId = fields.accountId ?? "";
    this.source = fields.source ?? "";
  }
}

function resolveCredentialPath(envVar: string, defaultRelativePath: string): string {
  const configuredPath = process.env[envVar];
  if (configuredPath) {
    return expanduser(configuredPath);
  }
  return path.join(homeDir(), defaultRelativePath);
}

function homeDir(): string {
  const home = process.env.HOME;
  if (home) {
    return expanduser(home);
  }
  return os.homedir();
}

/** Expand a leading `~` to the user home directory (mirrors `Path.expanduser`). */
function expanduser(target: string): string {
  if (target === "~") {
    return os.homedir();
  }
  if (target.startsWith("~/")) {
    return path.join(os.homedir(), target.slice(2));
  }
  return target;
}

function loadJsonFile(filePath: string, label: string): Record<string, unknown> | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    console.debug(`${label} not found: ${filePath}`);
    return null;
  }
  if (stat.isDirectory()) {
    console.warn(`${label} path is a directory, expected a file: ${filePath}`);
    return null;
  }

  try {
    const text = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch (e) {
    console.warn(`Failed to read ${label}: ${String(e)}`);
    return null;
  }
}

function readSecretFromFileDescriptor(envVar: string): string | null {
  const fdValue = process.env[envVar];
  if (!fdValue) {
    return null;
  }

  const fd = Number.parseInt(fdValue, 10);
  if (Number.isNaN(fd) || String(fd) !== fdValue.trim()) {
    console.warn(`${envVar} must be an integer file descriptor, got: ${fdValue}`);
    return null;
  }

  try {
    const buffer = Buffer.alloc(1024 * 1024);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
    const secret = buffer.toString("utf-8", 0, bytesRead).trim();
    return secret || null;
  } catch (e) {
    console.warn(`Failed to read ${envVar}: ${String(e)}`);
    return null;
  }
}

function credentialFromDirectToken(accessToken: string, source: string): ClaudeCodeCredential | null {
  const token = accessToken.trim();
  if (!token) {
    return null;
  }
  return new ClaudeCodeCredential({ accessToken: token, source });
}

function iterClaudeCodeCredentialPaths(): string[] {
  const paths: string[] = [];
  const overridePath = process.env.CLAUDE_CODE_CREDENTIALS_PATH;
  if (overridePath) {
    paths.push(expanduser(overridePath));
  }

  const defaultPath = path.join(homeDir(), ".claude/.credentials.json");
  if (paths.length === 0 || paths[paths.length - 1] !== defaultPath) {
    paths.push(defaultPath);
  }

  return paths;
}

function extractClaudeCodeCredential(data: Record<string, unknown>, source: string): ClaudeCodeCredential | null {
  const oauth = isRecord(data.claudeAiOauth) ? data.claudeAiOauth : {};
  const accessToken = typeof oauth.accessToken === "string" ? oauth.accessToken : "";
  if (!accessToken) {
    console.debug("Claude Code credentials container exists but no accessToken found");
    return null;
  }

  const cred = new ClaudeCodeCredential({
    accessToken,
    refreshToken: typeof oauth.refreshToken === "string" ? oauth.refreshToken : "",
    expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : 0,
    source,
  });

  if (cred.isExpired) {
    console.warn("Claude Code OAuth token is expired. Run 'claude' to refresh.");
    return null;
  }

  return cred;
}

/**
 * Load OAuth credential from explicit Claude Code handoff sources.
 *
 * Lookup order:
 *   1. $CLAUDE_CODE_OAUTH_TOKEN or $ANTHROPIC_AUTH_TOKEN
 *   2. $CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR
 *   3. $CLAUDE_CODE_CREDENTIALS_PATH
 *   4. ~/.claude/.credentials.json
 */
export function loadClaudeCodeCredential(): ClaudeCodeCredential | null {
  const directToken = process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN;
  if (directToken) {
    const cred = credentialFromDirectToken(directToken, "claude-cli-env");
    if (cred) {
      console.info("Loaded Claude Code OAuth credential from environment");
    }
    return cred;
  }

  const fdToken = readSecretFromFileDescriptor("CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR");
  if (fdToken) {
    const cred = credentialFromDirectToken(fdToken, "claude-cli-fd");
    if (cred) {
      console.info("Loaded Claude Code OAuth credential from file descriptor");
    }
    return cred;
  }

  const overridePath = process.env.CLAUDE_CODE_CREDENTIALS_PATH;
  const overridePathObj = overridePath ? expanduser(overridePath) : null;
  for (const credPath of iterClaudeCodeCredentialPaths()) {
    const data = loadJsonFile(credPath, "Claude Code credentials");
    if (data === null) {
      continue;
    }
    const cred = extractClaudeCodeCredential(data, "claude-cli-file");
    if (cred) {
      const sourceLabel = overridePathObj !== null && credPath === overridePathObj ? "override path" : "plaintext file";
      console.info(`Loaded Claude Code OAuth credential from ${sourceLabel} (expires_at=${cred.expiresAt})`);
      return cred;
    }
  }

  return null;
}

/** Load credential from Codex CLI (~/.codex/auth.json). */
export function loadCodexCliCredential(): CodexCliCredential | null {
  const credPath = resolveCredentialPath("CODEX_AUTH_PATH", ".codex/auth.json");
  const data = loadJsonFile(credPath, "Codex CLI credentials");
  if (data === null) {
    return null;
  }
  const tokens = isRecord(data.tokens) ? data.tokens : {};

  const accessToken =
    asString(data.access_token) || asString(data.token) || asString(tokens.access_token) || "";
  const accountId = asString(data.account_id) || asString(tokens.account_id) || "";
  if (!accessToken) {
    console.debug("Codex CLI credentials file exists but no token found");
    return null;
  }

  console.info("Loaded Codex CLI credential");
  return new CodexCliCredential({
    accessToken,
    accountId,
    source: "codex-cli",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

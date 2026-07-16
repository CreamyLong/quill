/**
 * Local sandbox provider — TypeScript port (simplified).
 *
 * Mirrors the per-thread lifecycle of
 * `quill.sandbox.local.local_sandbox_provider.LocalSandboxProvider`:
 * `acquire(thread_id)` returns a `LocalSandbox` scoped to that thread's host
 * workspace, cached so repeated acquisitions in the same thread reuse one
 * instance (and its `_agent_written_paths` state).
 *
 * SIMPLIFICATION vs Python: each thread gets ONE workspace directory at
 * `<baseDir>/<sanitized-thread_id>/` (default `<cwd>/.scitops/sandboxes/`),
 * onto which the whole virtual `/mnt/user-data` tree maps. Python instead
 * builds multiple path mappings (workspace/uploads/outputs + skills + custom
 * mounts) per thread. The `user_id` dimension and the LRU eviction cap are also
 * omitted here.
 *
 * WORKSPACE OVERRIDE: when `setWorkspaceOverrideResolver` is configured,
 * `acquire(thread_id)` checks the resolver first. If it returns an absolute
 * host path, that directory is used as the workspace (created if needed),
 * replacing the default per-thread directory. This enables per-thread
 * working directories selected from the frontend UI.
 */

import fs from "node:fs";
import path from "node:path";

import { getPaths } from "../../config/paths.js";
import { LocalSandbox } from "../local_sandbox.js";

/**
 * Resolves a thread's custom workspace directory, or undefined to use the
 * default per-thread workspace. Set once at startup via
 * `setWorkspaceOverrideResolver`.
 */
export type WorkspaceOverrideResolver = (threadId: string) => string | undefined;

let _workspaceOverrideResolver: WorkspaceOverrideResolver | undefined;

/**
 * Return the currently registered workspace override resolver (if any).
 * Used by middlewares that need to reflect the override in their state.
 */
export function getWorkspaceOverrideResolver(): WorkspaceOverrideResolver | undefined {
  return _workspaceOverrideResolver;
}

export class LocalSandboxProvider {
  private readonly skillsRoot: string | undefined;
  private readonly cache = new Map<string, LocalSandbox>();

  /**
   * @param _baseDir Deprecated — kept for backward compatibility. Workspace
   *   paths are now resolved from the centralized Paths config.
   * @param skillsRoot Optional host path to the skills directory.
   */
  constructor(_baseDir?: string, skillsRoot?: string) {
    this.skillsRoot = skillsRoot ? path.resolve(skillsRoot) : undefined;
  }

  /**
   * Register a resolver that maps a thread id to a custom absolute host-path
   * workspace directory. When the resolver returns a value, it replaces the
   * default per-thread workspace directory for that thread. Clears the sandbox
   * cache so subsequent acquires use the new override.
   */
  setWorkspaceOverrideResolver(resolver: WorkspaceOverrideResolver): void {
    _workspaceOverrideResolver = resolver;
    this.cache.clear();
  }

  /**
   * Return (creating + caching on first use) the `LocalSandbox` for a thread.
   * When a workspace override resolver is registered and returns an absolute
   * path for this thread, that directory is used as the workspace. Otherwise
   * the default per-thread user-data directory is used.
   *
   * @throws If a resolved override path is not absolute or not a directory.
   */
  acquire(threadId: string): LocalSandbox {
    const cached = this.cache.get(threadId);
    if (cached !== undefined) {
      return cached;
    }
    const paths = getPaths();

    // Resolve workspace: override (if absolute + valid) > default per-thread dir.
    const override = _workspaceOverrideResolver?.(threadId);
    let workspace: string;
    console.log(`[workspace-acquire] thread=${threadId} override=${JSON.stringify(override)}`);
    if (override !== undefined && override !== "") {
      if (!path.isAbsolute(override)) {
        throw new Error(
          `workspace_directory must be an absolute path, got: ${override}`,
        );
      }
      workspace = path.resolve(override);
      fs.mkdirSync(workspace, { recursive: true });
      const stat = fs.statSync(workspace);
      if (!stat.isDirectory()) {
        throw new Error(
          `workspace_directory is not a directory: ${workspace}`,
        );
      }
      // Do NOT mirror uploads/outputs inside the user's folder. Uploaded files
      // are routed to the thread's own uploads directory by the upload manager,
      // and outputs are created lazily by the agent when needed. This keeps the
      // user-selected workspace clean.
    } else {
      workspace = paths.sandboxUserDataDir(threadId);
      fs.mkdirSync(workspace, { recursive: true });
    }

    paths.ensureThreadDirs(threadId, null);
    const sandbox = new LocalSandbox(workspace, `local:${threadId}`, this.skillsRoot);
    this.cache.set(threadId, sandbox);
    return sandbox;
  }

  /** Return a cached sandbox by thread id, or undefined if not yet acquired. */
  get(threadId: string): LocalSandbox | undefined {
    return this.cache.get(threadId);
  }

  /**
   * Release a thread's sandbox reference.
   *
   * Like Python's LocalSandboxProvider.release, this is intentionally a no-op:
   * the cached instance is kept so `_agent_written_paths` survives across turns.
   * The on-disk workspace is likewise left in place.
   */
  release(_threadId: string): void {
    // Intentionally no-op — keep the cached sandbox and its workspace.
  }

  /** Drop all cached sandboxes (does not delete on-disk workspaces). */
  reset(): void {
    this.cache.clear();
  }
}

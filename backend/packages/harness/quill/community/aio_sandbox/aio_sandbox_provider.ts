/**
 * AIO Sandbox Provider — orchestrates sandbox lifecycle with pluggable backends.
 *
 * TypeScript port of `community/aio_sandbox/aio_sandbox_provider.py`.
 *
 */

import crypto from "node:crypto";
import fs from "node:fs";

import { getAppConfig } from "../../config/app_config.js";
import type { VolumeMountConfig } from "../../config/sandbox_config.js";
import { SkillsConfig } from "../../config/skills_config.js";
import { getPaths, VIRTUAL_PATH_PREFIX } from "../../config/paths.js";
import { SandboxBackend, waitForSandboxReadyAsync } from "./backend.js";
import { LocalContainerBackend } from "./local_backend.js";
import { RemoteSandboxBackend } from "./remote_backend.js";
import { SandboxInfo } from "./sandbox_info.js";
import { AioSandbox, type Sandbox } from "./aio_sandbox.js";
import { getEffectiveUserId } from "../../runtime/user_context.js";

const logger = {
  debug: (...a: unknown[]) => console.debug(...a),
  info: (...a: unknown[]) => console.info(...a),
  warning: (...a: unknown[]) => console.warn(...a),
  error: (...a: unknown[]) => console.error(...a),
};

// Default configuration
const DEFAULT_IMAGE = "enterprise-public-cn-beijing.cr.volces.com/vefaas-public/all-in-one-sandbox:latest";
const DEFAULT_PORT = 8080;
const DEFAULT_CONTAINER_PREFIX = "quill-sandbox";
const DEFAULT_IDLE_TIMEOUT = 600; // 10 minutes in seconds
const DEFAULT_REPLICAS = 3; // Maximum concurrent sandbox containers
const IDLE_CHECK_INTERVAL = 60; // Check every 60 seconds

/** Minimal async mutex to serialize acquisition per thread key. */
class AsyncMutex {
  private _p: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this._p;
    let release!: () => void;
    this._p = new Promise<void>((res) => {
      release = res;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/**
 * Abstract base for sandbox providers.
 *
 * PENDING DEPENDENCY: `quill.sandbox.sandbox_provider.SandboxProvider` is not
 * yet ported to TS; this is a local base mirroring its interface.
 */
export abstract class SandboxProvider {
  usesThreadDataMounts = false;
  needsUploadPermissionAdjustment = true;

  abstract acquire(threadId?: string | null, opts?: { userId?: string | null }): Promise<string>;

  async acquireAsync(threadId?: string | null, opts?: { userId?: string | null }): Promise<string> {
    return this.acquire(threadId, opts);
  }

  abstract get(sandboxId: string): Sandbox | null;

  abstract release(sandboxId: string): void;

  reset(): void {
    // no-op by default
  }
}

interface ProviderConfig {
  image: string;
  port: number;
  containerPrefix: string;
  idleTimeout: number;
  replicas: number;
  mounts: VolumeMountConfig[];
  environment: Record<string, string>;
  provisionerUrl: string;
}

/** Sandbox provider that manages containers running the AIO sandbox. */
export class AioSandboxProvider extends SandboxProvider {
  private readonly _sandboxes = new Map<string, AioSandbox>();
  private readonly _sandboxInfos = new Map<string, SandboxInfo>();
  private readonly _threadSandboxes = new Map<string, string>();
  private readonly _threadLocks = new Map<string, AsyncMutex>();
  private readonly _lastActivity = new Map<string, number>();
  // Warm pool: released sandboxes whose containers are still running.
  private readonly _warmPool = new Map<string, [SandboxInfo, number]>();
  private _shutdownCalled = false;
  private _idleCheckerTimer: ReturnType<typeof setInterval> | null = null;

  private readonly _config: ProviderConfig;
  private readonly _backend: SandboxBackend;

  constructor() {
    super();
    this._config = this._loadConfig();
    this._backend = this._createBackend();
    this.usesThreadDataMounts = this._backend instanceof LocalContainerBackend;

    // Register shutdown handler
    this._registerSignalHandlers();

    // Reconcile orphaned containers from previous process lifecycles (async).
    void this._reconcileOrphans();

    // Start idle checker if enabled
    if (this._config.idleTimeout > 0) {
      this._startIdleChecker();
    }
  }

  private static _threadKey(threadId: string, userId: string): string {
    return `${userId}\u0000${threadId}`;
  }

  // ── Factory methods ──────────────────────────────────────────────────

  private _createBackend(): SandboxBackend {
    const provisionerUrl = this._config.provisionerUrl;
    if (provisionerUrl) {
      logger.info(`Using remote sandbox backend with provisioner at ${provisionerUrl}`);
      return new RemoteSandboxBackend(provisionerUrl);
    }

    logger.info("Using local container sandbox backend");
    return new LocalContainerBackend({
      image: this._config.image,
      basePort: this._config.port,
      containerPrefix: this._config.containerPrefix,
      configMounts: this._config.mounts.map((m) => ({ hostPath: m.hostPath, containerPath: m.containerPath, readOnly: m.readOnly })),
      environment: this._config.environment,
    });
  }

  // ── Configuration ────────────────────────────────────────────────────

  private _loadConfig(): ProviderConfig {
    const config = getAppConfig();
    const sandboxConfig = config.sandbox;

    const idleTimeout = sandboxConfig.idleTimeout;
    const replicas = sandboxConfig.replicas;

    return {
      image: sandboxConfig.image || DEFAULT_IMAGE,
      port: sandboxConfig.port || DEFAULT_PORT,
      containerPrefix: sandboxConfig.containerPrefix || DEFAULT_CONTAINER_PREFIX,
      idleTimeout: idleTimeout !== null && idleTimeout !== undefined ? idleTimeout : DEFAULT_IDLE_TIMEOUT,
      replicas: replicas !== null && replicas !== undefined ? replicas : DEFAULT_REPLICAS,
      mounts: sandboxConfig.mounts || [],
      environment: AioSandboxProvider._resolveEnvVars(sandboxConfig.environment || {}),
      // provisioner URL for dynamic pod management (e.g. http://provisioner:8002)
      provisionerUrl: (sandboxConfig["provisionerUrl"] as string | undefined) || "",
    };
  }

  private static _resolveEnvVars(envConfig: Record<string, string>): Record<string, string> {
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(envConfig)) {
      if (typeof value === "string" && value.startsWith("$")) {
        const envName = value.slice(1);
        resolved[key] = process.env[envName] ?? "";
      } else {
        resolved[key] = String(value);
      }
    }
    return resolved;
  }

  // ── Startup reconciliation ────────────────────────────────────────────

  private async _reconcileOrphans(): Promise<void> {
    let running: SandboxInfo[];
    try {
      running = await this._backend.listRunning();
    } catch (e) {
      logger.warning(`Failed to enumerate running containers during startup reconciliation: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    if (running.length === 0) {
      return;
    }

    const currentTime = Date.now() / 1000;
    let adopted = 0;

    for (const info of running) {
      const age = info.createdAt > 0 ? currentTime - info.createdAt : Infinity;
      if (this._sandboxes.has(info.sandboxId) || this._warmPool.has(info.sandboxId)) {
        continue;
      }
      this._warmPool.set(info.sandboxId, [info, currentTime]);
      adopted += 1;
      logger.info(`Adopted container ${info.sandboxId} into warm pool (age: ${age.toFixed(0)}s)`);
    }

    logger.info(`Startup reconciliation complete: ${adopted} adopted into warm pool, ${running.length} total found`);
  }

  // ── Deterministic ID ─────────────────────────────────────────────────

  private static _effectiveAcquireUserId(userId: string | null | undefined): string {
    return userId || getEffectiveUserId();
  }

  private static _deterministicSandboxId(threadId: string, userId: string): string {
    return crypto.createHash("sha256").update(`${userId}:${threadId}`, "utf-8").digest("hex").slice(0, 8);
  }

  // ── Mount helpers ────────────────────────────────────────────────────

  private _getExtraMounts(threadId: string | null, userId: string | null): Array<[string, string, boolean]> {
    const mounts: Array<[string, string, boolean]> = [];

    if (threadId) {
      mounts.push(...AioSandboxProvider._getThreadMounts(threadId, userId));
      logger.info(`Adding thread mounts for thread ${threadId}: ${JSON.stringify(mounts)}`);
    }

    const skillsMount = this._getSkillsMount();
    if (skillsMount) {
      mounts.push(skillsMount);
      logger.info(`Adding skills mount: ${JSON.stringify(skillsMount)}`);
    }

    return mounts;
  }

  private static _getThreadMounts(threadId: string, userId: string | null): Array<[string, string, boolean]> {
    const paths = getPaths();
    const effectiveUserId = AioSandboxProvider._effectiveAcquireUserId(userId);
    paths.ensureThreadDirs(threadId, effectiveUserId);

    return [
      [paths.hostSandboxWorkDir(threadId, effectiveUserId), `${VIRTUAL_PATH_PREFIX}/workspace`, false],
      [paths.hostSandboxUploadsDir(threadId, effectiveUserId), `${VIRTUAL_PATH_PREFIX}/uploads`, false],
      [paths.hostSandboxOutputsDir(threadId, effectiveUserId), `${VIRTUAL_PATH_PREFIX}/outputs`, false],
      // ACP workspace: read-only inside the sandbox.
      [paths.hostAcpWorkspaceDir(threadId, effectiveUserId), "/mnt/acp-workspace", true],
    ];
  }

  private _getSkillsMount(): [string, string, boolean] | null {
    const raw = getAppConfig().skills;
    const skillsConfig = new SkillsConfig({
      use: raw.use as string | undefined,
      path: (raw.path as string | null | undefined) ?? null,
      containerPath: (raw.container_path as string | undefined) ?? raw.containerPath as string | undefined,
    });
    const skillsPath = skillsConfig.getSkillsPath();
    try {
      if (!fs.existsSync(skillsPath) || !fs.statSync(skillsPath).isDirectory()) {
        return null;
      }
    } catch {
      return null;
    }
    // Allow overriding the host path via env (useful in containerized deploys
    // where the host-side skills directory differs from the in-app default).
    const hostSkills = process.env.QUILL_HOST_SKILLS_PATH ?? skillsPath;
    return [hostSkills, skillsConfig.containerPath, true];
  }

  // ── Idle timeout management ──────────────────────────────────────────

  private _startIdleChecker(): void {
    this._idleCheckerTimer = setInterval(() => {
      void this._cleanupIdleSandboxes(this._config.idleTimeout).catch((e) => {
        logger.error(`Error in idle checker loop: ${e instanceof Error ? e.message : String(e)}`);
      });
    }, IDLE_CHECK_INTERVAL * 1000);
    this._idleCheckerTimer.unref?.();
    logger.info(`Started idle checker (timeout: ${this._config.idleTimeout}s)`);
  }

  private async _cleanupIdleSandboxes(idleTimeout: number): Promise<void> {
    const currentTime = Date.now() / 1000;
    const activeToDestroy: string[] = [];
    const warmToDestroy: Array<[string, SandboxInfo]> = [];

    // Active sandboxes: tracked via _lastActivity
    for (const [sandboxId, lastActivity] of this._lastActivity) {
      const idleDuration = currentTime - lastActivity;
      if (idleDuration > idleTimeout) {
        activeToDestroy.push(sandboxId);
        logger.info(`Sandbox ${sandboxId} idle for ${idleDuration.toFixed(1)}s, marking for destroy`);
      }
    }

    // Warm pool: tracked via release_timestamp stored in _warmPool
    for (const [sandboxId, [info, releaseTs]] of [...this._warmPool.entries()]) {
      const warmDuration = currentTime - releaseTs;
      if (warmDuration > idleTimeout) {
        warmToDestroy.push([sandboxId, info]);
        this._warmPool.delete(sandboxId);
        logger.info(`Warm-pool sandbox ${sandboxId} idle for ${warmDuration.toFixed(1)}s, marking for destroy`);
      }
    }

    for (const sandboxId of activeToDestroy) {
      try {
        const lastActivity = this._lastActivity.get(sandboxId);
        if (lastActivity === undefined) {
          logger.info(`Sandbox ${sandboxId} already gone before idle destroy, skipping`);
          continue;
        }
        if (Date.now() / 1000 - lastActivity < idleTimeout) {
          logger.info(`Sandbox ${sandboxId} was re-acquired before idle destroy, skipping`);
          continue;
        }
        logger.info(`Destroying idle sandbox ${sandboxId}`);
        await this.destroy(sandboxId);
      } catch (e) {
        logger.error(`Failed to destroy idle sandbox ${sandboxId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    for (const [sandboxId, info] of warmToDestroy) {
      try {
        await this._backend.destroy(info);
        logger.info(`Destroyed idle warm-pool sandbox ${sandboxId}`);
      } catch (e) {
        logger.error(`Failed to destroy idle warm-pool sandbox ${sandboxId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // ── Signal handling ──────────────────────────────────────────────────

  private _registerSignalHandlers(): void {
    const handler = (): void => {
      void this.shutdown();
    };
    try {
      process.on("SIGTERM", handler);
      process.on("SIGINT", handler);
      process.on("SIGHUP", handler);
      process.on("beforeExit", handler);
    } catch {
      logger.debug("Could not register signal handlers");
    }
  }

  // ── Thread locking (in-process) ──────────────────────────────────────

  private _getThreadLock(threadId: string, userId: string): AsyncMutex {
    const key = AioSandboxProvider._threadKey(threadId, userId);
    let lock = this._threadLocks.get(key);
    if (lock === undefined) {
      lock = new AsyncMutex();
      this._threadLocks.set(key, lock);
    }
    return lock;
  }

  private _sandboxIdForThread(threadId: string | null, userId: string | null): string {
    return threadId
      ? AioSandboxProvider._deterministicSandboxId(threadId, AioSandboxProvider._effectiveAcquireUserId(userId))
      : crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  }

  private async _reuseInProcessSandbox(threadId: string | null, userId: string | null, postLock = false): Promise<string | null> {
    if (threadId === null) {
      return null;
    }

    const effectiveUserId = AioSandboxProvider._effectiveAcquireUserId(userId);
    const key = AioSandboxProvider._threadKey(threadId, effectiveUserId);

    if (!this._threadSandboxes.has(key)) {
      return null;
    }

    const existingId = this._threadSandboxes.get(key)!;
    let info: SandboxInfo | undefined;
    if (this._sandboxes.has(existingId)) {
      info = this._sandboxInfos.get(existingId);
    } else {
      this._threadSandboxes.delete(key);
      return null;
    }

    const alive = info !== undefined ? await this._checkTrackedSandboxAlive(existingId, info) : true;
    if (alive === false) {
      await this._dropUnhealthySandbox(existingId, "in-process cache failed health check", info);
      return null;
    }

    if (this._threadSandboxes.get(key) !== existingId) {
      return null;
    }
    if (!this._sandboxes.has(existingId)) {
      this._threadSandboxes.delete(key);
      return null;
    }

    const suffix = postLock ? " (post-lock check)" : "";
    logger.info(`Reusing in-process sandbox ${existingId} for user/thread ${effectiveUserId}/${threadId}${suffix}`);
    this._lastActivity.set(existingId, Date.now() / 1000);
    return existingId;
  }

  private async _reclaimWarmPoolSandbox(
    threadId: string | null,
    sandboxId: string,
    userId: string | null,
    postLock = false,
  ): Promise<string | null> {
    if (threadId === null) {
      return null;
    }

    const effectiveUserId = AioSandboxProvider._effectiveAcquireUserId(userId);
    const key = AioSandboxProvider._threadKey(threadId, effectiveUserId);

    const warmEntry = this._warmPool.get(sandboxId);
    if (warmEntry === undefined) {
      return null;
    }
    let [info] = warmEntry;

    const alive = await this._checkTrackedSandboxAlive(sandboxId, info);
    if (alive === false) {
      await this._dropUnhealthySandbox(sandboxId, "warm-pool cache failed health check", info);
      return null;
    }

    const warmItem = this._warmPool.get(sandboxId);
    if (warmItem === undefined) {
      return null;
    }
    this._warmPool.delete(sandboxId);
    info = warmItem[0];
    const sandbox = new AioSandbox(sandboxId, info.sandboxUrl);
    this._sandboxes.set(sandboxId, sandbox);
    this._sandboxInfos.set(sandboxId, info);
    this._lastActivity.set(sandboxId, Date.now() / 1000);
    this._threadSandboxes.set(key, sandboxId);

    const suffix = postLock ? " (post-lock check)" : ` at ${info.sandboxUrl}`;
    logger.info(`Reclaimed warm-pool sandbox ${sandboxId} for user/thread ${effectiveUserId}/${threadId}${suffix}`);
    return sandboxId;
  }

  private async _recheckCachedSandbox(threadId: string, sandboxId: string, userId: string): Promise<string | null> {
    return (
      (await this._reuseInProcessSandbox(threadId, userId, true)) ??
      (await this._reclaimWarmPoolSandbox(threadId, sandboxId, userId, true))
    );
  }

  private _registerDiscoveredSandbox(threadId: string, info: SandboxInfo, userId: string): string {
    const sandbox = new AioSandbox(info.sandboxId, info.sandboxUrl);
    const key = AioSandboxProvider._threadKey(threadId, userId);
    this._sandboxes.set(info.sandboxId, sandbox);
    this._sandboxInfos.set(info.sandboxId, info);
    this._lastActivity.set(info.sandboxId, Date.now() / 1000);
    this._threadSandboxes.set(key, info.sandboxId);

    logger.info(`Discovered existing sandbox ${info.sandboxId} for user/thread ${userId}/${threadId} at ${info.sandboxUrl}`);
    return info.sandboxId;
  }

  private _registerCreatedSandbox(threadId: string | null, sandboxId: string, info: SandboxInfo, userId: string | null): string {
    const sandbox = new AioSandbox(sandboxId, info.sandboxUrl);
    this._sandboxes.set(sandboxId, sandbox);
    this._sandboxInfos.set(sandboxId, info);
    this._lastActivity.set(sandboxId, Date.now() / 1000);
    if (threadId) {
      this._threadSandboxes.set(AioSandboxProvider._threadKey(threadId, AioSandboxProvider._effectiveAcquireUserId(userId)), sandboxId);
    }

    logger.info(`Created sandbox ${sandboxId} for thread ${threadId} at ${info.sandboxUrl}`);
    return sandboxId;
  }

  private async _checkTrackedSandboxAlive(sandboxId: string, info: SandboxInfo): Promise<boolean | null> {
    try {
      return await this._backend.isAlive(info);
    } catch (e) {
      logger.warning(`Failed to check sandbox ${sandboxId} health: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  private _removeTrackedSandbox(sandboxId: string, expectedInfo?: SandboxInfo | null): [Sandbox | null, SandboxInfo | null, boolean] {
    const activeInfo = this._sandboxInfos.get(sandboxId);
    const warmItem = this._warmPool.get(sandboxId);
    const warmInfo = warmItem !== undefined ? warmItem[0] : null;
    if (expectedInfo !== undefined && expectedInfo !== null && activeInfo !== expectedInfo && warmInfo !== expectedInfo) {
      return [null, null, false];
    }

    const sandbox = this._sandboxes.get(sandboxId) ?? null;
    this._sandboxes.delete(sandboxId);
    let info = this._sandboxInfos.get(sandboxId) ?? null;
    this._sandboxInfos.delete(sandboxId);
    for (const [key, sid] of [...this._threadSandboxes.entries()]) {
      if (sid === sandboxId) {
        this._threadSandboxes.delete(key);
      }
    }
    this._lastActivity.delete(sandboxId);
    if (info === null && this._warmPool.has(sandboxId)) {
      info = this._warmPool.get(sandboxId)![0];
      this._warmPool.delete(sandboxId);
    } else {
      this._warmPool.delete(sandboxId);
    }

    return [sandbox, info, true];
  }

  private async _dropUnhealthySandbox(sandboxId: string, reason: string, expectedInfo?: SandboxInfo | null): Promise<void> {
    const [sandbox, info, removed] = this._removeTrackedSandbox(sandboxId, expectedInfo);
    if (!removed) {
      logger.info(`Skipped dropping sandbox ${sandboxId}: tracked info changed after health check`);
      return;
    }

    if (sandbox !== null) {
      try {
        (sandbox as AioSandbox).close();
      } catch (e) {
        logger.warning(`Error closing unhealthy sandbox ${sandboxId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (info !== null) {
      try {
        await this._backend.destroy(info);
      } catch (e) {
        logger.warning(`Error destroying unhealthy sandbox ${sandboxId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    logger.warning(`Dropped unhealthy sandbox ${sandboxId}: ${reason}`);
  }

  private _replicaCount(): [number, number] {
    const replicas = this._config.replicas;
    const total = this._sandboxes.size + this._warmPool.size;
    return [replicas, total];
  }

  private _logReplicasSoftCap(replicas: number, sandboxId: string, evicted: string | null): void {
    if (evicted) {
      logger.info(`Evicted warm-pool sandbox ${evicted} to stay within replicas=${replicas}`);
      return;
    }
    logger.warning(`All ${replicas} replica slots are in active use; creating sandbox ${sandboxId} beyond the soft limit`);
  }

  // ── Core: acquire / get / release / shutdown ─────────────────────────

  async acquire(threadId: string | null = null, opts: { userId?: string | null } = {}): Promise<string> {
    const effectiveUserId = AioSandboxProvider._effectiveAcquireUserId(opts.userId);
    if (threadId) {
      const threadLock = this._getThreadLock(threadId, effectiveUserId);
      return threadLock.runExclusive(() => this._acquireInternal(threadId, effectiveUserId));
    }
    return this._acquireInternal(threadId, effectiveUserId);
  }

  private async _acquireInternal(threadId: string | null, userId: string): Promise<string> {
    const cachedId = await this._reuseInProcessSandbox(threadId, userId);
    if (cachedId !== null) {
      return cachedId;
    }

    // Deterministic ID for thread-specific, random for anonymous
    const sandboxId = this._sandboxIdForThread(threadId, userId);

    // ── Warm pool (container still running, no cold-start) ──
    const reclaimedId = await this._reclaimWarmPoolSandbox(threadId, sandboxId, userId);
    if (reclaimedId !== null) {
      return reclaimedId;
    }

    // ── Backend discovery + create ──
    if (threadId) {
      return this._discoverOrCreateWithLock(threadId, sandboxId, userId);
    }

    return this._createSandbox(threadId, sandboxId, userId);
  }

  private async _discoverOrCreateWithLock(threadId: string, sandboxId: string, userId: string | null): Promise<string> {
    const paths = getPaths();
    const effectiveUserId = AioSandboxProvider._effectiveAcquireUserId(userId);
    paths.ensureThreadDirs(threadId, effectiveUserId);

    // NOTE: cross-process fcntl file locking has no Node stdlib analogue; the
    // per-thread AsyncMutex held by acquire() already serializes within this
    // process. Re-check caches here to mirror the Python structure.
    const cachedId = await this._recheckCachedSandbox(threadId, sandboxId, effectiveUserId);
    if (cachedId !== null) {
      return cachedId;
    }

    const discovered = await this._backend.discover(sandboxId);
    if (discovered !== null) {
      return this._registerDiscoveredSandbox(threadId, discovered, effectiveUserId);
    }

    return this._createSandbox(threadId, sandboxId, effectiveUserId);
  }

  private _evictOldestWarm(): string | null {
    if (this._warmPool.size === 0) {
      return null;
    }
    let oldestId: string | null = null;
    let oldestTs = Infinity;
    for (const [sid, [, ts]] of this._warmPool) {
      if (ts < oldestTs) {
        oldestTs = ts;
        oldestId = sid;
      }
    }
    if (oldestId === null) {
      return null;
    }
    const [info] = this._warmPool.get(oldestId)!;
    this._warmPool.delete(oldestId);

    try {
      void this._backend.destroy(info);
      logger.info(`Destroyed warm-pool sandbox ${oldestId}`);
    } catch (e) {
      logger.error(`Failed to destroy warm-pool sandbox ${oldestId}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
    return oldestId;
  }

  private async _createSandbox(threadId: string | null, sandboxId: string, userId: string | null): Promise<string> {
    const effectiveUserId = AioSandboxProvider._effectiveAcquireUserId(userId);
    const extraMounts = this._getExtraMounts(threadId, effectiveUserId);

    // Enforce replicas: only warm-pool containers count toward the eviction budget.
    const [replicas, total] = this._replicaCount();
    if (total >= replicas) {
      const evicted = this._evictOldestWarm();
      this._logReplicasSoftCap(replicas, sandboxId, evicted);
    }

    const info = await this._backend.create(threadId, sandboxId, extraMounts.length > 0 ? extraMounts : null, { userId: effectiveUserId });

    // Wait for sandbox to be ready
    if (!(await waitForSandboxReadyAsync(info.sandboxUrl, 60))) {
      await this._backend.destroy(info);
      throw new Error(`Sandbox ${sandboxId} failed to become ready within timeout at ${info.sandboxUrl}`);
    }

    return this._registerCreatedSandbox(threadId, sandboxId, info, effectiveUserId);
  }

  get(sandboxId: string): Sandbox | null {
    const sandbox = this._sandboxes.get(sandboxId) ?? null;
    if (sandbox !== null) {
      this._lastActivity.set(sandboxId, Date.now() / 1000);
    }
    return sandbox;
  }

  release(sandboxId: string): void {
    const sandbox = this._sandboxes.get(sandboxId) ?? null;
    const info = this._sandboxInfos.get(sandboxId) ?? null;
    this._sandboxes.delete(sandboxId);
    this._sandboxInfos.delete(sandboxId);
    for (const [key, sid] of [...this._threadSandboxes.entries()]) {
      if (sid === sandboxId) {
        this._threadSandboxes.delete(key);
      }
    }
    this._lastActivity.delete(sandboxId);
    // Park in warm pool — container keeps running
    if (info && !this._warmPool.has(sandboxId)) {
      this._warmPool.set(sandboxId, [info, Date.now() / 1000]);
    }

    if (sandbox !== null) {
      try {
        (sandbox as AioSandbox).close();
      } catch (e) {
        logger.warning(`Error closing sandbox ${sandboxId} during release: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    logger.info(`Released sandbox ${sandboxId} to warm pool (container still running)`);
  }

  async destroy(sandboxId: string): Promise<void> {
    const [sandbox, info] = this._removeTrackedSandbox(sandboxId);

    if (sandbox !== null) {
      try {
        (sandbox as AioSandbox).close();
      } catch (e) {
        logger.warning(`Error closing sandbox ${sandboxId} during destroy: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (info) {
      await this._backend.destroy(info);
      logger.info(`Destroyed sandbox ${sandboxId}`);
    }
  }

  async shutdown(): Promise<void> {
    if (this._shutdownCalled) {
      return;
    }
    this._shutdownCalled = true;
    const sandboxIds = [...this._sandboxes.keys()];
    const warmItems = [...this._warmPool.entries()];
    this._warmPool.clear();

    // Stop idle checker
    if (this._idleCheckerTimer !== null) {
      clearInterval(this._idleCheckerTimer);
      this._idleCheckerTimer = null;
      logger.info("Stopped idle checker");
    }

    logger.info(`Shutting down ${sandboxIds.length} active + ${warmItems.length} warm-pool sandbox(es)`);

    for (const sandboxId of sandboxIds) {
      try {
        await this.destroy(sandboxId);
      } catch (e) {
        logger.error(`Failed to destroy sandbox ${sandboxId} during shutdown: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    for (const [sandboxId, [info]] of warmItems) {
      try {
        await this._backend.destroy(info);
        logger.info(`Destroyed warm-pool sandbox ${sandboxId} during shutdown`);
      } catch (e) {
        logger.error(`Failed to destroy warm-pool sandbox ${sandboxId} during shutdown: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}

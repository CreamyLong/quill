/**
 * Local container backend for sandbox provisioning.
 *
 * TypeScript port of `community/aio_sandbox/local_backend.py`. Manages sandbox
 * containers using Docker or Apple Container on the local machine via
 * `child_process.spawnSync` (in place of Python's `subprocess.run`). Reuses the
 * ported `getFreePort` / `releasePort` helpers from `utils/network.ts`.
 *
 * NOTE: `getFreePort` is async in the TS port, so `create` is async (the base
 * `SandboxBackend` methods are async here).
 */

import { spawnSync } from "node:child_process";
import { platform as osPlatform } from "node:os";

import { getFreePort, releasePort } from "../../utils/network.js";
import { SandboxBackend, waitForSandboxReady, type CreateOptions } from "./backend.js";
import { SandboxInfo } from "./sandbox_info.js";

const logger = {
  debug: (...a: unknown[]) => console.debug(...a),
  info: (...a: unknown[]) => console.info(...a),
  warning: (...a: unknown[]) => console.warn(...a),
  error: (...a: unknown[]) => console.error(...a),
};

export interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readOnly: boolean;
}

/** Parse Docker's ISO 8601 timestamp into a Unix epoch float (seconds). */
function _parseDockerTimestamp(raw: string): number {
  if (!raw) {
    return 0.0;
  }
  try {
    let s = raw.trim();
    // Truncate fractional seconds to milliseconds for JS Date parsing.
    const m = s.match(/^(.*\.\d{1,3})\d*([Zz]|[+-]\d\d:?\d\d)?$/);
    if (m) {
      s = m[1] + (m[2] ?? "");
    }
    const t = Date.parse(s);
    if (Number.isNaN(t)) {
      return 0.0;
    }
    return t / 1000;
  } catch (e) {
    logger.debug(`Could not parse docker timestamp ${JSON.stringify(raw)}: ${e instanceof Error ? e.message : String(e)}`);
    return 0.0;
  }
}

/** Extract the host port mapped to `container_port/tcp` from a docker inspect entry. */
function _extractHostPort(inspectEntry: Record<string, any>, containerPort: number): number | null {
  try {
    const ports = (inspectEntry["NetworkSettings"] || {})["Ports"] || {};
    const bindings = ports[`${containerPort}/tcp`] || [];
    if (bindings.length > 0) {
      const hostPort = bindings[0]["HostPort"];
      if (hostPort) {
        return parseInt(String(hostPort), 10);
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/** Format a bind-mount argument for the selected runtime. */
function _formatContainerMount(runtime: string, hostPath: string, containerPath: string, readOnly: boolean): string[] {
  if (runtime === "docker") {
    let mountSpec = `type=bind,src=${hostPath},dst=${containerPath}`;
    if (readOnly) {
      mountSpec += ",readonly";
    }
    return ["--mount", mountSpec];
  }

  let mountSpec = `${hostPath}:${containerPath}`;
  if (readOnly) {
    mountSpec += ":ro";
  }
  return ["-v", mountSpec];
}

/** Return a Docker/Container command with environment values redacted. */
function _redactContainerCommandForLog(cmd: string[]): string[] {
  const redacted: string[] = [];
  let redactNextEnv = false;

  for (const arg of cmd) {
    if (redactNextEnv) {
      if (arg.includes("=")) {
        const key = arg.split("=", 1)[0];
        redacted.push(key ? `${key}=<redacted>` : "<redacted>");
      } else {
        redacted.push(arg);
      }
      redactNextEnv = false;
      continue;
    }

    if (arg === "-e" || arg === "--env") {
      redacted.push(arg);
      redactNextEnv = true;
      continue;
    }

    if (arg.startsWith("--env=")) {
      const value = arg.slice("--env=".length);
      if (value.includes("=")) {
        const key = value.split("=", 1)[0];
        redacted.push(key ? `--env=${key}=<redacted>` : "--env=<redacted>");
      } else {
        redacted.push(arg);
      }
      continue;
    }

    redacted.push(arg);
  }

  return redacted;
}

function _formatContainerCommandForLog(cmd: string[]): string {
  return cmd.map((arg) => (/\s/.test(arg) ? `'${arg}'` : arg)).join(" ");
}

function _normalizeSandboxHost(host: string): string {
  return host.trim().toLowerCase();
}

function _isIpv6LoopbackSandboxHost(host: string): boolean {
  return ["::1", "[::1]"].includes(_normalizeSandboxHost(host));
}

function _isLoopbackSandboxHost(host: string): boolean {
  return ["", "localhost", "127.0.0.1", "::1", "[::1]"].includes(_normalizeSandboxHost(host));
}

/** Choose the host interface for legacy Docker `-p` sandbox publishing. */
function _resolveDockerBindHost(sandboxHost: string | null = null, bindHost: string | null = null): string {
  let explicitBind = bindHost !== null ? bindHost : process.env.QUILL_SANDBOX_BIND_HOST ?? null;
  if (explicitBind !== null) {
    explicitBind = explicitBind.trim();
    if (explicitBind) {
      logger.debug(`Docker sandbox bind: ${explicitBind} (explicit bind host override)`);
      return explicitBind;
    }
  }

  const host = sandboxHost !== null ? sandboxHost : process.env.QUILL_SANDBOX_HOST ?? "localhost";
  if (_isIpv6LoopbackSandboxHost(host)) {
    logger.debug("Docker sandbox bind: [::1] (IPv6 loopback sandbox host)");
    return "[::1]";
  }
  if (_isLoopbackSandboxHost(host)) {
    logger.debug("Docker sandbox bind: 127.0.0.1 (loopback default)");
    return "127.0.0.1";
  }

  logger.debug("Docker sandbox bind: 0.0.0.0 (non-loopback sandbox host compatibility)");
  return "0.0.0.0";
}

/** Return true only when stderr definitively says the container does not exist. */
function _isNoSuchContainerError(stderr: string, containerName: string): boolean {
  const message = stderr.toLowerCase();
  if (message.includes("no such object") || message.includes("no such container")) {
    return true;
  }
  if (!message.includes("not found")) {
    return false;
  }
  return message.includes(containerName.toLowerCase()) || message.includes("container") || message.includes("object");
}

/**
 * Backend that manages sandbox containers locally using Docker or Apple Container.
 */
export class LocalContainerBackend extends SandboxBackend {
  private readonly _image: string;
  private readonly _basePort: number;
  private readonly _containerPrefix: string;
  private readonly _configMounts: VolumeMount[];
  private readonly _environment: Record<string, string>;
  private readonly _runtime: string;

  constructor(opts: {
    image: string;
    basePort: number;
    containerPrefix: string;
    configMounts: VolumeMount[];
    environment: Record<string, string>;
  }) {
    super();
    this._image = opts.image;
    this._basePort = opts.basePort;
    this._containerPrefix = opts.containerPrefix;
    this._configMounts = opts.configMounts;
    this._environment = opts.environment;
    this._runtime = this._detectRuntime();
  }

  get runtime(): string {
    return this._runtime;
  }

  private _detectRuntime(): string {
    if (osPlatform() === "darwin") {
      const result = spawnSync("container", ["--version"], { encoding: "utf-8", timeout: 5000 });
      if (!result.error && result.status === 0) {
        logger.info(`Detected Apple Container: ${(result.stdout ?? "").trim()}`);
        return "container";
      }
      logger.info("Apple Container not available, falling back to Docker");
    }
    return "docker";
  }

  // ── SandboxBackend interface ──────────────────────────────────────────

  async create(
    threadId: string | null,
    sandboxId: string,
    extraMounts: Array<[string, string, boolean]> | null = null,
    _opts: CreateOptions = {},
  ): Promise<SandboxInfo> {
    void threadId;
    const containerName = `${this._containerPrefix}-${sandboxId}`;

    let nextStart = this._basePort;
    let containerId: string | null = null;
    let port = 0;
    let started = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      port = await getFreePort(nextStart);
      try {
        containerId = this._startContainer(containerName, port, extraMounts);
        started = true;
        break;
      } catch (exc) {
        releasePort(port);
        const err = exc instanceof Error ? exc.message : String(exc);
        const errLower = err.toLowerCase();
        if (err.includes("port is already allocated") || errLower.includes("address already in use")) {
          logger.warning(`Port ${port} rejected by Docker (already allocated), retrying with next port`);
          nextStart = port + 1;
          continue;
        }
        if (errLower.includes("is already in use by container") || errLower.includes("conflict. the container name")) {
          logger.warning(`Container name ${containerName} already in use, attempting to discover existing sandbox instance`);
          const existing = await this.discover(sandboxId);
          if (existing !== null) {
            return existing;
          }
        }
        throw exc;
      }
    }
    if (!started) {
      throw new Error("Could not start sandbox container: all candidate ports are already allocated by Docker");
    }

    const sandboxHost = process.env.QUILL_SANDBOX_HOST ?? "localhost";
    return new SandboxInfo({
      sandboxId,
      sandboxUrl: `http://${sandboxHost}:${port}`,
      containerName,
      containerId,
    });
  }

  async destroy(info: SandboxInfo): Promise<void> {
    const stopTarget = info.containerId || info.containerName;
    if (stopTarget) {
      this._stopContainer(stopTarget);
    }
    try {
      const parsed = new URL(info.sandboxUrl);
      const port = parsed.port ? parseInt(parsed.port, 10) : null;
      if (port) {
        releasePort(port);
      }
    } catch {
      // ignore
    }
  }

  async isAlive(info: SandboxInfo): Promise<boolean> {
    if (info.containerName) {
      return this._isContainerRunning(info.containerName);
    }
    return false;
  }

  async discover(sandboxId: string): Promise<SandboxInfo | null> {
    const containerName = `${this._containerPrefix}-${sandboxId}`;

    let running: boolean;
    try {
      running = this._isContainerRunning(containerName);
    } catch (e) {
      logger.warning(
        `Could not verify container ${containerName} during discovery; not adopting it: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }

    if (!running) {
      return null;
    }

    const port = this._getContainerPort(containerName);
    if (port === null) {
      return null;
    }

    const sandboxHost = process.env.QUILL_SANDBOX_HOST ?? "localhost";
    const sandboxUrl = `http://${sandboxHost}:${port}`;
    if (!(await waitForSandboxReady(sandboxUrl, 5))) {
      return null;
    }

    return new SandboxInfo({ sandboxId, sandboxUrl, containerName });
  }

  async listRunning(): Promise<SandboxInfo[]> {
    // Step 1: enumerate container names via docker ps
    const result = spawnSync(
      this._runtime,
      ["ps", "--filter", `name=${this._containerPrefix}-`, "--format", "{{.Names}}"],
      { encoding: "utf-8", timeout: 10000 },
    );
    if (result.error) {
      logger.warning(`Failed to list running containers: ${result.error.message}`);
      return [];
    }
    if (result.status !== 0) {
      const stderr = (result.stderr ?? "").trim();
      logger.warning(
        `Failed to list running containers with ${this._runtime} ps (returncode=${result.status}, stderr=${stderr || "<empty>"})`,
      );
      return [];
    }
    if (!(result.stdout ?? "").trim()) {
      return [];
    }

    const containerNames = (result.stdout ?? "")
      .trim()
      .split("\n")
      .map((name) => name.trim())
      .filter((name) => name.startsWith(`${this._containerPrefix}-`));
    if (containerNames.length === 0) {
      return [];
    }

    // Step 2: batched docker inspect — single subprocess call for all containers
    const inspections = this._batchInspect(containerNames);

    const infos: SandboxInfo[] = [];
    const sandboxHost = process.env.QUILL_SANDBOX_HOST ?? "localhost";
    for (const containerName of containerNames) {
      const data = inspections.get(containerName);
      if (data === undefined) {
        continue;
      }
      const [createdAt, hostPort] = data;
      const sandboxId = containerName.slice(this._containerPrefix.length + 1);
      const sandboxUrl = hostPort ? `http://${sandboxHost}:${hostPort}` : "";

      infos.push(new SandboxInfo({ sandboxId, sandboxUrl, containerName, createdAt }));
    }

    logger.info(`Found ${infos.length} running sandbox container(s)`);
    return infos;
  }

  private _batchInspect(containerNames: string[]): Map<string, [number, number | null]> {
    const out = new Map<string, [number, number | null]>();
    if (containerNames.length === 0) {
      return out;
    }
    const result = spawnSync(this._runtime, ["inspect", ...containerNames], { encoding: "utf-8", timeout: 15000 });
    if (result.error) {
      logger.warning(`Failed to batch-inspect containers: ${result.error.message}`);
      return out;
    }
    if (result.status !== 0) {
      const stderr = (result.stderr ?? "").trim();
      logger.warning(
        `Failed to batch-inspect containers with ${this._runtime} inspect (returncode=${result.status}, stderr=${stderr || "<empty>"})`,
      );
      return out;
    }

    let payload: Array<Record<string, any>>;
    try {
      payload = JSON.parse(result.stdout || "[]");
    } catch (e) {
      logger.warning(`Failed to parse docker inspect output as JSON: ${e instanceof Error ? e.message : String(e)}`);
      return out;
    }

    for (const entry of payload) {
      const name = (entry["Name"] || "").replace(/^\/+/, "");
      if (!name) {
        continue;
      }
      const createdAt = _parseDockerTimestamp(entry["Created"] || "");
      const hostPort = _extractHostPort(entry, 8080);
      out.set(name, [createdAt, hostPort]);
    }
    return out;
  }

  // ── Container operations ─────────────────────────────────────────────

  private _startContainer(containerName: string, port: number, extraMounts: Array<[string, string, boolean]> | null = null): string {
    const cmd = [this._runtime, "run"];

    if (this._runtime === "docker") {
      cmd.push("--security-opt", "seccomp=unconfined");
    }

    const portMapping = this._runtime === "docker" ? `${_resolveDockerBindHost()}:${port}:8080` : `${port}:8080`;

    cmd.push("--rm", "-d", "-p", portMapping, "--name", containerName);

    for (const [key, value] of Object.entries(this._environment)) {
      cmd.push("-e", `${key}=${value}`);
    }

    for (const mount of this._configMounts) {
      cmd.push(..._formatContainerMount(this._runtime, mount.hostPath, mount.containerPath, mount.readOnly));
    }

    if (extraMounts) {
      for (const [hostPath, containerPath, readOnly] of extraMounts) {
        cmd.push(..._formatContainerMount(this._runtime, hostPath, containerPath, readOnly));
      }
    }

    cmd.push(this._image);

    const logCmd = _formatContainerCommandForLog(_redactContainerCommandForLog(cmd));
    logger.info(`Starting container using ${this._runtime}: ${logCmd}`);

    const result = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf-8" });
    if (result.error || result.status !== 0) {
      const stderr = result.error ? result.error.message : result.stderr ?? "";
      logger.error(`Failed to start container using ${this._runtime}: ${stderr}`);
      throw new Error(`Failed to start sandbox container: ${stderr}`);
    }
    const containerId = (result.stdout ?? "").trim();
    logger.info(`Started container ${containerName} (ID: ${containerId}) using ${this._runtime}`);
    return containerId;
  }

  private _stopContainer(containerId: string): void {
    const result = spawnSync(this._runtime, ["stop", containerId], { encoding: "utf-8" });
    if (result.error || result.status !== 0) {
      const stderr = result.error ? result.error.message : result.stderr ?? "";
      logger.warning(`Failed to stop container ${containerId}: ${stderr}`);
      return;
    }
    logger.info(`Stopped container ${containerId} using ${this._runtime}`);
  }

  private _isContainerRunning(containerName: string): boolean {
    const result = spawnSync(this._runtime, ["inspect", "-f", "{{.State.Running}}", containerName], {
      encoding: "utf-8",
      timeout: 5000,
    });
    if (result.error && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
      throw new Error(`Timed out checking container ${containerName}`);
    }

    if (result.status === 0) {
      return (result.stdout ?? "").trim().toLowerCase() === "true";
    }
    const stderr = result.stderr ?? (result.error ? result.error.message : "");
    if (_isNoSuchContainerError(stderr, containerName)) {
      return false;
    }
    throw new Error(`Failed to inspect container ${containerName}: ${stderr.trim()}`);
  }

  private _getContainerPort(containerName: string): number | null {
    const result = spawnSync(this._runtime, ["port", containerName, "8080"], { encoding: "utf-8", timeout: 5000 });
    if (!result.error && result.status === 0 && (result.stdout ?? "").trim()) {
      // Output format: "0.0.0.0:PORT" or ":::PORT"
      const portStr = (result.stdout ?? "").trim().split(":").pop() ?? "";
      const parsed = parseInt(portStr, 10);
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  }
}

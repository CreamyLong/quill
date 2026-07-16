/**
 * Abstract base class for sandbox provisioning backends.
 *
 * TypeScript port of `community/aio_sandbox/backend.py`. Uses `fetch` (with an
 * `AbortController` timeout) in place of `httpx` / `requests`. The synchronous
 * Python `wait_for_sandbox_ready` becomes async here (fetch is async), so the
 * provider awaits both readiness helpers.
 */

import { SandboxInfo } from "./sandbox_info.js";

const logger = {
  debug: (...a: unknown[]) => console.debug(...a),
  info: (...a: unknown[]) => console.info(...a),
  warning: (...a: unknown[]) => console.warn(...a),
  error: (...a: unknown[]) => console.error(...a),
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, timeoutS: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutS * 1000);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Poll the sandbox health endpoint until ready or timeout.
 *
 * @returns true if the sandbox is ready, false otherwise.
 */
export async function waitForSandboxReady(sandboxUrl: string, timeout = 30): Promise<boolean> {
  const startTime = Date.now();
  while ((Date.now() - startTime) / 1000 < timeout) {
    try {
      const response = await fetchWithTimeout(`${sandboxUrl}/v1/sandbox`, 5);
      if (response.status === 200) {
        return true;
      }
    } catch {
      // ignore transient errors and keep polling
    }
    await sleep(1000);
  }
  return false;
}

/**
 * Async variant of sandbox readiness polling.
 */
export async function waitForSandboxReadyAsync(sandboxUrl: string, timeout = 30, pollInterval = 1.0): Promise<boolean> {
  const deadline = Date.now() + timeout * 1000;
  while (true) {
    let remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }
    try {
      const response = await fetchWithTimeout(`${sandboxUrl}/v1/sandbox`, Math.min(5, remaining / 1000));
      if (response.status === 200) {
        return true;
      }
    } catch {
      // ignore transient errors and keep polling
    }
    remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }
    await sleep(Math.min(pollInterval * 1000, remaining));
  }
  return false;
}

export interface CreateOptions {
  userId?: string | null;
}

/**
 * Abstract base for sandbox provisioning backends.
 *
 * Two implementations:
 * - LocalContainerBackend: starts Docker/Apple Container locally, manages ports
 * - RemoteSandboxBackend: connects to a pre-existing URL (K8s service, external)
 */
export abstract class SandboxBackend {
  /** Create/provision a new sandbox. */
  abstract create(
    threadId: string | null,
    sandboxId: string,
    extraMounts?: Array<[string, string, boolean]> | null,
    opts?: CreateOptions,
  ): Promise<SandboxInfo>;

  /** Destroy/cleanup a sandbox and release its resources. */
  abstract destroy(info: SandboxInfo): Promise<void>;

  /** Quick check whether a sandbox is still alive. */
  abstract isAlive(info: SandboxInfo): Promise<boolean>;

  /** Try to discover an existing sandbox by its deterministic ID. */
  abstract discover(sandboxId: string): Promise<SandboxInfo | null>;

  /**
   * Enumerate all running sandboxes managed by this backend. The default
   * implementation returns an empty list, which is correct for backends that
   * don't manage local containers.
   */
  async listRunning(): Promise<SandboxInfo[]> {
    return [];
  }
}

export { logger as _backendLogger };

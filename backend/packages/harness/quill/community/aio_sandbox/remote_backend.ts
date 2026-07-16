/**
 * Remote sandbox backend — delegates Pod lifecycle to the provisioner service.
 *
 * TypeScript port of `community/aio_sandbox/remote_backend.py`. Uses `fetch`
 * (with an `AbortController` timeout) in place of `requests`.
 */

import { SandboxBackend, type CreateOptions } from "./backend.js";
import { SandboxInfo } from "./sandbox_info.js";
import { getEffectiveUserId } from "../../runtime/user_context.js";

const logger = {
  debug: (...a: unknown[]) => console.debug(...a),
  info: (...a: unknown[]) => console.info(...a),
  warning: (...a: unknown[]) => console.warn(...a),
  error: (...a: unknown[]) => console.error(...a),
};

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutS: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutS * 1000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Backend that delegates sandbox lifecycle to the provisioner service.
 *
 * All Pod creation, destruction, and discovery are handled by the provisioner.
 * This backend is a thin HTTP client.
 */
export class RemoteSandboxBackend extends SandboxBackend {
  private readonly _provisionerUrl: string;

  constructor(provisionerUrl: string) {
    super();
    this._provisionerUrl = provisionerUrl.replace(/\/+$/, "");
  }

  get provisionerUrl(): string {
    return this._provisionerUrl;
  }

  // ── SandboxBackend interface ──────────────────────────────────────────

  async create(
    threadId: string | null,
    sandboxId: string,
    extraMounts: Array<[string, string, boolean]> | null = null,
    opts: CreateOptions = {},
  ): Promise<SandboxInfo> {
    void extraMounts;
    return this._provisionerCreate(threadId, sandboxId, opts.userId ?? null);
  }

  async destroy(info: SandboxInfo): Promise<void> {
    await this._provisionerDestroy(info.sandboxId);
  }

  async isAlive(info: SandboxInfo): Promise<boolean> {
    return this._provisionerIsAlive(info.sandboxId);
  }

  async discover(sandboxId: string): Promise<SandboxInfo | null> {
    return this._provisionerDiscover(sandboxId);
  }

  async listRunning(): Promise<SandboxInfo[]> {
    return this._provisionerList();
  }

  // ── Provisioner API calls ─────────────────────────────────────────────

  private async _provisionerList(): Promise<SandboxInfo[]> {
    try {
      const resp = await fetchJson(`${this._provisionerUrl}/api/sandboxes`, { method: "GET" }, 10);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = await resp.json();
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        logger.warning(`Provisioner list_running returned non-dict payload: ${typeof data}`);
        return [];
      }

      const sandboxes = (data as Record<string, unknown>)["sandboxes"];
      if (!Array.isArray(sandboxes)) {
        logger.warning(`Provisioner list_running returned non-list sandboxes: ${typeof sandboxes}`);
        return [];
      }

      const infos: SandboxInfo[] = [];
      for (const sandbox of sandboxes) {
        if (typeof sandbox !== "object" || sandbox === null) {
          logger.warning(`Provisioner list_running entry is not a dict: ${typeof sandbox}`);
          continue;
        }
        const s = sandbox as Record<string, unknown>;
        const sandboxId = s["sandbox_id"];
        const sandboxUrl = s["sandbox_url"];
        if (typeof sandboxId === "string" && sandboxId && typeof sandboxUrl === "string" && sandboxUrl) {
          infos.push(new SandboxInfo({ sandboxId, sandboxUrl }));
        }
      }

      logger.info(`Provisioner list_running: ${infos.length} sandbox(es) found`);
      return infos;
    } catch (exc) {
      logger.warning(`Provisioner list_running failed: ${exc instanceof Error ? exc.message : String(exc)}`);
      return [];
    }
  }

  private async _provisionerCreate(threadId: string | null, sandboxId: string, userId: string | null): Promise<SandboxInfo> {
    const effectiveUserId = userId || getEffectiveUserId();
    try {
      const resp = await fetchJson(
        `${this._provisionerUrl}/api/sandboxes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sandbox_id: sandboxId, thread_id: threadId, user_id: effectiveUserId }),
        },
        30,
      );
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as { sandbox_url: string };
      logger.info(`Provisioner created sandbox ${sandboxId}: sandbox_url=${data["sandbox_url"]}`);
      return new SandboxInfo({ sandboxId, sandboxUrl: data["sandbox_url"] });
    } catch (exc) {
      logger.error(`Provisioner create failed for ${sandboxId}: ${exc instanceof Error ? exc.message : String(exc)}`);
      throw new Error(`Provisioner create failed: ${exc instanceof Error ? exc.message : String(exc)}`);
    }
  }

  private async _provisionerDestroy(sandboxId: string): Promise<void> {
    try {
      const resp = await fetchJson(`${this._provisionerUrl}/api/sandboxes/${sandboxId}`, { method: "DELETE" }, 15);
      if (resp.ok) {
        logger.info(`Provisioner destroyed sandbox ${sandboxId}`);
      } else {
        logger.warning(`Provisioner destroy returned ${resp.status}: ${await resp.text()}`);
      }
    } catch (exc) {
      logger.warning(`Provisioner destroy failed for ${sandboxId}: ${exc instanceof Error ? exc.message : String(exc)}`);
    }
  }

  private async _provisionerIsAlive(sandboxId: string): Promise<boolean> {
    let resp: Response;
    try {
      resp = await fetchJson(`${this._provisionerUrl}/api/sandboxes/${sandboxId}`, { method: "GET" }, 10);
    } catch (exc) {
      throw new Error(`Provisioner health check failed for ${sandboxId}: ${exc instanceof Error ? exc.message : String(exc)}`);
    }

    if (resp.status === 404) {
      return false;
    }
    if (!resp.ok) {
      throw new Error(`Provisioner health check failed for ${sandboxId}: HTTP ${resp.status} ${await resp.text()}`);
    }

    const data = (await resp.json()) as { status?: string };
    return data["status"] === "Running";
  }

  private async _provisionerDiscover(sandboxId: string): Promise<SandboxInfo | null> {
    try {
      const resp = await fetchJson(`${this._provisionerUrl}/api/sandboxes/${sandboxId}`, { method: "GET" }, 10);
      if (resp.status === 404) {
        return null;
      }
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as { sandbox_url: string };
      return new SandboxInfo({ sandboxId, sandboxUrl: data["sandbox_url"] });
    } catch (exc) {
      logger.debug(`Provisioner discover failed for ${sandboxId}: ${exc instanceof Error ? exc.message : String(exc)}`);
      return null;
    }
  }
}

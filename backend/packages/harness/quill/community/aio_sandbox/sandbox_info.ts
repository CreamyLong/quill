/**
 * Sandbox metadata for cross-process discovery and state persistence.
 *
 * TypeScript port of `community/aio_sandbox/sandbox_info.py`.
 */

/**
 * Persisted sandbox metadata that enables cross-process discovery.
 *
 * This class holds all the information needed to reconnect to an existing
 * sandbox from a different process (e.g., gateway vs langgraph, multiple
 * workers, or across K8s pods with shared storage).
 */
export class SandboxInfo {
  sandboxId: string;
  sandboxUrl: string; // e.g. http://localhost:8080 or http://k3s:30001
  containerName: string | null; // Only for local container backend
  containerId: string | null; // Only for local container backend
  createdAt: number;

  constructor(opts: {
    sandboxId: string;
    sandboxUrl: string;
    containerName?: string | null;
    containerId?: string | null;
    createdAt?: number;
  }) {
    this.sandboxId = opts.sandboxId;
    this.sandboxUrl = opts.sandboxUrl;
    this.containerName = opts.containerName ?? null;
    this.containerId = opts.containerId ?? null;
    this.createdAt = opts.createdAt ?? Date.now() / 1000;
  }

  toDict(): Record<string, unknown> {
    return {
      sandbox_id: this.sandboxId,
      sandbox_url: this.sandboxUrl,
      container_name: this.containerName,
      container_id: this.containerId,
      created_at: this.createdAt,
    };
  }

  static fromDict(data: Record<string, unknown>): SandboxInfo {
    return new SandboxInfo({
      sandboxId: data["sandbox_id"] as string,
      sandboxUrl: (data["sandbox_url"] as string | undefined) ?? (data["base_url"] as string | undefined) ?? "",
      containerName: (data["container_name"] as string | null | undefined) ?? null,
      containerId: (data["container_id"] as string | null | undefined) ?? null,
      createdAt: (data["created_at"] as number | undefined) ?? Date.now() / 1000,
    });
  }
}

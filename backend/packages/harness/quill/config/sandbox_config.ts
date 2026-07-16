/**
 * Configuration for a volume mount.
 */
export interface VolumeMountConfig {
  /** Source path for the mount. */
  hostPath: string;
  /** Path inside the container */
  containerPath: string;
  /** Whether the mount is read-only */
  readOnly: boolean;
}

/**
 * Config section for a sandbox.
 */
export interface SandboxConfig {
  /** Class path of the sandbox provider */
  use: string;
  /** Allow bash tool to execute directly on the host */
  allowHostBash: boolean;
  /** Docker image to use for the sandbox container */
  image: string | null;
  /** Base port for sandbox containers */
  port: number | null;
  /** Maximum number of concurrent sandbox containers */
  replicas: number | null;
  /** Prefix for container names */
  containerPrefix: string | null;
  /** Idle timeout in seconds before sandbox is released */
  idleTimeout: number | null;
  /** List of volume mounts */
  mounts: VolumeMountConfig[];
  /** Environment variables to inject into the sandbox container */
  environment: Record<string, string>;
  /** Maximum characters to keep from bash tool output */
  bashOutputMaxChars: number;
  /** Maximum characters to keep from read_file tool output */
  readFileOutputMaxChars: number;
  /** Maximum characters to keep from ls tool output */
  lsOutputMaxChars: number;
  /** Extra fields allowed (matches Pydantic extra="allow") */
  [key: string]: unknown;
}

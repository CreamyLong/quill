/**
 * Security helpers for sandbox capability gating.
 *
 * Mirrors `quill.sandbox.security` from the Python backend.
 */

import { getAppConfig } from "../config/app_config.js";

const LOCAL_SANDBOX_PROVIDER_MARKERS = [
  "quill.sandbox.local:LocalSandboxProvider",
  "quill.sandbox.local.local_sandbox_provider:LocalSandboxProvider",
];

export const LOCAL_HOST_BASH_DISABLED_MESSAGE =
  "Host bash execution is disabled for LocalSandboxProvider because it is not a secure " +
  "sandbox boundary. Switch to AioSandboxProvider for isolated bash access, or set " +
  "sandbox.allow_host_bash: true only in a fully trusted local environment.";

export const LOCAL_BASH_SUBAGENT_DISABLED_MESSAGE =
  "Bash subagent is disabled for LocalSandboxProvider because host bash execution is not " +
  "a secure sandbox boundary. Switch to AioSandboxProvider for isolated bash access, or set " +
  "sandbox.allow_host_bash: true only in a fully trusted local environment.";

export interface SandboxConfigLike {
  use?: string;
  allow_host_bash?: boolean;
  [key: string]: unknown;
}

export interface AppConfigLike {
  sandbox?: SandboxConfigLike;
  [key: string]: unknown;
}

/**
 * Return true when the active sandbox provider is the host-local provider.
 */
export function usesLocalSandboxProvider(config?: AppConfigLike): boolean {
  const cfg = config ?? getAppConfig();
  const sandboxCfg = cfg.sandbox as SandboxConfigLike | undefined;
  const sandboxUse = sandboxCfg?.use ?? "";
  if (LOCAL_SANDBOX_PROVIDER_MARKERS.includes(sandboxUse)) {
    return true;
  }
  return sandboxUse.endsWith(":LocalSandboxProvider") && sandboxUse.includes("quill.sandbox.local");
}

/**
 * Return whether host bash execution is explicitly allowed.
 */
export function isHostBashAllowed(config?: AppConfigLike): boolean {
  const cfg = config ?? getAppConfig();
  const sandboxCfg = cfg.sandbox as SandboxConfigLike | undefined;
  if (sandboxCfg === undefined) {
    return false;
  }
  if (!usesLocalSandboxProvider(cfg)) {
    return true;
  }
  return Boolean(sandboxCfg.allow_host_bash);
}

/**
 * Community Tools config API client.
 *
 * Reads/writes the `tools` section of config.yaml via the Gateway's
 * `/api/config/tools` endpoints.
 */

import { fetch } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";

/** A configurable field in a community provider's config entry. */
export interface CommunityToolProviderField {
  key: string;
  label: string;
  type: "password" | "text" | "number";
  required?: boolean;
  placeholder?: string;
}

/** Static description of a community tool provider for the Settings UI. */
export interface CommunityToolProvider {
  id: string;
  displayName: string;
  use: string;
  group: string;
  fields: CommunityToolProviderField[];
}

/** A tool entry as stored in config.yaml tools: section. */
export interface ToolConfigEntry {
  name: string;
  group: string;
  use: string;
  enabled?: boolean;
  [key: string]: unknown;
}

export class ConfigToolsRequestError extends Error {
  readonly status: number;
  readonly errors?: string[];
  constructor(status: number, message: string, errors?: string[]) {
    super(message);
    this.name = "ConfigToolsRequestError";
    this.status = status;
    this.errors = errors;
  }
}

async function readErrorDetail(response: Response, fallback: string): Promise<string> {
  const error = (await response.json().catch(() => ({}))) as { detail?: unknown };
  return typeof error.detail === "string" ? error.detail : fallback;
}

/** Fetch the current tools configuration from config.yaml. */
export async function loadToolsConfig(): Promise<ToolConfigEntry[]> {
  const response = await fetch(`${getBackendBaseURL()}/api/config/tools`);
  if (!response.ok) {
    throw new ConfigToolsRequestError(
      response.status,
      await readErrorDetail(response, "Failed to load tools configuration"),
    );
  }
  const data = (await response.json()) as { tools?: ToolConfigEntry[] };
  return data.tools ?? [];
}

/** Save the tools configuration back to config.yaml. */
export async function saveToolsConfig(
  tools: ToolConfigEntry[],
): Promise<{ message?: string }> {
  const response = await fetch(`${getBackendBaseURL()}/api/config/tools`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tools }),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as {
      detail?: unknown;
      errors?: string[];
    };
    throw new ConfigToolsRequestError(
      response.status,
      (typeof error.detail === "string" && error.detail) || "Failed to save tools configuration",
      error.errors,
    );
  }
  return (await response.json()) as { message?: string };
}

/** Fetch the registry of available community tool providers. */
export async function loadToolProviders(): Promise<CommunityToolProvider[]> {
  const response = await fetch(`${getBackendBaseURL()}/api/config/tools/providers`);
  if (!response.ok) {
    throw new ConfigToolsRequestError(
      response.status,
      await readErrorDetail(response, "Failed to load tool providers"),
    );
  }
  const data = (await response.json()) as { providers?: CommunityToolProvider[] };
  return data.providers ?? [];
}

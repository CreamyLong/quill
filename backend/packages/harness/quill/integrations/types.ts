/**
 * Integration installers — managed first-party integration installers.
 *
 * Mirrors the DeerFlow 2.0 `integrations/` module. Each integration is a
 * self-contained installer that bundles skills, MCP server configs, and
 * setup instructions for a specific external service (e.g., Lark, GitHub).
 *
 * Integrations are NOT the same as extensions:
 * - Extensions are runtime plugins that hook into the agent lifecycle.
 * - Integrations are install-time packages that add skills + MCP configs.
 */

/** Metadata for an integration installer. */
export interface IntegrationManifest {
  /** Unique integration name. */
  name: string;
  /** Semver version. */
  version: string;
  /** Short description. */
  description: string;
  /** External service this integration connects to. */
  service: string;
  /** Skills this integration installs (relative paths). */
  skills: string[];
  /** MCP server configs this integration adds. */
  mcpServers?: McpServerConfig[];
  /** Setup instructions for the operator. */
  setupSteps?: string[];
}

/** MCP server configuration contributed by an integration. */
export interface McpServerConfig {
  name: string;
  transport: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

/** Result of installing an integration. */
export interface IntegrationResult {
  name: string;
  success: boolean;
  installedSkills: string[];
  addedMcpServers: string[];
  errors: string[];
}

/** A registered integration installer. */
export interface RegisteredIntegration {
  manifest: IntegrationManifest;
  /** Absolute path to the integration directory. */
  directory: string;
  /** Whether this integration is currently installed. */
  installed: boolean;
}

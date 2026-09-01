/**
 * Provider registry — dynamic provider discovery and registration.
 *
 * Replaces the static PROVIDER_REGISTRY in factory.ts with a plugin
 * interface that providers implement. New providers register themselves
 * at module load time; the factory discovers them at runtime.
 *
 * Pattern: Provider Catalog as Source of Truth (OpenWork).
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

/** Authentication methods a provider supports. */
export type ProviderAuthMethod = "api_key" | "oauth" | "cloud" | "none";

/** Capabilities a provider's models may have. */
export interface ProviderCapabilities {
  /** Supports extended thinking / reasoning. */
  reasoning: boolean;
  /** Supports image/vision input. */
  vision: boolean;
  /** Supports file attachments. */
  attachments: boolean;
  /** Supports tool/function calling. */
  tools: boolean;
}

/** Configuration fields a provider needs from the user. */
export interface ProviderConfigField {
  key: string;
  label: string;
  type: "string" | "password" | "url" | "boolean" | "number";
  required: boolean;
  placeholder?: string;
  helpText?: string;
}

/**
 * Provider plugin interface.
 *
 * Each provider implements this interface and registers itself via
 * `registerProvider()`. The factory then discovers providers at runtime
 * instead of relying on a hardcoded registry.
 */
export interface ProviderPlugin {
  /** Unique provider identifier (e.g. "openai", "anthropic", "ollama"). */
  id: string;
  /** Human-readable provider name. */
  name: string;
  /** Provider logo URL or path. */
  logo?: string;
  /** Authentication methods supported. */
  authMethods: ProviderAuthMethod[];
  /** Configuration fields needed from the user. */
  configFields: ProviderConfigField[];
  /** Default capabilities for this provider's models. */
  defaultCapabilities: ProviderCapabilities;
  /**
   * LangChain class path for this provider (e.g. "langchain_openai:ChatOpenAI").
   * Used as the `use` field in model config.
   */
  classPath: string;
  /**
   * Validate a model config entry for this provider.
   * Returns an error message if invalid, null if valid.
   */
  validateConfig(config: Record<string, unknown>): string | null;
  /**
   * Resolve the actual capabilities for a model given its config.
   * May differ from defaultCapabilities based on model-specific settings.
   */
  resolveCapabilities(config: Record<string, unknown>): ProviderCapabilities;
}

/** Registry of all registered providers. */
const _providers = new Map<string, ProviderPlugin>();

/**
 * Register a provider plugin.
 *
 * Providers call this at module load time to register themselves.
 * If a provider with the same id is already registered, it is replaced.
 */
export function registerProvider(plugin: ProviderPlugin): void {
  _providers.set(plugin.id, plugin);
}

/**
 * Get a provider by id.
 *
 * @returns The provider plugin, or undefined if not found.
 */
export function getProvider(id: string): ProviderPlugin | undefined {
  return _providers.get(id);
}

/**
 * Get a provider by class path (the `use` field in model config).
 *
 * @returns The provider plugin, or undefined if not found.
 */
export function getProviderByClassPath(classPath: string): ProviderPlugin | undefined {
  for (const provider of _providers.values()) {
    if (provider.classPath === classPath) {
      return provider;
    }
  }
  return undefined;
}

/**
 * List all registered providers.
 *
 * @returns Array of all registered provider plugins.
 */
export function listProviders(): ProviderPlugin[] {
  return Array.from(_providers.values());
}

/**
 * Check if a provider id is registered.
 */
export function hasProvider(id: string): boolean {
  return _providers.has(id);
}

/**
 * Clear all registered providers.
 *
 * Primarily for testing.
 */
export function clearProviders(): void {
  _providers.clear();
}

/**
 * Infer the provider id from a model config's `use` field.
 *
 * The `use` field format is "module:Class". This function extracts
 * a provider id by matching against registered providers' class paths.
 *
 * @returns The provider id, or null if no match found.
 */
export function inferProviderId(use: string): string | null {
  const provider = getProviderByClassPath(use);
  return provider?.id ?? null;
}

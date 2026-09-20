/**
 * Extension Manager — runtime extensibility with five contribution kinds.
 *
 * Inspired by DeerFlow 2.0's extension manager and OpenClaw's plugin SDK.
 *
 * Extensions can contribute:
 *   1. Middleware — isolated middleware for the agent graph
 *   2. Lifecycle hooks — task-lifecycle event handlers
 *   3. Observers — system model call observers for observability
 *   4. Gateway services — long-lived services tied to the gateway lifecycle
 *   5. HTTP routers — FastAPI-like HTTP route contributions
 *
 * Extensions are loaded at gateway startup and registered with the runtime.
 * They can be installed from Python packages, Git repos, or local directories.
 *
 * Source patterns:
 * - DeerFlow 2.0: Extension manager with five contribution kinds
 * - OpenClaw: Plugin SDK with clean public/private separation
 * - DeepSeek Harness: Cordis plugin system (everything-is-a-plugin)
 */

import type { MiddlewareDefinition } from "../agents/factory.js";
import type { AppConfig } from "../config/app_config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Contribution kinds an extension can provide.
 */
export type ContributionKind =
  | "middleware"
  | "lifecycle_hook"
  | "observer"
  | "gateway_service"
  | "http_router";

/**
 * A lifecycle hook event.
 */
export type LifecycleEvent =
  | "task_start"
  | "task_complete"
  | "task_failed"
  | "agent_start"
  | "agent_end"
  | "tool_call"
  | "tool_result";

/**
 * Lifecycle hook handler.
 */
export type LifecycleHook = (event: LifecycleEvent, context: Record<string, unknown>) => void | Promise<void>;

/**
 * Observer callback for system model calls.
 */
export type ObserverCallback = (data: {
  type: "model_call" | "model_response" | "tool_call" | "tool_result";
  timestamp: string;
  data: Record<string, unknown>;
}) => void;

/**
 * Gateway service — a long-lived service tied to the gateway lifecycle.
 */
export interface GatewayService {
  name: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  health?: () => Promise<{ healthy: boolean; message?: string }>;
}

/**
 * HTTP route contribution.
 */
export interface HttpRoute {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  handler: (request: Record<string, unknown>) => Promise<{ status: number; body: unknown }>;
  description?: string;
}

/**
 * Extension contribution — a single contribution from an extension.
 */
export interface ExtensionContribution {
  kind: ContributionKind;
  name: string;
  // Middleware contribution
  middleware?: MiddlewareDefinition;
  // Lifecycle hook contribution
  hook?: { events: LifecycleEvent[]; handler: LifecycleHook };
  // Observer contribution
  observer?: ObserverCallback;
  // Gateway service contribution
  service?: GatewayService;
  // HTTP route contribution
  route?: HttpRoute;
}

/**
 * Extension manifest — describes what an extension provides.
 */
export interface ExtensionManifest {
  name: string;
  version: string;
  description: string;
  /** Path to the extension directory. */
  path: string;
  /** Source: "local" | "package" | "git". */
  source: "local" | "package" | "git";
  /** Contribution kinds this extension provides. */
  contributes: ContributionKind[];
  /** Dependencies on other extensions. */
  dependencies?: string[];
}

/**
 * Installed extension state.
 */
export interface InstalledExtension {
  manifest: ExtensionManifest;
  contributions: ExtensionContribution[];
  /** Whether the extension is currently enabled. */
  enabled: boolean;
  /** Installation timestamp. */
  installedAt: string;
}

// ---------------------------------------------------------------------------
// Extension Manager
// ---------------------------------------------------------------------------

/**
 * Manages extension lifecycle: registration, enabling, disabling.
 */
export class ExtensionManager {
  private extensions = new Map<string, InstalledExtension>();
  private middlewares: MiddlewareDefinition[] = [];
  private hooks = new Map<LifecycleEvent, LifecycleHook[]>();
  private observers: ObserverCallback[] = [];
  private services = new Map<string, GatewayService>();
  private routes = new Map<string, HttpRoute>();
  private appConfig: AppConfig | null = null;

  constructor(appConfig?: AppConfig) {
    this.appConfig = appConfig ?? null;
  }

  /**
   * Register an extension with its contributions.
   */
  registerExtension(
    manifest: ExtensionManifest,
    contributions: ExtensionContribution[],
  ): void {
    const existing = this.extensions.get(manifest.name);
    if (existing) {
      // Disable the existing extension first
      this.disableExtension(manifest.name);
    }

    const extension: InstalledExtension = {
      manifest,
      contributions,
      enabled: false,
      installedAt: new Date().toISOString(),
    };

    this.extensions.set(manifest.name, extension);
  }

  /**
   * Enable an extension — registers all its contributions.
   */
  async enableExtension(name: string): Promise<{ success: boolean; message: string }> {
    const extension = this.extensions.get(name);
    if (!extension) {
      return { success: false, message: `Extension "${name}" not found.` };
    }

    if (extension.enabled) {
      return { success: true, message: `Extension "${name}" is already enabled.` };
    }

    // Check dependencies
    for (const dep of extension.manifest.dependencies ?? []) {
      const depExt = this.extensions.get(dep);
      if (!depExt || !depExt.enabled) {
        return {
          success: false,
          message: `Extension "${name}" depends on "${dep}" which is not enabled.`,
        };
      }
    }

    // Register contributions
    for (const contribution of extension.contributions) {
      this.registerContribution(contribution);
    }

    extension.enabled = true;

    // Start gateway services
    for (const contribution of extension.contributions) {
      if (contribution.kind === "gateway_service" && contribution.service) {
        try {
          await contribution.service.start();
        } catch (err) {
          console.error(`[ExtensionManager] Failed to start service "${contribution.name}": ${err}`);
        }
      }
    }

    return { success: true, message: `Extension "${name}" enabled.` };
  }

  /**
   * Disable an extension — removes all its contributions.
   */
  async disableExtension(name: string): Promise<{ success: boolean; message: string }> {
    const extension = this.extensions.get(name);
    if (!extension || !extension.enabled) {
      return { success: false, message: `Extension "${name}" is not enabled.` };
    }

    // Stop gateway services
    for (const contribution of extension.contributions) {
      if (contribution.kind === "gateway_service" && contribution.service) {
        try {
          await contribution.service.stop();
        } catch (err) {
          console.error(`[ExtensionManager] Failed to stop service "${contribution.name}": ${err}`);
        }
      }
    }

    // Remove contributions
    for (const contribution of extension.contributions) {
      this.unregisterContribution(contribution);
    }

    extension.enabled = false;
    return { success: true, message: `Extension "${name}" disabled.` };
  }

  /**
   * List all registered extensions.
   */
  listExtensions(): InstalledExtension[] {
    return [...this.extensions.values()];
  }

  /**
   * Get a specific extension.
   */
  getExtension(name: string): InstalledExtension | undefined {
    return this.extensions.get(name);
  }

  /**
   * Get all active middleware contributions.
   */
  getActiveMiddlewares(): MiddlewareDefinition[] {
    return [...this.middlewares];
  }

  /**
   * Get all active lifecycle hooks for an event.
   */
  getHooksForEvent(event: LifecycleEvent): LifecycleHook[] {
    return this.hooks.get(event) ?? [];
  }

  /**
   * Get all active observers.
   */
  getObservers(): ObserverCallback[] {
    return [...this.observers];
  }

  /**
   * Get all active HTTP routes.
   */
  getRoutes(): HttpRoute[] {
    return [...this.routes.values()];
  }

  /**
   * Fire a lifecycle event to all registered hooks.
   */
  async fireEvent(
    event: LifecycleEvent,
    context: Record<string, unknown>,
  ): Promise<void> {
    const hooks = this.hooks.get(event) ?? [];
    for (const hook of hooks) {
      try {
        await hook(event, context);
      } catch (err) {
        console.error(`[ExtensionManager] Hook error for event "${event}": ${err}`);
      }
    }
  }

  /**
   * Notify all observers.
   */
  notifyObservers(data: Parameters<ObserverCallback>[0]): void {
    for (const observer of this.observers) {
      try {
        observer(data);
      } catch (err) {
        console.error(`[ExtensionManager] Observer error: ${err}`);
      }
    }
  }

  /**
   * Get health status of all gateway services.
   */
  async getServicesHealth(): Promise<Array<{ name: string; healthy: boolean; message?: string }>> {
    const results: Array<{ name: string; healthy: boolean; message?: string }> = [];
    for (const [name, service] of this.services) {
      if (service.health) {
        try {
          const health = await service.health();
          results.push({ name, ...health });
        } catch {
          results.push({ name, healthy: false, message: "Health check failed" });
        }
      } else {
        results.push({ name, healthy: true, message: "No health check defined" });
      }
    }
    return results;
  }

  // ------------------------------------------------------------------
  // Internal registration
  // ------------------------------------------------------------------

  private registerContribution(contribution: ExtensionContribution): void {
    switch (contribution.kind) {
      case "middleware":
        if (contribution.middleware) {
          this.middlewares.push(contribution.middleware);
        }
        break;
      case "lifecycle_hook":
        if (contribution.hook) {
          for (const event of contribution.hook.events) {
            const existing = this.hooks.get(event) ?? [];
            existing.push(contribution.hook.handler);
            this.hooks.set(event, existing);
          }
        }
        break;
      case "observer":
        if (contribution.observer) {
          this.observers.push(contribution.observer);
        }
        break;
      case "gateway_service":
        if (contribution.service) {
          this.services.set(contribution.name, contribution.service);
        }
        break;
      case "http_router":
        if (contribution.route) {
          const key = `${contribution.route.method} ${contribution.route.path}`;
          this.routes.set(key, contribution.route);
        }
        break;
    }
  }

  private unregisterContribution(contribution: ExtensionContribution): void {
    switch (contribution.kind) {
      case "middleware":
        if (contribution.middleware) {
          this.middlewares = this.middlewares.filter(
            (m) => m.name !== contribution.middleware!.name,
          );
        }
        break;
      case "lifecycle_hook":
        if (contribution.hook) {
          for (const event of contribution.hook.events) {
            const existing = this.hooks.get(event) ?? [];
            this.hooks.set(
              event,
              existing.filter((h) => h !== contribution.hook!.handler),
            );
          }
        }
        break;
      case "observer":
        if (contribution.observer) {
          this.observers = this.observers.filter((o) => o !== contribution.observer);
        }
        break;
      case "gateway_service":
        this.services.delete(contribution.name);
        break;
      case "http_router":
        if (contribution.route) {
          const key = `${contribution.route.method} ${contribution.route.path}`;
          this.routes.delete(key);
        }
        break;
    }
  }
}

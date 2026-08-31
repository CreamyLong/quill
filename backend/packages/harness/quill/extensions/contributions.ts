/**
 * Extension contribution kinds — the five ways extensions can enhance Quill.
 *
 * Port of DeerFlow 2.0's extension contribution system. Extensions can
 * contribute five kinds of capabilities:
 *
 * 1. **Middleware** — isolated middleware at semantic lead/subagent positions
 * 2. **Lifecycle hooks** — lead and agent task-lifecycle callbacks
 * 3. **Observers** — observe DeerFlow-owned model calls (goal, memory, title, summarization)
 * 4. **Gateway services** — app-scoped runtime dependencies started at Gateway startup
 * 5. **HTTP routers** — eager FastAPI HTTP routers mounted at startup
 */

import type { LoadedExtension } from "./types.js";

/** Middleware contribution positions. */
export type MiddlewarePosition =
  | "before_agent"
  | "before_model"
  | "wrap_model_call"
  | "after_model"
  | "after_agent"
  | "before_tool"
  | "after_tool";

/** Middleware contribution from an extension. */
export interface MiddlewareContribution {
  type: "middleware";
  position: MiddlewarePosition;
  /** Middleware class or factory function. */
  middleware: unknown;
  /** Whether this applies to the lead agent (true) or subagents (false). */
  target: "lead" | "subagent" | "both";
}

/** Lifecycle hook contribution from an extension. */
export interface LifecycleContribution {
  type: "lifecycle";
  /** Lifecycle phase. */
  phase:
    | "on_agent_start"
    | "on_agent_end"
    | "on_run_start"
    | "on_run_end"
    | "on_tool_start"
    | "on_tool_end";
  /** Handler function. */
  handler: (context: unknown) => Promise<void> | void;
}

/** Observer contribution for system-model calls. */
export interface ObserverContribution {
  type: "observer";
  /** What to observe. */
  target: "goal" | "memory" | "title" | "summarization";
  /** Observer callback. */
  callback: (context: unknown) => Promise<void> | void;
}

/** Gateway service contribution. */
export interface GatewayServiceContribution {
  type: "service";
  /** Service name (for dependency injection). */
  name: string;
  /** Factory that creates the service. */
  factory: (dependencies: Record<string, unknown>) => Promise<unknown> | unknown;
  /** Service names this depends on. */
  dependencies?: string[];
  /** Called when the service is stopped. */
  onStop?: () => Promise<void> | void;
}

/** HTTP router contribution. */
export interface HttpRouterContribution {
  type: "router";
  /** Router prefix/path. */
  prefix: string;
  /** The router instance (Express/FastAPI-style). */
  router: unknown;
  /** Whether authentication is required (default: true). */
  requiresAuth?: boolean;
}

/** Union of all contribution kinds. */
export type ExtensionContribution =
  | MiddlewareContribution
  | LifecycleContribution
  | ObserverContribution
  | GatewayServiceContribution
  | HttpRouterContribution;

/** Registry of extension contributions, keyed by contribution type. */
export class ContributionRegistry {
  private middlewares: MiddlewareContribution[] = [];
  private lifecycles: LifecycleContribution[] = [];
  private observers: ObserverContribution[] = [];
  private services: GatewayServiceContribution[] = [];
  private routers: HttpRouterContribution[] = [];

  /**
   * Register a contribution from an extension.
   */
  register(contribution: ExtensionContribution, extension: LoadedExtension): void {
    switch (contribution.type) {
      case "middleware":
        this.middlewares.push(contribution);
        console.log(
          `[extensions] Registered middleware from ${extension.manifest.name} at ${contribution.position}`,
        );
        break;
      case "lifecycle":
        this.lifecycles.push(contribution);
        console.log(
          `[extensions] Registered lifecycle hook from ${extension.manifest.name} for ${contribution.phase}`,
        );
        break;
      case "observer":
        this.observers.push(contribution);
        console.log(
          `[extensions] Registered observer from ${extension.manifest.name} for ${contribution.target}`,
        );
        break;
      case "service":
        this.services.push(contribution);
        console.log(
          `[extensions] Registered service from ${extension.manifest.name}: ${contribution.name}`,
        );
        break;
      case "router":
        this.routers.push(contribution);
        console.log(
          `[extensions] Registered HTTP router from ${extension.manifest.name} at ${contribution.prefix}`,
        );
        break;
    }
  }

  /** Get all middleware contributions. */
  getMiddlewares(): MiddlewareContribution[] {
    return [...this.middlewares];
  }

  /** Get middleware contributions for a specific position. */
  getMiddlewaresAt(position: MiddlewarePosition): MiddlewareContribution[] {
    return this.middlewares.filter((m) => m.position === position);
  }

  /** Get all lifecycle contributions. */
  getLifecycles(): LifecycleContribution[] {
    return [...this.lifecycles];
  }

  /** Get lifecycle contributions for a specific phase. */
  getLifecyclesFor(
    phase: LifecycleContribution["phase"],
  ): LifecycleContribution[] {
    return this.lifecycles.filter((l) => l.phase === phase);
  }

  /** Get all observer contributions. */
  getObservers(): ObserverContribution[] {
    return [...this.observers];
  }

  /** Get observer contributions for a specific target. */
  getObserversFor(target: ObserverContribution["target"]): ObserverContribution[] {
    return this.observers.filter((o) => o.target === target);
  }

  /** Get all service contributions. */
  getServices(): GatewayServiceContribution[] {
    return [...this.services];
  }

  /** Get all router contributions. */
  getRouters(): HttpRouterContribution[] {
    return [...this.routers];
  }

  /**
   * Initialize all Gateway services in dependency order.
   * Services are started after Gateway persistence is ready.
   */
  async initServices(dependencies: Record<string, unknown> = {}): Promise<void> {
    for (const service of this.services) {
      try {
        const svc = await service.factory(dependencies);
        dependencies[service.name] = svc;
        console.log(`[extensions] Initialized service: ${service.name}`);
      } catch (err) {
        console.error(
          `[extensions] Failed to initialize service ${service.name}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  /**
   * Stop all Gateway services in reverse order.
   */
  async stopServices(): Promise<void> {
    for (const service of [...this.services].reverse()) {
      if (service.onStop) {
        try {
          await service.onStop();
          console.log(`[extensions] Stopped service: ${service.name}`);
        } catch (err) {
          console.error(
            `[extensions] Error stopping service ${service.name}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }
  }

  /**
   * Clear all contributions (for testing).
   */
  clear(): void {
    this.middlewares = [];
    this.lifecycles = [];
    this.observers = [];
    this.services = [];
    this.routers = [];
  }
}

/** Singleton registry instance. */
let _registry: ContributionRegistry | null = null;

export function getContributionRegistry(): ContributionRegistry {
  if (!_registry) {
    _registry = new ContributionRegistry();
  }
  return _registry;
}

export function resetContributionRegistry(): void {
  _registry = null;
}

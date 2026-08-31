/**
 * Extension system — public contracts for the plugin loader.
 *
 * Mirrors the DeerFlow 2.0 `extensions/` module. Extensions are Python/TS
 * plugins that hook into the agent lifecycle without modifying core code.
 *
 * An extension is a directory containing:
 *   - extension.yaml  (metadata: name, version, description, entrypoint, hooks)
 *   - <entrypoint>    (the main module — .py or .ts)
 *
 * Extensions are discovered from `config.yaml → extensions.paths` and loaded
 * at Gateway startup. Each extension's hooks are registered with the
 * lifecycle middleware.
 */

/** Lifecycle phases an extension can hook into. */
export type ExtensionHookPhase =
  | "pre_model"
  | "post_model"
  | "pre_tool"
  | "post_tool"
  | "on_agent_start"
  | "on_agent_end";

/** Metadata declared in extension.yaml. */
export interface ExtensionManifest {
  /** Unique extension name. */
  name: string;
  /** Semver version. */
  version: string;
  /** Short description. */
  description: string;
  /** Entrypoint module (relative to extension directory). */
  entrypoint: string;
  /** Lifecycle hooks this extension implements. */
  hooks: ExtensionHookPhase[];
  /** Optional: tool names this extension contributes. */
  tools?: string[];
  /** Optional: config schema (JSON Schema) for this extension. */
  configSchema?: Record<string, unknown> | null;
}

/** A loaded extension with its manifest and module reference. */
export interface LoadedExtension {
  manifest: ExtensionManifest;
  /** Absolute path to the extension directory. */
  directory: string;
  /** Whether the extension is currently enabled. */
  enabled: boolean;
}

/** Context passed to extension hooks. */
export interface ExtensionHookContext {
  /** Current thread state snapshot. */
  threadId: string | null;
  /** Current user id. */
  userId: string | null;
  /** Current run id. */
  runId: string | null;
  /** Arbitrary extension-specific config from config.yaml. */
  config: Record<string, unknown>;
}

/** Return value from a hook — may inject messages or mutate state. */
export interface ExtensionHookResult {
  /** Optional: messages to inject into the conversation. */
  injectMessages?: Array<{ role: string; content: string }>;
  /** Optional: whether to abort the current operation. */
  abort?: boolean;
  /** Optional: reason for abort. */
  abortReason?: string;
}

/** The interface an extension entrypoint must export. */
export interface ExtensionModule {
  /** Called once when the extension is loaded. */
  initialize?: (context: ExtensionHookContext) => Promise<void> | void;
  /** Called when the extension is unloaded. */
  dispose?: () => Promise<void> | void;
  /** Lifecycle hook implementations. */
  hooks?: {
    [phase in ExtensionHookPhase]?: (
      context: ExtensionHookContext,
      data: Record<string, unknown>
    ) => Promise<ExtensionHookResult | null> | ExtensionHookResult | null;
  };
}

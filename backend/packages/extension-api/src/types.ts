/**
 * Extension API type definitions — stable contracts for extension authors.
 *
 * This file is the single source of truth for the extension API surface.
 * Both the harness extension loader and third-party extensions import
 * from here.
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
  name: string;
  version: string;
  description: string;
  entrypoint: string;
  hooks: ExtensionHookPhase[];
  tools?: string[];
  configSchema?: Record<string, unknown> | null;
}

/** Context passed to extension hooks. */
export interface ExtensionHookContext {
  threadId: string | null;
  userId: string | null;
  runId: string | null;
  config: Record<string, unknown>;
}

/** Return value from a hook. */
export interface ExtensionHookResult {
  injectMessages?: Array<{ role: string; content: string }>;
  abort?: boolean;
  abortReason?: string;
}

/** The interface an extension entrypoint must export. */
export interface ExtensionModule {
  initialize?: (context: ExtensionHookContext) => Promise<void> | void;
  dispose?: () => Promise<void> | void;
  hooks?: {
    [phase in ExtensionHookPhase]?: (
      context: ExtensionHookContext,
      data: Record<string, unknown>
    ) => Promise<ExtensionHookResult | null> | ExtensionHookResult | null;
  };
}

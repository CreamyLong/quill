/**
 * Single source of truth for the config hot-reload boundary.
 *
 * Mirrors `quill.config.reload_boundary` from the Python backend.
 *
 * The fields listed here are the infrastructure subset that the gateway
 * captures once at startup (engines, singletons, IM clients, the logging
 * handler) and that therefore require a process restart to change at runtime.
 */

/**
 * The standardised prefix every restart-required field description starts with.
 */
export const STARTUP_ONLY_PREFIX = "startup-only:";

/**
 * Restart-required field paths mapped to the human-readable reason.
 *
 * The reason text is what surfaces in the field description, so it must explain
 * what code captures the snapshot so an operator knows which subsystem to
 * restart.
 */
export const STARTUP_ONLY_FIELDS: Record<string, string> = {
  database:
    "init_engine_from_config() runs once during langgraph_runtime() startup; the SQLAlchemy engine holds the connection pool and is not rebuilt on config.yaml edits.",
  checkpointer:
    "make_checkpointer() binds the persistent checkpointer once at startup, including SQLite WAL / busy_timeout settings.",
  run_events:
    "make_run_event_store() picks the memory- vs SQL-backed implementation at startup and is frozen onto app.state.run_events_config to stay paired with the underlying event store.",
  stream_bridge: "make_stream_bridge() constructs the stream-bridge singleton once during startup.",
  sandbox:
    "get_sandbox_provider() caches the provider singleton (``_default_sandbox_provider``); a different ``sandbox.use`` class path only takes effect on next process start.",
  log_level:
    "apply_logging_level() runs only during app.py startup; it sets the quill/app logger levels and may lower root handler thresholds so configured messages can propagate. A freshly reloaded AppConfig does not retrigger it.",
  channels:
    "start_channel_service() is invoked once during startup; the live IM channel clients (Feishu, Slack, Telegram, DingTalk) are not rebuilt when channels.* changes.",
  channel_connections:
    "start_channel_service() wires the connection repository and channel workers once at startup, and the channel-connections router caches the merged provider config on app.state; channel_connections.* edits need a restart.",
};

/** Yield every registered restart-required field path. */
export function iterStartupOnlyFieldPaths(): IterableIterator<string> {
  return Object.keys(STARTUP_ONLY_FIELDS)[Symbol.iterator]();
}

/**
 * Return true when `fieldPath` is registered as restart-required.
 *
 * Accepts only top-level paths ("database", "sandbox" etc.); nested keys like
 * "database.url" are not modelled here because the boundary is per-section.
 */
export function isStartupOnlyField(fieldPath: string): boolean {
  return Object.prototype.hasOwnProperty.call(STARTUP_ONLY_FIELDS, fieldPath);
}

/**
 * Build the standardised description for a registered field.
 *
 * @throws Error when `fieldPath` is not registered — deliberate so a typo
 *   cannot bypass the drift coverage.
 */
export function formatFieldDescription(fieldPath: string, fieldDoc: string | null = null): string {
  if (!isStartupOnlyField(fieldPath)) {
    throw new Error(`KeyError: ${fieldPath}`);
  }
  const reason = STARTUP_ONLY_FIELDS[fieldPath];
  const header = `${STARTUP_ONLY_PREFIX} ${reason}`;
  if (fieldDoc === null) {
    return header;
  }
  return `${header}\n\n${fieldDoc.trim()}`;
}

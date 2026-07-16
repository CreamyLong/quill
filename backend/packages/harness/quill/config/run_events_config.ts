/**
 * Run event storage configuration.
 *
 * Controls where run events (messages + execution traces) are persisted.
 *
 * Backends:
 * - memory: In-memory storage, data lost on restart. Suitable for development.
 * - db: SQL database. Provides full query capability. Suitable for production.
 * - jsonl: Append-only JSONL files. Lightweight single-node persistence.
 */

export type RunEventsBackend = "memory" | "db" | "jsonl";

export interface RunEventsConfig {
  /** Storage backend for run events. */
  backend: RunEventsBackend;
  /** Maximum trace content size in bytes before truncation (db backend only). */
  maxTraceContent: number;
  /** Whether RunJournal should accumulate token counts to RunRow. */
  trackTokenUsage: boolean;
}

export function buildRunEventsConfig(input: Partial<RunEventsConfig> = {}): RunEventsConfig {
  return {
    // Default to jsonl (lightweight append-only persistence) so subagent
    // timeline events survive a restart and the /events endpoint can backfill
    // historical subtask cards. Override with `memory` for ephemeral dev/test
    // via config.yaml `run_events.backend`.
    backend: input.backend ?? "jsonl",
    maxTraceContent: input.maxTraceContent ?? 10240,
    trackTokenUsage: input.trackTokenUsage ?? true,
  };
}

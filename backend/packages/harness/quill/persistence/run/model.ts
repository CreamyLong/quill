/**
 * Table model for run metadata.
 *
 * Ports ``quill.persistence.run.model``. The Python ORM class is represented
 * here as the row data shape plus its ``CREATE TABLE`` DDL. ``token_usage_by_model``
 * carries the ``server_default '{}'`` the ORM declared (added by the
 * ``0002_runs_token_usage`` revision in the Python source).
 */

/** Row shape of the ``runs`` table (JSON columns already parsed). */
export interface RunRow {
  run_id: string;
  thread_id: string;
  assistant_id: string | null;
  user_id: string | null;
  /** "pending" | "running" | "success" | "error" | "timeout" | "interrupted" */
  status: string;
  model_name: string | null;
  multitask_strategy: string;
  metadata_json: Record<string, unknown>;
  kwargs_json: Record<string, unknown>;
  error: string | null;

  // Convenience fields (for listing pages without querying RunEventStore)
  message_count: number;
  first_human_message: string | null;
  last_ai_message: string | null;

  // Token usage (accumulated in-memory by RunJournal, written on run completion)
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  llm_call_count: number;
  lead_agent_tokens: number;
  subagent_tokens: number;
  middleware_tokens: number;
  token_usage_by_model: Record<string, Record<string, number>>;

  // Follow-up association
  follow_up_to_run_id: string | null;

  created_at: string;
  updated_at: string;
}

export const RUNS_TABLE = "runs";

export const RUNS_DDL = `
CREATE TABLE IF NOT EXISTS runs (
  run_id               VARCHAR(64) PRIMARY KEY,
  thread_id            VARCHAR(64) NOT NULL,
  assistant_id         VARCHAR(128),
  user_id              VARCHAR(64),
  status               VARCHAR(20) DEFAULT 'pending',
  model_name           VARCHAR(128),
  multitask_strategy   VARCHAR(20) DEFAULT 'reject',
  metadata_json        JSON DEFAULT '{}',
  kwargs_json          JSON DEFAULT '{}',
  error                TEXT,
  message_count        INTEGER DEFAULT 0,
  first_human_message  TEXT,
  last_ai_message      TEXT,
  total_input_tokens   INTEGER DEFAULT 0,
  total_output_tokens  INTEGER DEFAULT 0,
  total_tokens         INTEGER DEFAULT 0,
  llm_call_count       INTEGER DEFAULT 0,
  lead_agent_tokens    INTEGER DEFAULT 0,
  subagent_tokens      INTEGER DEFAULT 0,
  middleware_tokens    INTEGER DEFAULT 0,
  token_usage_by_model JSON DEFAULT '{}',
  follow_up_to_run_id  VARCHAR(64),
  created_at           DATETIME,
  updated_at           DATETIME
);
CREATE INDEX IF NOT EXISTS ix_runs_thread_id ON runs (thread_id);
CREATE INDEX IF NOT EXISTS ix_runs_user_id ON runs (user_id);
CREATE INDEX IF NOT EXISTS ix_runs_thread_status ON runs (thread_id, status);
`;

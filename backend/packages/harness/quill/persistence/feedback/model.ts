/**
 * Table model for user feedback on runs.
 *
 * Ports ``quill.persistence.feedback.model``. The Python ORM class is
 * represented here as the row data shape plus its ``CREATE TABLE`` DDL.
 */

/** Row shape of the ``feedback`` table. */
export interface FeedbackRow {
  feedback_id: string;
  run_id: string;
  thread_id: string;
  user_id: string | null;
  /**
   * Optional RunEventStore event identifier — allows feedback to target a
   * specific message or the entire run.
   */
  message_id: string | null;
  /** +1 (thumbs-up) or -1 (thumbs-down) */
  rating: number;
  /** Optional text feedback from the user. */
  comment: string | null;
  created_at: string;
}

export const FEEDBACK_TABLE = "feedback";

export const FEEDBACK_DDL = `
CREATE TABLE IF NOT EXISTS feedback (
  feedback_id VARCHAR(64) PRIMARY KEY,
  run_id      VARCHAR(64) NOT NULL,
  thread_id   VARCHAR(64) NOT NULL,
  user_id     VARCHAR(64),
  message_id  VARCHAR(64),
  rating      INTEGER NOT NULL,
  comment     TEXT,
  created_at  DATETIME,
  CONSTRAINT uq_feedback_thread_run_user UNIQUE (thread_id, run_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_feedback_run_id ON feedback (run_id);
CREATE INDEX IF NOT EXISTS ix_feedback_thread_id ON feedback (thread_id);
CREATE INDEX IF NOT EXISTS ix_feedback_user_id ON feedback (user_id);
`;

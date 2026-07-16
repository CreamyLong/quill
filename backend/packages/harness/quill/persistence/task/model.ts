/**
 * Table model for work tasks.
 *
 * A task represents a named work context bound to a local folder. Each task
 * groups multiple conversation threads (dialog sessions). The folder path is the
 * anchor — a task is auto-created from a folder name and can be renamed later.
 */

/** Row shape of the ``tasks`` table. */
export interface TaskRow {
  task_id: string;
  name: string;
  folder_path: string;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export const TASKS_TABLE = "tasks";

export const TASKS_DDL = `
CREATE TABLE IF NOT EXISTS tasks (
  task_id      VARCHAR(64) PRIMARY KEY,
  name         VARCHAR(256) NOT NULL,
  folder_path  VARCHAR(1024) NOT NULL,
  user_id      VARCHAR(64),
  created_at   DATETIME,
  updated_at   DATETIME
);
CREATE INDEX IF NOT EXISTS ix_tasks_user_id ON tasks (user_id);
CREATE INDEX IF NOT EXISTS ix_tasks_folder_path ON tasks (folder_path);
`;

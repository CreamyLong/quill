/**
 * Run status and disconnect mode enums.
 */

export enum RunStatus {
  PENDING = "pending",
  RUNNING = "running",
  SUCCESS = "success",
  ERROR = "error",
  TIMEOUT = "timeout",
  INTERRUPTED = "interrupted",
}

export enum DisconnectMode {
  CANCEL = "cancel",
  CONTINUE = "continue",
}

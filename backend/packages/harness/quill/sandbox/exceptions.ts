/**
 * Sandbox-related exceptions with structured error information.
 *
 * Mirrors `quill.sandbox.exceptions` from the Python backend.
 */

export interface SandboxErrorDetails {
  [key: string]: unknown;
}

export class SandboxError extends Error {
  message: string;
  details: SandboxErrorDetails;

  constructor(message: string, details: SandboxErrorDetails = {}) {
    super(message);
    this.message = message;
    this.details = details;
    this.name = "SandboxError";
  }

  toString(): string {
    const entries = Object.entries(this.details);
    if (entries.length === 0) {
      return this.message;
    }
    const detailStr = entries.map(([k, v]) => `${k}=${String(v)}`).join(", ");
    return `${this.message} (${detailStr})`;
  }
}

export class SandboxNotFoundError extends SandboxError {
  sandboxId: string | null;

  constructor(message = "Sandbox not found", sandboxId: string | null = null) {
    super(message, sandboxId ? { sandbox_id: sandboxId } : {});
    this.sandboxId = sandboxId;
    this.name = "SandboxNotFoundError";
  }
}

export class SandboxRuntimeError extends SandboxError {
  constructor(message: string, details: SandboxErrorDetails = {}) {
    super(message, details);
    this.name = "SandboxRuntimeError";
  }
}

export class SandboxCommandError extends SandboxError {
  command: string | null;
  exitCode: number | null;

  constructor(message: string, command: string | null = null, exitCode: number | null = null) {
    const details: SandboxErrorDetails = {};
    if (command) {
      details.command = command.length > 100 ? `${command.slice(0, 100)}...` : command;
    }
    if (exitCode !== null) {
      details.exit_code = exitCode;
    }
    super(message, details);
    this.command = command;
    this.exitCode = exitCode;
    this.name = "SandboxCommandError";
  }
}

export class SandboxFileError extends SandboxError {
  path: string | null;
  operation: string | null;

  constructor(message: string, path: string | null = null, operation: string | null = null) {
    const details: SandboxErrorDetails = {};
    if (path) {
      details.path = path;
    }
    if (operation) {
      details.operation = operation;
    }
    super(message, details);
    this.path = path;
    this.operation = operation;
    this.name = "SandboxFileError";
  }
}

export class SandboxPermissionError extends SandboxFileError {
  constructor(message: string, path: string | null = null, operation: string | null = null) {
    super(message, path, operation);
    this.name = "SandboxPermissionError";
  }
}

export class SandboxFileNotFoundError extends SandboxFileError {
  constructor(message: string, path: string | null = null, operation: string | null = null) {
    super(message, path, operation);
    this.name = "SandboxFileNotFoundError";
  }
}

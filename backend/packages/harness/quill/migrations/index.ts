/**
 * Migrations — import sessions from other harnesses.
 */

export {
  defaultClaudeProjectsDir,
  migrateClaudeCodeSession,
  parseClaudeCodeSessionFile,
  scanClaudeCodeSessions,
  unmungeProjectDir,
  type ClaudeCodeSessionSummary,
  type CreateThreadFromHistory,
  type ImportedClaudeSession,
  type ImportedMessage,
  type MigrationResult,
} from "./claude_code.js";

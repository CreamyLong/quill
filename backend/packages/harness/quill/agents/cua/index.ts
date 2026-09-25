/**
 * CUA (Computer Use Agent) — desktop automation with fail-closed privacy.
 *
 * Inspired by ZCode's CUA with broker architecture and fail-closed privacy
 * design. This module provides a structured interface for desktop automation
 * actions (file system operations, browser control, terminal execution) with
 * a privacy-first design: sensitive operations require explicit user approval
 * and all actions are logged for audit.
 *
 * @module agents/cua
 */

export { CuaBroker, type CuaBrokerOptions, type CuaAction, type CuaResult } from "./broker.js";
export { PrivacyGuard, type PrivacyRule, type PrivacyLevel } from "./privacy.js";
export { CuaAuditLog, type AuditEntry } from "./audit.js";

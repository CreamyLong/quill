/**
 * Feedback persistence — model and SQL repository.
 *
 * Ports ``quill.persistence.feedback.__init__``.
 */

export { FeedbackRepository } from "./sql.js";
export { FEEDBACK_TABLE, FEEDBACK_DDL } from "./model.js";
export type { FeedbackRow } from "./model.js";

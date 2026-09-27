/**
 * Scheduling package — cron/interval-driven agent runs.
 *
 * Mirrors the scheduled-task capability found in OpenClaw (cron/heartbeat)
 * and OpenWork (automations engine). The scheduler itself is framework-
 * agnostic; the gateway wires `fireRun` to its own run-creation logic.
 */

export type { ScheduleSpec, ScheduledRunStatus, ScheduledTask, ScheduledTaskInput } from "./types.js";
export { parseCronExpression, isCronExpression, nextCronRun, type ParsedCron } from "./cron.js";
export { ScheduledTaskScheduler, computeNextRun, type ScheduledFireResult, type SchedulerOptions, type ScheduledTaskStore } from "./scheduler.js";
export { FileScheduledTaskStore, MemoryScheduledTaskStore } from "./store.js";
export {
  WebhookDeliverySender,
  buildDeliveryPayload,
  deliverRunOutcome,
  formatRunOutcome,
  shouldDeliver,
  type AutomationDeliveryTarget,
  type DeliveryChannel,
  type DeliveryEventType,
  type DeliverySender,
} from "./automation_delivery.js";

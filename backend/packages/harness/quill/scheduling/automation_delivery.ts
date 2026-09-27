/**
 * Automation → IM Delivery — scheduled-run outcomes pushed to messaging
 * platforms.
 *
 * ZCode's automations schema ships a `bot_delivery_target` column that no
 * code ever reads — IM integration upstream happens through plugins and
 * results otherwise land in a session badge. Quill already owns both halves
 * ZCode never connected (scheduled/off-peak tasks + IM channel bridges), so
 * this module implements the promised pipeline for real:
 *
 * A scheduled task declares a `delivery` target (channel kind + webhook /
 * bot endpoint). When a run settles, the harness filters by event type
 * (success / error), formats a compact outcome message, and pushes it to the
 * channel — best-effort, so a delivery failure never breaks the scheduler.
 *
 * Payload formats follow each platform's bot webhook contract:
 * - slack:    incoming webhook `{ "text": "..." }`
 * - feishu:   custom bot webhook `{ "msg_type": "text", "content": { "text": ... } }`
 * - dingtalk: custom bot webhook `{ "msgtype": "text", "text": { "content": ... } }`
 * - telegram: bot API `sendMessage` `{ "chat_id": ..., "text": ..., "parse_mode": "HTML" }`
 * - webhook:  generic JSON `{ "text": ..., "task": ..., "status": ... }`
 *
 * @module scheduling/automation_delivery
 */

import type { ScheduledTask } from "./types.js";
import type { ScheduledFireResult } from "./scheduler.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Events that trigger a delivery (default: both). */
export type DeliveryEventType = "success" | "error";

/** Supported delivery channels. */
export type DeliveryChannel = "slack" | "telegram" | "feishu" | "dingtalk" | "webhook";

/** Where a scheduled run's outcome is delivered. */
export interface AutomationDeliveryTarget {
  /** Channel kind — decides the payload format. */
  channel: DeliveryChannel;
  /**
   * Webhook / bot endpoint URL. For telegram this is the bot API
   * `sendMessage` URL (`https://api.telegram.org/bot<TOKEN>/sendMessage`);
   * for the others, the platform's incoming-webhook URL.
   */
  url: string;
  /** Telegram chat id (ignored by webhook-style channels). */
  chat_id?: string;
  /** Which events deliver. Default: ["success", "error"]. */
  events?: DeliveryEventType[];
}

/** Pluggable sender so tests (and alternative transports) never need HTTP. */
export interface DeliverySender {
  send(target: AutomationDeliveryTarget, text: string): Promise<void>;
}

/** Minimal fetch shape (matches global fetch). */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const STATUS_EMOJI: Record<string, string> = {
  success: "✅",
  error: "❌",
  cancelled: "⛔",
  skipped: "⏭️",
};

/** Max characters of the run summary included in the message. */
const SUMMARY_MAX_CHARS = 600;

/**
 * Format a compact, human-readable outcome message for a scheduled run.
 * Plain text (no markdown) so every IM platform renders it identically.
 */
export function formatRunOutcome(
  task: Pick<ScheduledTask, "name" | "id">,
  result: ScheduledFireResult,
): string {
  const emoji = STATUS_EMOJI[result.status] ?? "ℹ️";
  const lines = [
    `${emoji} Quill automation: ${task.name}`,
    `Status: ${result.status}`,
  ];
  if (result.threadId !== undefined) {
    lines.push(`Thread: ${result.threadId}`);
  }
  if (result.runId !== undefined) {
    lines.push(`Run: ${result.runId}`);
  }
  const summary = result.summary;
  if (summary !== undefined && summary.trim() !== "") {
    const trimmed = summary.length > SUMMARY_MAX_CHARS
      ? `${summary.slice(0, SUMMARY_MAX_CHARS)}…`
      : summary;
    lines.push("", `Summary: ${trimmed}`);
  }
  lines.push("", `Time: ${new Date().toISOString()}`);
  return lines.join("\n");
}

/** Whether a target wants delivery for this run status. */
export function shouldDeliver(
  target: AutomationDeliveryTarget,
  status: string,
): boolean {
  const events = target.events ?? ["success", "error"];
  if (status === "success") {
    return events.includes("success");
  }
  // error / cancelled / skipped are all failure-ish outcomes.
  return events.includes("error");
}

// ---------------------------------------------------------------------------
// Webhook sender
// ---------------------------------------------------------------------------

/**
 * Build the HTTP payload for one channel kind. Exported for tests and for
 * alternative transports that want the same wire format.
 */
export function buildDeliveryPayload(
  target: AutomationDeliveryTarget,
  text: string,
): { body: string } {
  switch (target.channel) {
    case "slack":
      return { body: JSON.stringify({ text }) };
    case "feishu":
      return { body: JSON.stringify({ msg_type: "text", content: { text } }) };
    case "dingtalk":
      return { body: JSON.stringify({ msgtype: "text", text: { content: text } }) };
    case "telegram":
      return {
        body: JSON.stringify({
          chat_id: target.chat_id,
          text,
          disable_web_page_preview: true,
        }),
      };
    case "webhook":
    default:
      return { body: JSON.stringify({ text, channel: target.channel }) };
  }
}

/**
 * Sends outcome messages over HTTP webhooks. `fetchImpl` is injectable
 * (defaults to global fetch) so tests run without network.
 */
export class WebhookDeliverySender implements DeliverySender {
  constructor(
    private readonly fetchImpl: FetchLike = ((url: string, init: never) =>
      fetch(url, init)) as unknown as FetchLike,
  ) {}

  async send(target: AutomationDeliveryTarget, text: string): Promise<void> {
    const { body } = buildDeliveryPayload(target, text);
    const response = await this.fetchImpl(target.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `delivery to ${target.channel} failed: HTTP ${response.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Delivery pipeline
// ---------------------------------------------------------------------------

/**
 * Deliver one scheduled-run outcome. Best-effort: errors are logged and
 * swallowed so a broken webhook never breaks the scheduler loop.
 */
export async function deliverRunOutcome(
  task: Pick<ScheduledTask, "name" | "id">,
  result: ScheduledFireResult,
  target: AutomationDeliveryTarget | undefined,
  sender: DeliverySender,
  logger: (message: string) => void = () => {},
): Promise<boolean> {
  if (target === undefined || target.url === undefined || target.url.trim() === "") {
    return false;
  }
  if (!shouldDeliver(target, result.status)) {
    return false;
  }
  const text = formatRunOutcome(task, result);
  try {
    await sender.send(target, text);
    logger(`[delivery] sent '${task.name}' ${result.status} outcome to ${target.channel}`);
    return true;
  } catch (err) {
    logger(
      `[delivery] failed to send '${task.name}' outcome to ${target.channel}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
}

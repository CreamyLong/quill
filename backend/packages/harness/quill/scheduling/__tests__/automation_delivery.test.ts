/**
 * Tests for automation → IM delivery (ZCode bot_delivery_target, actually
 * implemented). Covers per-channel payload formats, event filtering,
 * best-effort semantics, and scheduler wiring.
 */

import { describe, expect, it } from "vitest";

import {
  WebhookDeliverySender,
  buildDeliveryPayload,
  deliverRunOutcome,
  formatRunOutcome,
  shouldDeliver,
} from "../automation_delivery.js";
import { MemoryScheduledTaskStore, ScheduledTaskScheduler, type ScheduledFireResult } from "../index.js";
import type { ScheduledTask } from "../types.js";

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "t1",
    name: "nightly digest",
    prompt: "summarize today",
    schedule: { kind: "interval", everySeconds: 3600 },
    thread_id: null,
    enabled: true,
    created_at: "2026-09-28T00:00:00Z",
    updated_at: "2026-09-28T00:00:00Z",
    last_run_at: null,
    last_status: null,
    last_run_id: null,
    next_run_at: null,
    run_count: 0,
    ...overrides,
  };
}

describe("formatRunOutcome", () => {
  it("includes emoji, name, status, ids, and summary", () => {
    const text = formatRunOutcome(
      { name: "nightly digest", id: "t1" },
      { status: "success", threadId: "th1", runId: "r1", summary: "3 reports summarized" },
    );
    expect(text).toContain("✅");
    expect(text).toContain("nightly digest");
    expect(text).toContain("Status: success");
    expect(text).toContain("Thread: th1");
    expect(text).toContain("Run: r1");
    expect(text).toContain("Summary: 3 reports summarized");
  });

  it("truncates long summaries", () => {
    const text = formatRunOutcome({ name: "x", id: "t" }, { status: "error", summary: "a".repeat(2000) });
    expect(text.length).toBeLessThan(2000);
    expect(text).toContain("…");
  });
});

describe("shouldDeliver", () => {
  it("delivers success and error by default", () => {
    const target = { channel: "slack" as const, url: "https://hook" };
    expect(shouldDeliver(target, "success")).toBe(true);
    expect(shouldDeliver(target, "error")).toBe(true);
  });

  it("honors the events filter", () => {
    const target = { channel: "slack" as const, url: "https://hook", events: ["error"] as const };
    expect(shouldDeliver(target, "success")).toBe(false);
    expect(shouldDeliver(target, "error")).toBe(true);
  });
});

describe("buildDeliveryPayload", () => {
  it("formats slack incoming webhooks", () => {
    expect(JSON.parse(buildDeliveryPayload({ channel: "slack", url: "u" }, "hi").body)).toEqual({ text: "hi" });
  });

  it("formats feishu custom bots", () => {
    expect(JSON.parse(buildDeliveryPayload({ channel: "feishu", url: "u" }, "hi").body)).toEqual({
      msg_type: "text",
      content: { text: "hi" },
    });
  });

  it("formats dingtalk custom bots", () => {
    expect(JSON.parse(buildDeliveryPayload({ channel: "dingtalk", url: "u" }, "hi").body)).toEqual({
      msgtype: "text",
      text: { content: "hi" },
    });
  });

  it("formats telegram sendMessage with chat_id", () => {
    expect(
      JSON.parse(buildDeliveryPayload({ channel: "telegram", url: "u", chat_id: "42" }, "hi").body),
    ).toEqual({ chat_id: "42", text: "hi", disable_web_page_preview: true });
  });

  it("formats generic webhooks", () => {
    expect(JSON.parse(buildDeliveryPayload({ channel: "webhook", url: "u" }, "hi").body)).toEqual({
      text: "hi",
      channel: "webhook",
    });
  });
});

describe("WebhookDeliverySender", () => {
  it("posts the payload as JSON and surfaces HTTP failures", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const sender = new WebhookDeliverySender(async (url, init) => {
      calls.push({ url, body: init.body });
      return { ok: true, status: 200, text: async () => "ok" };
    });
    await sender.send({ channel: "slack", url: "https://hooks.slack" }, "hello");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://hooks.slack");
    expect(JSON.parse(calls[0].body)).toEqual({ text: "hello" });

    const failing = new WebhookDeliverySender(async () => ({
      ok: false,
      status: 500,
      text: async () => "boom",
    }));
    await expect(
      failing.send({ channel: "slack", url: "https://hooks.slack" }, "hello"),
    ).rejects.toThrow("HTTP 500");
  });
});

describe("deliverRunOutcome", () => {
  it("is best-effort: sender failures resolve false instead of throwing", async () => {
    const logs: string[] = [];
    const delivered = await deliverRunOutcome(
      { name: "x", id: "t" },
      { status: "success" },
      { channel: "slack", url: "https://hook" },
      {
        send: async () => {
          throw new Error("network down");
        },
      },
      (m) => logs.push(m),
    );
    expect(delivered).toBe(false);
    expect(logs.some((l) => l.includes("failed to send"))).toBe(true);
  });

  it("skips delivery when no target or when the event is filtered out", async () => {
    let sends = 0;
    const sender = { send: async () => { sends += 1; } };
    expect(
      await deliverRunOutcome({ name: "x", id: "t" }, { status: "success" }, undefined, sender),
    ).toBe(false);
    expect(
      await deliverRunOutcome(
        { name: "x", id: "t" },
        { status: "success" },
        { channel: "slack", url: "u", events: ["error"] },
        sender,
      ),
    ).toBe(false);
    expect(sends).toBe(0);
  });
});

describe("scheduler wiring", () => {
  it("delivers the settled outcome when the task declares a target", async () => {
    const store = new MemoryScheduledTaskStore();
    const delivered: Array<{ text: string; target: string }> = [];
    const withDelivery = task({
      next_run_at: "2026-09-28T00:00:00Z",
      delivery: { channel: "feishu", url: "https://open.feishu.cn/hook/x" },
    });
    store.save(withDelivery);

    const scheduler = new ScheduledTaskScheduler({
      store,
      fireRun: async (): Promise<ScheduledFireResult> => ({
        status: "success",
        threadId: "th1",
        summary: "done",
      }),
      now: () => new Date("2026-09-28T00:01:00Z"),
      deliverySender: {
        send: async (target, text) => {
          delivered.push({ text, target: target.url });
        },
      },
    });
    await scheduler.tick();

    expect(delivered).toHaveLength(1);
    expect(delivered[0].target).toBe("https://open.feishu.cn/hook/x");
    expect(delivered[0].text).toContain("nightly digest");
    expect(delivered[0].text).toContain("Status: success");
  });

  it("does not deliver when no sender is wired or the task has no target", async () => {
    const store = new MemoryScheduledTaskStore();
    store.save(task({ next_run_at: "2026-09-28T00:00:00Z" }));
    const scheduler = new ScheduledTaskScheduler({
      store,
      fireRun: async () => ({ status: "success" }),
      now: () => new Date("2026-09-28T00:01:00Z"),
    });
    await scheduler.tick(); // no deliverySender: must not throw
    expect(store.get("t1")?.last_status).toBe("success");
  });
});

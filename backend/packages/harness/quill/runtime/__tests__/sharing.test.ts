/**
 * Tests for conversation sharing (ZCode sync).
 *
 * Covers sanitization (system messages dropped, secrets redacted, tool
 * internals stripped, length caps), projection integrity hashes, the
 * file-backed store (create/get/revoke, access modes), and import.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ConversationShareStore,
  buildShareProjection,
  importSharedConversation,
  newShareId,
  redactSecrets,
  sanitizeForShare,
  verifyShareProjection,
} from "../sharing.js";

const tempDirs: string[] = [];
function makeStore(): ConversationShareStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quill-shares-"));
  tempDirs.push(dir);
  return new ConversationShareStore(dir);
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("redactSecrets", () => {
  it("redacts common token shapes", () => {
    const text = [
      "key sk-abcdefghijklmnopqrstuvwx",
      "gh ghp_abcdefghijklmnopqrstuvwxyz",
      "slack xoxb-1234567890abcdefgh",
      "aws AKIAIOSFODNN7EXAMPLE",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
      "api_key = supersecretvalue123",
    ].join("\n");
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain("sk-abcdefghijklmnopqrstuvwx");
    expect(redacted).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    expect(redacted).not.toContain("xoxb-1234567890abcdefgh");
    expect(redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(redacted).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(redacted).not.toContain("supersecretvalue123");
    expect(redacted).toContain("[REDACTED]");
  });

  it("leaves ordinary text untouched", () => {
    expect(redactSecrets("the model returned 42 tokens for the user")).toBe(
      "the model returned 42 tokens for the user",
    );
  });
});

describe("sanitizeForShare", () => {
  it("keeps user/assistant text and drops system + tool messages", () => {
    const rows = sanitizeForShare([
      { role: "system", content: "You are Quill" },
      { role: "user", content: "hello" },
      { role: "assistant", content: [{ type: "text", text: "hi there" }] },
      { role: "tool", content: "raw tool output" },
      { role: "user", content: "sk-abcdefghijklmnopqrstuvwx please" },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant", "user"]);
    expect(rows[1].content).toBe("hi there");
    expect(rows[2].content).toContain("[REDACTED]");
  });

  it("caps row content length", () => {
    const rows = sanitizeForShare([{ role: "user", content: "x".repeat(20000) }]);
    expect(rows[0].content.length).toBeLessThanOrEqual(8001);
  });
});

describe("buildShareProjection + verifyShareProjection", () => {
  it("builds a projection with a verifiable integrity hash", () => {
    const projection = buildShareProjection({
      id: "s1",
      title: "  Debug session  ",
      accessMode: "link_viewer",
      messages: [
        { role: "user", content: "fix it" },
        { role: "assistant", content: "fixed" },
      ],
    });
    expect(projection.schema_version).toBe(1);
    expect(projection.share.title).toBe("Debug session");
    expect(projection.share.message_count).toBe(2);
    expect(verifyShareProjection(projection)).toBe(true);
  });

  it("detects tampered rows via the integrity hash", () => {
    const projection = buildShareProjection({
      id: "s1",
      title: "t",
      accessMode: "link_viewer",
      messages: [{ role: "user", content: "original" }],
    });
    const tampered = {
      ...projection,
      rows: [{ ...projection.rows[0], content: "tampered" }],
    };
    expect(verifyShareProjection(tampered)).toBe(false);
  });
});

describe("ConversationShareStore", () => {
  it("creates, lists, and serves viewer projections", () => {
    const store = makeStore();
    const projection = buildShareProjection({
      id: newShareId(),
      title: "t",
      accessMode: "link_viewer",
      messages: [{ role: "user", content: "hi" }],
    });
    store.create(projection, "thread-1");

    expect(store.list().map((p) => p.share.id)).toEqual([projection.share.id]);
    expect(store.getForViewer(projection.share.id)?.share.title).toBe("t");
    expect(store.getRecord(projection.share.id)?.sourceThreadId).toBe("thread-1");
  });

  it("hides private shares from viewers", () => {
    const store = makeStore();
    const projection = buildShareProjection({
      id: newShareId(),
      title: "t",
      accessMode: "private",
      messages: [{ role: "user", content: "hi" }],
    });
    store.create(projection, "thread-1");
    expect(store.getForViewer(projection.share.id)).toBeNull();
    expect(store.getForImport(projection.share.id)).toBeNull();
  });

  it("serves link_editor shares for import but not link_viewer", () => {
    const store = makeStore();
    const editable = buildShareProjection({
      id: newShareId(),
      title: "t",
      accessMode: "link_editor",
      messages: [{ role: "user", content: "hi" }],
    });
    const viewOnly = buildShareProjection({
      id: newShareId(),
      title: "t",
      accessMode: "link_viewer",
      messages: [{ role: "user", content: "hi" }],
    });
    store.create(editable, "thread-1");
    store.create(viewOnly, "thread-2");

    expect(store.getForImport(editable.share.id)).not.toBeNull();
    expect(store.getForImport(viewOnly.share.id)).toBeNull();
  });

  it("revoked shares disappear for viewers", () => {
    const store = makeStore();
    const projection = buildShareProjection({
      id: newShareId(),
      title: "t",
      accessMode: "link_viewer",
      messages: [{ role: "user", content: "hi" }],
    });
    store.create(projection, "thread-1");
    expect(store.revoke(projection.share.id)).toBe(true);
    expect(store.getForViewer(projection.share.id)).toBeNull();
    expect(store.revoke(projection.share.id)).toBe(true); // idempotent
    expect(store.revoke("nope")).toBe(false);
  });

  it("rejects path-shaped share ids", () => {
    const store = makeStore();
    expect(() => store.getRecord("../../etc/passwd")).toThrow("invalid share id");
  });
});

describe("importSharedConversation", () => {
  it("creates a thread from the shared rows", async () => {
    const projection = buildShareProjection({
      id: "share-1",
      title: "Great session",
      accessMode: "link_editor",
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", content: "a" },
      ],
    });
    const result = await importSharedConversation(projection, async (input) => {
      expect(input.name).toBe("Great session");
      expect(input.importedFromShareId).toBe("share-1");
      expect(input.messages).toHaveLength(2);
      return { threadId: "new-thread" };
    });
    expect(result).toEqual({ threadId: "new-thread", messageCount: 2 });
  });
});

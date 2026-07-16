import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { JsonlRunEventStore } from "../store/jsonl.ts";

describe("JsonlRunEventStore.listEvents filters", () => {
  let baseDir: string;
  let store: JsonlRunEventStore;

  beforeAll(() => {
    baseDir = mkdtempSync(path.join(os.tmpdir(), "quill-events-"));
    store = new JsonlRunEventStore(`${baseDir}/.scitops`);
  });

  afterAll(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  beforeAll(async () => {
    for (let i = 0; i < 5; i++) {
      await store.put({
        thread_id: "t1",
        run_id: "r1",
        event_type: "subagent.step",
        category: "subagent",
        content: `s${i}`,
        metadata: { task_id: "k1", message_index: i + 1 },
      });
    }
    await store.put({
      thread_id: "t1",
      run_id: "r1",
      event_type: "subagent.start",
      category: "subagent",
      content: "start",
      metadata: { task_id: "k1" },
    });
  });

  it("filters by task_id across the run-wide events", async () => {
    const k1 = await store.listEvents("t1", "r1", { task_id: "k1" });
    expect(k1).toHaveLength(6);
    const none = await store.listEvents("t1", "r1", { task_id: "no-such" });
    expect(none).toHaveLength(0);
  });

  it("forward-paginates with after_seq", async () => {
    const first2 = await store.listEvents("t1", "r1", { limit: 2 });
    const after = await store.listEvents("t1", "r1", { after_seq: first2[1]!.seq });
    expect(after.map((e) => e.content)).toEqual(["s2", "s3", "s4", "start"]);
  });
});

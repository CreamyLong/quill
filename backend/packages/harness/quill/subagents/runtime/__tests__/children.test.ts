import { describe, expect, it } from "vitest";

import {
  cancelChildren,
  childrenOf,
  deregisterChild,
  hasChildren,
  registerChild,
  size,
} from "../children.ts";

describe("active-child registry", () => {
  it("registers a child under its parent run", () => {
    // Use a unique parent id — the registry is module-level across tests.
    registerChild("iso-run-1", "child-a");
    expect(childrenOf("iso-run-1")).toEqual(["child-a"]);
    expect(hasChildren("iso-run-1")).toBe(true);
    cancelChildren("iso-run-1");
  });

  it("is idempotent for the same child", () => {
    registerChild("iso-run-2", "child-b");
    registerChild("iso-run-2", "child-b");
    expect(childrenOf("iso-run-2")).toEqual(["child-b"]);
    cancelChildren("iso-run-2");
  });

  it("deregister removes the child; cleans up the parent when empty", () => {
    registerChild("run-2", "c1");
    registerChild("run-2", "c2");
    deregisterChild("run-2", "c1");
    expect(childrenOf("run-2")).toEqual(["c2"]);
    deregisterChild("run-2", "c2");
    expect(hasChildren("run-2")).toBe(false);
  });

  it("cancelChildren requests cancel for each child and clears the set", () => {
    registerChild("run-3", "k1");
    registerChild("run-3", "k2");
    // cancelChildren is cooperative: it calls requestCancelBackgroundTask
    // for each id (a no-op if the id is absent) and clears the registration.
    const n = cancelChildren("run-3");
    expect(n).toBe(2);
    expect(childrenOf("run-3")).toEqual([]);
  });

  it("cancelChildren is a no-op for an unknown parent", () => {
    expect(cancelChildren("no-such-run")).toBe(0);
  });

  it("size() reflects the number of parents with live children", () => {
    registerChild("ra", "x");
    registerChild("rb", "y");
    expect(size()).toBeGreaterThanOrEqual(2);
    // cleanup
    cancelChildren("ra");
    cancelChildren("rb");
  });
});

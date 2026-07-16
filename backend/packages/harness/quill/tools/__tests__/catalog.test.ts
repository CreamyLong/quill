import { describe, expect, it } from "vitest";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import {
  RuntimeToolCatalog,
  ToolPolicy,
  assembleForSubagent,
  buildToolPolicy,
  catalogTools,
  setGlobalCatalog,
  getGlobalCatalog,
} from "../catalog.ts";

/** Make a throwaway tool with a given name (and optional description). */
function makeTool(name: string, description = `${name} tool`) {
  return tool(async () => `${name} ok`, {
    name,
    description,
    schema: z.object({}),
  });
}

describe("RuntimeToolCatalog", () => {
  it("records each tool's group and dedupes with first-write-wins", () => {
    const catalog = new RuntimeToolCatalog();
    catalog.add(makeTool("bash"), "sandbox");
    catalog.add(makeTool("bash"), "meta"); // duplicate name — ignored
    expect(catalog.size).toBe(1);
    expect(catalog.byName.get("bash")?.group).toBe("sandbox");
  });

  it("filters by group via forGroups (null = all)", () => {
    const catalog = new RuntimeToolCatalog();
    catalog.addAll([makeTool("bash"), makeTool("read_file")], "sandbox");
    catalog.addAll([makeTool("web_search")], "web");
    catalog.addAll([makeTool("tool_search")], "meta");

    expect(catalog.forGroups(null).map((c) => c.tool.name).sort()).toEqual([
      "bash",
      "read_file",
      "tool_search",
      "web_search",
    ]);
    expect(catalog.forGroups(["sandbox"]).map((c) => c.tool.name).sort()).toEqual([
      "bash",
      "read_file",
    ]);
    expect(catalog.forGroups(["mcp"]).map((c) => c.tool.name)).toEqual([]);
  });

  it("global catalog singleton: setGlobalCatalog / getGlobalCatalog", () => {
    const catalog = new RuntimeToolCatalog();
    catalog.add(makeTool("bash"), "sandbox");
    setGlobalCatalog(catalog);
    expect(getGlobalCatalog()).toBe(catalog);
    setGlobalCatalog(null);
    expect(getGlobalCatalog()).toBeNull();
  });
});

describe("ToolPolicy (four-layer convergence)", () => {
  const policy = () => {
    // Layer-0 catalog: 2 sandbox, 1 web, 1 mcp, 1 meta ("task"-like)
    const cataloged = [
      { tool: makeTool("bash"), group: "sandbox" as const },
      { tool: makeTool("read_file"), group: "sandbox" as const },
      { tool: makeTool("web_search"), group: "web" as const },
      { tool: makeTool("sciverse"), group: "mcp" as const },
      { tool: makeTool("task"), group: "meta" as const },
    ];
    return new ToolPolicy(cataloged, null, null, null);
  };

  it("strips task even when nothing else would (recursion guard)", () => {
    const resolved = policy().resolve(null);
    expect(resolved.map((c) => c.tool.name)).not.toContain("task");
  });

  it("layers parent group intersection first", () => {
    const cataloged = [
      { tool: makeTool("bash"), group: "sandbox" as const },
      { tool: makeTool("web_search"), group: "web" as const },
      { tool: makeTool("sciverse"), group: "mcp" as const },
    ];
    // Parent only authorised for sandbox + mcp.
    const p = new ToolPolicy(cataloged, ["sandbox", "mcp"], null, null);
    expect(p.resolve(null).map((c) => c.tool.name).sort()).toEqual(["bash", "sciverse"]);
  });

  it("applies subagent allowlist (layer 1) after groups (layer 0)", () => {
    const cataloged = [
      { tool: makeTool("bash"), group: "sandbox" as const },
      { tool: makeTool("read_file"), group: "sandbox" as const },
      { tool: makeTool("web_search"), group: "web" as const },
    ];
    // Allow only read_file + web_search — bash is dropped despite being in an
    // authorised group.
    const p = new ToolPolicy(cataloged, null, ["read_file", "web_search"], null);
    expect(p.resolve(null).map((c) => c.tool.name).sort()).toEqual([
      "read_file",
      "web_search",
    ]);
  });

  it("applies denylist (layer 2) and never lets task survive", () => {
    const cataloged = [
      { tool: makeTool("bash"), group: "sandbox" as const },
      { tool: makeTool("read_file"), group: "sandbox" as const },
      { tool: makeTool("task"), group: "meta" as const },
    ];
    const p = new ToolPolicy(cataloged, null, null, ["bash"]);
    expect(p.resolve(null).map((c) => c.tool.name)).toEqual(["read_file"]);
  });

  it("applies skill allowed_tools (layer 3 — legacy allow-all when no skill declares)", () => {
    // skills [] => no restriction => all (non-task) survive
    const resolved = policy().resolve(null);
    expect(resolved.map((c) => c.tool.name)).not.toContain("task");
    expect(resolved.length).toBe(4);
  });

  it("applies skill allowed_tools (layer 3 — explicit restriction)", () => {
    const cataloged = [
      { tool: makeTool("bash"), group: "sandbox" as const },
      { tool: makeTool("read_file"), group: "sandbox" as const },
      { tool: makeTool("web_search"), group: "web" as const },
    ];
    const p = new ToolPolicy(cataloged, null, null, null);
    // Skill allowed only web_search — bash + read_file are dropped even though
    // they survived the group/allow/deny layers.
    const skillAllowed = new Set(["web_search"]);
    expect(p.resolve(skillAllowed).map((c) => c.tool.name)).toEqual(["web_search"]);
  });

  it("full four-layer converge: groups → allow → deny → skill", () => {
    const cataloged = [
      { tool: makeTool("bash"), group: "sandbox" as const },
      { tool: makeTool("read_file"), group: "sandbox" as const },
      { tool: makeTool("write_file"), group: "sandbox" as const },
      { tool: makeTool("web_search"), group: "web" as const },
      { tool: makeTool("task"), group: "meta" as const },
      { tool: makeTool("sciverse"), group: "mcp" as const },
    ];
    // L0 parent groups: sandbox + web (NOT mcp)
    // L1 allowlist: bash, read_file, write_file, web_search (narrows sandbox)
    // L2 denylist: write_file
    // L3 skill allowed_tools: bash, read_file (narrows further)
    const p = new ToolPolicy(
      cataloged,
      ["sandbox", "web"],
      ["bash", "read_file", "write_file", "web_search"],
      ["write_file"],
    );
    const skillAllowed = new Set(["bash", "read_file"]);
    expect(p.resolve(skillAllowed).map((c) => c.tool.name).sort()).toEqual([
      "bash",
      "read_file",
    ]);
  });
});

describe("assembleForSubagent", () => {
  it("when no catalog, falls back to plain-array allow/deny (backward-compat)", () => {
    const tools = [makeTool("bash"), makeTool("read_file"), makeTool("web_search")];
    const out = assembleForSubagent(null, {
      tools,
      configAllowlist: ["bash", "read_file"],
      configDenylist: ["read_file"],
      parentGroups: null,
    });
    expect(out.map((t) => t.name)).toEqual(["bash"]);
  });

  it("when catalog provided, task is removed from the subagent's list", () => {
    const catalog = new RuntimeToolCatalog();
    catalog.addAll([makeTool("bash"), makeTool("read_file")], "sandbox");
    catalog.add(makeTool("task"), "meta");

    const out = assembleForSubagent(catalog, {
      tools: catalog.tools(),
      configAllowlist: null,
      configDenylist: null,
      parentGroups: null,
    });
    expect(out.map((t) => t.name)).not.toContain("task");
    expect(out.map((t) => t.name).sort()).toEqual(["bash", "read_file"]);
  });

  it("parentGroups=null inherits every group in the catalog", () => {
    const catalog = new RuntimeToolCatalog();
    catalog.addAll([makeTool("bash")], "sandbox");
    catalog.addAll([makeTool("web_search")], "web");
    const out = assembleForSubagent(catalog, {
      tools: catalog.tools(),
      configAllowlist: null,
      configDenylist: null,
      parentGroups: null,
    });
    expect(out.map((t) => t.name).sort()).toEqual(["bash", "web_search"]);
  });
});

describe("catalogTools", () => {
  it("tags unknown tools with the fallback group", () => {
    const tagged = catalogTools([makeTool("foo")], null, "subagent");
    expect(tagged[0]!.group).toBe("subagent");
  });

  it("keeps the catalog group for known tools", () => {
    const catalog = new RuntimeToolCatalog();
    catalog.add(makeTool("bash"), "sandbox");
    const tagged = catalogTools([makeTool("bash"), makeTool("x")], catalog, "subagent");
    expect(tagged[0]!.group).toBe("sandbox");
    expect(tagged[1]!.group).toBe("subagent");
  });
});

describe("buildToolPolicy", () => {
  it("prefers the catalog over a plain tool array when both are given", () => {
    const catalog = new RuntimeToolCatalog();
    catalog.addAll([makeTool("bash"), makeTool("read_file")], "sandbox");
    // An extra tool passed in `tools` that is NOT in the catalog must be
    // ignored — the catalog is the source of truth.
    const extra = makeTool("rogue");
    const p = buildToolPolicy([extra], catalog, "subagent", null, null, null);
    const names = p.resolve(null).map((c) => c.tool.name);
    expect(names).not.toContain("rogue");
    expect(names.sort()).toEqual(["bash", "read_file"]);
  });
});

/**
 * Runtime tool catalog: a group-keyed registry shared between the lead agent
 * and subagent assembly.
 *
 * Mirrors the parent→child tool-permission inheritance model from the Python
 * backend (`quill.subagents.tool_policy`): rather than passing subagents a
 * hardcoded static tool array, both `getAvailableTools()` and the subagent
 * executor draw from one catalog that records each tool's group, and a
 * {@link ToolPolicy} converges the four allowed layers into the final set.
 *
 * The four layers, applied in order by `ToolPolicy.resolve()`:
 *   0. parent `tool_groups` intersection — inherit only the groups the lead
 *      agent was authorised for;
 *   1. subagent `tools` allowlist (`SubagentConfig.tools`);
 *   2. `disallowed_tools` denylist (`SubagentConfig.disallowedTools`);
 *   3. loaded skills' `allowed_tools` (`allowedToolNamesForSkills`);
 * and `task` is always removed to prevent recursive delegation.
 */

import type { StructuredToolInterface } from "@langchain/core/tools";

import { allowedToolNamesForSkills } from "../skills/tool_policy.js";
import type { Skill } from "../skills/types.js";

export type ToolGroup =
  | "builtin"
  | "meta"
  | "mcp"
  | "web"
  | "sandbox"
  | "media"
  | string;

export interface CatalogedTool {
  tool: StructuredToolInterface;
  group: ToolGroup;
}

/**
 * Group-keyed tool registry. Built once at launcher startup from the lead
 * agent's full tool set (MCP / web / sandbox / media / meta) and then re-used
 * for subagent assembly so lead + subagents never drift.
 */
export class RuntimeToolCatalog {
  readonly byName = new Map<string, CatalogedTool>();

  add(tool: StructuredToolInterface, group: ToolGroup): void {
    if (this.byName.has(tool.name)) {
      // First write wins (mirrors Python dedupe); later duplicate groups are
      // silently ignored so a tool tagged at multiple sites keeps its primary
      // group assignment.
      return;
    }
    this.byName.set(tool.name, { tool, group });
  }

  addAll(tools: StructuredToolInterface[], group: ToolGroup): void {
    for (const tool of tools) {
      this.add(tool, group);
    }
  }

  /**
   * Tools whose group is in `groups`, in insertion order. When `groups` is
   * null/empty the lead authorised for all groups, so every tool is returned.
   */
  forGroups(groups: readonly string[] | null): CatalogedTool[] {
    const all = [...this.byName.values()];
    if (groups === null || groups === undefined || groups.length === 0) {
      return all;
    }
    const set = new Set(groups);
    return all.filter((ct) => set.has(ct.group));
  }

  get size(): number {
    return this.byName.size;
  }

  names(): string[] {
    return [...this.byName.keys()];
  }

  /** All cataloged tools, in insertion order. */
  tools(): StructuredToolInterface[] {
    return [...this.byName.values()].map((ct) => ct.tool);
  }

  /** CatalogedTool entries for the given groups (or all when null). */
  entries(groups: readonly string[] | null): CatalogedTool[] {
    return this.forGroups(groups);
  }
}

/**
 * Converge the four allowed layers into a subagent's final tool list.
 *
 * Construct with the parent's catalog (or null for the backward-compat path
 * where the caller still passes a plain tool array), then call `resolve()` with
 * the loaded skills' allowed-tools set.
 */
export class ToolPolicy {
  constructor(
    private readonly cataloged: CatalogedTool[],
    private readonly parentGroups: readonly string[] | null,
    private readonly allow: readonly string[] | null,
    private readonly deny: readonly string[] | null,
  ) {}

  /**
   * Apply layers 0–3 and return the surviving tools.
   *
   * @param skillAllowed  union of loaded skills' `allowed_tools`, or `null`
   *   when skills impose no explicit restriction (legacy allow-all).
   */
  resolve(skillAllowed: ReadonlySet<string> | null): CatalogedTool[] {
    let out = this.cataloged;

    // Layer 0 — parent tool_groups intersection.
    if (this.parentGroups !== null && this.parentGroups.length > 0) {
      const pg = new Set(this.parentGroups);
      out = out.filter((c) => pg.has(c.group));
    }

    // Layer 1 — subagent allowlist.
    if (this.allow !== null) {
      const a = new Set(this.allow);
      out = out.filter((c) => a.has(c.tool.name));
    }

    // Hard guard — never let a subagent spawn subagents (prevents recursion
    // even if a config's disallowed_tools is overridden without "task").
    out = out.filter((c) => c.tool.name !== "task");

    // Layer 2 — subagent denylist.
    if (this.deny !== null) {
      const d = new Set(this.deny);
      out = out.filter((c) => !d.has(c.tool.name));
    }

    // Layer 3 — loaded skills' allowed_tools.
    if (skillAllowed !== null) {
      out = out.filter((c) => skillAllowed.has(c.tool.name));
    }

    return out;
  }
}

/**
 * Tag a plain tool array with group metadata, using the catalog when present
 * so tools keep the group they were registered under.
 */
export function catalogTools(
  tools: StructuredToolInterface[],
  catalog: RuntimeToolCatalog | null,
  fallbackGroup: ToolGroup,
): CatalogedTool[] {
  return tools.map((tool) => {
    const existing = catalog?.byName.get(tool.name);
    return existing ?? { tool, group: fallbackGroup };
  });
}

/**
 * Build a {@link ToolPolicy}. When `catalog` is provided the subagent's base
 * tools are sourced FROM the catalog (intersected by `parentGroups`), so pass
 * an empty array as `tools`. When `catalog` is null the explicit `tools`
 * array is used directly (backward-compat for callers/tests that have not yet
 * adopted the catalog).
 */
export function buildToolPolicy(
  tools: StructuredToolInterface[],
  catalog: RuntimeToolCatalog | null,
  fallbackGroup: ToolGroup,
  parentGroups: readonly string[] | null,
  allow: readonly string[] | null,
  deny: readonly string[] | null,
): ToolPolicy {
  if (catalog !== null && catalog.size > 0) {
    // Sourced from the shared catalog; Layer 0 (`parentGroups`) may further
    // narrow which groups the subagent inherits.
    const cataloged =
      parentGroups === null
        ? [...catalog.byName.values()]
        : catalog.forGroups(parentGroups);
    return new ToolPolicy(cataloged, null, allow, deny);
  }
  const cataloged = catalogTools(tools, null, fallbackGroup);
  return new ToolPolicy(cataloged, null, allow, deny);
}

// ---------------------------------------------------------------------------
// Singleton bridge to getAvailableTools().
//
// The launcher builds a catalog at startup and publishes it here; when set,
// `getAvailableTools()` reads from the catalog instead of the dependency-free
// built-in stub. Keeps the catalog as the single source of truth without
// forcing a global DI container.
// ---------------------------------------------------------------------------

let _globalCatalog: RuntimeToolCatalog | null = null;

/** Publish the launcher-built catalog for `getAvailableTools()`. */
export function setGlobalCatalog(catalog: RuntimeToolCatalog | null): void {
  _globalCatalog = catalog;
}

/** Read the launcher-built catalog (or null when not published). */
export function getGlobalCatalog(): RuntimeToolCatalog | null {
  return _globalCatalog;
}

/**
 * Convenience: build a subagent's final tool list from a catalog + config +
 * loaded skills, applying all four layers plus skill allowed_tools.
 *
 * Used by {@link SubagentExecutor} and exposed for tests / custom assembly.
 */
export function assembleForSubagent(
  catalog: RuntimeToolCatalog | null,
  options: {
    tools: StructuredToolInterface[];
    configAllowlist: readonly string[] | null;
    configDenylist: readonly string[] | null;
    parentGroups: readonly string[] | null;
    fallbackGroup?: ToolGroup;
    skills?: Skill[] | null;
  },
): StructuredToolInterface[] {
  const {
    tools,
    configAllowlist,
    configDenylist,
    parentGroups,
    fallbackGroup = "subagent",
    skills = null,
  } = options;

  const policy = buildToolPolicy(
    tools,
    catalog,
    fallbackGroup,
    parentGroups,
    configAllowlist,
    configDenylist,
  );

  const skillAllowed = skills !== null ? allowedToolNamesForSkills(skills) : null;
  return policy.resolve(skillAllowed).map((c) => c.tool);
}

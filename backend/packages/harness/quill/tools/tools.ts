/**
 * Tool registry and loader.
 *
 * Mirrors `quill.tools.tools` from the Python backend. The Python
 * `get_available_tools` resolves tool classes from config entries via
 * `resolve_variable` (dynamic import by dotted path), loads cached MCP
 * tools, builds the ACP invoke tool, and deduplicates by name.
 *
 * Tool loading in this runtime flows through the shared
 * {@link RuntimeToolCatalog} (`./catalog.ts`): the launcher builds one
 * catalog at startup (from the lead agent's full tool set — MCP, web,
 * sandbox, media, meta) and publishes it via {@link setGlobalCatalog}.
 * `getAvailableTools()` reads from that catalog when present, so both the
 * lead agent and subagent assembly draw from the *same* group-keyed source of
 * truth. When no catalog has been published yet (e.g. unit tests), the
 * original dependency-free built-in fallback is used.
 *
 * Full loader porting status
 * -------------------------
 * `resolve_variable` (dynamic class resolution from `config.tools[].use`),
 * the MCP tool cache (`quill.mcp.cache.get_cached_mcp_tools`), the ACP tool
 * builder (`build_invoke_acp_agent_tool`), and the host-bash security filter
 * (`is_host_bash_allowed`) are not yet ported from Python, so this module does
 * not reconstruct them — the launcher is responsible for resolving + deduping
 * the real tool set before putting it in the catalog.
 */

import type { StructuredToolInterface } from "@langchain/core/tools";

import type { AppConfig } from "../config/app_config.js";
import { getAppConfig } from "../config/app_config.js";
import { createAskClarificationTool } from "./builtins/clarification_tool.js";
import { createPresentFilesTool } from "./builtins/present_file_tool.js";
import {
  getGlobalCatalog,
  type RuntimeToolCatalog,
} from "./catalog.js";

export interface GetAvailableToolsOptions {
  /** Optional list of tool group names to filter by (mirrors Python `groups`). */
  groups?: string[] | null;
  /** Whether to include MCP tools (mirrors Python `include_mcp`). */
  includeMcp?: boolean;
  /** Resolved runtime model name; gates vision-only tools. */
  modelName?: string | null;
  /** Whether subagent tools (`task`) should be included. */
  subagentEnabled?: boolean;
  /** Explicit AppConfig; falls back to `getAppConfig()` when omitted. */
  appConfig?: AppConfig | null;
  /**
   * Caller-injected tools that require external dependencies (e.g. a
   * `SandboxToolProvider` for `view_image`, or `TaskToolDeps` for `task`).
   * These are appended after the catalog/built-ins and deduplicated by name.
   */
  extraTools?: StructuredToolInterface[];
}

const BUILTIN_TOOLS: StructuredToolInterface[] = [
  createAskClarificationTool(),
  createPresentFilesTool(),
];

/**
 * Get all available tools from config.
 *
 * When the launcher has published a {@link RuntimeToolCatalog} via
 * {@link setGlobalCatalog}, the result is the catalog's tools filtered by
 * `groups` (and `extraTools` appended). Otherwise the dependency-free
 * built-in fallback (`ask_clarification`, `present_file`) plus caller-injected
 * `extraTools` is returned.
 */
export function getAvailableTools(options: GetAvailableToolsOptions = {}): StructuredToolInterface[] {
  const {
    groups = null,
    includeMcp = true,
    modelName = null,
    subagentEnabled = false,
    appConfig = null,
    extraTools = [],
  } = options;

  const config = appConfig ?? getAppConfig();
  const catalog: RuntimeToolCatalog | null = getGlobalCatalog();

  // Base tool list: shared catalog when present, else the built-in fallback.
  let tools: StructuredToolInterface[];
  if (catalog !== null && catalog.size > 0) {
    tools = groups === null ? catalog.tools() : catalog.forGroups(groups).map((ct) => ct.tool);
    // `includeMcp` is a no-op when sourced from the catalog — the catalog
    // already carries exactly the MCP tools the launcher resolved. Kept for
    // signature compatibility with Python's loader.
    void includeMcp;
  } else {
    tools = [...BUILTIN_TOOLS];
  }

  // Skill-evolution tool (if enabled in config).
  const skillEvolution = config.skillEvolution;
  if (skillEvolution?.enabled) {
    // `skill_manage_tool` requires deps not yet ported; skip until then.
    // When ported, import { skillManageTool } from "./skill_manage_tool.js"
    // and append here.
  }

  // Subagent tools (task) — requires TaskToolDeps, injected via extraTools.
  if (subagentEnabled) {
    // Caller passes the task tool via extraTools.
  }

  // Vision tool — requires SandboxToolProvider, injected via extraTools.
  // (Python adds view_image_tool here when model_config.supports_vision.)

  // Append caller-injected tools.
  if (extraTools.length > 0) {
    tools.push(...extraTools);
  }

  // Deduplicate by tool name — first occurrence wins (mirrors Python).
  const seenNames = new Set<string>();
  const unique: StructuredToolInterface[] = [];
  for (const tool of tools) {
    const name = tool.name;
    if (!seenNames.has(name)) {
      unique.push(tool);
      seenNames.add(name);
    }
  }

  void modelName; // reserved for future vision-gating when view_image is wired.
  return unique;
}

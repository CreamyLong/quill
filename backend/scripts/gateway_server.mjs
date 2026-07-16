/**
 * Launcher for the TypeScript Quill HTTP gateway.
 *
 * Builds the runtime graph (model + agent) and the model catalogue, then hands
 * them to the compiled, LangGraph-SDK-compatible gateway server.
 *
 * Usage:
 *   cd backend && npm run build && OPENAI_API_KEY=... npm run gateway
 *
 * Env:
 *   QUILL_PORT   HTTP port (default 8123)
 *   OPENAI_API_KEY   API key for the configured OpenAI-compatible model
 */

import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs";
import { cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Pin the project root to the monorepo root (parent of backend/).
// Regardless of cwd, config.yaml is always read from the repo root so
// `tools:`, `models:`, etc. are never silently empty.
const _gatewayHere = path.dirname(fileURLToPath(import.meta.url));
const _repoRoot = path.resolve(_gatewayHere, "../..");
if (fs.existsSync(path.join(_repoRoot, "config.yaml"))) {
  process.env.QUILL_PROJECT_ROOT = _repoRoot;
}

import { getWriter } from "@langchain/langgraph";
import { createQuillAgent } from "../dist/packages/harness/quill/agents/factory.js";
import { applyPromptTemplate } from "../dist/packages/harness/quill/agents/lead_agent/prompt.js";
import { getAppConfig } from "../dist/packages/harness/quill/config/app_config.js";
import { Paths } from "../dist/packages/harness/quill/config/paths.js";
import { getEffectiveUserId } from "../dist/packages/harness/quill/runtime/user_context.js";
import { makeCheckpointer } from "../dist/packages/harness/quill/runtime/checkpointer/index.js";
import { storeContext } from "../dist/packages/harness/quill/runtime/store/index.js";
import { initEngineFromConfig } from "../dist/packages/harness/quill/persistence/engine.js";
import { loadMcpTools } from "../dist/packages/harness/quill/mcp/client.js";
import { initializeMcpTools, resetMcpToolsCache, getCachedMcpTools, setMcpLoadOptions } from "../dist/packages/harness/quill/mcp/cache.js";
import { buildMcpInterceptors } from "../dist/packages/harness/quill/mcp/interceptors.js";
import { setWorkspaceResolver } from "../dist/packages/harness/quill/mcp/path_rewrite.js";
import { getWorkspaceOverrideResolver } from "../dist/packages/harness/quill/sandbox/local/provider.js";
import { createTaskTool } from "../dist/packages/harness/quill/tools/builtins/task_tool.js";
import {
  webSearchTool as tavilyWebSearchTool,
  webFetchTool as tavilyWebFetchTool,
} from "../dist/packages/harness/quill/community/tavily/tools.js";
import { createSandboxTools } from "../dist/packages/harness/quill/tools/builtins/sandbox_tools.js";
import { LocalSandboxProvider } from "../dist/packages/harness/quill/sandbox/local/provider.js";
import { AioSandboxProvider } from "../dist/packages/harness/quill/community/aio_sandbox/aio_sandbox_provider.js";
import { AioSandboxToolProvider } from "../dist/packages/harness/quill/community/aio_sandbox/aio_sandbox_adapter.js";
import { isHostBashAllowed } from "../dist/packages/harness/quill/sandbox/security.js";
import { summarizationMiddleware } from "../dist/packages/harness/quill/agents/middlewares/builtin.js";
import { setSandboxMiddlewareProvider } from "../dist/packages/harness/quill/agents/middlewares/builtin.js";
import { guardrailMiddleware } from "../dist/packages/harness/quill/guardrails/middleware.js";
import { AllowlistProvider } from "../dist/packages/harness/quill/guardrails/builtin.js";
import { buildTracingCallbacks } from "../dist/packages/harness/quill/tracing/factory.js";
import { SubagentExecutor } from "../dist/packages/harness/quill/subagents/executor.js";
import {
  getAvailableSubagentNames,
  getSubagentConfig,
} from "../dist/packages/harness/quill/subagents/registry.js";
import { runSubagentPolled } from "../dist/packages/harness/quill/subagents/runtime/poller.js";
import { createGatewayServer } from "../dist/packages/harness/quill/server/gateway.js";
import { makeRunEventStore } from "../dist/packages/harness/quill/runtime/events/store/index.js";
import {
  registerChild,
  deregisterChild,
} from "../dist/packages/harness/quill/subagents/runtime/children.js";
import { isSubagentsEnabled } from "../dist/packages/harness/quill/config/subagents_config.js";
import { createChatModel } from "../dist/packages/harness/quill/models/factory.js";
import { setSecurityScannerModelFactory } from "../dist/packages/harness/quill/skills/security_scanner.js";
import { getDatabase } from "../dist/packages/harness/quill/persistence/engine.js";
import { TaskRepository } from "../dist/packages/harness/quill/persistence/task/sql.js";
import { RunRepository } from "../dist/packages/harness/quill/persistence/run/sql.js";
import { createAskClarificationTool } from "../dist/packages/harness/quill/tools/builtins/clarification_tool.js";
import { createViewImageTool } from "../dist/packages/harness/quill/tools/builtins/view_image_tool.js";
import { createPresentFilesTool } from "../dist/packages/harness/quill/tools/builtins/present_file_tool.js";
import { createToolSearchTool } from "../dist/packages/harness/quill/tools/builtins/tool_search_tool.js";
import {
  RuntimeToolCatalog,
  setGlobalCatalog,
} from "../dist/packages/harness/quill/tools/catalog.js";
import { toolSearchMiddleware } from "../dist/packages/harness/quill/agents/middlewares/tool_search_middleware.js";
import { presentFilesMiddleware } from "../dist/packages/harness/quill/agents/middlewares/present_files_middleware.js";
import { titleMiddleware } from "../dist/packages/harness/quill/agents/middlewares/title_middleware.js";
import { getOrNewSkillStorage } from "../dist/packages/harness/quill/skills/storage/index.js";
import { SkillsConfig } from "../dist/packages/harness/quill/config/skills_config.js";
import {
  parseSlashSkillReference,
  resolveSlashSkill,
} from "../dist/packages/harness/quill/skills/slash.js";
import { buildChatModel, pickModelConfig } from "./model_factory.mjs";
import { createSqliteThreadStore } from "./sqlite_store.mjs";
import { createAuthStore } from "./auth_store.mjs";
import { createMemoryStore } from "./memory_store.mjs";
import { createSkillsStore } from "./skills_store.mjs";
import { createAgentsStore } from "./agents_store.mjs";

// Load KEY=VALUE pairs from the project-root .env into process.env (only for
// keys not already set), so tools like Tavily can read their API keys locally.
function loadRootEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(here, "../../.env");
  if (!fs.existsSync(envPath)) return;
  try {
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith("#")) continue;
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* ignore malformed .env */
  }
}
loadRootEnv();

const appConfig = getAppConfig();
const modelConfig = pickModelConfig(appConfig);

/**
 * Build a chat model using the ported quill.models.factory. Falls back to the
 * legacy scripts/model_factory.mjs if the registry rejects the config, so a
 * patch-provider mismatch does not break the gateway during Phase 1 migration.
 */
function buildModel(name, thinkingEnabled = false) {
  try {
    return createChatModel(name, thinkingEnabled, { appConfig, attachTracing: false });
  } catch (err) {
    console.warn(
      `[gateway] createChatModel failed for '${name}' (thinking=${thinkingEnabled}): ${err instanceof Error ? err.message : err}. Falling back to legacy buildChatModel.`,
    );
    const cfg = (appConfig.models ?? []).find((m) => m.name === name) ?? modelConfig;
    return buildChatModel(cfg);
  }
}

// Inject the same model factory into the skill security scanner so it can call
// the moderation model instead of falling through to the "block" fallback.
setSecurityScannerModelFactory(({ name, thinkingEnabled }) =>
  buildModel(name, thinkingEnabled ?? false),
);

const PORT = Number(process.env.QUILL_PORT ?? 8123);
const API_KEY = modelConfig.api_key ?? process.env.OPENAI_API_KEY;

// Load MCP tools via the caching layer (mtime-based staleness detection,
// matching Python's `quill.mcp.cache` behavior). Custom interceptors from
// extensions_config.json's `mcpInterceptors` are loaded and passed through.
let mcpTools = [];
let mcpServers = [];
let mcpInterceptors = [];
try {
  const { ExtensionsConfig } = await import(
    "../dist/packages/harness/quill/config/extensions_config.js"
  );
  const extCfg = ExtensionsConfig.fromFile();

  // Load custom interceptors (mcpInterceptors array in extensions_config.json).
  mcpInterceptors = await buildMcpInterceptors(extCfg);
  if (mcpInterceptors.length > 0) {
    console.log(`[gateway] loaded ${mcpInterceptors.length} MCP interceptor(s)`);
  }

  // Wire the workspace resolver so MCP tool output paths get rewritten to
  // sandbox virtual paths (/mnt/user-data/...). This was the missing one-liner.
  setWorkspaceResolver(getWorkspaceOverrideResolver() ?? (() => null));

  // Forward interceptors to the cache layer so every load/reload applies them.
  setMcpLoadOptions({ interceptors: mcpInterceptors });

  const loaded = await initializeMcpTools();
  mcpTools = loaded.tools;
  mcpServers = loaded.servers;
  if (mcpTools.length > 0) {
    console.log(
      `[gateway] loaded ${mcpTools.length} MCP tool(s) from extensions_config.json: ${mcpServers.join(", ")}`,
    );
  } else {
    console.log("[gateway] no MCP tools configured/loaded.");
  }
} catch (err) {
  console.warn(`[gateway] MCP tool loading failed: ${err instanceof Error ? err.message : err}`);
}

/**
 * Reload MCP tools after `PUT /api/mcp/config`. Resets the cache (closing old
 * sessions), reloads tools, then rebuilds the deferred-tool catalog and
 * runtimeToolCatalog so the new tools are visible to running agents. This was
 * the bug: previously `mcpTools` was reassigned but the catalog kept serving
 * the stale tool set until restart.
 */
async function reloadMcpTools() {
  try {
    // Reset cache + sessions → forces re-read of extensions_config.json.
    resetMcpToolsCache();
    const loaded = await getCachedMcpTools();
    mcpTools = loaded.tools;
    mcpServers = loaded.servers;

    // Rebuild the deferred-tool catalog + hash.
    if (toolSearchEnabled && mcpTools.length > 0) {
      mcpCatalog = mcpTools.map((t) => ({ name: t.name, description: t.description ?? "" }));
      mcpDeferredNames = new Set(mcpTools.map((t) => t.name));
      mcpCatalogHash = createHash("sha256")
        .update(JSON.stringify(mcpCatalog.map((e) => [e.name, e.description]).sort()))
        .digest("hex");
      console.log(`[gateway] deferred MCP catalog hash: ${mcpCatalogHash.slice(0, 16)}...`);
    } else {
      mcpCatalog = [];
      mcpDeferredNames = new Set();
      mcpCatalogHash = null;
    }

    // Rebuild the runtime catalog so MCP tools are the fresh set.
    const freshCatalog = new RuntimeToolCatalog();
    freshCatalog.addAll(mcpTools, "mcp");
    freshCatalog.addAll(webTools, "web");
    freshCatalog.addAll(sandboxTools, "sandbox");
    freshCatalog.addAll(mediaTools, "meta");
    const freshToolSearchTool =
      toolSearchEnabled && mcpTools.length > 0 ? createToolSearchTool(mcpCatalog) : null;
    if (freshToolSearchTool) {
      freshCatalog.add(freshToolSearchTool, "meta");
    }
    setGlobalCatalog(freshCatalog);
    // Keep the lead-tools getter in sync so the next agent build picks up the
    // new MCP tools AND the refreshed tool_search tool.
    setToolSearchTool(freshToolSearchTool);

    console.log(
      `[gateway] reloaded ${mcpTools.length} MCP tool(s) from extensions_config.json: ${mcpServers.join(", ") || "none"} — catalog rebuilt`,
    );
  } catch (err) {
    console.warn(`[gateway] MCP reload failed: ${err instanceof Error ? err.message : err}`);
  }
}

// Respect config.yaml tool_search.enabled; only defer MCP tools when enabled.
const toolSearchEnabled = appConfig.toolSearch?.enabled === true;

// Build a deferred-tool catalog and hash for tool_search / deferred binding.
let mcpCatalog = [];
let mcpDeferredNames = new Set();
let mcpCatalogHash = null;
if (toolSearchEnabled && mcpTools.length > 0) {
  mcpCatalog = mcpTools.map((t) => ({ name: t.name, description: t.description ?? "" }));
  mcpDeferredNames = new Set(mcpTools.map((t) => t.name));
  mcpCatalogHash = createHash("sha256")
    .update(JSON.stringify(mcpCatalog.map((e) => [e.name, e.description]).sort()))
    .digest("hex");
  console.log(`[gateway] deferred MCP catalog hash: ${mcpCatalogHash.slice(0, 16)}...`);
} else if (mcpTools.length > 0) {
  console.log(`[gateway] MCP tools bound directly (tool_search disabled)`);
}

// --- Checkpointer: LangGraph state persistence ---
// Use the ported runtime checkpointer (sqlite by default, memory fallback).
const { checkpointer, close: closeCheckpointer } = await makeCheckpointer(appConfig);

// --- Store: LangGraph cross-thread key-value store ---
// Used by memory middleware (Phase 2). Initialized here and closed on shutdown.
const { store: langGraphStore, close: closeStore } = storeContext();
if (langGraphStore.constructor.name !== "InMemoryStore") {
  console.log(`[gateway] store: ${langGraphStore.constructor.name}`);
}

// --- Community tools: dynamic loader driven by config.yaml `tools` entries ---
// Each entry follows `use: quill.community.<provider>.tools:<export_name>`.
// Providers are loaded on demand; a missing API key typically surfaces as a
// runtime tool error rather than aborting startup.
async function loadCommunityTools() {
  const configured = appConfig.tools ?? [];
  const communityEntries = configured.filter((t) =>
    String(t.use ?? "").startsWith("quill.community."),
  );

  // Group by module path so each provider file is imported once.
  const byModule = new Map();
  for (const entry of communityEntries) {
    const use = String(entry.use);
    const colonIdx = use.lastIndexOf(":");
    if (colonIdx < 0) {
      console.warn(`[gateway] skipping malformed tool entry '${entry.name}': ${use}`);
      continue;
    }
    const modulePath = use.slice(0, colonIdx);
    const exportName = use.slice(colonIdx + 1);
    const jsPath = modulePath.replace(/\./g, "/") + ".js";
    if (!byModule.has(jsPath)) {
      byModule.set(jsPath, []);
    }
    byModule.get(jsPath).push({ name: entry.name, exportName });
  }

  const loaded = [];
  for (const [jsPath, wanted] of byModule.entries()) {
    try {
      const url = new URL(jsPath.replace(/^quill\//, "../dist/packages/harness/quill/"), import.meta.url);
      const mod = await import(url.href);
      for (const { name, exportName } of wanted) {
        const tool = mod[exportName];
        if (tool === undefined) {
          console.warn(`[gateway] tool export '${exportName}' not found in ${url.href}`);
          continue;
        }
        loaded.push(tool);
        console.log(`[gateway] loaded community tool '${name}' (${exportName})`);
      }
    } catch (err) {
      console.warn(`[gateway] failed to load community tools from ${jsPath}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return loaded;
}

const communityTools = await loadCommunityTools();

// Web tools: use the config-driven community loader when entries are present;
// otherwise fall back to the legacy Tavily env-key behaviour.
const webTools = [];
if (communityTools.length > 0) {
  webTools.push(...communityTools);
  console.log(`[gateway] ${communityTools.length} community tool(s) loaded from config.`);
} else if (process.env.TAVILY_API_KEY) {
  webTools.push(tavilyWebSearchTool, tavilyWebFetchTool);
  console.log("[gateway] web_search + web_fetch (Tavily community provider) enabled.");
} else {
  console.log("[gateway] no community tools configured and TAVILY_API_KEY not set — web tools disabled.");
}

// --- Sandbox provider: config-driven selection ---
// Defaults to the local host-filesystem backend. The AIO container backend is
// selectable via `sandbox.use` in config.yaml; when selected it is wrapped in
// AioSandboxToolProvider so file/shell/view_image tools work through the same
// SandboxBackend interface. The underlying AioSandboxProvider is also injected
// into SandboxMiddleware so the middleware can manage container lifecycle
// (acquire on first model call, release on agent completion).
async function createSandboxProvider(skillsRoot) {
  const use = appConfig?.sandbox?.use ?? "quill.sandbox.local.provider:LocalSandboxProvider";
  if (use.includes("aio_sandbox") || use.includes("AioSandboxProvider")) {
    const aioProvider = new AioSandboxProvider();
    // Inject the AIO provider into SandboxMiddleware for lifecycle management.
    // The middleware acquires a sandbox per thread in beforeModel and releases
    // it in afterAgent; the provider's warm pool handles reuse. When no
    // provider is injected (local backend), the middleware is a no-op.
    setSandboxMiddlewareProvider(aioProvider);
    return new AioSandboxToolProvider(aioProvider);
  }
  // Local sandbox (default): per-thread workspace under .scitops/sandboxes/.
  // Mount the skills root read-only at /mnt/skills so the agent can read skill
  // files via read_file as instructed by the <skill_system> prompt.
  return new LocalSandboxProvider(undefined, skillsRoot);
}

// Resolve the skills root early so the local sandbox can mount it at /mnt/skills.
const skillsConfig = new SkillsConfig(appConfig.skills ?? {});
const skillsRoot = skillsConfig.getSkillsPath();
const sandboxProvider = await createSandboxProvider(skillsRoot);
const isAioProvider = sandboxProvider instanceof AioSandboxToolProvider;
// Host bash gating: the TS runtime ships the LOCAL backend by default, so `bash` runs
// real shell commands on the HOST unless the AIO container backend is active. That is
// dangerous, so it is OFF by default (matching quill's safe local default). Opt in
// explicitly with QUILL_ALLOW_HOST_BASH=1, or `sandbox.allow_host_bash: true` in
// config.yaml. The file tools (read/write/ls/glob/grep/str_replace) are always on and
// are confined to the per-thread workspace. When the AIO container backend is active,
// bash is safely isolated inside the container, so it is allowed regardless.
const hostBashAllowed =
  process.env.QUILL_ALLOW_HOST_BASH === "1" ||
  appConfig?.sandbox?.allowHostBash === true ||
  isAioProvider;
const sandboxTools = createSandboxTools(sandboxProvider, { hostBashAllowed });
const askClarificationTool = createAskClarificationTool();
const viewImageTool = createViewImageTool(sandboxProvider);
const presentFilesTool = createPresentFilesTool();
const mediaTools = [askClarificationTool, viewImageTool, presentFilesTool];
console.log(
  `[gateway] sandbox tools enabled (backend=${isAioProvider ? "aio" : "local"}, host bash ${hostBashAllowed ? "ALLOWED" : "gated OFF"}): ${sandboxTools
    .map((t) => t.name)
    .join(", ")}` +
    `; media tools: ${mediaTools.map((t) => t.name).join(", ")}`,
);

// --- Shared runtime tool catalog (single source of truth) ---
// Built once from every tool the runtime assembles, tagged by its source
// group. Both the lead agent's effective tool set and every subagent draw
// from this same catalog via `tools/catalog.ts` so they never drift: a
// subagent inherits only the groups its parent was authorized for, then its
// own allowlist / denylist / loaded-skill allowed_tools converge on top.
// `task` is intentionally NOT registered here — the lead agent adds it
// separately above, and the catalog's ToolPolicy always strips it for
// subagents as a recursion guard.
const runtimeToolCatalog = new RuntimeToolCatalog();
// Declared here (used at line ~317) to avoid the temporal dead zone — all deps
// (toolSearchEnabled, mcpTools, mcpCatalog) are already initialised above.
const toolSearchTool = toolSearchEnabled && mcpTools.length > 0 ? createToolSearchTool(mcpCatalog) : null;
// MCP tools are registered conditionally based on tool_search: when deferred
// (tool_search enabled) the live schemas are withheld from subagent binding
// until promoted, but the catalog still carries the group tag so the policy
// can restore them on promote.
runtimeToolCatalog.addAll(mcpTools, "mcp");
runtimeToolCatalog.addAll(webTools, "web");
runtimeToolCatalog.addAll(sandboxTools, "sandbox");
runtimeToolCatalog.addAll(mediaTools, "meta");
if (toolSearchTool) {
  runtimeToolCatalog.add(toolSearchTool, "meta");
}
setGlobalCatalog(runtimeToolCatalog);

console.log(
  `[gateway] runtime tool catalog: ${runtimeToolCatalog.size} tool(s) — mcp(${mcpTools.length}) web(${webTools.length}) sandbox(${sandboxTools.length}) media(${mediaTools.length})${toolSearchTool ? " +tool_search" : ""}`,
);

// Parent-run event store for subagent timeline persistence
// (subagent.{start,step,end}). Initialised after `_db` (see factory call
// below); the SAME instance is handed to both the poller (writes) and the
// gateway's `/events` route (reads) so persisted events are queryable.
let gatewayEventStore = null;

// The SubagentExecutor consumes `runtimeToolCatalog` + `parentToolGroups`
// directly (see subagents/executor.ts), so there is no launcher-side tool
// derivation any more — the static `[...mcpTools, ...webTools, ...sandboxTools]`
// fork is gone. Subagents inherit only the lead's authorised scope, then their
// own config allowlist / denylist / skill allowed_tools converge on top, and
// `task` is stripped as a recursion guard.

// --- Multi-agent: ported subagent system (SubagentExecutor + registry) ---
// The lead agent delegates via the `task` tool to a roster of subagents defined
// in `subagents/registry.ts` (built-ins: general-purpose, bash, research; plus
// any `custom_agents` from config.yaml). `bash` is auto-hidden when host bash is
// gated off. Each delegation runs a fresh, isolated subagent graph built by the
// ported `SubagentExecutor`, into which we INJECT the working `buildChatModel`
// (from model_factory.mjs) so it builds real LongCat models instead of hitting
// the executor's throwing `createChatModel` stub.

/** Resolve a subagent's model NAME to a real chat model via the ported factory. */
function subagentModelFactory({ name }) {
  return buildModel(name, false);
}

/** Copy any files the subagent wrote to its outputs directory into the parent
 *  thread's outputs directory so `present_files` and artifact downloads work. */
async function copySubagentOutputsToParent(subagentThreadId, parentThreadId, userId = "default") {
  if (!parentThreadId || !subagentThreadId || subagentThreadId === parentThreadId) {
    return;
  }
  const paths = new Paths();
  const src = paths.sandboxOutputsDir(subagentThreadId, userId);
  const dst = paths.sandboxOutputsDir(parentThreadId, userId);
  if (!fs.existsSync(src)) {
    return;
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  if (entries.length === 0) {
    return;
  }
  fs.mkdirSync(dst, { recursive: true });
  let copied = 0;
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    await cp(srcPath, dstPath, {
      recursive: entry.isDirectory(),
      force: true,
      preserveTimestamps: true,
    });
    copied += 1;
  }
  console.log(`[runSubagent] copied ${copied} subagent output(s) to parent outputs: ${dst}`);
}

/** Delegate one instruction to a ported subagent and return its final report.
 *  Mirrors Python `task_tool`: starts a background subagent, polls it, and
 *  emits `task_started` / `task_running` / `task_completed` / `task_failed` /
 *  `task_cancelled` / `task_timed_out` stream events so the frontend subtask
 *  cards update in real time.
 */
async function runSubagent({ subagentType, description, prompt }, config) {
  // `prompt` is the detailed task body (Python `prompt`); `description` is just
  // a short display label. Fall back to `description` for callers/models that
  // only fill the latter.
  const taskPrompt = (prompt && String(prompt).trim()) || description;
  console.log(`[runSubagent] START type=${subagentType} desc="${description.slice(0, 60)}..." task="${taskPrompt.slice(0, 60)}..."`);
  const subagentConfig = getSubagentConfig(subagentType, { appConfig });
  if (!subagentConfig) {
    throw new Error(`Unknown subagent type '${subagentType}'.`);
  }

  // Use the tool_call id as the task id for traceability (matches Python).
  const toolCallId =
    (config?.toolCall?.id) ??
    (config?.metadata?.tool_call_id) ??
    `task-${randomUUID()}`;

  // Identify the parent run's thread/user so subagent outputs can be copied back.
  const parentThreadId = config?.configurable?.thread_id ?? config?.metadata?.thread_id ?? null;
  const parentRunId = config?.configurable?.run_id ?? config?.metadata?.run_id ?? null;
  const userId = config?.configurable?.user_id ?? config?.metadata?.user_id ?? "default";
  const userRole = config?.configurable?.user_role ?? config?.metadata?.user_role ?? null;
  const oauthProvider = config?.configurable?.oauth_provider ?? config?.metadata?.oauth_provider ?? null;
  const oauthId = config?.configurable?.oauth_id ?? config?.metadata?.oauth_id ?? null;
  const parentSandboxState = config?.configurable?.sandbox ?? config?.metadata?.sandbox ?? null;
  const parentThreadData = config?.configurable?.thread_data ?? config?.metadata?.thread_data ?? null;
  const subagentThreadId = `subagent-${subagentConfig.name}-${randomUUID()}`;

  // The subagent inherits the parent's authorized tool scope and workspace
  // identity via the shared catalog, then applies its own config allowlist /
  // denylist / skill allowed_tools in the executor's ToolPolicy.
  const executor = new SubagentExecutor(subagentConfig, [], {
    appConfig,
    parentModel: modelConfig.name,
    threadId: subagentThreadId,
    modelFactory: subagentModelFactory,
    sandboxState: parentSandboxState,
    threadData: parentThreadData,
    userId,
    userRole,
    oauthProvider,
    oauthId,
    runId: parentRunId,
    parentRuntimeCatalog: runtimeToolCatalog,
    // The lead agent was built without an explicit group filter in this
    // launcher, so it is authorized for all groups — pass null to mean "all".
    parentToolGroups: null,
  });

  const taskId = executor.executeAsync(taskPrompt, toolCallId);
  const writer = getWriter(config);

  // The poller owns the poll loop, live SSE emission, and (in the final Phase
  // E) event persistence. We inject a transport that forwards each event to the
  // LangGraph stream writer as a `custom` event — the shape the frontend
  // already understands.
  const emitter = (event) => {
    try {
      writer?.(event);
    } catch (err) {
      console.warn(`[runSubagent] SSE emit failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  // Event persistence (subagent.{start,step,end}) is wired in Phase E once the
  // gateway's RunEventStore is plumbed in here.
  const eventStore = gatewayEventStore ?? null;

  // Register this child task under its parent run so a user cancel / client
  // disconnect (Phase F) can cancel it as part of the cascading abort. The
  // poller's finally also cleans up the background task registry entry.
  registerChild(parentRunId, taskId);

  let finalResult;
  try {
    finalResult = await runSubagentPolled({
      executor,
      taskId,
      subagentConfig,
      description: subagentConfig.description || `${subagentType}: ${description.slice(0, 120)}`,
      emitEvent: emitter,
      eventStore,
      parentThreadId,
      parentRunId,
    });
  } catch (err) {
    // Terminal failure / cancellation / timeout: the poller already emitted the
    // matching SSE event; just bubble the error into the `task' tool body which
    // formats it as "Task failed. Error: ..." / "Task timed out ...".
    throw err;
  }

  if (finalResult.status === "completed") {
    // Mirror outputs back to the parent thread so present_files / artifact
    // downloads work from the lead thread.
    await copySubagentOutputsToParent(subagentThreadId, parentThreadId, userId);
    console.log(`[runSubagent] task ${taskId} completed (status=${finalResult.status})`);
    return finalResult;
  }

  // Non-completed terminal states: still persist outputs (partial work can be
  // useful), then throw so the `task' tool formats a failed/cancelled/timed-out
  // ToolMessage (Phase D) via makeTaskToolMessage.
  try {
    await copySubagentOutputsToParent(subagentThreadId, parentThreadId, userId);
  } catch {
    /* best-effort */
  }
  deregisterChild(parentRunId, taskId);
  throw new Error(`Task ${finalResult.status}: ${finalResult.error ?? "Subagent failed"}`);
}

// Build the `task` tool's roster from the ported registry so the lead agent's
// tool description reflects the real, available subagents. The whole
// subagent system is gated by the master switch `subagents.enabled` (default
// true) — when disabled the roster is empty and no `task` tool is mounted.
const subagentsFeatureEnabled = isSubagentsEnabled(appConfig.subagents);
const subagentNames = subagentsFeatureEnabled ? getAvailableSubagentNames({ appConfig }) : [];
const subagentSpecs = subagentNames
  .map((name) => {
    const cfg = getSubagentConfig(name, { appConfig });
    if (!cfg) return null;
    const firstLine = String(cfg.description ?? "").split("\n")[0].trim();
    return { name, description: firstLine || name };
  })
  .filter(Boolean);
const defaultSubagent = subagentNames.includes("research")
  ? "research"
  : subagentNames[0] ?? "general-purpose";

const taskTool = subagentsFeatureEnabled
  ? createTaskTool({
      runSubagent,
      defaultSubagent,
      subagents: subagentSpecs,
    })
  : null;
console.log(
  `[gateway] subagent roster: ${
    subagentsFeatureEnabled ? subagentNames.join(", ") : "DISABLED"
  } (default: ${defaultSubagent})`,
);

// Lead agent gets the delegation tool, the Sciverse tools (direct or deferred),
// web search/fetch, the sandbox workspace tools, and media presentation tools.
//
// IMPORTANT: This must be a function (not a static array) so that MCP tool
// reloads via PUT /api/mcp/config take effect immediately. `mcpTools` is
// reassigned by `reloadMcpTools()`; a static array would keep serving the
// startup-time snapshot (empty when the config was wrong at boot).
let _toolSearchTool = toolSearchTool;
function getLeadTools() {
  return [
    ...(taskTool ? [taskTool] : []),
    ...(_toolSearchTool ? [_toolSearchTool] : []),
    ...mcpTools,
    ...webTools,
    ...sandboxTools,
    ...mediaTools,
  ];
}
function setToolSearchTool(tool) {
  _toolSearchTool = tool;
}

// System prompt is built dynamically per-request by buildGraphForContext via
// applyPromptTemplate (mirrors Python lead_agent.apply_prompt_template), so
// ultra/pro/flash modes get mode-specific subagent/skills/plan-mode sections.

// --- Tracing (observability) callbacks: LangSmith/Langfuse when configured ---
// Attached to every run's graph.stream config. Inert ([]) unless a provider is
// enabled in config + credentials are present (env/config) — so this is safe by
// default and requires no external keys to run.
let tracingCallbacks = [];
try {
  tracingCallbacks = buildTracingCallbacks();
  if (tracingCallbacks.length > 0) {
    console.log(`[gateway] tracing enabled (${tracingCallbacks.length} callback(s))`);
  }
} catch (err) {
  console.warn(`[gateway] tracing disabled: ${err instanceof Error ? err.message : err}`);
  tracingCallbacks = [];
}

// --- Guardrails: pre-tool-call authorization gate (features.guardrail slot) ---
// Config-driven via the `guardrails` section of config.yaml. Uses the built-in
// AllowlistProvider (allow/deny lists) by default. Enabled by default with a
// safe denylist; set `guardrails.enabled: false` to turn it off.
let guardrailFeature;
{
  const gcfg = appConfig.guardrails ?? {};
  const enabled = gcfg.enabled !== false; // default ON
  if (enabled) {
    const provider = gcfg.provider ?? {};
    const pconf = provider.config ?? provider.params ?? provider ?? {};
    // Read deniedTools from either camelCase or snake_case, and from either
    // the provider root or provider.params (config.yaml uses params.denied_tools).
    const deniedTools = pconf.deniedTools
      ?? pconf.denied_tools
      ?? ["bash"];
    const allowedTools = pconf.allowedTools ?? pconf.allowed_tools; // undefined => allow all except denied
    const authz = new AllowlistProvider({ allowedTools, deniedTools });
    guardrailFeature = guardrailMiddleware(authz, { failClosed: gcfg.failClosed !== false });
    console.log(
      `[gateway] guardrails enabled (provider=allowlist, denied=[${deniedTools.join(", ")}]${allowedTools ? `, allowed=[${allowedTools.join(", ")}]` : ""})`,
    );
  } else {
    console.log("[gateway] guardrails disabled (config)");
  }
}

// Repo-root skills/public is where committed (read-only) public skills live.
const PUBLIC_SKILLS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../skills/public",
);

// --- Skill activation: load the local skill storage once at startup ---
const skillStorage = getOrNewSkillStorage({
  skillsPath: path.resolve(PUBLIC_SKILLS_DIR, ".."),
  appConfig,
});
const availableSkills = null; // all enabled skills are available to the lead agent

function buildGraphForContext(context) {
  const planMode = context?.is_plan_mode === true;
  const subagentEnabled = context?.subagent_enabled === true;
  const thinkingEnabled = context?.thinking_enabled === true;
  const userId = context?.user_id ?? null;
  // In ultra/subagent mode the lead agent is an orchestrator: it MUST delegate
  // work to subagents via `task`. Direct execution tools are removed from the
  // lead's tool set so the model cannot avoid delegating. Meta tools
  // (clarification, presentation, vision, tool search) are kept.
  const allowedLeadToolsInSubagentMode = new Set([
    "task",
    "ask_clarification",
    "present_files",
    "view_image",
    "tool_search",
  ]);
  const toolsForMode = subagentEnabled
    ? getLeadTools().filter((t) => allowedLeadToolsInSubagentMode.has(t.name))
    : getLeadTools().filter((t) => t.name !== "task");

  console.log(`[gateway] buildGraphForContext: subagent_enabled=${context?.subagent_enabled} (type=${typeof context?.subagent_enabled}) -> subagentEnabled=${subagentEnabled}, task tool ${subagentEnabled ? "INCLUDED" : "EXCLUDED"}`);

  // Build the system prompt dynamically per-request via applyPromptTemplate
  // (mirrors Python lead_agent.apply_prompt_template). This injects:
  // - <subagent_system> block with parallel task() orchestration guidance
  //   (only when subagentEnabled, i.e. ultra mode)
  // - <skill_system> block listing available skills
  // - <deferred_tools_section> for tool_search-deferred MCP tools
  // Note: pro mode does NOT alter the system prompt — it only activates
  // TodoMiddleware via createQuillAgent({ planMode }), which injects the
  // <todo_list_system> block in wrapModelCall. The Python apply_prompt_template
  // has no plan_mode parameter; we mirror that to avoid conflicting prompts.
  const modeSystemPrompt = applyPromptTemplate({
    subagentEnabled,
    maxConcurrentSubagents: 3,
    appConfig,
    availableSkills: null, // all enabled skills are available to the lead agent
    deferredNames: mcpDeferredNames,
  });

  if (planMode) {
    console.log(`[gateway] run mode: ${subagentEnabled ? "ultra" : "pro"} (planMode=true, subagent=${subagentEnabled}, thinking=${thinkingEnabled})`);
  }
  console.log(`[gateway] tools for mode (count=${toolsForMode.length}): ${toolsForMode.map((t) => t.name).join(", ")}`);
  return createQuillAgent({
    model: buildModel(modelConfig.name, thinkingEnabled),
    tools: toolsForMode,
    systemPrompt: modeSystemPrompt,
    planMode,
    checkpointer,
    userId,
    getUserId: () => getEffectiveUserId(),
    features: {
      // Compress old turns once a conversation gets long (short chats unaffected).
      summarization: summarizationMiddleware({
        model: buildModel(modelConfig.name, false),
        maxMessages: 40,
        keepRecent: 12,
      }),
      // Activate a skill when the user types /skill-name.
      skillActivation: {
        storage: skillStorage,
        parseSlashSkillReference,
        resolveSlashSkill,
        availableSkills,
      },
      // Enable view_image / image injection.
      vision: true,
      // Inject current date and per-user memory as reminders.
      dynamicContext: true,
      // Debounced LLM-based memory updates after each agent step.
      // Use the gateway's SQLite memory store so the Memory panel sees facts.
      memory: memoryStore ? { updaterOptions: { storage: memoryStore } } : true,
      // Auto-generate thread titles after the first exchange (matches Python lead_agent).
      autoTitle: titleMiddleware({
        createChatModel: (name) => buildModel(name ?? modelConfig.name, false),
      }),
      // Enable per-run token budget enforcement when configured.
      tokenBudget: appConfig.tokenBudget?.enabled === true,
      // Hide MCP tool schemas until promoted via tool_search (only when enabled).
      ...(toolSearchEnabled && mcpDeferredNames.size > 0
        ? {
            deferredToolFilter: {
              deferredNames: mcpDeferredNames,
              catalogHash: mcpCatalogHash,
            },
          }
        : {}),
      ...(guardrailFeature ? { guardrail: guardrailFeature } : {}),
    },
    extraMiddleware: [
      presentFilesMiddleware(),
      ...(toolSearchEnabled && mcpDeferredNames.size > 0 ? [toolSearchMiddleware(mcpDeferredNames, mcpCatalogHash)] : []),
    ],
  });
}

// Startup visibility: the default middleware chain assembled by the agent
// factory (planMode off, vision/tokenBudget off for the lead). Faithful ports
// are marked (*) where they replaced earlier inline simplified versions.
console.log(
  "[gateway] agent middlewares: threadData, uploads, sandbox, sandboxAudit*, " +
    "skillActivation*, inputSanitization*, systemMessageCoalescing*, danglingToolCall*, " +
    (toolSearchEnabled && mcpDeferredNames.size > 0 ? "deferredToolFilter*(enabled), " : "deferredToolFilter, ") +
    "guardrail, toolErrorHandling, summarization, title, memory*(enabled), " +
    "dynamicContext*(enabled), viewImage*(enabled), subagentLimit, safetyFinishReason*, loopDetection*, " +
    "tokenUsage*, tokenBudget*(disabled), toolOutputBudget*, llmErrorHandling*, clarification, presentFiles*" +
    (toolSearchEnabled && mcpDeferredNames.size > 0 ? ", toolSearch*(enabled)" : ""),
);
console.log("[gateway] graph factory ready: mode will be resolved per run from context.is_plan_mode / context.subagent_enabled");

/** Map Quill ModelConfig entries to the frontend `/api/models` shape. */
function toGatewayModels(cfg) {
  const list = cfg.models && cfg.models.length > 0 ? cfg.models : [modelConfig];
  return list.map((m) => ({
    id: m.name,
    name: m.name,
    model: m.model,
    display_name: m.displayName ?? m.name,
    description: m.description ?? null,
    supports_thinking: Boolean(m.supportsThinking),
    supports_reasoning_effort: Boolean(m.supportsReasoningEffort),
  }));
}

// FIXED: always resolve relative to this script's location (backend/.scitops),
// regardless of the cwd the server was launched from. Previously using
// process.cwd() caused a second empty .scitops to be created at the repo
// root when started from there, hiding the real thread history.
const QUILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".scitops");

const memoryStore = buildStore("memory store enabled (.scitops/memory.db)", () =>
  createMemoryStore(path.resolve(QUILL_DIR, "memory.db")),
);

// --- Persistence ORM: initialize application schema ---
// Schema includes users, threads_meta, runs, run_events, feedback, and
// channel_connections. Ad-hoc stores remain functional during migration.
try {
  initEngineFromConfig({
    backend: "sqlite",
    sqlite_path: path.resolve(QUILL_DIR, "quill.db"),
  });
  console.log("[gateway] persistence ORM initialized (.scitops/quill.db)");
} catch (err) {
  console.warn(`[gateway] persistence ORM initialization failed: ${err instanceof Error ? err.message : err}`);
}

const _db = getDatabase();
const runRepository = _db ? new RunRepository(_db) : null;
const taskRepository = _db ? new TaskRepository(_db) : null;
if (taskRepository) {
  console.log("[gateway] task repository enabled (work workspace)");
}
if (runRepository) {
  console.log("[gateway] token-usage aggregation enabled (RunRepository bound)");
}

// Build the durable run-event store (jsonl/db/memory per config.yaml) and hand
// it to the poller so timeline events survive a restart. The JsonlRunEventStore
// lives under <QUILLDIR>/threads/<threadId>/runs/<runId>.jsonl.
try {
  gatewayEventStore = makeRunEventStore(appConfig.runEvents ?? null, { db: _db ?? null });
} catch (err) {
  console.warn(`[gateway] run-event store init failed; falling back to in-memory: ${err instanceof Error ? err.message : err}`);
  gatewayEventStore = null;
}
console.log(`[gateway] run-event store: ${gatewayEventStore ? gatewayEventStore.constructor.name : "in-memory (fallback)"} (backend=${appConfig.runEvents?.backend ?? "default"})`);

/** Construct an optional store, logging success/failure without aborting startup. */
function buildStore(label, factory) {
  try {
    const s = factory();
    console.log(`[gateway] ${label}`);
    return s;
  } catch (err) {
    console.warn(`[gateway] ${label} unavailable: ${err?.message ?? err}`);
    return undefined;
  }
}

const { server, getThreadMetadata } = createGatewayServer({
  graph: buildGraphForContext,
  models: toGatewayModels(appConfig),
  modelLabel: modelConfig.name,
  mcpConfig: appConfig.mcp ?? null,
  reloadMcp: reloadMcpTools,
  runCallbacks: tracingCallbacks,
  auth: process.env.QUILL_AUTH_ENABLED === "1"
    ? (() => {
        const a = createAuthStore(path.resolve(QUILL_DIR, "auth.db"));
        console.log("[gateway] real auth ENABLED (.scitops/auth.db)");
        return a;
      })()
    : undefined,
  store: buildStore("SQLite thread store enabled (.scitops/threads.db)", () =>
    createSqliteThreadStore(path.resolve(QUILL_DIR, "threads.db")),
  ),
  taskRepository,
  memory: memoryStore,
  skills: buildStore("skills store enabled (.scitops/skills.db)", () =>
    createSkillsStore(path.resolve(QUILL_DIR, "skills.db"), PUBLIC_SKILLS_DIR),
  ),
  skillUploadStorage: {
    installFromArchive: async (filePath) => {
      const result = await skillStorage.ainstallSkillFromArchive(filePath);
      return { skillName: String(result.skill_name ?? path.basename(filePath, path.extname(filePath))) };
    },
  },
  agents: buildStore("agents store enabled (.scitops/agents.db)", () =>
    createAgentsStore(path.resolve(QUILL_DIR, "agents.db")),
  ),
  deleteThreadCheckpoint: async (threadId) => {
    if (typeof checkpointer.deleteThread === "function") {
      await checkpointer.deleteThread(threadId);
    }
  },
  aggregateTokenUsage: runRepository
    ? async (threadId, opts) => runRepository.aggregateTokensByThread(threadId, opts)
    : undefined,
  eventStore: gatewayEventStore,
});

// Wire per-thread workspace_directory override resolution. When a thread's
// metadata contains `workspace_directory` (set by the frontend when creating a
// new conversation with a custom working directory), the sandbox provider uses
// that host path as the workspace instead of the default per-thread sandbox dir.
if (sandboxProvider instanceof LocalSandboxProvider) {
  sandboxProvider.setWorkspaceOverrideResolver((threadId) => {
    const meta = getThreadMetadata(threadId);
    const ws = meta?.workspace_directory;
    return typeof ws === "string" ? ws : undefined;
  });
}

if (!API_KEY) {
  console.warn(
    "[gateway] WARNING: OPENAI_API_KEY is not set. The server will start, but live runs will fail.",
  );
}

server.listen(PORT, () => {
  console.log(`Quill TS gateway listening on http://localhost:${PORT}`);
  console.log(`Using model: ${modelConfig.name} (${modelConfig.model})`);
  console.log(`Health:  curl http://localhost:${PORT}/health`);
  console.log(`Models:  curl http://localhost:${PORT}/api/models`);
});

// Graceful shutdown: close the checkpointer database connection so checkpoints
// are flushed and WAL files are cleaned up.
async function shutdown() {
  console.log("[gateway] shutting down...");
  await new Promise((resolve) => server.close(resolve));
  if (closeStore) {
    try {
      await closeStore();
      console.log("[gateway] store closed");
    } catch (err) {
      console.warn(`[gateway] error closing store: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (closeCheckpointer) {
    try {
      await closeCheckpointer();
      console.log("[gateway] checkpointer closed");
    } catch (err) {
      console.warn(`[gateway] error closing checkpointer: ${err instanceof Error ? err.message : err}`);
    }
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

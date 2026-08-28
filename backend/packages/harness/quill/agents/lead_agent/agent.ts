/**
 * Lead agent factory — TypeScript port of `quill.agents.lead_agent.agent`.
 *
 * INVARIANT — tracing callback placement
 * ======================================
 *
 * Tracing callbacks (Langfuse, LangSmith) are attached at the **graph
 * invocation root** in `_makeLeadAgent` (see the `buildTracingCallbacks()`
 * block that appends to `config.callbacks`). Every `createChatModel(...)`
 * call inside this module — and inside any middleware reachable from this
 * graph (e.g. `TitleMiddleware`) — MUST pass `attachTracing: false`.
 *
 * Forgetting that flag emits duplicate spans (one rooted at the graph, one
 * at the model) AND prevents the Langfuse handler's `propagate_attributes`
 * path from firing, so `session_id` / `user_id` never reach the trace.
 *
 * The current sites are: bootstrap agent, default agent, summarization
 * middleware. Any new in-graph `createChatModel` call must add to this list
 * and pass the flag.
 *
 * Porting notes
 * -------------
 * - Python's `create_agent(model, tools, middleware, system_prompt, state_schema)`
 *   maps to TS `createQuillAgent({ model, tools, middleware, systemPrompt })`.
 * - Python's `AgentMiddleware` class instances map to TS `MiddlewareDefinition`
 *   hook objects.
 * - `setup_agent` / `update_agent` builtin tools are ported and wired into
 *   the bootstrap path and custom-agent path respectively.
 * - `getAvailableTools` is a stub (see `tools/tools.ts`); config-loaded tools,
 *   MCP, and ACP are not yet available.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { StructuredToolInterface } from "@langchain/core/tools";

import { createQuillAgent, type MiddlewareDefinition } from "../factory.js";

import { applyPromptTemplate, getEnabledSkillsForConfig } from "./prompt.js";

import { loadAgentConfig, validateAgentName, type AgentConfig } from "../../config/agents_config.js";
import { getAppConfig, type AppConfig, type ModelConfig } from "../../config/app_config.js";
import { createChatModel } from "../../models/factory.js";
import { buildTracingCallbacks } from "../../tracing/factory.js";
import { filterToolsBySkillAllowedTools, type NamedTool } from "../../skills/tool_policy.js";
import type { Skill } from "../../skills/types.js";
import { getAvailableTools } from "../../tools/tools.js";
import { assembleDeferredTools, type DeferredToolSetup } from "../../tools/builtins/tool_search_tool.js";
import { getEffectiveUserId } from "../../runtime/user_context.js";
import { createSetupAgentTool } from "../../tools/builtins/setup_agent_tool.js";
import { createUpdateAgentTool } from "../../tools/builtins/update_agent_tool.js";

// Middleware (faithful ports — imported from individual files, not builtin.ts,
// so we get the full implementations rather than the simplified builtin.ts
// versions of title/subagentLimit/clarification).
import { inputSanitizationMiddleware } from "../middlewares/input_sanitization_middleware.js";
import { toolOutputBudgetMiddleware } from "../middlewares/tool_output_budget_middleware.js";
import { threadDataMiddleware } from "../middlewares/thread_data_middleware.js";
import { uploadsMiddleware } from "../middlewares/uploads_middleware.js";
import { sandboxMiddleware } from "../middlewares/sandbox_middleware.js";
import { danglingToolCallMiddleware } from "../middlewares/dangling_tool_call_middleware.js";
import { llmErrorHandlingMiddleware } from "../middlewares/llm_error_handling_middleware.js";
import { sandboxAuditMiddleware } from "../middlewares/sandbox_audit_middleware.js";
import { toolErrorHandlingMiddleware } from "../middlewares/builtin.js";
import { dynamicContextMiddleware } from "../middlewares/dynamic_context_middleware.js";
import { skillActivationMiddleware } from "../middlewares/skill_activation_middleware.js";
import { summarizationMiddleware } from "../middlewares/summarization_middleware.js";
import { todoMiddleware } from "../middlewares/todo_middleware.js";
import { tokenUsageMiddleware } from "../middlewares/token_usage_middleware.js";
import { titleMiddleware } from "../middlewares/title_middleware.js";
import { memoryMiddleware } from "../middlewares/memory_middleware.js";
import { viewImageMiddleware } from "../middlewares/view_image_middleware.js";
import { deferredToolFilterMiddleware } from "../middlewares/deferred_tool_filter_middleware.js";
import { systemMessageCoalescingMiddleware } from "../middlewares/system_message_coalescing_middleware.js";
import { subagentLimitMiddleware } from "../middlewares/subagent_limit_middleware.js";
import { loopDetectionMiddleware } from "../middlewares/loop_detection_middleware.js";
import { tokenBudgetMiddleware } from "../middlewares/token_budget_middleware.js";
import { safetyFinishReasonMiddleware } from "../middlewares/safety_finish_reason_middleware.js";
import { clarificationMiddleware } from "../middlewares/clarification_middleware.js";
import { presentFilesMiddleware } from "../middlewares/present_files_middleware.js";
import { createGuardrailMiddleware } from "../../guardrails/loader.js";
import { toolResultSanitizationMiddleware } from "../../middlewares/tool_result_sanitization.js";
import { createLifecycleHookMiddleware, type LifecycleHookMiddlewareOptions } from "../../middlewares/lifecycle_middleware.js";

const _BOOTSTRAP_SKILL_NAMES = new Set<string>(["bootstrap"]);

/**
 * Channels where the self-mutation tool (`update_agent`) must be withheld.
 * Mirrors Python `_WEBHOOK_CHANNELS` — webhook prompts come from arbitrary
 * external actors, so exposing the tool there gives an attacker a path to
 * mutate the agent's SOUL.md / tool_groups / model.
 */
const _WEBHOOK_CHANNELS = new Set<string>(["github"]);

/**
 * Writable view of RunnableConfig for metadata/callbacks mutation.
 *
 * LangGraph's `RunnableConfig` declares `metadata` and `callbacks` as
 * optional readonly fields, but the Python `make_lead_agent` mutates them
 * in place to inject tracing metadata and root-level callbacks. We cast to
 * this writable view to mirror that behavior.
 */
type WritableRunnableConfig = RunnableConfig & {
  metadata: Record<string, unknown>;
  callbacks?: unknown[];
};

/**
 * Structured view of `AppConfig.summarization` (which is typed as
 * `Record<string, unknown>` in the config layer). Mirrors the Python
 * `SummarizationConfig` fields used by `_create_summarization_middleware`.
 */
interface SummarizationConfigLike {
  enabled?: boolean;
  model_name?: string | null;
  trigger?: unknown;
  keep?: unknown;
  trim_tokens_to_summarize?: number | null;
  summary_prompt?: string | null;
  skill_file_read_tool_names?: string[];
  preserve_recent_skill_count?: number | null;
  preserve_recent_skill_tokens?: number | null;
  preserve_recent_skill_tokens_per_skill?: number | null;
}

// ---------------------------------------------------------------------------
// Runtime config extraction
// ---------------------------------------------------------------------------

/**
 * Merge legacy `configurable` options with LangGraph runtime `context`.
 *
 * Mirrors Python `_get_runtime_config`: the LangGraph `context` channel
 * carries per-run overrides (is_plan_mode, subagent_enabled, etc.) that
 * take precedence over `configurable`.
 */
function _getRuntimeConfig(config: RunnableConfig): Record<string, unknown> {
  const cfg: Record<string, unknown> = { ...((config.configurable as Record<string, unknown>) ?? {}) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const context = (config as any).context as Record<string, unknown> | undefined;
  if (context && typeof context === "object") {
    Object.assign(cfg, context);
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// Model name resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a runtime model name safely, falling back to default if invalid.
 *
 * Mirrors Python `_resolve_model_name`: request → validated config entry →
 * global default. Raises if no models are configured.
 */
function _resolveModelName(
  requestedModelName: string | null | undefined,
  appConfig: AppConfig | null = null,
): string {
  const resolvedAppConfig = appConfig ?? getAppConfig();
  const defaultModelName = resolvedAppConfig.models.length > 0 ? resolvedAppConfig.models[0].name : null;
  if (defaultModelName === null) {
    throw new Error("No chat models are configured. Please configure at least one model in config.yaml.");
  }

  if (requestedModelName) {
    const found = resolvedAppConfig.models.find((m) => m.name === requestedModelName);
    if (found) {
      return requestedModelName;
    }
    if (requestedModelName !== defaultModelName) {
      console.warn(
        `Model '${requestedModelName}' not found in config; fallback to default model '${defaultModelName}'.`,
      );
    }
  }
  return defaultModelName;
}

// ---------------------------------------------------------------------------
// Summarization middleware factory
// ---------------------------------------------------------------------------

/**
 * Create and configure the summarization middleware from config.
 *
 * Mirrors Python `_create_summarization_middleware`. The TS
 * `summarizationMiddleware` is currently a pragmatic port that accepts only
 * `{ model, maxMessages, keepRecent, maxTranscriptChars }`; the Python-only
 * fields (trigger/keep tuples, skills_container_path, skill_file_read_tool_names,
 * before_summarization hooks, preserve_recent_skill_*) are noted as future
 * work and will be wired once the full `QuillSummarizationMiddleware` is
 * ported.
 *
 * Returns `null` when summarization is disabled or no model is available.
 */
function _createSummarizationMiddleware(
  appConfig: AppConfig | null = null,
): MiddlewareDefinition | null {
  const resolvedAppConfig = appConfig ?? getAppConfig();
  const config = (resolvedAppConfig.summarization ?? {}) as SummarizationConfigLike;

  if (!config.enabled) {
    return null;
  }

  // Create the summarizer model. attachTracing=False because the graph-level
  // RunnableConfig (set in _makeLeadAgent) already carries tracing callbacks;
  // binding them again at the model level would emit duplicate spans and
  // break session_id / user_id propagation.
  const modelName = config.model_name ?? null;
  const model = createChatModel(modelName, false, {
    appConfig: resolvedAppConfig,
    attachTracing: false,
  });
  // Tag the model so RunJournal can identify these LLM calls as middleware
  // rather than lead_agent (mirrors Python `model.with_config(tags=[...])`).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const taggedModel = (typeof (model as any).withConfig === "function"
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (model as any).withConfig({ tags: ["middleware:summarize"] })
    : model) as BaseChatModel;

  // TODO: once the full QuillSummarizationMiddleware is ported, pass:
  //   - trigger / keep (from config.trigger / config.keep)
  //   - trim_tokens_to_summarize
  //   - summary_prompt
  //   - skills_container_path (resolvedAppConfig.skills.container_path)
  //   - skill_file_read_tool_names
  //   - before_summarization hooks (memory_flush_hook when memory.enabled)
  //   - preserve_recent_skill_count / _tokens / _tokens_per_skill
  return summarizationMiddleware({ model: taggedModel });
}

// ---------------------------------------------------------------------------
// Todo list middleware factory
// ---------------------------------------------------------------------------

/**
 * Create and configure the TodoList middleware.
 *
 * Mirrors Python `_create_todo_list_middleware`. The TS `todoMiddleware`
 * already ships with default `systemPrompt` / `toolDescription` that match
 * the Python prompts, so we rely on those defaults (no need to re-pass the
 * ~100 lines of prompt text). Returns `null` when plan mode is disabled.
 */
function _createTodoListMiddleware(isPlanMode: boolean): MiddlewareDefinition | null {
  if (!isPlanMode) {
    return null;
  }
  // The TS todo_middleware.ts DEFAULT_TODO_SYSTEM_PROMPT and
  // DEFAULT_TODO_TOOL_DESCRIPTION already mirror the Python prompts.
  return todoMiddleware();
}

// ---------------------------------------------------------------------------
// Lead runtime base middlewares
// ---------------------------------------------------------------------------

/**
 * Build shared base middlewares for the lead agent runtime.
 *
 * Mirrors Python `build_lead_runtime_middlewares` (from
 * `tool_error_handling_middleware.py`). These run before the lead-only
 * middlewares (DynamicContext, SkillActivation, Summarization, etc.).
 *
 * Order (outer → inner / first → last):
 *   1. InputSanitization   — outermost wrapModelCall wrapper
 *   2. ToolOutputBudget    — per-tool output size enforcement
 *   3. ThreadData          — thread-scoped data init
 *   4. Uploads             — uploaded file registration
 *   5. Sandbox             — sandbox lifecycle management
 *   6. DanglingToolCall    — patch interrupted tool calls
 *   7. LLMErrorHandling    — retry/recover LLM errors
 *   8. Guardrail           — pre-tool-call authorization (if guardrails enabled)
 *   9. SandboxAudit        — audit bash tool calls
 *   10. ToolErrorHandling  — convert tool exceptions to ToolMessages
 *
 * GuardrailMiddleware is inserted from `appConfig.guardrails` via
 * `createGuardrailMiddleware` (see `guardrails/loader.ts`). Provider
 * resolution is lazy (first tool call) because this factory is synchronous.
 */
function buildLeadRuntimeMiddlewares(
  appConfig: AppConfig,
  userContext: { userId?: string | null; getUserId?: () => string | null },
): MiddlewareDefinition[] {
  const chain: MiddlewareDefinition[] = [
    inputSanitizationMiddleware(),
    toolOutputBudgetMiddleware(appConfig.toolOutput),
    threadDataMiddleware({ userId: userContext.userId }),
    uploadsMiddleware({ userId: userContext.userId }),
    sandboxMiddleware({ userId: userContext.userId, getUserId: userContext.getUserId }),
    danglingToolCallMiddleware(),
    llmErrorHandlingMiddleware(),
  ];

  // [8] Guardrail — pre-tool-call authorization (Codex exec-policy style
  //     command-level rules, or any GuardrailProvider via config).
  const guardrail = createGuardrailMiddleware(appConfig.guardrails);
  if (guardrail !== null) {
    chain.push(guardrail);
  }

  chain.push(
    sandboxAuditMiddleware(),
    toolErrorHandlingMiddleware(),
    presentFilesMiddleware(),
  );
  return chain;
}

// ---------------------------------------------------------------------------
// build_middlewares — public middleware composition entry point
// ---------------------------------------------------------------------------

/**
 * Build the lead-agent middleware chain based on runtime configuration.
 *
 * Mirrors Python `build_middlewares`. Public entry point for the lead
 * agent's full middleware composition. Used by `makeLeadAgent` and by
 * embedded lead-agent variants that need the identical chain.
 *
 * Middleware order (Python-faithful):
 *   1-9.   buildLeadRuntimeMiddlewares (base runtime)
 *   10.    DynamicContext
 *   11.    SkillActivation
 *   12.    Summarization          (if enabled)
 *   13.    TodoList               (if plan mode)
 *   14.    TokenUsage             (if token_usage.enabled)
 *   15.    Title
 *   16.    Memory
 *   17.    ViewImage              (if model supports vision)
 *   18.    DeferredToolFilter     (if deferred tools exist)
 *   19.    SystemMessageCoalescing
 *   20.    SubagentLimit          (if subagent_enabled)
 *   21.    LoopDetection          (if enabled)
 *   22.    TokenBudget            (if enabled)
 *   23.    custom_middlewares
 *   24.    SafetyFinishReason     (if enabled)
 *   25.    Clarification          (always last)
 */
export function buildMiddlewares(
  config: RunnableConfig,
  modelName: string | null,
  agentName: string | null = null,
  customMiddlewares: MiddlewareDefinition[] | null = null,
  options: {
    availableSkills?: Set<string> | null;
    appConfig?: AppConfig | null;
    deferredSetup?: DeferredToolSetup | null;
    userId?: string | null;
    getUserId?: () => string | null;
  } = {},
): MiddlewareDefinition[] {
  const {
    availableSkills = null,
    appConfig = null,
    deferredSetup = null,
    userId = null,
    getUserId,
  } = options;

  const resolvedAppConfig = appConfig ?? getAppConfig();
  const effectiveUserId = userId ?? getEffectiveUserId();
  const userContext = { userId: effectiveUserId, getUserId };

  // [1-9] Base runtime middlewares
  const middlewares = buildLeadRuntimeMiddlewares(resolvedAppConfig, userContext);

  // [10] DynamicContext — inject current date (and optionally memory) as
  //      <system-reminder> into the first HumanMessage to keep the system
  //      prompt fully static for prefix-cache reuse.
  middlewares.push(dynamicContextMiddleware({ agentName: agentName, getUserId }));

  // [11] SkillActivation — deterministically load a full SKILL.md when the
  //      user starts the turn with /skill-name.
  middlewares.push(skillActivationMiddleware({ availableSkills }));

  // [12] Summarization — compress old conversation turns when the transcript
  //      grows beyond a threshold.
  const summarizationMw = _createSummarizationMiddleware(resolvedAppConfig);
  if (summarizationMw !== null) {
    middlewares.push(summarizationMw);
  }

  // [13] TodoList — plan-mode task tracker (write_todos tool + reminders).
  const cfg = _getRuntimeConfig(config);
  const isPlanMode = Boolean(cfg["is_plan_mode"] ?? false);
  const todoMw = _createTodoListMiddleware(isPlanMode);
  if (todoMw !== null) {
    middlewares.push(todoMw);
  }

  // [14] TokenUsage — aggregate token usage per run.
  if (resolvedAppConfig.tokenUsage?.enabled) {
    middlewares.push(tokenUsageMiddleware());
  }

  // [15] Title — generate a run title from the first user message.
  middlewares.push(titleMiddleware());

  // [16] Memory — queue conversation for memory update (after Title).
  middlewares.push(
    memoryMiddleware({ agentName, memoryConfig: resolvedAppConfig.memory, getUserId }),
  );

  // [17] ViewImage — inject image details before the LLM (vision models only).
  //      Use the resolved runtime modelName to avoid stale config values.
  const modelConfig: ModelConfig | undefined = modelName
    ? resolvedAppConfig.models.find((m) => m.name === modelName)
    : undefined;
  if (modelConfig && modelConfig.supportsVision) {
    middlewares.push(viewImageMiddleware());
  }

  // [18] DeferredToolFilter — hide deferred (e.g. MCP) tool schemas from
  //      model binding until tool_search promotes them.
  if (deferredSetup && deferredSetup.deferredNames && deferredSetup.deferredNames.size > 0) {
    middlewares.push(
      deferredToolFilterMiddleware(deferredSetup.deferredNames, deferredSetup.catalogHash),
    );
  }

  // [19] SystemMessageCoalescing — merge multiple SystemMessages into one
  //      leading SystemMessage before the request reaches the provider.
  middlewares.push(systemMessageCoalescingMiddleware());

  // [20] SubagentLimit — truncate excess parallel task calls.
  const subagentEnabled = Boolean(cfg["subagent_enabled"] ?? false);
  if (subagentEnabled) {
    const maxConcurrentSubagents = Number(cfg["max_concurrent_subagents"] ?? 3);
    middlewares.push(subagentLimitMiddleware(maxConcurrentSubagents));
  }

  // [21] LoopDetection — detect and break repetitive tool-call loops.
  const loopDetectionConfig = resolvedAppConfig.loopDetection;
  if (loopDetectionConfig?.enabled) {
    middlewares.push(loopDetectionMiddleware(loopDetectionConfig));
  }

  // [22] TokenBudget — enforce per-run token limits.
  const tokenBudgetConfig = resolvedAppConfig.tokenBudget;
  if (tokenBudgetConfig?.enabled) {
    middlewares.push(tokenBudgetMiddleware(tokenBudgetConfig));
  }

  // [23] Custom middlewares — injected before Clarification so they can
  //      observe the fully-prepared state but still run before the final
  //      clarification gate.
  if (customMiddlewares && customMiddlewares.length > 0) {
    middlewares.push(...customMiddlewares);
  }

  // [24] SafetyFinishReason — suppress tool execution when the provider
  //      safety-terminated the response. Registered after custom middlewares
  //      so that LangChain's reverse-order after_model dispatch runs Safety
  //      first; cleared tool_calls then flow through Loop/Subagent accounting
  //      without firing extra alarms.
  const safetyConfig = resolvedAppConfig.safetyFinishReason;
  if (safetyConfig?.enabled) {
    middlewares.push(safetyFinishReasonMiddleware());
  }

  // [25] Clarification — always last to intercept clarification requests
  //      after model calls.
  middlewares.push(clarificationMiddleware());

  return middlewares;
}

// ---------------------------------------------------------------------------
// Skill helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the set of skill names available to this agent.
 *
 * Mirrors Python `_available_skill_names`: bootstrap agents get a narrow
 * `{"bootstrap"}` set; custom agents use their configured `skills` list;
 * the default agent returns `null` (no restriction).
 */
function _availableSkillNames(
  agentConfig: AgentConfig | null,
  isBootstrap: boolean,
): Set<string> | null {
  if (isBootstrap) {
    return new Set(_BOOTSTRAP_SKILL_NAMES);
  }
  if (agentConfig && agentConfig.skills !== null) {
    return new Set(agentConfig.skills);
  }
  return null;
}

/**
 * Load enabled skills and filter by the available-skills policy.
 *
 * Mirrors Python `_load_enabled_skills_for_tool_policy`: loads all enabled
 * skills from storage, then keeps only those whose name is in
 * `availableSkills` (when non-null).
 */
function _loadEnabledSkillsForToolPolicy(
  availableSkills: Set<string> | null,
  appConfig: AppConfig,
): Skill[] {
  let skills: Skill[];
  try {
    skills = getEnabledSkillsForConfig(appConfig);
  } catch (e) {
    console.error(`Failed to load skills for allowed-tools policy: ${String(e)}`);
    throw e;
  }

  if (availableSkills === null) {
    return skills;
  }
  return skills.filter((skill) => availableSkills.has(skill.name));
}

// ---------------------------------------------------------------------------
// make_lead_agent — LangGraph graph factory entry point
// ---------------------------------------------------------------------------

/**
 * LangGraph graph factory; keep the signature compatible with LangGraph Server.
 *
 * Mirrors Python `make_lead_agent`. Resolves the runtime `app_config` from
 * the config's `context` channel, falling back to the global `getAppConfig()`.
 */
export function makeLeadAgent(config: RunnableConfig): unknown {
  const runtimeConfig = _getRuntimeConfig(config);
  const runtimeAppConfig = (runtimeConfig["app_config"] as AppConfig | undefined) ?? null;
  return _makeLeadAgent(config, runtimeAppConfig ?? getAppConfig());
}

/**
 * Internal lead-agent constructor.
 *
 * Mirrors Python `_make_lead_agent`. Resolves model / thinking / plan mode /
 * subagent settings from the runtime config, loads agent config, injects
 * tracing metadata and callbacks at the graph invocation root, loads skills,
 * assembles tools (with tool-policy filtering and deferred-tool setup),
 * builds the middleware chain, and returns a compiled Quill agent graph.
 */
function _makeLeadAgent(config: RunnableConfig, appConfig: AppConfig): unknown {
  const cfg = _getRuntimeConfig(config);
  const resolvedAppConfig = appConfig;

  const thinkingEnabled = Boolean(cfg["thinking_enabled"] ?? true);
  const reasoningEffort = (cfg["reasoning_effort"] as string | null) ?? null;
  const requestedModelName =
    (cfg["model_name"] as string | null) ?? (cfg["model"] as string | null) ?? null;
  const isPlanMode = Boolean(cfg["is_plan_mode"] ?? false);
  const subagentEnabled = Boolean(cfg["subagent_enabled"] ?? false);
  const maxConcurrentSubagents = Number(cfg["max_concurrent_subagents"] ?? 3);
  const isBootstrap = Boolean(cfg["is_bootstrap"] ?? false);
  const agentName = validateAgentName(cfg["agent_name"] as string | null);

  const agentConfig = !isBootstrap ? loadAgentConfig(agentName) : null;
  const availableSkills = _availableSkillNames(agentConfig, isBootstrap);
  // Custom agent model from agent config (if any), or null to let
  // _resolveModelName pick the default.
  const agentModelName =
    agentConfig && agentConfig.model ? agentConfig.model : null;

  // Final model name resolution: request → agent config → global default.
  const modelName = _resolveModelName(requestedModelName ?? agentModelName, resolvedAppConfig);

  const modelConfig = resolvedAppConfig.models.find((m) => m.name === modelName);
  if (modelConfig === undefined) {
    throw new Error(
      "No chat model could be resolved. Please configure at least one model in config.yaml or provide a valid 'model_name'/'model' in the request.",
    );
  }

  // Degrade thinking mode if the model doesn't support it.
  let effectiveThinkingEnabled = thinkingEnabled;
  if (effectiveThinkingEnabled && !modelConfig.supportsThinking) {
    console.warn(
      `Thinking mode is enabled but model '${modelName}' does not support it; fallback to non-thinking mode.`,
    );
    effectiveThinkingEnabled = false;
  }

  console.info(
    `Create Agent(${agentName ?? "default"}) -> thinking_enabled: ${effectiveThinkingEnabled}, reasoning_effort: ${reasoningEffort}, model_name: ${modelName}, is_plan_mode: ${isPlanMode}, subagent_enabled: ${subagentEnabled}, max_concurrent_subagents: ${maxConcurrentSubagents}`,
  );

  // Inject run metadata for LangSmith trace tagging.
  const writableConfig = config as WritableRunnableConfig;
  if (!writableConfig.metadata) {
    writableConfig.metadata = {};
  }
  writableConfig.metadata["agent_name"] = agentName ?? "default";
  writableConfig.metadata["model_name"] = modelName ?? "default";
  writableConfig.metadata["thinking_enabled"] = effectiveThinkingEnabled;
  writableConfig.metadata["reasoning_effort"] = reasoningEffort;
  writableConfig.metadata["is_plan_mode"] = isPlanMode;
  writableConfig.metadata["subagent_enabled"] = subagentEnabled;
  writableConfig.metadata["tool_groups"] = agentConfig?.toolGroups ?? null;
  writableConfig.metadata["available_skills"] =
    availableSkills !== null ? Array.from(availableSkills).sort() : null;

  // Inject tracing callbacks at the graph invocation root so a single
  // LangGraph run produces one trace with all node / LLM / tool calls as
  // child spans, AND so the Langfuse handler sees on_chain_start with
  // parent_run_id=null and actually propagates langfuse_session_id /
  // langfuse_user_id from config.metadata onto the trace.
  const tracingCallbacks = buildTracingCallbacks();
  if (tracingCallbacks.length > 0) {
    const existing = (writableConfig.callbacks ?? []) as unknown[];
    // buildTracingCallbacks returns unknown[]; cast to the callback handler
    // type expected by RunnableConfig. The runtime values are valid
    // BaseCallbackHandler instances (LangChainTracer / Langfuse handler).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    writableConfig.callbacks = [...existing, ...tracingCallbacks] as any;
  }

  const userId = getEffectiveUserId();
  const skillsForToolPolicy = _loadEnabledSkillsForToolPolicy(availableSkills, resolvedAppConfig);

  // ------------------------------------------------------------------
  // Bootstrap path — minimal prompt for initial custom agent creation.
  // The `setup_agent` tool is injected so the LLM can persist the new
  // agent's SOUL.md and config.yaml.
  // ------------------------------------------------------------------
  if (isBootstrap) {
    const setupAgentTool = createSetupAgentTool({});
    const rawTools = getAvailableTools({
      modelName,
      subagentEnabled,
      appConfig: resolvedAppConfig,
      extraTools: [setupAgentTool],
    });
    // StructuredToolInterface has a `name` property but lacks the index
    // signature NamedTool requires; cast through unknown to bridge the gap.
    const filtered = filterToolsBySkillAllowedTools(
      rawTools as unknown as NamedTool[],
      skillsForToolPolicy,
    ) as unknown as StructuredToolInterface[];
    const [finalTools, setup] = assembleDeferredTools(filtered, {
      enabled: resolvedAppConfig.toolSearch?.enabled ?? false,
    });

    return createQuillAgent({
      model: createChatModel(modelName, effectiveThinkingEnabled, {
        appConfig: resolvedAppConfig,
        attachTracing: false,
      }),
      tools: finalTools,
      middleware: buildMiddlewares(config, modelName, null, null, {
        availableSkills: new Set(_BOOTSTRAP_SKILL_NAMES),
        appConfig: resolvedAppConfig,
        deferredSetup: setup,
        userId,
      }),
      systemPrompt: applyPromptTemplate({
        subagentEnabled,
        maxConcurrentSubagents,
        availableSkills: new Set(_BOOTSTRAP_SKILL_NAMES),
        appConfig: resolvedAppConfig,
        deferredNames: setup.deferredNames,
      }),
    });
  }

  // ------------------------------------------------------------------
  // Default path — full lead agent.
  // Inject `update_agent` for custom agents (agentName !== null), unless
  // the run originates from a webhook channel where self-mutation is unsafe.
  // ------------------------------------------------------------------
  const channelName = (cfg["channel_name"] as string | null) ?? null;
  const isWebhookChannel = _WEBHOOK_CHANNELS.has(channelName ?? "");
  const extraTools: StructuredToolInterface[] = [];
  if (agentName && !isWebhookChannel) {
    extraTools.push(createUpdateAgentTool({}));
  }
  const rawTools = getAvailableTools({
    modelName,
    groups: agentConfig?.toolGroups ?? null,
    subagentEnabled,
    appConfig: resolvedAppConfig,
    extraTools,
  });
  const filtered = filterToolsBySkillAllowedTools(
    rawTools as unknown as NamedTool[],
    skillsForToolPolicy,
  ) as unknown as StructuredToolInterface[];
  const [finalTools, setup] = assembleDeferredTools(filtered, {
    enabled: resolvedAppConfig.toolSearch?.enabled ?? false,
  });

  return createQuillAgent({
    model: createChatModel(modelName, effectiveThinkingEnabled, {
      appConfig: resolvedAppConfig,
      attachTracing: false,
      reasoningEffort: reasoningEffort ?? undefined,
    }),
    tools: finalTools,
    middleware: buildMiddlewares(config, modelName, agentName, null, {
      availableSkills,
      appConfig: resolvedAppConfig,
      deferredSetup: setup,
      userId,
    }),
    systemPrompt: applyPromptTemplate({
      subagentEnabled,
      maxConcurrentSubagents,
      agentName,
      availableSkills,
      appConfig: resolvedAppConfig,
      deferredNames: setup.deferredNames,
    }),
  });
}

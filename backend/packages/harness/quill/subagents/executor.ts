/**
 * Subagent execution engine.
 *
 * Mirrors `quill.subagents.executor` from the Python backend.
 *
 * Porting note on concurrency: the Python module bridges its synchronous
 * `execute()` API into an event loop with a `ThreadPoolExecutor` and a
 * persistent "isolated" asyncio loop (so a sync caller inside a running loop
 * does not clash on shared async clients). Node.js is single-threaded and
 * Promise-native, so that machinery has no TS analogue — `execute()` is simply
 * an async method here, and `executeAsync()` schedules the coroutine on the
 * event loop with a cooperative timeout. The observable data shapes and
 * lifecycle (statuses, result holder, background-task registry, cooperative
 * cancellation) are preserved faithfully.
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { StructuredToolInterface } from "@langchain/core/tools";

import { createQuillAgent, type MiddlewareDefinition } from "../agents/factory.js";
import {
  clarificationMiddleware,
  danglingToolCallMiddleware,
  dynamicContextMiddleware,
  inputSanitizationMiddleware,
  llmErrorHandlingMiddleware,
  sandboxAuditMiddleware,
  sandboxMiddleware,
  systemMessageCoalescingMiddleware,
  threadDataMiddleware,
  tokenBudgetMiddleware,
  tokenUsageMiddleware,
  toolErrorHandlingMiddleware,
  toolOutputBudgetMiddleware,
  uploadsMiddleware,
} from "../agents/middlewares/builtin.js";
import { deferredToolFilterMiddleware } from "../agents/middlewares/deferred_tool_filter_middleware.js";
import { createGuardrailMiddleware } from "../guardrails/loader.js";
import { createChatModel as createChatModelFromFactory } from "../models/factory.js";
import type {
  SandboxState,
  ThreadDataState,
  ThreadState,
} from "../agents/thread_state.js";
import type { AppConfig } from "../config/app_config.js";
import { getAppConfig } from "../config/app_config.js";
import {
  allowedToolNamesForSkills,
  filterToolsBySkillAllowedTools,
  type NamedTool,
} from "../skills/tool_policy.js";
import type { Skill } from "../skills/types.js";
import {
  assembleDeferredTools,
  getDeferredToolsPromptSection,
  type DeferredToolSetup,
} from "../tools/builtins/tool_search_tool.js";
export type { DeferredToolSetup } from "../tools/builtins/tool_search_tool.js";
import {
  assembleForSubagent,
  buildToolPolicy,
  type RuntimeToolCatalog,
  type ToolGroup,
} from "../tools/catalog.js";
import {
  resolveSubagentModelName,
  type SubagentConfig,
} from "./config.js";
import { SubagentTokenCollector, type TokenUsageRecord } from "./token_collector.js";
import { getOrNewSkillStorage } from "../skills/storage/index.js";
import { buildTracingCallbacks } from "../tracing/factory.js";
import { injectLangfuseMetadata } from "../tracing/metadata.js";

// ---------------------------------------------------------------------------
// Stubs for modules not yet ported to TypeScript.
// These mirror the Python call sites; see the porting report for the list of
// dependencies that still need real implementations.
// ---------------------------------------------------------------------------

/** Options for `quill.models.create_chat_model`. */
export interface CreateChatModelOptions {
  name: string;
  thinkingEnabled?: boolean;
  appConfig?: AppConfig;
  attachTracing?: boolean;
}

/**
 * Factory for building a chat model from a model NAME (mirrors
 * `quill.models.create_chat_model`). The primary model builder in this
 * runtime is `scripts/model_factory.mjs::buildChatModel`, which the composition
 * root (launcher) injects via {@link SubagentExecutorOptions.modelFactory}.
 */
export type ChatModelFactory = (options: CreateChatModelOptions) => BaseChatModel;

/**
 * Default factory for building a chat model from a model NAME.
 *
 * Delegates to the ported {@link createChatModelFromFactory}. The composition
 * root (launcher) can still inject a custom factory via
 * {@link SubagentExecutorOptions.modelFactory}.
 */
function createChatModel(options: CreateChatModelOptions): BaseChatModel {
  return createChatModelFromFactory(
    options.name,
    options.thinkingEnabled ?? false,
    {
      appConfig: options.appConfig,
      attachTracing: options.attachTracing,
    },
  );
}

/**
 * Build the standard middleware chain used by subagent graphs.
 *
 * Mirrors the essential runtime middlewares from the lead agent (sandbox
 * lifecycle, tool error handling, token tracking/budgets, deferred tool
 * filtering, clarification) without lead-only features such as plan-mode todo
 * tracking, auto-title, or subagent delegation limits.
 */
function buildSubagentRuntimeMiddlewares(options: {
  appConfig: AppConfig;
  modelName: string;
  lazyInit?: boolean;
  deferredSetup?: DeferredToolSetup | null;
  threadId?: string | null;
  userId?: string | null;
}): MiddlewareDefinition[] {
  const chain: MiddlewareDefinition[] = [];

  // [1] Sandbox infrastructure (per-user/per-thread path isolation).
  chain.push(
    threadDataMiddleware({
      threadId: options.threadId ?? null,
      userId: options.userId ?? null,
      lazyInit: options.lazyInit ?? true,
    }),
    uploadsMiddleware({
      threadId: options.threadId ?? null,
      userId: options.userId ?? null,
    }),
    sandboxMiddleware({ userId: options.userId ?? null }),
  );

  // [2] Input sanitization / system message coalescing.
  chain.push(inputSanitizationMiddleware());
  chain.push(systemMessageCoalescingMiddleware());

  // [3] Patch interrupted/incomplete tool calls.
  chain.push(danglingToolCallMiddleware());

  // [4] LLM error handling (shared base middleware, mirrors Python
  // `_build_runtime_middlewares` tail order: DanglingToolCall →
  // LLMErrorHandling → Guardrail → SandboxAudit → ToolErrorHandling). Without
  // LLMErrorHandlingMiddleware, transient/unrecoverable LLM errors throw
  // out of the model node and surface as `status=failed` instead of being
  // retried or gracefully degraded to a fallback AIMessage.
  chain.push(llmErrorHandlingMiddleware({ appConfig: options.appConfig }));

  // [4b] Guardrail — pre-tool-call authorization. Sub-agent bash calls are
  // constrained by the same command-level policy as the lead agent.
  const guardrail = createGuardrailMiddleware(options.appConfig.guardrails);
  if (guardrail !== null) {
    chain.push(guardrail);
  }

  chain.push(sandboxAuditMiddleware());

  // [5] Deferred tool filter (hide MCP schemas until promoted via tool_search).
  if (options.deferredSetup?.deferredNames?.size ?? 0 > 0) {
    chain.push(
      deferredToolFilterMiddleware(
        [...options.deferredSetup!.deferredNames],
        options.deferredSetup!.catalogHash ?? null,
      ),
    );
  }

  // [7] Tool error handling.
  chain.push(toolErrorHandlingMiddleware());

  // [8] Dynamic context (current date, memory hints).
  chain.push(dynamicContextMiddleware());

  // [9] Token tracking / budgets.
  chain.push(tokenUsageMiddleware());
  if (options.appConfig.tokenBudget?.enabled) {
    chain.push(tokenBudgetMiddleware(options.appConfig.tokenBudget));
  }
  chain.push(toolOutputBudgetMiddleware(options.appConfig.toolOutput ?? {}));

  // [10] Clarification (always last).
  chain.push(clarificationMiddleware());

  return chain;
}

// `get_or_new_skill_storage`, `build_tracing_callbacks` and
// `inject_langfuse_metadata` are imported from their real modules below — see
// the imports near the top of this file.

// ---------------------------------------------------------------------------
// Status + result data shapes
// ---------------------------------------------------------------------------

/** Status of a subagent execution. */
export enum SubagentStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
  TIMED_OUT = "timed_out",
}

const TERMINAL_STATUSES: ReadonlySet<SubagentStatus> = new Set([
  SubagentStatus.COMPLETED,
  SubagentStatus.FAILED,
  SubagentStatus.CANCELLED,
  SubagentStatus.TIMED_OUT,
]);

/** Whether a status is terminal (mirrors `SubagentStatus.is_terminal`). */
export function isTerminalStatus(status: SubagentStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Cooperative cancellation flag; the TS analogue of Python's `threading.Event`.
 * Cancellation is polled at `stream` iteration boundaries — long-running tool
 * calls within a single iteration are not interrupted until the next chunk.
 */
export class CancelEvent {
  private _set = false;

  isSet(): boolean {
    return this._set;
  }

  set(): void {
    this._set = true;
  }

  clear(): void {
    this._set = false;
  }
}

/** Optional overrides for a terminal transition. */
interface TerminalUpdate {
  result?: string | null;
  error?: string | null;
  completedAt?: Date | null;
  aiMessages?: Array<Record<string, unknown>> | null;
  tokenUsageRecords?: TokenUsageRecord[] | null;
}

/**
 * A captured step of the subagent's run — one AI turn or one tool result.
 * `_aexecute` appends to this as the stream produces messages (Phase C); the
 * poller ({@link subagents/runtime/poller.ts}) reads it to drive the live
 * `task_running` SSE events and the `subagent.step` timeline.
 */
export interface SubagentCapturedStep {
  /** Monotone per-subagent index (1-based). */
  message_index: number;
  kind: "ai" | "tool";
  text: string;
  tool_name?: string;
  tool_calls?: Array<{ name?: string; args?: unknown }>;
  truncated?: boolean;
}

/** Result of a subagent execution. */
export class SubagentResult {
  taskId: string;
  traceId: string;
  status: SubagentStatus;
  result: string | null;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  aiMessages: Array<Record<string, unknown>>;
  /** Captured AI+Tool steps, in stream order (new in Phase C). */
  steps: SubagentCapturedStep[];
  tokenUsageRecords: TokenUsageRecord[];
  usageReported: boolean;
  readonly cancelEvent: CancelEvent;

  constructor(fields: {
    taskId: string;
    traceId: string;
    status: SubagentStatus;
    result?: string | null;
    error?: string | null;
    startedAt?: Date | null;
    completedAt?: Date | null;
    aiMessages?: Array<Record<string, unknown>> | null;
    steps?: SubagentCapturedStep[] | null;
    tokenUsageRecords?: TokenUsageRecord[];
    usageReported?: boolean;
  }) {
    this.taskId = fields.taskId;
    this.traceId = fields.traceId;
    this.status = fields.status;
    this.result = fields.result ?? null;
    this.error = fields.error ?? null;
    this.startedAt = fields.startedAt ?? null;
    this.completedAt = fields.completedAt ?? null;
    // __post_init__: mutable default for ai_messages.
    this.aiMessages = fields.aiMessages ?? [];
    this.steps = fields.steps ?? [];
    this.tokenUsageRecords = fields.tokenUsageRecords ?? [];
    this.usageReported = fields.usageReported ?? false;
    this.cancelEvent = new CancelEvent();
  }

  /**
   * Set a terminal status exactly once.
   *
   * Background timeout/cancellation and the execution worker can race on the
   * same result holder. The first terminal transition wins; late terminal
   * writes must not change status or payload fields. (In Node's single-threaded
   * event loop there is no true lock contention, but the "first write wins"
   * guarantee is preserved.)
   */
  trySetTerminal(status: SubagentStatus, update: TerminalUpdate = {}): boolean {
    if (!isTerminalStatus(status)) {
      throw new Error(`Status ${status} is not terminal`);
    }

    if (isTerminalStatus(this.status)) {
      return false;
    }

    if (update.result !== undefined && update.result !== null) {
      this.result = update.result;
    }
    if (update.error !== undefined && update.error !== null) {
      this.error = update.error;
    }
    if (update.aiMessages !== undefined && update.aiMessages !== null) {
      this.aiMessages = update.aiMessages;
    }
    if (update.tokenUsageRecords !== undefined && update.tokenUsageRecords !== null) {
      this.tokenUsageRecords = update.tokenUsageRecords;
    }
    this.completedAt = update.completedAt ?? new Date();
    this.status = status;
    return true;
  }
}

// ---------------------------------------------------------------------------
// Background task registry
// ---------------------------------------------------------------------------

/** Global storage for background task results. */
const _backgroundTasks = new Map<string, SubagentResult>();

export const MAX_CONCURRENT_SUBAGENTS = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortId(): string {
  return randomUUID().slice(0, 8);
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Build a serializable dict from a message (mirrors `AIMessage.model_dump`). */
function messageToDict(message: BaseMessage): Record<string, unknown> {
  const stored = message.toDict();
  const data = (stored.data ?? {}) as unknown as Record<string, unknown>;
  return {
    ...data,
    type: message.getType(),
    id: message.id ?? (data.id as string | undefined) ?? null,
  };
}

/**
 * Coerce a message's content (string or list of content blocks) into text.
 *
 * Concatenates raw string chunks directly, but preserves separation between
 * full text blocks for readability.
 */
/** Cap on a single step's rendered text before persistence / wire transport. */
const SUBAGENT_STEP_MAX_CHARS = 4000;

/**
 * Clamp oversized step text — mirrors Python's `build_subagent_step`
 * `SUBAGENT_STEP_MAX_CHARS` cap so a single tool dump can't balloon the wire
 * payload or event store.
 */
function clampStepText(text: string): { text: string; truncated: boolean } {
  if (text.length <= SUBAGENT_STEP_MAX_CHARS) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, SUBAGENT_STEP_MAX_CHARS)}…[truncated]`,
    truncated: true,
  };
}

/** Build a serializable timeline step, capping oversized text. */
function buildStep(params: {
  kind: "ai" | "tool";
  messageIndex: number;
  text: string;
  toolCalls?: Array<{ name?: string; args?: unknown }>;
  toolName?: string;
}): import("./runtime/result.js").SubagentStep {
  const clamped = clampStepText(params.text);
  const step: import("./runtime/result.js").SubagentStep = {
    message_index: params.messageIndex,
    kind: params.kind,
    text: clamped.text,
    truncated: clamped.truncated,
  };
  if (params.kind === "ai" && params.toolCalls) {
    step.tool_calls = params.toolCalls;
  }
  if (params.kind === "tool" && params.toolName) {
    step.tool_name = params.toolName;
  }
  return step;
}

function coerceContentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    let pendingStrParts: string[] = [];
    for (const block of content) {
      if (typeof block === "string") {
        pendingStrParts.push(block);
      } else if (block !== null && typeof block === "object") {
        if (pendingStrParts.length > 0) {
          parts.push(pendingStrParts.join(""));
          pendingStrParts = [];
        }
        const textVal = (block as Record<string, unknown>).text;
        if (typeof textVal === "string") {
          parts.push(textVal);
        }
      }
    }
    if (pendingStrParts.length > 0) {
      parts.push(pendingStrParts.join(""));
    }
    return parts.length > 0 ? parts.join("\n") : "No text content in response";
  }
  return String(content);
}

// Tool-list derivation now flows through the converged {@link ToolPolicy} in
// `tools/catalog.ts`, which applies layers 0–3 (parent groups → allow → deny →
// skill allowed_tools) and always strips `task`. The legacy `filterTools`
// helper was removed in favour of that policy; see the constructor below.

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/** Constructor arguments for {@link SubagentExecutor}. */
export interface SubagentExecutorOptions {
  appConfig?: AppConfig | null;
  parentModel?: string | null;
  sandboxState?: SandboxState | null;
  threadData?: ThreadDataState | null;
  threadId?: string | null;
  traceId?: string | null;
  userId?: string | null;
  userRole?: string | null;
  oauthProvider?: string | null;
  oauthId?: string | null;
  runId?: string | null;
  /**
   * The parent lead agent's shared tool catalog. When provided, subagent tools
   * are sourced from the catalog instead of the static `tools` array passed to
   * the constructor, and {@link SubagentExecutorOptions.parentToolGroups}
   * restricts inheritance to the groups the lead was authorised for (the first
   * of the four permission layers). This is how lead + subagents share one
   * group-keyed source of truth.
   */
  parentRuntimeCatalog?: RuntimeToolCatalog | null;
  /**
   * Group names the parent lead agent was authorised for. When
   * `parentRuntimeCatalog` is set, only tools in these groups are
   * inheritable. Null/empty ⇒ lead authorised for all groups (no intersection).
   */
  parentToolGroups?: string[] | null;
  /**
   * Group to assign tools that are not already present in the parent catalog
   * (defensive fallback; the launcher should tag everything). Defaults to
   * "subagent".
   */
  fallbackToolGroup?: ToolGroup;
  /**
   * Allow a concrete `ToolPolicy` for layering — advanced callers / tests can
   * pass a pre-built policy instead of deriving one from the catalog. When set
   * it takes precedence over the catalog path for the *base* tool list; the
   * skill layer is still applied on top in `_applySkillAlreadyTools`.
   */
  toolPolicy?: import("../tools/catalog.js").ToolPolicy | null;
  /**
   * Inject a working chat-model builder (the composition root passes
   * `buildChatModel` from `scripts/model_factory.mjs`). When omitted, model
   * construction falls back to the throwing stub.
   */
  modelFactory?: ChatModelFactory | null;
}

/** Executor for running subagents. */
export class SubagentExecutor {
  readonly config: SubagentConfig;
  readonly appConfig: AppConfig | null;
  readonly parentModel: string | null;
  modelName: string | null;
  readonly sandboxState: SandboxState | null;
  readonly threadData: ThreadDataState | null;
  readonly threadId: string | null;
  readonly traceId: string;
  readonly userId: string | null;
  readonly userRole: string | null;
  readonly oauthProvider: string | null;
  readonly oauthId: string | null;
  readonly runId: string | null;
  readonly parentRuntimeCatalog: RuntimeToolCatalog | null;
  readonly parentToolGroups: string[] | null;

  private readonly _modelFactory: ChatModelFactory;

  private readonly _baseTools: StructuredToolInterface[];
  /** The converged policy applied to derive `_baseTools` (policy path only). */
  private readonly _toolPolicy: import("../tools/catalog.js").ToolPolicy | null;
  tools: StructuredToolInterface[];

  constructor(
    config: SubagentConfig,
    tools: StructuredToolInterface[],
    options: SubagentExecutorOptions = {}
  ) {
    this.config = config;
    this.appConfig = options.appConfig ?? null;
    this.parentModel = options.parentModel ?? null;

    // Resolve eagerly only when it does not require loading config.yaml;
    // otherwise defer to _createAgent (which already loads app_config) so unit
    // tests can construct executors without a config file present.
    if (
      config.model !== "inherit" ||
      this.parentModel !== null ||
      this.appConfig !== null
    ) {
      this.modelName = resolveSubagentModelName(config, this.parentModel, {
        appConfig: this.appConfig,
      });
    } else {
      this.modelName = null;
    }

    this.sandboxState = options.sandboxState ?? null;
    this.threadData = options.threadData ?? null;
    this.threadId = options.threadId ?? null;
    // Generate trace_id if not provided (for top-level calls).
    this.traceId = options.traceId || shortId();
    this.userId = options.userId ?? null;
    // Guardrail attribution propagated from the parent runtime context.
    this.userRole = options.userRole ?? null;
    this.oauthProvider = options.oauthProvider ?? null;
    this.oauthId = options.oauthId ?? null;
    this.runId = options.runId ?? null;
    this.parentRuntimeCatalog = options.parentRuntimeCatalog ?? null;
    this.parentToolGroups = options.parentToolGroups ?? null;
    this._modelFactory = options.modelFactory ?? createChatModel;

    // Derive the base tool list. Three paths, in priority order:
    //   1. an explicit `toolPolicy` (advanced/tests);
    //   2. the shared `parentRuntimeCatalog`, narrowed by `parentToolGroups`;
    //   3. the static `tools` array (backward-compat).
    // In every path `task` is stripped and the four-layer policy (groups →
    // allow → deny) is applied; the skill layer is layered on later in
    // `_applySkillAlreadyTools`.
    if (options.toolPolicy !== undefined && options.toolPolicy !== null) {
      this._toolPolicy = options.toolPolicy;
      this._baseTools = options.toolPolicy.resolve(null).map((c) => c.tool);
    } else if (this.parentRuntimeCatalog !== null && this.parentRuntimeCatalog.size > 0) {
      this._toolPolicy = buildToolPolicy(
        [],
        this.parentRuntimeCatalog,
        options.fallbackToolGroup ?? "subagent",
        this.parentToolGroups,
        config.tools,
        config.disallowedTools,
      );
      this._baseTools = this._toolPolicy.resolve(null).map((c) => c.tool);
    } else {
      // No catalog — backward-compat plain-array path. Still route through the
      // policy so `task` is always stripped and allow/deny behave identically.
      this._toolPolicy = null;
      this._baseTools = assembleForSubagent(null, {
        tools,
        configAllowlist: config.tools,
        configDenylist: config.disallowedTools,
        parentGroups: null,
        fallbackGroup: options.fallbackToolGroup ?? "subagent",
      });
    }
    this.tools = this._baseTools;

    console.info(
      `[trace=${this.traceId}] SubagentExecutor initialized: ${config.name} with ${this.tools.length} tools${
        this.parentToolGroups ? ` (groups=${this.parentToolGroups.join(",")})` : ""
      }${this._toolPolicy ? " [policy]" : " [compat]"}`
    );
  }

  /**
   * Create the agent instance.
   *
   * `deferredSetup` (assembled in `_buildInitialState`) carries the deferred MCP
   * tool names + catalog hash so the subagent gets the same
   * DeferredToolFilterMiddleware the lead agent has. `null` is a no-op.
   */
  private _createAgent(
    tools?: StructuredToolInterface[] | null,
    options: { deferredSetup?: DeferredToolSetup | null } = {}
  ): unknown {
    const appConfig = this.appConfig ?? getAppConfig();
    if (this.modelName === null) {
      this.modelName = resolveSubagentModelName(this.config, this.parentModel, { appConfig });
    }
    const model = this._modelFactory({
      name: this.modelName,
      thinkingEnabled: false,
      appConfig,
      attachTracing: false,
    });

    // Reuse shared middleware composition with lead agent.
    const middlewares = buildSubagentRuntimeMiddlewares({
      appConfig,
      modelName: this.modelName,
      lazyInit: true,
      deferredSetup: options.deferredSetup ?? null,
      threadId: this.threadId,
      userId: this.userId,
    });

    // system_prompt is included in initial state messages (see
    // _buildInitialState) to avoid multiple SystemMessages which some LLM APIs
    // don't support.
    return createQuillAgent({
      model,
      tools: tools ?? this.tools,
      middleware: middlewares,
      systemPrompt: null,
      // Checkpointer isolation: subagents are one-shot and never resume, so
      // do not inherit the parent run's checkpointer. This avoids cluttering
      // the checkpoint store with transient subagent state.
      checkpointer: false,
    });
  }

  /** Load enabled skill metadata based on config.skills. */
  private async _loadSkills(): Promise<Skill[]> {
    // Align with Python: null = load all enabled skills, [] = none, ["a"] = whitelist.
    if (this.config.skills !== null && this.config.skills.length === 0) {
      console.info(
        `[trace=${this.traceId}] Subagent ${this.config.name} skills=[] — skipping skill loading`
      );
      return [];
    }

    let allSkills: Skill[];
    try {
      const storage = getOrNewSkillStorage(
        this.appConfig !== null ? { appConfig: this.appConfig } : {}
      );
      allSkills = await storage.loadSkills(true);
      console.info(
        `[trace=${this.traceId}] Subagent ${this.config.name} loaded ${allSkills.length} enabled skills from disk`
      );
    } catch (error) {
      console.error(
        `[trace=${this.traceId}] Failed to load skills for subagent ${this.config.name}`,
        error
      );
      throw error;
    }

    if (allSkills.length === 0) {
      console.info(
        `[trace=${this.traceId}] Subagent ${this.config.name} no enabled skills found`
      );
      return [];
    }

    // Filter by config.skills whitelist.
    if (this.config.skills !== null) {
      const allowed = new Set(this.config.skills);
      return allSkills.filter((s) => allowed.has(s.name));
    }
    return allSkills;
  }

  /**
   * Apply the loaded skills' allowed-tools layer on top of the base tools.
   *
   * When a policy was used to derive `_baseTools`, re-resolve it through the
   * policy with the skill layer so an allowed-by-skill tool can't slip past
   * the group/allow/deny layers. Otherwise fall back to the legacy
   * `filterToolsBySkillAllowedTools` over `_baseTools`.
   */
  private _applySkillAllowedTools(skills: Skill[]): StructuredToolInterface[] {
    if (this._toolPolicy !== null) {
      const allowed = allowedToolNamesForSkills(skills);
      return this._toolPolicy.resolve(allowed).map((c) => c.tool);
    }
    // StructuredToolInterface (an interface) lacks the implicit index signature
    // `NamedTool` requires, so bridge through `unknown` — the filter only reads
    // each tool's `name`.
    return filterToolsBySkillAllowedTools(
      this._baseTools as unknown as NamedTool[],
      skills
    ) as unknown as StructuredToolInterface[];
  }

  /**
   * Load skill content as conversation items based on config.skills.
   *
   * Aligned with Codex's pattern: each subagent loads its own skills per-session
   * and injects them as conversation items (developer messages), not as system
   * prompt text. The config.skills whitelist controls which skills are loaded:
   * - null: load all enabled skills
   * - []: no skills
   * - ["skill-a", "skill-b"]: only these skills
   */
  private async _loadSkillMessages(skills: Skill[]): Promise<SystemMessage[]> {
    if (skills.length === 0) {
      return [];
    }

    // Read each skill's SKILL.md content and create conversation items.
    const messages: SystemMessage[] = [];
    for (const skill of skills) {
      try {
        let content = await readFile(skill.skillFile, "utf-8");
        content = content.trim();
        if (content) {
          messages.push(
            new SystemMessage(`<skill name="${skill.name}">\n${content}\n</skill>`)
          );
          console.info(
            `[trace=${this.traceId}] Subagent ${this.config.name} loaded skill: ${skill.name}`
          );
        }
      } catch (error) {
        console.debug(
          `[trace=${this.traceId}] Failed to read skill ${skill.name}`,
          error
        );
      }
    }

    return messages;
  }

  /**
   * Build the initial state for agent execution.
   *
   * Returns `[state, finalTools, deferredSetup]`. `finalTools` is the
   * policy-filtered tool list with the `tool_search` tool appended when deferral
   * applies; `deferredSetup` is consumed by `_createAgent` so the agent build
   * and the injected `<available-deferred-tools>` section share one catalog/hash.
   */
  private async _buildInitialState(
    task: string
  ): Promise<[Record<string, unknown>, StructuredToolInterface[], DeferredToolSetup]> {
    // Load skills as conversation items (Codex pattern).
    const skills = await this._loadSkills();
    const filteredTools = this._applySkillAllowedTools(skills);
    // Assemble deferred tool_search AFTER policy filtering (fail-closed),
    // mirroring the lead path so subagents stop binding full MCP schemas.
    const enabled = (this.appConfig ?? getAppConfig()).toolSearch.enabled;
    const [finalTools, deferredSetup] = assembleDeferredTools(filteredTools, { enabled });
    const skillMessages = await this._loadSkillMessages(skills);

    // Combine system_prompt and skills into a single SystemMessage. Some LLM
    // APIs reject multiple SystemMessages with "System message must be at the
    // beginning."
    const systemParts: string[] = [];
    if (this.config.systemPrompt) {
      systemParts.push(this.config.systemPrompt);
    }
    for (const skillMsg of skillMessages) {
      systemParts.push(
        typeof skillMsg.content === "string"
          ? skillMsg.content
          : JSON.stringify(skillMsg.content)
      );
    }
    // Name the deferred MCP tools in the prompt; their schemas stay withheld
    // until tool_search promotes them. Empty set -> "" -> appends nothing.
    const deferredSection = getDeferredToolsPromptSection({
      deferredNames: deferredSetup.deferredNames,
    });
    if (deferredSection) {
      systemParts.push(deferredSection);
    }

    const messages: BaseMessage[] = [];
    if (systemParts.length > 0) {
      messages.push(new SystemMessage(systemParts.join("\n\n")));
    }

    // Then the actual task.
    messages.push(new HumanMessage(task));

    const state: Record<string, unknown> = { messages };

    // Pass through sandbox and thread data from parent.
    if (this.sandboxState !== null) {
      state.sandbox = this.sandboxState;
    }
    if (this.threadData !== null) {
      state.thread_data = this.threadData;
    }

    return [state, finalTools, deferredSetup];
  }

  /**
   * Execute a task asynchronously.
   *
   * `resultHolder` is an optional pre-created result object to update during
   * execution (used by the background path for real-time updates).
   */
  async _aexecute(task: string, resultHolder?: SubagentResult | null): Promise<SubagentResult> {
    let result: SubagentResult;
    if (resultHolder !== undefined && resultHolder !== null) {
      // Use the provided result holder (for async execution with real-time updates).
      result = resultHolder;
    } else {
      // Create a new result for synchronous execution.
      result = new SubagentResult({
        taskId: shortId(),
        traceId: this.traceId,
        status: SubagentStatus.RUNNING,
        startedAt: new Date(),
      });
    }
    const aiMessages = result.aiMessages;
    // O(1) duplicate detection for streamed AI messages. `stream_mode="values"`
    // re-yields the full state every super-step, so the same trailing message is
    // re-examined on each chunk; an id-keyed set keeps that check O(1).
    const seenMessageIds = new Set<string>();
    for (const msg of aiMessages) {
      const mid = msg.id;
      if (typeof mid === "string" && mid) {
        seenMessageIds.add(mid);
      }
    }

    let collector: SubagentTokenCollector | null = null;
    try {
      const [state, finalTools, deferredSetup] = await this._buildInitialState(task);
      const agent = this._createAgent(finalTools, { deferredSetup }) as {
        stream: (
          input: unknown,
          options: Record<string, unknown>
        ) => Promise<AsyncIterable<Record<string, unknown>>>;
      };

      // Token collector for subagent LLM calls.
      const collectorCaller = `subagent:${this.config.name}`;
      collector = new SubagentTokenCollector(collectorCaller);

      // Build config with thread_id for sandbox access and recursion limit.
      const callbacks: BaseCallbackHandler[] = [collector];
      const runConfig: RunnableConfig = {
        recursionLimit: this.config.maxTurns,
        callbacks,
        tags: [collectorCaller],
      };

      // Inject tracing callbacks at the graph level so a single subagent run
      // produces one trace with all node / LLM / tool calls as child spans.
      const tracingCallbacks = buildTracingCallbacks() as BaseCallbackHandler[];
      if (tracingCallbacks.length > 0) {
        runConfig.callbacks = [...callbacks, ...tracingCallbacks];
      }

      // Normalize subagent name for tracing so it matches the lead-agent naming
      // shape (lowercase, hyphens only).
      let assistantId: string;
      if (this.config.name) {
        const normalizedName = this.config.name.trim().toLowerCase().replace(/_/g, "-");
        assistantId = `subagent:${normalizedName}`;
      } else {
        assistantId = "subagent";
      }

      // Inject Langfuse trace-attribute metadata so the subagent trace links to
      // the parent thread and carries the correct session/user IDs.
      injectLangfuseMetadata({
        config: runConfig as unknown as Record<string, unknown>,
        threadId: this.threadId,
        userId: this.userId,
        assistantId,
        modelName: this.modelName,
        environment: process.env.QUILL_ENV ?? process.env.ENVIRONMENT,
      });

      const context: Record<string, unknown> = {};
      if (this.threadId) {
        runConfig.configurable = { thread_id: this.threadId };
        context.thread_id = this.threadId;
      }
      if (this.appConfig !== null) {
        context.app_config = this.appConfig;
      }
      // Propagate guardrail attribution so delegated tool calls are evaluated
      // with the parent run's identity (role-aware policy, audit).
      context.user_id = this.userId;
      context.user_role = this.userRole;
      context.oauth_provider = this.oauthProvider;
      context.oauth_id = this.oauthId;
      context.run_id = this.runId;
      context.is_subagent = true;

      console.info(
        `[trace=${this.traceId}] Subagent ${this.config.name} starting async execution with max_turns=${this.config.maxTurns}`
      );

      // Use stream instead of invoke to get real-time updates. This allows us to
      // collect AI messages as they are generated.
      let finalState: Record<string, unknown> | null = null;
      // Number of messages already consumed from previous chunks in the stream
      // (`messages` grows monotonically across `values` chunks — it is the
      // full accumulated list, not a delta, so we walk only the appended tail).
      let seenMessageCount = 0;
      // Monotone per-subagent step counter — an integer step index shared by AI
      // and Tool steps so the timeline interleaves reasoning + tool runs.
      let stepIndex = 0;

      // Pre-check: bail out immediately if already cancelled before streaming.
      if (result.cancelEvent.isSet()) {
        console.info(
          `[trace=${this.traceId}] Subagent ${this.config.name} cancelled before streaming`
        );
        result.trySetTerminal(SubagentStatus.CANCELLED, {
          error: "Cancelled by user",
          tokenUsageRecords: collector.snapshotRecords(),
        });
        return result;
      }

      const stream = await agent.stream(state, {
        ...runConfig,
        context,
        streamMode: "values",
      });

      for await (const chunk of stream) {
        // Cooperative cancellation: check if parent requested stop. Cancellation
        // is only detected at stream iteration boundaries, so long-running tool
        // calls within a single iteration will not be interrupted until the next
        // chunk is yielded.
        if (result.cancelEvent.isSet()) {
          console.info(
            `[trace=${this.traceId}] Subagent ${this.config.name} cancelled by parent`
          );
          result.trySetTerminal(SubagentStatus.CANCELLED, {
            error: "Cancelled by user",
            tokenUsageRecords: collector.snapshotRecords(),
          });
          return result;
        }

        finalState = chunk;

        // Walk the APPENDED tail of the message list (everything after the
        // messages we already processed for the previous chunk) and capture each
        // new AI and Tool message as a step. AI-only watchers (above) missed the
        // ToolMessage outputs that follow a tool call — fixing #3779 means we
        // capture BOTH so the subtask timeline interleaves reasoning and tool
        // runs in stream order. A monotone `stepIndex` numbers everything.
        const messages = (chunk.messages as BaseMessage[] | undefined) ?? [];
        if (messages.length > seenMessageCount) {
          for (let i = seenMessageCount; i < messages.length; i++) {
            const msg = messages[i];
            if (msg instanceof AIMessage) {
              const messageDict = messageToDict(msg);
              const messageId = messageDict.id;
              let isDuplicate: boolean;
              if (typeof messageId === "string" && messageId) {
                isDuplicate = seenMessageIds.has(messageId);
              } else {
                const serialized = JSON.stringify(messageDict);
                isDuplicate = aiMessages.some((m) => JSON.stringify(m) === serialized);
              }
              if (isDuplicate) {
                continue;
              }
              aiMessages.push(messageDict);
              if (typeof messageId === "string" && messageId) {
                seenMessageIds.add(messageId);
              }
              stepIndex += 1;
              const text = coerceContentToText(msg.content);
              const step = buildStep({
                kind: "ai",
                messageIndex: stepIndex,
                text,
                toolCalls: messageDict.tool_calls as
                  | Array<{ name?: string; args?: unknown }>
                  | undefined,
              });
              result.steps.push(step);
              console.info(
                `[trace=${this.traceId}] Subagent ${this.config.name} captured AI step #${stepIndex}`
              );
            } else if (msg instanceof ToolMessage) {
              const rawName = (msg as ToolMessage).name ?? undefined;
              const rawContent = (msg as ToolMessage).content;
              stepIndex += 1;
              const text = coerceContentToText(rawContent);
              const step = buildStep({
                kind: "tool",
                messageIndex: stepIndex,
                text,
                toolName: typeof rawName === "string" && rawName ? rawName : undefined,
              });
              result.steps.push(step);
              console.info(
                `[trace=${this.traceId}] Subagent ${this.config.name} captured Tool step #${stepIndex} (${
                  typeof rawName === "string" && rawName ? rawName : "tool"
                })`
              );
            }
            // Other message kinds (System/Human) are not timeline steps.
          }
          seenMessageCount = messages.length;
        }
      }

      console.info(
        `[trace=${this.traceId}] Subagent ${this.config.name} completed async execution`
      );
      const tokenUsageRecords = collector.snapshotRecords();
      let finalResult: string | null = null;

      if (finalState === null) {
        console.warn(`[trace=${this.traceId}] Subagent ${this.config.name} no final state`);
        finalResult = "No response generated";
      } else {
        // Extract the final message - find the last AIMessage.
        const messages = (finalState.messages as BaseMessage[] | undefined) ?? [];
        console.info(
          `[trace=${this.traceId}] Subagent ${this.config.name} final messages count: ${messages.length}`
        );

        // Find the last AIMessage in the conversation.
        let lastAiMessage: AIMessage | null = null;
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg instanceof AIMessage) {
            lastAiMessage = msg;
            break;
          }
        }

        if (lastAiMessage !== null) {
          finalResult = coerceContentToText(lastAiMessage.content);
        } else if (messages.length > 0) {
          // Fallback: use the last message if no AIMessage found.
          const lastMessage = messages[messages.length - 1];
          console.warn(
            `[trace=${this.traceId}] Subagent ${this.config.name} no AIMessage found, using last message`
          );
          const rawContent =
            lastMessage !== undefined && "content" in lastMessage
              ? lastMessage.content
              : String(lastMessage);
          finalResult = coerceContentToText(rawContent);
        } else {
          console.warn(
            `[trace=${this.traceId}] Subagent ${this.config.name} no messages in final state`
          );
          finalResult = "No response generated";
        }
      }

      if (finalResult === null) {
        finalResult = "No response generated";
      }

      result.trySetTerminal(SubagentStatus.COMPLETED, {
        result: finalResult,
        tokenUsageRecords,
      });
    } catch (error) {
      console.error(
        `[trace=${this.traceId}] Subagent ${this.config.name} async execution failed`,
        error
      );
      result.trySetTerminal(SubagentStatus.FAILED, {
        error: stringifyError(error),
        tokenUsageRecords: collector !== null ? collector.snapshotRecords() : null,
      });
    }

    return result;
  }

  /**
   * Execute a task (async wrapper mirroring Python's sync `execute()`).
   *
   * The Python variant blocks on an isolated event loop when called from within
   * a running loop; in Node there is no sync-over-async bridge, so this simply
   * awaits `_aexecute`.
   */
  async execute(task: string, resultHolder?: SubagentResult | null): Promise<SubagentResult> {
    try {
      return await this._aexecute(task, resultHolder);
    } catch (error) {
      console.error(
        `[trace=${this.traceId}] Subagent ${this.config.name} execution failed`,
        error
      );
      // Create a result with error if we don't have one.
      const result =
        resultHolder ??
        new SubagentResult({
          taskId: shortId(),
          traceId: this.traceId,
          status: SubagentStatus.RUNNING,
        });
      result.trySetTerminal(SubagentStatus.FAILED, { error: stringifyError(error) });
      return result;
    }
  }

  /**
   * Start a task execution in the background.
   *
   * Returns a task ID that can be used to check status later.
   */
  executeAsync(task: string, taskId?: string | null): string {
    // Use provided task_id or generate a new one.
    const id = taskId ?? shortId();

    // Create initial pending result.
    const result = new SubagentResult({
      taskId: id,
      traceId: this.traceId,
      status: SubagentStatus.PENDING,
    });

    console.info(
      `[trace=${this.traceId}] Subagent ${this.config.name} starting async execution, task_id=${id}, timeout=${this.config.timeoutSeconds}s`
    );

    _backgroundTasks.set(id, result);

    // Schedule execution on the event loop (the TS analogue of submitting to the
    // scheduler pool). Fire-and-forget: status is tracked via _backgroundTasks.
    void this._runBackgroundTask(task, id);

    return id;
  }

  private async _runBackgroundTask(task: string, taskId: string): Promise<void> {
    const resultHolder = _backgroundTasks.get(taskId);
    if (resultHolder === undefined) {
      return;
    }
    resultHolder.status = SubagentStatus.RUNNING;
    resultHolder.startedAt = new Date();

    const timeoutMs = this.config.timeoutSeconds * 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutMarker = Symbol("subagent-timeout");
    const timeoutPromise = new Promise<typeof timeoutMarker>((resolve) => {
      timer = setTimeout(() => resolve(timeoutMarker), timeoutMs);
    });

    try {
      const outcome = await Promise.race([
        this._aexecute(task, resultHolder).then(() => "done" as const),
        timeoutPromise,
      ]);
      if (outcome === timeoutMarker) {
        console.error(
          `[trace=${this.traceId}] Subagent ${this.config.name} execution timed out after ${this.config.timeoutSeconds}s`
        );
        // Signal cooperative cancellation; the run stops at the next boundary.
        resultHolder.cancelEvent.set();
        resultHolder.trySetTerminal(SubagentStatus.TIMED_OUT, {
          error: `Execution timed out after ${this.config.timeoutSeconds} seconds`,
        });
      }
    } catch (error) {
      console.error(
        `[trace=${this.traceId}] Subagent ${this.config.name} async execution failed`,
        error
      );
      const taskResult = _backgroundTasks.get(taskId) ?? resultHolder;
      taskResult.trySetTerminal(SubagentStatus.FAILED, { error: stringifyError(error) });
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Background task registry API
// ---------------------------------------------------------------------------

/**
 * Signal a running background task to stop.
 *
 * Sets the cancel_event on the task, which is checked cooperatively by
 * `_aexecute` during streaming iteration.
 */
export function requestCancelBackgroundTask(taskId: string): void {
  const result = _backgroundTasks.get(taskId);
  if (result !== undefined) {
    result.cancelEvent.set();
    console.info(`Requested cancellation for background task ${taskId}`);
  }
}

/** Get the result of a background task. */
export function getBackgroundTaskResult(taskId: string): SubagentResult | null {
  return _backgroundTasks.get(taskId) ?? null;
}

/** List all background tasks. */
export function listBackgroundTasks(): SubagentResult[] {
  return [..._backgroundTasks.values()];
}

/**
 * Remove a completed task from background tasks.
 *
 * Should be called by task_tool after it finishes polling and returns the
 * result. This prevents memory leaks from accumulated completed tasks.
 *
 * Only removes tasks that are in a terminal state (COMPLETED/FAILED/TIMED_OUT)
 * to avoid race conditions with the background executor still updating the task
 * entry.
 */
export function cleanupBackgroundTask(taskId: string): void {
  const result = _backgroundTasks.get(taskId);
  if (result === undefined) {
    // Nothing to clean up; may have been removed already.
    console.debug(`Requested cleanup for unknown background task ${taskId}`);
    return;
  }

  // Only clean up tasks that are in a terminal state to avoid races with the
  // background executor still updating the task entry.
  if (isTerminalStatus(result.status) || result.completedAt !== null) {
    _backgroundTasks.delete(taskId);
    console.debug(`Cleaned up background task: ${taskId}`);
  } else {
    console.debug(
      `Skipping cleanup for non-terminal background task ${taskId} (status=${result.status})`
    );
  }
}

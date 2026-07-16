/**
 * TypeScript agent runtime built on @langchain/langgraph.
 *
 * This mirrors the Python `quill.agents.factory.create_quill_agent`
 * contract but compiles to a native JS StateGraph that can run in Node.js.
 *
 * Architecture note: LangGraph JS has strict compile-time node typing, so
 * instead of adding dynamic middleware nodes in a loop we use explicit nodes:
 *
 *   START -> prepare -> beforeModel -> model -> afterModel -> tools -> afterAgent -> END
 *                                              ^                              |
 *                                              |______________________________|
 *
 * All beforeModel hooks run sequentially inside the `beforeModel` node; all
 * afterModel hooks inside `afterModel`; all afterAgent hooks inside `afterAgent`.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { StructuredToolInterface } from "@langchain/core/tools";
import {
  Annotation,
  END,
  START,
  StateGraph,
  messagesStateReducer,
  type CompiledStateGraph,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";

import {
  DEFAULT_RUNTIME_FEATURES,
  type MiddlewareClass,
  type RuntimeFeatures,
} from "./features.js";
import {
  clarificationMiddleware,
  danglingToolCallMiddleware,
  dynamicContextMiddleware,
  inputSanitizationMiddleware,
  llmErrorHandlingMiddleware,
  loopDetectionMiddleware,
  safetyFinishReasonMiddleware,
  sandboxAuditMiddleware,
  sandboxMiddleware,
  systemMessageCoalescingMiddleware,
  threadDataMiddleware,
  titleMiddleware,
  todoMiddleware,
  tokenBudgetMiddleware,
  tokenUsageMiddleware,
  toolErrorHandlingMiddleware,
  toolOutputBudgetMiddleware,
  uploadsMiddleware,
  viewImageMiddleware,
} from "./middlewares/builtin.js";
import { subagentLimitMiddleware } from "./middlewares/subagent_limit_middleware.js";
import { skillActivationMiddleware, type SkillActivationOptions } from "./middlewares/skill_activation_middleware.js";
import { durableContextMiddleware } from "./middlewares/durable_context_middleware.js";
import { toolSearchMiddleware } from "./middlewares/tool_search_middleware.js";
import { memoryMiddleware, type MemoryMiddlewareOptions } from "./middlewares/memory_middleware.js";
import { deferredToolFilterMiddleware } from "./middlewares/deferred_tool_filter_middleware.js";
import { getAppConfig } from "../config/app_config.js";
import { buildTokenBudgetConfig } from "../config/token_budget_config.js";
import { buildToolOutputConfig } from "../config/tool_output_config.js";
import {
  type PromotedTools,
  type SandboxState,
  type ThreadDataState,
  type ThreadState,
  type ViewedImageData,
  mergeArtifacts,
  mergeInternal,
  mergePromoted,
  mergeSandbox,
  mergeTodos,
  mergeViewedImages,
} from "./thread_state.js";

export { ThreadState, type RuntimeFeatures };

/**
 * Symbol used by middleware tools to return a raw state update instead of a
 * string ToolMessage payload. Mirrors Python's `Command(update=...)` return
 * from middleware-created tools such as `write_todos`.
 */
export const STATE_UPDATE = Symbol.for("quill.state_update");

/** Tool call as emitted by the model. */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Request passed to model-call wrappers. */
export interface ModelRequest {
  messages: BaseMessage[];
  /** Active tool set; populated by the runtime so wrappers can filter it. */
  tools?: StructuredToolInterface[];
  /** Current thread state; populated by the runtime for state-aware wrappers. */
  state?: ThreadState;
  /** Current run id; populated by the runtime for run-scoped wrappers. */
  runId?: string | null;
}

/** Request passed to tool-call wrappers. */
export interface ToolCallRequest {
  name: string;
  args: Record<string, unknown>;
  tool_call_id: string;
  state: ThreadState;
}

/** A model-call wrapper; mirrors Python ``wrap_model_call``. */
export type ModelCallWrapper = (
  request: ModelRequest,
  handler: (request: ModelRequest) => Promise<BaseMessage>
) => Promise<BaseMessage>;

/** A tool-call wrapper; mirrors Python ``wrap_tool_call``. */
export type ToolCallWrapper = (
  request: ToolCallRequest,
  handler: (request: ToolCallRequest) => Promise<BaseMessage | Partial<ThreadState>>
) => Promise<BaseMessage | Partial<ThreadState>>;

/** A node that can mutate agent state. */
export type MiddlewareNode = (
  state: ThreadState,
  config?: RunnableConfig
) => Partial<ThreadState> | Promise<Partial<ThreadState>> | void | Promise<void>;

export interface MiddlewareDefinition {
  name: string;
  /** Node invoked before the model call. */
  beforeModel?: MiddlewareNode;
  /** Node invoked after the model call (before tool execution). */
  afterModel?: MiddlewareNode;
  /** Node invoked after all tool calls for the step have completed. */
  afterAgent?: MiddlewareNode;
  /** Wrap an individual model invocation. */
  wrapModelCall?: ModelCallWrapper;
  /** Wrap an individual tool invocation. */
  wrapToolCall?: ToolCallWrapper;
  /** Tools contributed by this middleware (e.g. write_todos). */
  tools?: StructuredToolInterface[];
}

export interface CreateQuillAgentOptions {
  model: BaseChatModel;
  tools?: StructuredToolInterface[];
  systemPrompt?: string | null;
  middleware?: MiddlewareDefinition[];
  features?: RuntimeFeatures;
  extraMiddleware?: MiddlewareDefinition[];
  planMode?: boolean;
  name?: string;
  /** Optional checkpointer for thread persistence. Pass `false` to explicitly
   *  disable checkpointing (e.g. for one-shot subagents that never resume). */
  checkpointer?: BaseCheckpointSaver | false;
  /** Optional user id used by middlewares that need per-user isolation. */
  userId?: string | null;
  /** Optional callback that resolves the current user id at runtime. */
  getUserId?: () => string | null;
}

/**
 * Build the LangGraph state annotation for Quill threads.
 */
function buildThreadStateAnnotation() {
  return Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      // id-aware merge (LangGraph's add_messages): appends new messages and
      // replaces same-id messages in place, so re-emitting an existing message
      // (e.g. prepare prepending a system prompt) never duplicates it.
      reducer: messagesStateReducer,
      default: () => [],
    }),
    sandbox: Annotation<SandboxState | null | undefined>({
      reducer: mergeSandbox,
      default: () => undefined,
    }),
    thread_data: Annotation<ThreadDataState | null | undefined>({
      reducer: (_existing, incoming) => incoming,
      default: () => undefined,
    }),
    title: Annotation<string | null | undefined>({
      reducer: (_existing, incoming) => incoming,
      default: () => undefined,
    }),
    artifacts: Annotation<string[]>({
      reducer: mergeArtifacts,
      default: () => [],
    }),
    todos: Annotation<unknown[] | null | undefined>({
      reducer: mergeTodos,
      default: () => undefined,
    }),
    uploaded_files: Annotation<Array<Record<string, unknown>> | null | undefined>({
      reducer: (_existing, incoming) => incoming,
      default: () => undefined,
    }),
    viewed_images: Annotation<Record<string, ViewedImageData>>({
      reducer: mergeViewedImages,
      default: () => ({}),
    }),
    promoted: Annotation<PromotedTools | null | undefined>({
      reducer: mergePromoted,
      default: () => undefined,
    }),
    internal: Annotation<Record<string, unknown> | null | undefined>({
      reducer: mergeInternal,
      default: () => ({}),
    }),
    // jump_to: signal channel for forced re-engagement. Set by middleware
    // (e.g. TodoMiddleware._afterModel) to force routing back to "model".
    // Cleared by _beforeModel to prevent infinite loops. Mirrors the Python
    // hook_config(can_jump_to=["model"]) behavior in the custom JS graph.
    jump_to: Annotation<string | null | undefined>({
      reducer: (_existing: string | null | undefined, incoming: string | null | undefined) => incoming,
      default: () => undefined,
    }),

  });
}

/**
 * Assemble the middleware chain from feature flags.
 *
 * Mirrors Python `_assemble_from_features` with the same ordering.
 */
function assembleFromFeatures(
  features: RuntimeFeatures,
  _name: string,
  planMode: boolean,
  userContext: { userId?: string | null; getUserId?: () => string | null }
): MiddlewareDefinition[] {
  const chain: MiddlewareDefinition[] = [];

  // [0-2] Sandbox infrastructure
  if (features.sandbox !== false) {
    if (typeof features.sandbox === "object") {
      chain.push(features.sandbox as unknown as MiddlewareDefinition);
    } else {
      chain.push(
        threadDataMiddleware({ userId: userContext.userId }),
        uploadsMiddleware({ userId: userContext.userId }),
        sandboxMiddleware({ userId: userContext.userId, getUserId: userContext.getUserId }),
      );
    }
  }

  // [2.5] SandboxAudit — audits `bash` tool calls (wrapToolCall).
  if (features.sandboxAudit !== false) {
    if (typeof features.sandboxAudit === "object") {
      chain.push(features.sandboxAudit as unknown as MiddlewareDefinition);
    } else {
      chain.push(sandboxAuditMiddleware());
    }
  }

  // [3] Skill activation — inject SKILL.md on /skill-name commands.
  // Must run BEFORE inputSanitization so the slash prefix is still at the
  // start of the user message (sanitization wraps text in boundary markers).
  if (features.skillActivation !== false) {
    if (typeof features.skillActivation === "object") {
      chain.push(skillActivationMiddleware(features.skillActivation as unknown as SkillActivationOptions));
    } else {
      chain.push(skillActivationMiddleware());
    }
  }

  // [3.5] DurableContext — capture task delegations + loaded skill files into
  // checkpointed state channels, inject them ephemerally for the model.
  chain.push(durableContextMiddleware());

  // [4] Input sanitization — prompt-injection defense on the last user message.
  if (features.inputSanitization !== false) {
    if (typeof features.inputSanitization === "object") {
      chain.push(features.inputSanitization as unknown as MiddlewareDefinition);
    } else {
      chain.push(inputSanitizationMiddleware());
    }
  }

  // [5] System message coalescing — merge multiple SystemMessages into one.
  if (features.systemMessageCoalescing !== false) {
    if (typeof features.systemMessageCoalescing === "object") {
      chain.push(features.systemMessageCoalescing as unknown as MiddlewareDefinition);
    } else {
      chain.push(systemMessageCoalescingMiddleware());
    }
  }

  // [6] Dynamic context (memory/current-date reminders).
  if (features.dynamicContext !== false) {
    if (typeof features.dynamicContext === "object") {
      chain.push(features.dynamicContext as unknown as MiddlewareDefinition);
    } else {
      chain.push(dynamicContextMiddleware());
    }
  }

  // [7] DanglingToolCall — patches interrupted/incomplete tool calls.
  chain.push(danglingToolCallMiddleware());

  // [8] Deferred tool filter + ToolSearch — paired middlewares for the deferred
  // (MCP) tool discovery flow. The filter hides deferred tool schemas; the
  // promotion middleware scans tool_search results and writes state.promoted.
  if (features.deferredToolFilter !== false) {
    if (typeof features.deferredToolFilter === "object") {
      const opts = features.deferredToolFilter as unknown as {
        deferredNames?: Iterable<string>;
        catalogHash?: string | null;
      };
      const deferredNames = opts.deferredNames ?? [];
      chain.push(deferredToolFilterMiddleware(deferredNames, opts.catalogHash ?? null));
      if (opts.catalogHash) {
        chain.push(toolSearchMiddleware(deferredNames, opts.catalogHash));
      }
    } else {
      chain.push(deferredToolFilterMiddleware([], null));
    }
  }

  // [9] Guardrail
  if (features.guardrail !== false) {
    if (typeof features.guardrail === "object") {
      chain.push(features.guardrail as unknown as MiddlewareDefinition);
    } else {
      throw new Error("guardrail=true requires a custom middleware instance");
    }
  }

  // [10] ToolErrorHandling
  chain.push(toolErrorHandlingMiddleware());

  // [11] Summarization
  if (features.summarization !== false) {
    if (typeof features.summarization === "object") {
      chain.push(features.summarization as unknown as MiddlewareDefinition);
    } else {
      throw new Error("summarization=true requires a custom middleware instance");
    }
  }

  // [12] TodoMiddleware
  if (planMode) {
    chain.push(todoMiddleware());
  }

  // [13] Auto Title
  if (features.autoTitle !== false) {
    if (typeof features.autoTitle === "object") {
      chain.push(features.autoTitle as unknown as MiddlewareDefinition);
    } else {
      chain.push(titleMiddleware());
    }
  }

  // [14] Memory
  if (features.memory !== false) {
    if (typeof features.memory === "object") {
      chain.push(memoryMiddleware({
        ...(features.memory as unknown as MemoryMiddlewareOptions),
        getUserId: userContext.getUserId,
      }));
    } else {
      chain.push(memoryMiddleware({ getUserId: userContext.getUserId }));
    }
  }

  // [15] Vision
  if (features.vision !== false) {
    if (typeof features.vision === "object") {
      chain.push(features.vision as unknown as MiddlewareDefinition);
    } else {
      chain.push(viewImageMiddleware());
    }
  }

  // [16] Subagent
  if (features.subagent !== false) {
    if (typeof features.subagent === "object") {
      chain.push(features.subagent as unknown as MiddlewareDefinition);
    } else {
      chain.push(subagentLimitMiddleware());
    }
  }

  // [17] SafetyFinishReason
  if (features.safetyFinishReason !== false) {
    if (typeof features.safetyFinishReason === "object") {
      chain.push(features.safetyFinishReason as unknown as MiddlewareDefinition);
    } else {
      chain.push(safetyFinishReasonMiddleware());
    }
  }

  // [18] LoopDetection
  if (features.loopDetection !== false) {
    if (typeof features.loopDetection === "object") {
      chain.push(features.loopDetection as unknown as MiddlewareDefinition);
    } else {
      chain.push(loopDetectionMiddleware());
    }
  }

  // [19] TokenUsage
  if (features.tokenUsage !== false) {
    if (typeof features.tokenUsage === "object") {
      chain.push(features.tokenUsage as unknown as MiddlewareDefinition);
    } else {
      chain.push(tokenUsageMiddleware());
    }
  }

  // [20] TokenBudget
  if (features.tokenBudget !== false) {
    if (typeof features.tokenBudget === "object") {
      chain.push(features.tokenBudget as unknown as MiddlewareDefinition);
    } else {
      let tokenBudgetConfig;
      try {
        tokenBudgetConfig = getAppConfig().tokenBudget;
      } catch {
        tokenBudgetConfig = buildTokenBudgetConfig({ enabled: true });
      }
      chain.push(tokenBudgetMiddleware(tokenBudgetConfig));
    }
  }

  // [21] ToolOutputBudget
  if (features.toolOutputBudget !== false) {
    if (typeof features.toolOutputBudget === "object") {
      chain.push(features.toolOutputBudget as unknown as MiddlewareDefinition);
    } else {
      let toolOutputConfig;
      try {
        const app = getAppConfig();
        toolOutputConfig = app.toolOutput ?? {};
      } catch {
        toolOutputConfig = {};
      }
      chain.push(toolOutputBudgetMiddleware(toolOutputConfig));
    }
  }

  // [22] LLM error handling / retry (innermost wrapModelCall, closest to API).
  if (features.llmErrorHandling !== false) {
    if (typeof features.llmErrorHandling === "object") {
      chain.push(features.llmErrorHandling as unknown as MiddlewareDefinition);
    } else {
      chain.push(llmErrorHandlingMiddleware());
    }
  }

  // [23] Clarification (always last among built-ins)
  chain.push(clarificationMiddleware());

  return chain;
}

/**
 * Create a Quill agent compiled StateGraph from plain JS arguments.
 *
 * This is the JS/TS equivalent of Python's `create_quill_agent`.
 */
export function createQuillAgent(
  options: CreateQuillAgentOptions
  // LangGraph's compiled graph type is very strict; let TypeScript infer it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const {
    model,
    tools = [],
    systemPrompt,
    middleware,
    features,
    extraMiddleware,
    planMode = false,
    checkpointer,
  } = options;

  if (middleware !== undefined && (features !== undefined || (extraMiddleware?.length ?? 0) > 0)) {
    throw new Error("Cannot specify both 'middleware' and 'features'/'extraMiddleware'.");
  }

  let effectiveMiddleware: MiddlewareDefinition[];
  if (middleware !== undefined) {
    effectiveMiddleware = [...middleware];
  } else {
    effectiveMiddleware = assembleFromFeatures(
      { ...DEFAULT_RUNTIME_FEATURES, ...(features ?? {}) },
      options.name ?? "default",
      planMode,
      { userId: options.userId, getUserId: options.getUserId }
    );
    if (extraMiddleware && extraMiddleware.length > 0) {
      effectiveMiddleware = applyMiddlewareOrdering(effectiveMiddleware, extraMiddleware);
    }
  }

  // Merge tools contributed by middleware (e.g. write_todos from TodoMiddleware)
  // into the effective tool set. Middleware tools are de-duplicated by name;
  // user-supplied tools take precedence.
  const effectiveTools: StructuredToolInterface[] = [...tools];
  const existingToolNames = new Set(tools.map((t) => t.name));
  for (const mw of effectiveMiddleware) {
    for (const tool of mw.tools ?? []) {
      if (!existingToolNames.has(tool.name)) {
        effectiveTools.push(tool);
        existingToolNames.add(tool.name);
      }
    }
  }

  console.log(`[createQuillAgent] effective middleware (${effectiveMiddleware.length}): ${effectiveMiddleware.map((mw) => mw.name).join(", ")}`);
  console.log(`[createQuillAgent] tool wrappers: ${effectiveMiddleware.filter((mw) => mw.wrapToolCall).map((mw) => mw.name).join(", ")}`);
  const annotation = buildThreadStateAnnotation();
  const beforeModelHooks = effectiveMiddleware
    .map((mw) => mw.beforeModel)
    .filter((fn): fn is MiddlewareNode => fn !== undefined);
  const afterModelHooks = effectiveMiddleware
    .map((mw) => mw.afterModel)
    .filter((fn): fn is MiddlewareNode => fn !== undefined);
  const afterAgentHooks = effectiveMiddleware
    .map((mw) => mw.afterAgent)
    .filter((fn): fn is MiddlewareNode => fn !== undefined);
  const wrapModelCalls = effectiveMiddleware
    .map((mw) => mw.wrapModelCall)
    .filter((fn): fn is ModelCallWrapper => fn !== undefined);
  const wrapToolCalls = effectiveMiddleware
    .map((mw) => mw.wrapToolCall)
    .filter((fn): fn is ToolCallWrapper => fn !== undefined);

  const graph = new StateGraph(annotation)
    .addNode("prepare", prepareNode(systemPrompt))
    .addNode("beforeModel", runMiddlewareHooks(beforeModelHooks))
    .addNode("model", modelNode(model, effectiveTools, wrapModelCalls))
    .addNode("afterModel", runMiddlewareHooks(afterModelHooks))
    .addNode("tools", toolsNode(effectiveTools, wrapToolCalls))
    .addNode("afterAgent", runMiddlewareHooks(afterAgentHooks))
    .addEdge(START, "prepare")
    .addEdge("prepare", "beforeModel")
    .addEdge("beforeModel", "model")
    .addEdge("model", "afterModel")
    .addEdge("afterModel", "tools")
    .addEdge("tools", "afterAgent")
    .addConditionalEdges("afterAgent", shouldContinue, {
      // Route through beforeModel (not directly to model) so that beforeModel
      // hooks run on every re-engagement: TodoMiddleware._beforeModel clears
      // the jump_to signal here, preventing infinite re-loop.
      model: "beforeModel",
      [END]: END,
    });

  // `checkpointer: false` means "explicitly disabled" (e.g. one-shot
  // subagents); convert to undefined so LangGraph JS treats it as no-op.
  return graph.compile({ checkpointer: checkpointer === false ? undefined : checkpointer });
}

function runMiddlewareHooks(hooks: MiddlewareNode[]) {
  return async function (state: ThreadState, config?: RunnableConfig): Promise<Partial<ThreadState>> {
    let runningState = state;
    let updates: Partial<ThreadState> = {};
    for (const hook of hooks) {
      const result = await hook(runningState, config);
      if (result) {
        updates = { ...updates, ...result };
        runningState = { ...runningState, ...result };
      }
    }
    return updates;
  };
}

function prepareNode(systemPrompt: string | null | undefined) {
  return async function (state: ThreadState): Promise<Partial<ThreadState>> {
    if (systemPrompt === null || systemPrompt === undefined) {
      return {};
    }
    const messages = state.messages ?? [];
    if (messages.length === 0 || messages[0].getType() !== "system") {
      const { SystemMessage } = await import("@langchain/core/messages");
      return {
        messages: [new SystemMessage(systemPrompt), ...messages],
      };
    }
    return {};
  };
}

function modelNode(
  model: BaseChatModel,
  tools: StructuredToolInterface[],
  wrapModelCalls: ModelCallWrapper[]
) {
  const defaultBoundModel =
    tools.length > 0 && model.bindTools !== undefined ? model.bindTools(tools) : model;
  const invokeModel = async (request: ModelRequest): Promise<BaseMessage> => {
    const activeTools = request.tools ?? tools;
    const toolsChanged = activeTools !== tools;
    const boundModel =
      toolsChanged && activeTools.length > 0 && model.bindTools !== undefined
        ? model.bindTools(activeTools)
        : toolsChanged
          ? model
          : defaultBoundModel;
    return boundModel.invoke(request.messages);
  };
  return async function (state: ThreadState, config?: RunnableConfig): Promise<Partial<ThreadState>> {
    const msgs = state.messages ?? [];
    // Strict OpenAI-compatible backends reject non-leading SystemMessages.
    // Hoist any system messages to the front of the request (state is left
    // untouched); the coalescing middleware then merges multiples into one.
    const systems = msgs.filter((m) => m.getType() === "system");
    const requestMessages =
      systems.length > 0 ? [...systems, ...msgs.filter((m) => m.getType() !== "system")] : msgs;
    const runId = (config?.configurable as { run_id?: unknown } | undefined)?.run_id;
    const request: ModelRequest = {
      messages: requestMessages,
      tools,
      state,
      runId: typeof runId === "string" ? runId : null,
    };
    const response = await applyModelWrappers(wrapModelCalls, request, invokeModel);
    return { messages: [response] };
  };
}

function applyModelWrappers(
  wrappers: ModelCallWrapper[],
  request: ModelRequest,
  handler: (request: ModelRequest) => Promise<BaseMessage>
): Promise<BaseMessage> {
  const composed = wrappers.reduceRight<(request: ModelRequest) => Promise<BaseMessage>>(
    (next, wrapper) => (req) => wrapper(req, next),
    handler
  );
  return composed(request);
}

/**
 * Run a single tool call through the wrapper chain. Factored out of `toolsNode`
 * so both the serial (single-call fast path) and concurrent (multi-call) paths
 * share identical error / state-update / ToolMessage handling.
 */
function makeInvokeTool(
  tool: StructuredToolInterface | undefined,
  call: ToolCall,
  config: RunnableConfig | undefined,
): (req: ToolCallRequest) => Promise<BaseMessage | Partial<ThreadState>> {
  return async (req: ToolCallRequest): Promise<BaseMessage | Partial<ThreadState>> => {
    if (tool === undefined) {
      return makeToolMessage(req.tool_call_id, `Tool ${req.name} not found`);
    }
    try {
      // Forward the current tool-call metadata so tools (e.g. write_todos)
      // can correlate their ToolMessage with the model's tool_call id.
      // This mirrors LangGraph's ToolNode behaviour and Python's
      // InjectedToolCallId.
      const toolConfig = { ...config, toolCall: call };
      const output = await tool.invoke(req.args, toolConfig);
      // Middleware tools (e.g. write_todos) may return a raw state update
      // instead of a plain string. Mirror Python's Command(update=...).
      if (
        output !== null &&
        typeof output === "object" &&
        !Array.isArray(output) &&
        (STATE_UPDATE in output || (output as Record<symbol, unknown>)[STATE_UPDATE] === true)
      ) {
        return output as Partial<ThreadState>;
      }
      // Some tools (e.g. `task`) return a ready-made ToolMessage when
      // invoked with tool-call metadata. Use it directly instead of
      // double-wrapping it into a new ToolMessage.
      if (output instanceof BaseMessage) {
        return output;
      }
      return makeToolMessage(req.tool_call_id, output);
    } catch (error) {
      return makeToolMessage(
        req.tool_call_id,
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}

/**
 * Run all tool calls for a turn, then fold their results into a single
 * `{ messages, ...stateUpdate }`, preserving the original tool-call order so
 * the conversation stays coherent.
 *
 * Single-call turns take the serial fast path (ordering is trivially preserved
 * and existing middleware side-effects are unchanged). Multi-call turns run the
 * independent calls concurrently — so N parallel `task` dispatches in an Ultra
 * turn truly overlap — then re-sort the outcomes by their original index.
 */
async function runToolCalls(
  toolCalls: ToolCall[],
  tools: StructuredToolInterface[],
  wrapToolCalls: ToolCallWrapper[],
  state: ThreadState,
  config?: RunnableConfig,
): Promise<{ messages: BaseMessage[]; stateUpdate?: Partial<ThreadState> }> {
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  if (toolCalls.length === 1) {
    // Serial fast path — identical behaviour to the previous implementation.
    const call = toolCalls[0];
    const request: ToolCallRequest = {
      name: call.name,
      args: call.args,
      tool_call_id: call.id,
      state,
    };
    const result = await applyToolWrappers(
      wrapToolCalls,
      request,
      makeInvokeTool(toolMap.get(call.name), call, config),
    );
    if (isStateUpdate(result)) {
      const updateMessages = Array.isArray(result.messages)
        ? (result.messages as BaseMessage[])
        : [];
      return { messages: updateMessages, stateUpdate: result };
    }
    return { messages: [result] };
  }

  // Concurrent path: fan out, then re-sort by original index.
  console.log(`[toolsNode] processing ${toolCalls.length} tool call(s) concurrently; ${wrapToolCalls.length} wrapper(s) registered`);
  const indexed = await Promise.all(
    toolCalls.map((call, index) => {
      const request: ToolCallRequest = {
        name: call.name,
        args: call.args,
        tool_call_id: call.id,
        state,
      };
      return applyToolWrappers(
        wrapToolCalls,
        request,
        makeInvokeTool(toolMap.get(call.name), call, config),
      ).then((result) => ({ index, result }));
    }),
  );
  indexed.sort((a, b) => a.index - b.index);

  const resultMessages: BaseMessage[] = [];
  let stateUpdate: Partial<ThreadState> | undefined;
  for (const { result } of indexed) {
    if (isStateUpdate(result)) {
      const updateMessages = Array.isArray(result.messages)
        ? (result.messages as BaseMessage[])
        : [];
      for (const m of updateMessages) {
        resultMessages.push(m);
      }
      stateUpdate = { ...stateUpdate, ...result };
    } else {
      resultMessages.push(result);
    }
  }
  return { messages: resultMessages, stateUpdate };
}

function toolsNode(
  tools: StructuredToolInterface[],
  wrapToolCalls: ToolCallWrapper[]
) {
  // `config` carries the run's `configurable` (e.g. thread_id). Forwarding it to
  // `tool.invoke` lets tools that need per-thread context — like the sandbox
  // file/shell tools reading `config.configurable.thread_id` — receive it.
  return async function (
    state: ThreadState,
    config?: RunnableConfig
  ): Promise<Partial<ThreadState>> {
    const messages = state.messages ?? [];
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
      return {};
    }
    const toolCalls = ((lastMessage as unknown as { tool_calls?: ToolCall[] }).tool_calls ?? []).filter(
      (tc): tc is ToolCall => typeof tc?.id === "string" && typeof tc?.name === "string"
    );
    if (toolCalls.length === 0) {
      return {};
    }

    const { messages: resultMessages, stateUpdate } = await runToolCalls(
      toolCalls,
      tools,
      wrapToolCalls,
      state,
      config,
    );

    if (stateUpdate !== undefined) {
      // Merge any explicit messages from the state update with generated tool
      // messages. Middleware tools usually include the required ToolMessage.
      const updateMessages = Array.isArray(stateUpdate.messages)
        ? (stateUpdate.messages as BaseMessage[])
        : [];
      const existing = new Set(resultMessages.map((m) => (m as unknown as { id?: string }).id).filter(Boolean));
      const mergedExtra = updateMessages.filter(
        (m) => !existing.has((m as unknown as { id?: string }).id),
      );
      return { ...stateUpdate, messages: [...resultMessages, ...mergedExtra] };
    }
    return { messages: resultMessages };
  };
}

function isStateUpdate(value: unknown): value is Partial<ThreadState> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    ((value as Record<symbol, unknown>)[STATE_UPDATE] === true || STATE_UPDATE in value)
  );
}

function applyToolWrappers(
  wrappers: ToolCallWrapper[],
  request: ToolCallRequest,
  handler: (request: ToolCallRequest) => Promise<BaseMessage | Partial<ThreadState>>
): Promise<BaseMessage | Partial<ThreadState>> {
  const composed = wrappers.reduceRight<(request: ToolCallRequest) => Promise<BaseMessage | Partial<ThreadState>>>(
    (next, wrapper) => (req) => wrapper(req, next),
    handler
  );
  return composed(request);
}

async function makeToolMessage(toolCallId: string, content: unknown): Promise<BaseMessage> {
  const { ToolMessage } = await import("@langchain/core/messages");
  return new ToolMessage({
    content: typeof content === "string" ? content : JSON.stringify(content),
    tool_call_id: toolCallId,
  });
}

function shouldContinue(state: ThreadState): "model" | typeof END {
  // A middleware (e.g. TodoMiddleware in plan mode) can request a forced
  // re-engagement by setting `state.jump_to = "model"`. This is checked first
  // so it overrides the default tool-call-based routing — when the agent tried
  // to exit cleanly but has incomplete todos, the middleware forces it back.
  const jumpTo = state.jump_to as string | undefined;
  if (jumpTo === "model") {
    return "model";
  }
  const messages = state.messages ?? [];
  // Find the most recent AI message; if it requested tools, route back to the
  // model so it can consume the tool results (or request more tools).
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.getType() === "ai") {
      const toolCalls = ((message as unknown as { tool_calls?: ToolCall[] }).tool_calls ?? []).filter(
        (tc): tc is ToolCall => typeof tc?.id === "string" && typeof tc?.name === "string"
      );
      return toolCalls.length > 0 ? "model" : END;
    }
  }
  return END;
}

function applyMiddlewareOrdering(
  chain: MiddlewareDefinition[],
  extra: MiddlewareDefinition[]
): MiddlewareDefinition[] {
  // Simple append for now; @Next/@Prev ordering can be added later.
  return [...chain, ...extra];
}

// Expose reducer helpers for custom state schemas.
export const reducers = {
  mergeSandbox,
  mergeArtifacts,
  mergeTodos,
  mergeViewedImages,
  mergePromoted,
};

export type { MiddlewareClass };

/**
 * Run API request/response contracts for the gateway runs routers.
 *
 * These types mirror the FastAPI/Pydantic models in
 * `app/gateway/routers/thread_runs.py` and `app/gateway/routers/runs.py`.
 */

export type InterruptSpec = string[] | "*" | null;
export type OnDisconnect = "cancel" | "continue";
export type OnCompletion = "delete" | "keep";
export type MultitaskStrategy = "reject" | "rollback" | "interrupt" | "enqueue";
export type IfNotExists = "reject" | "create";

export interface RunCreateRequest {
  /** Agent / assistant to use */
  assistant_id?: string | null;
  /** Graph input (e.g. {messages: [...]}) */
  input?: Record<string, unknown> | null;
  /** LangGraph Command */
  command?: Record<string, unknown> | null;
  /** Run metadata */
  metadata?: Record<string, unknown> | null;
  /** RunnableConfig overrides */
  config?: Record<string, unknown> | null;
  /** Quill context overrides (model_name, thinking_enabled, etc.) */
  context?: Record<string, unknown> | null;
  /** Completion callback URL */
  webhook?: string | null;
  /** Resume from checkpoint */
  checkpoint_id?: string | null;
  /** Full checkpoint object */
  checkpoint?: Record<string, unknown> | null;
  /** Nodes to interrupt before */
  interrupt_before?: InterruptSpec;
  /** Nodes to interrupt after */
  interrupt_after?: InterruptSpec;
  /** Stream mode(s) */
  stream_mode?: string[] | string | null;
  /** Include subgraph events */
  stream_subgraphs?: boolean;
  /** SSE resumable mode */
  stream_resumable?: boolean | null;
  /** Behaviour on SSE disconnect */
  on_disconnect?: OnDisconnect;
  /** Delete temp thread on completion */
  on_completion?: OnCompletion;
  /** Concurrency strategy */
  multitask_strategy?: MultitaskStrategy;
  /** Delayed execution */
  after_seconds?: number | null;
  /** Thread creation policy */
  if_not_exists?: IfNotExists;
  /** LangSmith feedback keys */
  feedback_keys?: string[] | null;
}

export interface RegeneratePrepareRequest {
  /** Assistant message id to regenerate */
  message_id: string;
}

export interface RegeneratePrepareResponse {
  input: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  metadata: Record<string, unknown>;
  target_run_id: string;
}

export interface RunResponse {
  run_id: string;
  thread_id: string;
  assistant_id?: string | null;
  status: string;
  metadata?: Record<string, unknown>;
  kwargs?: Record<string, unknown>;
  multitask_strategy?: string;
  created_at?: string;
  updated_at?: string;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_tokens?: number;
  llm_call_count?: number;
  lead_agent_tokens?: number;
  subagent_tokens?: number;
  middleware_tokens?: number;
  message_count?: number;
}

export interface ThreadTokenUsageModelBreakdown {
  tokens: number;
  runs: number;
}

export interface ThreadTokenUsageCallerBreakdown {
  lead_agent: number;
  subagent: number;
  middleware: number;
}

export interface ThreadTokenUsageResponse {
  thread_id: string;
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_runs: number;
  by_model: Record<string, ThreadTokenUsageModelBreakdown>;
  by_caller: ThreadTokenUsageCallerBreakdown;
}

export interface RunMessage {
  run_id: string;
  seq?: number;
  content: Record<string, unknown>;
  metadata: {
    caller: string;
    [key: string]: unknown;
  };
  created_at: string;
}

export interface RunMessagesResponse {
  messages: RunMessage[];
  has_more: boolean;
}

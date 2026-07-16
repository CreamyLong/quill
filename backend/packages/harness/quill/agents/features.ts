/**
 * Declarative feature flags and middleware positioning for create_quill_agent.
 *
 * Pure data types — no I/O, no side effects.
 */

export interface AgentMiddlewareLike {
  name: string;
  // Marker interface; concrete middleware implementations extend this.
  [key: string]: unknown;
}

export interface RuntimeFeatures {
  /** Sandbox middleware. */
  sandbox: boolean | AgentMiddlewareLike;
  /** Memory middleware. */
  memory: boolean | AgentMiddlewareLike;
  /** Summarization middleware (custom only). */
  summarization: false | AgentMiddlewareLike;
  /** Subagent middleware. */
  subagent: boolean | AgentMiddlewareLike;
  /** Vision/image middleware. */
  vision: boolean | AgentMiddlewareLike;
  /** Auto title generation middleware. */
  autoTitle: boolean | AgentMiddlewareLike;
  /** Guardrail middleware (custom only). */
  guardrail: false | AgentMiddlewareLike;
  /** Loop detection middleware. */
  loopDetection: boolean | AgentMiddlewareLike;
  /** Token budget middleware. */
  tokenBudget: boolean | AgentMiddlewareLike;
  /** Provider safety-termination handling middleware. */
  safetyFinishReason: boolean | AgentMiddlewareLike;
  /** Sandbox bash-command auditing middleware. */
  sandboxAudit: boolean | AgentMiddlewareLike;
  /** Input sanitization / prompt-injection defense middleware. */
  inputSanitization: boolean | AgentMiddlewareLike;
  /** System message coalescing middleware. */
  systemMessageCoalescing: boolean | AgentMiddlewareLike;
  /** Token usage logging and step attribution middleware. */
  tokenUsage: boolean | AgentMiddlewareLike;
  /** Tool output budget / externalization middleware. */
  toolOutputBudget: boolean | AgentMiddlewareLike;
  /** LLM error handling / retry middleware. */
  llmErrorHandling: boolean | AgentMiddlewareLike;
  /** Dynamic context injection middleware (current date, memory hints). */
  dynamicContext: boolean | AgentMiddlewareLike;
  /** Deferred tool schema filter (tool_search gating). */
  deferredToolFilter: boolean | AgentMiddlewareLike;
  /** Slash skill activation middleware. */
  skillActivation: boolean | AgentMiddlewareLike;
}

export const DEFAULT_RUNTIME_FEATURES: RuntimeFeatures = {
  sandbox: true,
  memory: false,
  summarization: false,
  subagent: false,
  vision: false,
  autoTitle: false,
  guardrail: false,
  loopDetection: true,
  tokenBudget: false,
  safetyFinishReason: true,
  sandboxAudit: true,
  inputSanitization: true,
  systemMessageCoalescing: true,
  tokenUsage: true,
  toolOutputBudget: true,
  llmErrorHandling: true,
  dynamicContext: false,
  deferredToolFilter: false,
  skillActivation: false,
};

export type MiddlewareClass = new (...args: unknown[]) => AgentMiddlewareLike;

/** Declare a middleware should be placed after an anchor in the chain. */
export function Next(anchor: MiddlewareClass): (cls: MiddlewareClass) => MiddlewareClass {
  return function decorator(cls: MiddlewareClass): MiddlewareClass {
    (cls as unknown as { _nextAnchor?: MiddlewareClass })._nextAnchor = anchor;
    return cls;
  };
}

/** Declare a middleware should be placed before an anchor in the chain. */
export function Prev(anchor: MiddlewareClass): (cls: MiddlewareClass) => MiddlewareClass {
  return function decorator(cls: MiddlewareClass): MiddlewareClass {
    (cls as unknown as { _prevAnchor?: MiddlewareClass })._prevAnchor = anchor;
    return cls;
  };
}

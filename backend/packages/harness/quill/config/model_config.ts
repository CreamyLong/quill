/**
 * Config section for a model.
 */
export interface ModelConfig {
  /** Unique name for the model */
  name: string;
  /** Display name for the model */
  displayName: string | null;
  /** Description for the model */
  description: string | null;
  /** Class path of the model provider (e.g. langchain_openai.ChatOpenAI) */
  use: string;
  /** Model name */
  model: string;
  /** Whether to route OpenAI ChatOpenAI calls through the /v1/responses API */
  useResponsesApi: boolean | null;
  /** Structured output version for OpenAI responses content, e.g. responses/v1 */
  outputVersion: string | null;
  /** Whether the model supports thinking */
  supportsThinking: boolean;
  /** Whether the model supports reasoning effort */
  supportsReasoningEffort: boolean;
  /** Extra settings passed to the model when thinking is enabled */
  whenThinkingEnabled: Record<string, unknown> | null;
  /** Extra settings passed to the model when thinking is disabled */
  whenThinkingDisabled: Record<string, unknown> | null;
  /** Whether the model supports vision/image inputs */
  supportsVision: boolean;
  /** Maximum seconds to wait between successive streaming chunks */
  streamChunkTimeout: number | null;
  /** Thinking settings for the model */
  thinking: Record<string, unknown> | null;
  /** Extra fields allowed (matches Pydantic extra="allow") */
  [key: string]: unknown;
}

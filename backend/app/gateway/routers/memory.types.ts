/**
 * Memory API request/response contracts for the gateway memory router.
 *
 * These types mirror the FastAPI/Pydantic models in
 * `app/gateway/routers/memory.py`.
 */

export interface ContextSection {
  /** Summary content */
  summary?: string;
  /** Last update timestamp */
  updatedAt?: string;
}

export interface UserContext {
  workContext?: ContextSection;
  personalContext?: ContextSection;
  topOfMind?: ContextSection;
}

export interface HistoryContext {
  recentMonths?: ContextSection;
  earlierContext?: ContextSection;
  longTermBackground?: ContextSection;
}

export interface MemoryFact {
  /** Unique identifier for the fact */
  id: string;
  /** Fact content */
  content: string;
  /** Fact category */
  category?: string;
  /** Confidence score (0-1) */
  confidence?: number;
  /** Creation timestamp */
  createdAt?: string;
  /** Source thread ID */
  source?: string;
  /** Optional description of the prior mistake or wrong approach */
  sourceError?: string | null;
}

export interface MemoryResponse {
  /** Memory schema version */
  version?: string;
  /** Last update timestamp */
  lastUpdated?: string;
  user?: UserContext;
  history?: HistoryContext;
  facts?: MemoryFact[];
}

export interface FactCreateRequest {
  /** Fact content */
  content: string;
  /** Fact category */
  category?: string;
  /** Confidence score (0-1) */
  confidence?: number;
}

export interface FactPatchRequest {
  /** Fact content */
  content?: string;
  /** Fact category */
  category?: string;
  /** Confidence score (0-1) */
  confidence?: number;
}

export interface MemoryConfigResponse {
  /** Whether memory is enabled */
  enabled: boolean;
  /** Path to memory storage file */
  storage_path: string;
  /** Debounce time for memory updates */
  debounce_seconds: number;
  /** Maximum number of facts to store */
  max_facts: number;
  /** Minimum confidence threshold for facts */
  fact_confidence_threshold: number;
  /** Whether memory injection is enabled */
  injection_enabled: boolean;
  /** Maximum tokens for memory injection */
  max_injection_tokens: number;
  /** Token counting strategy for memory injection ('tiktoken' or 'char') */
  token_counting: string;
  /** Fact categories that bypass the regular injection budget */
  guaranteed_categories: string[];
  /** Token ceiling for guaranteed-category facts */
  guaranteed_token_budget: number;
}

export interface MemoryStatusResponse {
  config: MemoryConfigResponse;
  data: MemoryResponse;
}

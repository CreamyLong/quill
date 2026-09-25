/**
 * Universal MCP Rail — two-tool capability federation.
 *
 * Inspired by OpenWork's two-tool universal MCP rail that federates all
 * capability sources behind a constant surface:
 *   - search_capabilities: find any capability across MCP servers, skills, plugins
 *   - execute_capability: run any capability by ID
 *
 * This pattern provides a constant 2-tool interface regardless of how many
 * MCP servers, skills, or plugins are installed.
 *
 * Source patterns:
 * - OpenWork: Two-tool universal MCP rail (search_capabilities + execute_capability)
 * - Kimi Code: Conversational MCP configuration
 * - ZCode: MCP sync and dual-role MCP
 */

// ---------------------------------------------------------------------------
// Capability types
// ---------------------------------------------------------------------------

/**
 * Capability source types.
 */
export type CapabilitySource =
  | "mcp_server"    // From an MCP server
  | "skill"         // From a Quill skill
  | "plugin"        // From an installed plugin
  | "builtin"       // Built-in Quill tool
  | "custom";       // User-defined capability

/**
 * A federated capability entry.
 */
export interface CapabilityEntry {
  /** Unique capability ID (source:name format, e.g., "mcp_server:github:create_issue"). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description of what this capability does. */
  description: string;
  /** Where this capability comes from. */
  source: CapabilitySource;
  /** Source name (e.g., MCP server name, skill name). */
  sourceName: string;
  /** Tool name within the source. */
  toolName: string;
  /** Input schema (JSON Schema). */
  inputSchema?: Record<string, unknown>;
  /** Whether this capability requires confirmation. */
  requiresConfirmation: boolean;
  /** Tags for search. */
  tags: string[];
}

/**
 * Search query for capabilities.
 */
export interface CapabilitySearchQuery {
  /** Search term (matches name, description, tags). */
  query?: string;
  /** Filter by source type. */
  source?: CapabilitySource;
  /** Filter by source name. */
  sourceName?: string;
  /** Pagination. */
  offset?: number;
  limit?: number;
}

/**
 * Search result.
 */
export interface CapabilitySearchResult {
  capabilities: CapabilityEntry[];
  total: number;
  query: string;
}

/**
 * Execution request.
 */
export interface CapabilityExecutionRequest {
  /** Capability ID to execute. */
  capabilityId: string;
  /** Arguments for the capability. */
  args: Record<string, unknown>;
  /** Thread context. */
  threadId?: string;
  /** Run context. */
  runId?: string;
}

/**
 * Execution result.
 */
export interface CapabilityExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  /** Execution duration in ms. */
  durationMs: number;
  /** Capability that was executed. */
  capabilityId: string;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Capability registry — aggregates capabilities from all sources.
 */
export interface CapabilityRegistry {
  /** Register a capability. */
  register(entry: CapabilityEntry): void;
  /** Unregister a capability by ID. */
  unregister(capabilityId: string): void;
  /** Unregister all capabilities from a source. */
  unregisterBySource(source: CapabilitySource, sourceName: string): void;
  /** Search capabilities. */
  search(query: CapabilitySearchQuery): CapabilitySearchResult;
  /** Get a specific capability. */
  get(capabilityId: string): CapabilityEntry | null;
  /** List all capabilities. */
  listAll(): CapabilityEntry[];
  /** Get all unique sources. */
  getSources(): Array<{ source: CapabilitySource; sourceName: string; count: number }>;
  /** Clear all capabilities. */
  clear(): void;
}

/**
 * Capability Marketplace — public contracts.
 *
 * Port of OpenWork's capability marketplace pattern. Provides standardized
 * interfaces for discovering and invoking shared capabilities (skills, MCP
 * tools, automations) through a unified API.
 *
 * This enhances Quill's skill/MCP discovery by adding a searchable, categorized
 * marketplace that can span local, community, and remote capabilities.
 */

/** A capability that can be discovered and executed. */
export interface Capability {
  /** Unique capability ID. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Short description for search/discovery. */
  description: string;
  /** Capability category. */
  category:
    | "research"
    | "coding"
    | "analysis"
    | "creative"
    | "communication"
    | "automation"
    | "integration"
    | "other";
  /** Capability source type. */
  source: "skill" | "mcp_tool" | "automation" | "community";
  /** Source identifier (skill name, MCP server name, etc.). */
  sourceId: string;
  /** Tags for search/filtering. */
  tags: string[];
  /** Icon or emoji (optional). */
  icon?: string;
  /** Whether this capability is currently available. */
  available: boolean;
  /** Capability version. */
  version?: string;
  /** Author or publisher. */
  author?: string;
  /** Usage count (for ranking). */
  usageCount: number;
  /** Average user rating (0-5). */
  rating: number;
  /** Input schema (JSON Schema). */
  inputSchema?: Record<string, unknown>;
  /** When this capability was registered. */
  registeredAt: number;
  /** Last update timestamp. */
  updatedAt: number;
}

/** Search query for capabilities. */
export interface CapabilitySearchQuery {
  /** Free-text search term. */
  query?: string;
  /** Filter by category. */
  category?: Capability["category"];
  /** Filter by source type. */
  source?: Capability["source"];
  /** Filter by tags. */
  tags?: string[];
  /** Only return available capabilities. */
  availableOnly?: boolean;
  /** Sort order. */
  sortBy: "relevance" | "name" | "rating" | "usage" | "recent";
  /** Maximum results to return. */
  limit: number;
  /** Offset for pagination. */
  offset: number;
}

/** Search results. */
export interface CapabilitySearchResult {
  /** Matching capabilities. */
  capabilities: Capability[];
  /** Total matches (for pagination). */
  total: number;
  /** Whether more results exist. */
  hasMore: boolean;
}

/** Execution request for a capability. */
export interface CapabilityExecutionRequest {
  /** Capability ID to execute. */
  capabilityId: string;
  /** Input arguments. */
  args: Record<string, unknown>;
  /** Thread ID for scoping. */
  threadId?: string | null;
  /** Run ID for scoping. */
  runId?: string | null;
  /** User ID for ownership. */
  userId?: string | null;
}

/** Execution result. */
export interface CapabilityExecutionResult {
  /** Whether execution succeeded. */
  success: boolean;
  /** Execution result data. */
  data: unknown;
  /** Error message (when failed). */
  error: string | null;
  /** Execution duration in ms. */
  durationMs: number;
}

/** Configuration for the capability marketplace. */
export interface MarketplaceConfig {
  /** Whether the marketplace is enabled. */
  enabled: boolean;
  /** Whether to include community capabilities. */
  includeCommunity: boolean;
  /** Whether to index MCP tools as capabilities. */
  indexMcpTools: boolean;
  /** Whether to index skills as capabilities. */
  indexSkills: boolean;
  /** Maximum search results per query. */
  maxResults: number;
}

/** Default marketplace configuration. */
export const DEFAULT_MARKETPLACE_CONFIG: MarketplaceConfig = {
  enabled: true,
  includeCommunity: true,
  indexMcpTools: true,
  indexSkills: true,
  maxResults: 50,
};

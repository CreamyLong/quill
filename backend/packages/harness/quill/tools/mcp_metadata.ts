/**
 * Single source of truth for the MCP-tool metadata tag.
 *
 * A tool is "MCP-sourced" when it carries the `quill_mcp` metadata flag.
 * The tag is *written* where MCP tools are loaded and *read* by deferred-tool
 * assembly and the agent build site. Keeping the key, the tagger, and the
 * predicate here means the magic string lives in exactly one place.
 */

export const MCP_TOOL_METADATA_KEY = "quill_mcp";

export interface ToolLike {
  metadata?: Record<string, unknown>;
  // Allow additional tool fields.
  [key: string]: unknown;
}

/** Mark `tool` as MCP-sourced. Mutates in place and returns it for chaining. */
export function tagMcpTool<T extends ToolLike>(tool: T): T {
  tool.metadata = { ...(tool.metadata ?? {}), [MCP_TOOL_METADATA_KEY]: true };
  return tool;
}

/** True when `tool` carries the MCP-source tag written by `tagMcpTool`. */
export function isMcpTool(tool: ToolLike): boolean {
  return tool.metadata?.[MCP_TOOL_METADATA_KEY] === true;
}

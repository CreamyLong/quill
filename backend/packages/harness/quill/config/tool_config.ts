/**
 * Config section for a tool group.
 */
export interface ToolGroupConfig {
  /** Unique name for the tool group */
  name: string;
  /** Extra fields allowed (matches Pydantic extra="allow") */
  [key: string]: unknown;
}

/**
 * Config section for a tool.
 */
export interface ToolConfig {
  /** Unique name for the tool */
  name: string;
  /** Group name for the tool */
  group: string;
  /** Variable name of the tool provider */
  use: string;
  /** Extra fields allowed (matches Pydantic extra="allow") */
  [key: string]: unknown;
}

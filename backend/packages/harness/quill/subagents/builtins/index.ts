/**
 * Built-in subagent configurations.
 *
 * Mirrors `quill.subagents.builtins.__init__` from the Python backend.
 */

import type { SubagentConfig } from "../config.js";
import { BASH_AGENT_CONFIG } from "./bash_agent.js";
import { GENERAL_PURPOSE_CONFIG } from "./general_purpose.js";
import { RESEARCH_CONFIG } from "./research.js";

export { GENERAL_PURPOSE_CONFIG } from "./general_purpose.js";
export { BASH_AGENT_CONFIG } from "./bash_agent.js";
export { RESEARCH_CONFIG } from "./research.js";

/** Registry of built-in subagents. */
export const BUILTIN_SUBAGENTS: Record<string, SubagentConfig> = {
  "general-purpose": GENERAL_PURPOSE_CONFIG,
  bash: BASH_AGENT_CONFIG,
  research: RESEARCH_CONFIG,
};

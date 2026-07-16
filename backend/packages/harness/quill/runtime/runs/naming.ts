/**
 * Run naming helpers for LangChain/LangSmith tracing.
 */

export interface StringMap {
  [key: string]: unknown;
}

/**
 * Resolve the root run name from the tracing config or assistant id.
 */
export function resolveRootRunName(config: StringMap, assistantId: string | null): string {
  for (const containerName of ["context", "configurable"]) {
    const container = config[containerName];
    if (container != null && typeof container === "object" && !Array.isArray(container)) {
      const agentName = (container as StringMap)["agent_name"];
      if (typeof agentName === "string" && agentName.trim().length > 0) {
        return agentName;
      }
    }
  }
  return assistantId ?? "lead_agent";
}

/**
 * Trajectory Recorder — records model decision paths from journal events.
 *
 * Inspired by ZCode's model trajectory recording and DeepSeek Harness's
 * session log as deterministic replay source.
 *
 * The recorder builds a trajectory graph from run journal events,
 * tracking the flow: user_message → llm_call → tool_call → tool_result → llm_call → ...
 *
 * Source patterns:
 * - ZCode: Model trajectory recording with file tail
 * - DeepSeek Harness: Session log as deterministic replay source
 */

import type {
  TrajectoryConfig,
  TrajectoryEdge,
  TrajectoryGraph,
  TrajectoryNode,
} from "./types.js";
import { DEFAULT_TRAJECTORY_CONFIG } from "./types.js";

// ---------------------------------------------------------------------------
// Raw event for trajectory building
// ---------------------------------------------------------------------------

/**
 * Raw journal event for trajectory recording.
 */
export interface TrajectoryRawEvent {
  eventType: string;
  category: string;
  content: string | Record<string, unknown>;
  metadata: Record<string, unknown>;
  timestamp: string;
  threadId?: string;
  runId?: string;
}

// ---------------------------------------------------------------------------
// Trajectory Recorder
// ---------------------------------------------------------------------------

/**
 * Records model decision trajectories from run events.
 */
export class TrajectoryRecorder {
  private config: TrajectoryConfig;

  constructor(config?: Partial<TrajectoryConfig>) {
    this.config = { ...DEFAULT_TRAJECTORY_CONFIG, ...config };
  }

  /**
   * Build a trajectory graph from raw journal events.
   */
  buildTrajectory(events: TrajectoryRawEvent[], threadId: string, runId: string): TrajectoryGraph {
    const nodes: TrajectoryNode[] = [];
    const edges: TrajectoryEdge[] = [];
    const modelsUsed = new Set<string>();
    const toolsUsed = new Set<string>();
    let totalTokens = 0;
    let totalDuration = 0;
    let llmCallCount = 0;
    let toolCallCount = 0;
    let errorCount = 0;

    // Sort events by timestamp
    const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    let prevNodeId: string | null = null;
    let pendingLlmNodeId: string | null = null;

    for (const event of sorted) {
      if (nodes.length >= this.config.maxNodes) break;

      const node = this.eventToNode(event, nodes.length);
      if (!node) continue;

      nodes.push(node);

      // Track metrics
      if (node.type === "llm_call") {
        llmCallCount++;
        if (node.content.model) modelsUsed.add(node.content.model);
        totalTokens += (node.content.inputTokens ?? 0) + (node.content.outputTokens ?? 0);
        totalDuration += node.durationMs ?? 0;
        pendingLlmNodeId = node.id;
      } else if (node.type === "tool_call") {
        toolCallCount++;
        if (node.content.toolName) toolsUsed.add(node.content.toolName);
        totalDuration += node.durationMs ?? 0;
      } else if (node.type === "error") {
        errorCount++;
      }

      // Build edges
      if (prevNodeId) {
        const edge = this.inferEdge(nodes[nodes.length - 2]!, node, pendingLlmNodeId);
        if (edge) {
          edges.push(edge);
        }
      }

      prevNodeId = node.id;
    }

    const startedAt = sorted[0]?.timestamp ?? new Date().toISOString();
    const endedAt = sorted[sorted.length - 1]?.timestamp;

    return {
      id: runId,
      threadId,
      startedAt,
      endedAt,
      complete: true,
      nodes,
      edges,
      metrics: {
        totalNodes: nodes.length,
        llmCallCount,
        toolCallCount,
        errorCount,
        totalTokens,
        totalDurationMs: totalDuration,
        uniqueToolsUsed: [...toolsUsed],
        modelsUsed: [...modelsUsed],
      },
    };
  }

  // ------------------------------------------------------------------
  // Event conversion
  // ------------------------------------------------------------------

  /**
   * Convert a raw event to a trajectory node.
   */
  private eventToNode(event: TrajectoryRawEvent, sequence: number): TrajectoryNode | null {
    const base = {
      id: `${event.eventType}-${sequence}-${Date.now()}`,
      sequence,
      timestamp: event.timestamp,
      caller: event.metadata["caller"] as string | undefined,
    };

    switch (event.eventType) {
      case "llm.human.input": {
        if (!this.config.recordUserMessages) return null;
        const content = typeof event.content === "object" ? event.content : {};
        return {
          ...base,
          type: "user_message",
          content: {
            messagePreview: this.truncate(
              ((content as Record<string, unknown>)["content"] as string) ?? "",
            ),
          },
        };
      }

      case "llm.ai.response": {
        const usage = event.metadata["usage"] as Record<string, unknown> | undefined;
        const latency = event.metadata["latency_ms"] as number | undefined;
        return {
          ...base,
          type: "llm_call",
          durationMs: latency,
          content: {
            model: this.extractModelName(event.metadata),
            inputTokens: (usage?.["input_tokens"] as number) ?? 0,
            outputTokens: (usage?.["output_tokens"] as number) ?? 0,
          },
        };
      }

      case "llm.tool.result": {
        const content = typeof event.content === "object" ? event.content : {};
        return {
          ...base,
          type: "tool_result",
          content: {
            resultSummary: this.truncate(
              JSON.stringify((content as Record<string, unknown>)["content"] ?? ""),
            ),
          },
        };
      }

      case "run.start":
      case "run.end": {
        if (!this.config.recordSystemEvents) return null;
        return {
          ...base,
          type: "system_event",
          content: { eventName: event.eventType },
        };
      }

      case "run.error":
      case "llm.error": {
        const content = typeof event.content === "string" ? event.content : JSON.stringify(event.content);
        return {
          ...base,
          type: "error",
          content: { errorMessage: this.truncate(content) },
        };
      }

      default:
        return null;
    }
  }

  // ------------------------------------------------------------------
  // Edge inference
  // ------------------------------------------------------------------

  /**
   * Infer the edge type between two consecutive nodes.
   */
  private inferEdge(source: TrajectoryNode, target: TrajectoryNode, pendingLlmNodeId: string | null): TrajectoryEdge | null {
    const edge: TrajectoryEdge = {
      sourceId: source.id,
      targetId: target.id,
      transitionType: "sequential",
    };

    if (source.type === "user_message" && target.type === "llm_call") {
      edge.transitionType = "user_to_response";
    } else if (source.type === "llm_call" && target.type === "tool_result") {
      edge.transitionType = "tool_call_to_result";
    } else if (source.type === "tool_result" && target.type === "llm_call") {
      edge.transitionType = "tool_result_to_next_prompt";
    } else if (source.type === "error" && target.type === "llm_call") {
      edge.transitionType = "error_to_retry";
    }

    return edge;
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Extract model name from event metadata.
   */
  private extractModelName(metadata: Record<string, unknown>): string | undefined {
    return (metadata["model"] as string) ?? (metadata["model_name"] as string);
  }

  /**
   * Truncate a string to maxContentLength.
   */
  private truncate(str: string): string {
    if (str.length <= this.config.maxContentLength) return str;
    return str.slice(0, this.config.maxContentLength) + "...";
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let globalRecorder: TrajectoryRecorder | null = null;

/**
 * Get the global trajectory recorder instance.
 */
export function getTrajectoryRecorder(config?: Partial<TrajectoryConfig>): TrajectoryRecorder {
  if (!globalRecorder) {
    globalRecorder = new TrajectoryRecorder(config);
  }
  return globalRecorder;
}

/**
 * Reset the global trajectory recorder (for testing).
 */
export function resetTrajectoryRecorder(): void {
  globalRecorder = null;
}

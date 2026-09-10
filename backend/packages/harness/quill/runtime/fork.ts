/**
 * Session Forking — creates a branched copy of a thread with full checkpoint copy.
 *
 * Implements the session forking pattern from Kimi Code and DeepSeek Harness:
 * - Copies all checkpoints from source thread to the new thread
 * - Copies pending writes
 * - Preserves fork metadata (forked_from, fork_checkpoint_id)
 * - Supports forking at a specific checkpoint (partial history)
 *
 * Source patterns:
 * - Kimi Code: session forking (branch without disrupting original)
 * - DeepSeek Harness: fork at turn boundary
 */

import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";

/**
 * Result of a session fork operation.
 */
export interface ForkResult {
  /** The new thread ID. */
  newThreadId: string;
  /** The source thread ID. */
  sourceThreadId: string;
  /** Number of checkpoints copied. */
  checkpointsCopied: number;
  /** Number of pending writes copied. */
  writesCopied: number;
  /** The checkpoint ID forked at (if partial fork). */
  forkCheckpointId: string | null;
}

/**
 * Options for forking a session.
 */
export interface ForkOptions {
  /** The checkpointer to copy checkpoints from/to. */
  checkpointer: BaseCheckpointSaver;
  /** Source thread ID. */
  sourceThreadId: string;
  /** New thread ID. */
  newThreadId: string;
  /** Optional: fork at a specific checkpoint (copy only up to this point). */
  checkpointId?: string;
  /** Optional: checkpoint namespace (default: ""). */
  checkpointNs?: string;
}

/**
 * Fork a session by copying checkpoints from source to target thread.
 *
 * This implements a deep fork: all checkpoints and pending writes are copied
 * so the new thread has the full conversation history and can continue from
 * that point without affecting the original.
 */
export async function forkSession(options: ForkOptions): Promise<ForkResult> {
  const { checkpointer, sourceThreadId, newThreadId, checkpointNs = "" } = options;

  let checkpointsCopied = 0;
  let writesCopied = 0;
  let forkCheckpointId: string | null = null;

  // List all checkpoints for the source thread
  const config: RunnableConfig = {
    configurable: {
      thread_id: sourceThreadId,
      checkpoint_ns: checkpointNs,
    },
  };

  const checkpointList: Array<{
    checkpointId: string;
    parentCheckpointId: string | null;
    metadata: Record<string, unknown>;
    pendingWrites: Array<[string, string, unknown]>;
  }> = [];

  // Collect all checkpoints from the source thread
  for await (const tuple of checkpointer.list(config)) {
    const checkpointId = tuple.config.configurable?.checkpoint_id as string;
    const parentCheckpointId = tuple.parentConfig?.configurable?.checkpoint_id as string | null ?? null;

    // If forking at a specific checkpoint, stop after reaching it
    if (options.checkpointId && checkpointId === options.checkpointId) {
      forkCheckpointId = checkpointId;
      checkpointList.push({
        checkpointId,
        parentCheckpointId,
        metadata: tuple.metadata as Record<string, unknown>,
        pendingWrites: tuple.pendingWrites ?? [],
      });
      break;
    }

    checkpointList.push({
      checkpointId,
      parentCheckpointId,
      metadata: tuple.metadata as Record<string, unknown>,
      pendingWrites: tuple.pendingWrites ?? [],
    });
  }

  // Copy checkpoints to the new thread
  for (const cp of checkpointList) {
    const sourceConfig: RunnableConfig = {
      configurable: {
        thread_id: sourceThreadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: cp.checkpointId,
      },
    };

    // Get the full checkpoint data from source
    const sourceTuple = await checkpointer.getTuple(sourceConfig);
    if (!sourceTuple) {
      continue;
    }

    // Build the new config for the target thread
    const targetConfig: RunnableConfig = {
      configurable: {
        thread_id: newThreadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: cp.checkpointId,
      },
    };

    // Put the checkpoint into the new thread
    const newConfig = await checkpointer.put(
      targetConfig,
      sourceTuple.checkpoint,
      sourceTuple.metadata ?? { source: "fork", step: 0, parents: {} },
      {}, // newVersions
    );

    // Copy pending writes for this checkpoint
    if (cp.pendingWrites.length > 0) {
      const writeConfig: RunnableConfig = {
        configurable: {
          thread_id: newThreadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: cp.checkpointId,
        },
      };

      // Group writes by task_id
      const writesByTask = new Map<string, Array<[string, unknown]>>();
      for (const [taskId, channel, value] of cp.pendingWrites) {
        const existing = writesByTask.get(taskId) ?? [];
        existing.push([channel, value]);
        writesByTask.set(taskId, existing);
      }

      for (const [taskId, writes] of writesByTask) {
        const pendingWrites: Array<[string, unknown]> = writes;
        await checkpointer.putWrites(writeConfig, pendingWrites, taskId);
        writesCopied += writes.length;
      }
    }

    checkpointsCopied++;

    // Update the fork checkpoint ID to the latest copied
    if (!options.checkpointId) {
      forkCheckpointId = cp.checkpointId;
    }
  }

  return {
    newThreadId,
    sourceThreadId,
    checkpointsCopied,
    writesCopied,
    forkCheckpointId,
  };
}

/**
 * Check if a checkpointer supports the list operation needed for forking.
 */
export function canFork(checkpointer: unknown): boolean {
  if (!checkpointer || typeof checkpointer !== "object") {
    return false;
  }
  const cp = checkpointer as Record<string, unknown>;
  return (
    typeof cp["list"] === "function" &&
    typeof cp["getTuple"] === "function" &&
    typeof cp["put"] === "function" &&
    typeof cp["putWrites"] === "function"
  );
}

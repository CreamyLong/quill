/**
 * Callback handler that collects LLM token usage within a subagent.
 *
 * Mirrors `quill.subagents.token_collector` from the Python backend.
 *
 * Each subagent execution creates its own collector. After the subagent
 * finishes, the collected records are transferred to the parent RunJournal
 * via `RunJournal.record_external_llm_usage_records`.
 */

import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";

/** A single token-usage record captured for one LLM response. */
export type TokenUsageRecord = Record<string, number | string | null>;

/** Lightweight callback handler that collects LLM token usage within a subagent. */
export class SubagentTokenCollector extends BaseCallbackHandler {
  name = "SubagentTokenCollector";

  readonly caller: string;
  private readonly _records: TokenUsageRecord[] = [];
  private readonly _countedRunIds = new Set<string>();

  constructor(caller: string) {
    super();
    this.caller = caller;
  }

  override handleLLMEnd(
    response: LLMResult,
    runId: string,
    _parentRunId?: string,
    _tags?: string[]
  ): void {
    const rid = String(runId);
    if (this._countedRunIds.has(rid)) {
      return;
    }

    for (const generation of response.generations) {
      for (const gen of generation) {
        const message = (gen as { message?: unknown }).message;
        if (message === undefined || message === null) {
          continue;
        }
        const usage = (message as { usage_metadata?: unknown }).usage_metadata;
        const usageDict = (usage ?? {}) as Record<string, unknown>;
        const inputTk = Number(usageDict.input_tokens ?? 0) || 0;
        const outputTk = Number(usageDict.output_tokens ?? 0) || 0;
        let totalTk = Number(usageDict.total_tokens ?? 0) || 0;
        if (totalTk <= 0) {
          totalTk = inputTk + outputTk;
        }
        if (totalTk <= 0) {
          continue;
        }
        // Capture the model that actually produced this response so the
        // parent journal can bucket tokens by real model rather than the
        // lead agent's resolved model.
        const responseMetadata =
          ((message as { response_metadata?: unknown }).response_metadata as
            | Record<string, unknown>
            | undefined) ?? {};
        let modelName: string | null = null;
        const rawModelName = responseMetadata.model_name ?? responseMetadata.model;
        if (typeof rawModelName === "string") {
          modelName = rawModelName;
        }
        this._countedRunIds.add(rid);
        this._records.push({
          source_run_id: rid,
          caller: this.caller,
          model_name: modelName,
          input_tokens: inputTk,
          output_tokens: outputTk,
          total_tokens: totalTk,
        });
        return;
      }
    }
  }

  /** Return a copy of the accumulated usage records. */
  snapshotRecords(): TokenUsageRecord[] {
    return [...this._records];
  }
}

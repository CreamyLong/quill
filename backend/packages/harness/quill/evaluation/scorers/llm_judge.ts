/**
 * LLM-judge scorer — uses an LLM to evaluate the agent's response.
 *
 * Mirrors the "LLM-as-judge" evaluation pattern from OpenAI Evals and
 * DeepSeek-harness. An evaluation prompt is sent to a judge model which
 * scores the agent's response against criteria defined in the task.
 *
 * This scorer is intentionally async (unlike the deterministic scorers)
 * because it makes a network call. The runner handles timeouts and retries.
 */

import type { EvalScore, EvalScorer, EvalTask, EvalTaskResult } from "../types.js";

/**
 * Function that calls the judge LLM. Abstracted so the scorer can work
 * with any LLM backend (same pattern as Kimi Code's kosong abstraction).
 */
export type JudgeLlmCall = (
  systemPrompt: string,
  userPrompt: string,
  options?: { model?: string; temperature?: number },
) => Promise<string>;

/**
 * Create an LLM-judge scorer with the given LLM call function.
 */
export function createLlmJudgeScorer(callLlm: JudgeLlmCall): EvalScorer {
  return {
    name: "llm_judge",

    async score(task: EvalTask, result: EvalTaskResult): Promise<EvalScore> {
      const config = task.scoring;
      if (config.type !== "llm_judge") {
        return { score: 0, passed: false, reason: "Scoring config type mismatch" };
      }

      const systemPrompt = config.prompt;
      const userPrompt = buildJudgeUserPrompt(task, result);

      try {
        const rawResponse = await callLlm(systemPrompt, userPrompt, {
          model: config.model,
          temperature: config.temperature ?? 0,
        });

        return parseJudgeResponse(rawResponse);
      } catch (err) {
        return {
          score: 0,
          passed: false,
          reason: `LLM judge call failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

function buildJudgeUserPrompt(task: EvalTask, result: EvalTaskResult): string {
  const parts: string[] = [];
  parts.push(`Task: ${task.name}`);
  parts.push(`\nTask prompt:\n${task.prompt}`);
  if (task.expectedAnswer) {
    parts.push(`\nExpected answer:\n${task.expectedAnswer}`);
  }
  parts.push(`\nAgent response:\n${result.response}`);
  if (result.artifacts.length > 0) {
    parts.push(`\nArtifacts produced: ${result.artifacts.join(", ")}`);
  }
  parts.push(`\n\nRate the agent's response on a scale of 0.0 to 1.0, where:`);
  parts.push(`- 1.0 = fully correct and complete`);
  parts.push(`- 0.5 = partially correct or incomplete`);
  parts.push(`- 0.0 = incorrect or irrelevant`);
  parts.push(`\nRespond with JSON: {"score": <number>, "passed": <boolean>, "reason": "<explanation>"}`);
  return parts.join("\n");
}

function parseJudgeResponse(raw: string): EvalScore {
  // Try to parse JSON from the response (handle markdown code fences)
  const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```\s*$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.score === "number") {
      return {
        score: Math.max(0, Math.min(1, parsed.score)),
        passed: parsed.passed === true || parsed.score >= 0.7,
        reason: parsed.reason ?? "LLM judge scored the response",
        details: parsed,
      };
    }
  } catch {
    // Fall through to text-based extraction
  }

  // Try to extract a score from free text
  const scoreMatch = raw.match(/\b(\d+(?:\.\d+)?)\b/);
  if (scoreMatch) {
    const score = parseFloat(scoreMatch[1]);
    const normalizedScore = score > 1 ? score / 100 : score;
    return {
      score: Math.max(0, Math.min(1, normalizedScore)),
      passed: normalizedScore >= 0.7,
      reason: raw.slice(0, 200),
    };
  }

  return {
    score: 0,
    passed: false,
    reason: `Could not parse judge response: ${raw.slice(0, 100)}`,
  };
}

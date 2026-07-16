/**
 * Memory updater for reading, writing, and updating memory data.
 *
 * Mirrors `quill.agents.memory.updater` from the Python backend.
 */

import crypto from "node:crypto";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { createChatModel } from "../../models/factory.js";
import { getMemoryConfig, type MemoryConfig } from "../../config/memory_config.js";
import {
  createEmptyMemory,
  getMemoryStorage,
  utcNowIsoZ,
  type MemoryStorage,
} from "./storage.js";
import {
  MEMORY_UPDATE_PROMPT,
  formatConversationForUpdate,
  formatMemoryForInjection,
} from "./prompt.js";

const REQUIRED_UPDATE_KEYS = new Set(["user", "history", "newFacts", "factsToRemove"]);

function validateConfidence(confidence: number): number {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("confidence");
  }
  return confidence;
}

function normalizeFact(fact: unknown): Record<string, unknown> | null {
  if (fact === null || typeof fact !== "object") return null;
  const f = fact as Record<string, unknown>;
  const rawContent = f.content;
  if (typeof rawContent !== "string") return null;
  const content = rawContent.trim();
  if (!content) return null;

  const rawCategory = f.category;
  const category =
    typeof rawCategory === "string" && rawCategory.trim() ? rawCategory.trim() : "context";

  let rawConfidence: unknown = f.confidence ?? 0.5;
  if (typeof rawConfidence === "boolean") return null;
  if (typeof rawConfidence === "string") {
    const s = rawConfidence.trim();
    if (!s) return null;
    const parsed = Number(s);
    if (Number.isNaN(parsed)) return null;
    rawConfidence = parsed;
  } else if (typeof rawConfidence !== "number") {
    return null;
  }
  const confidence = Number(rawConfidence);
  if (!Number.isFinite(confidence)) return null;

  const normalized: Record<string, unknown> = { content, category, confidence };
  const sourceError = f.sourceError;
  if (typeof sourceError === "string" && sourceError.trim()) {
    normalized.sourceError = sourceError.trim();
  }
  return normalized;
}

function normalizeUpdateData(updateData: Record<string, unknown>): {
  user: Record<string, unknown>;
  history: Record<string, unknown>;
  newFacts: Array<Record<string, unknown>>;
  factsToRemove: string[];
} {
  const user = updateData.user;
  const history = updateData.history;
  const newFacts = updateData.newFacts;
  const factsToRemove = updateData.factsToRemove;

  const normalizedFactsToRemove: string[] = Array.isArray(factsToRemove)
    ? factsToRemove.filter((id): id is string => typeof id === "string")
    : [];

  const normalizedNewFacts: Array<Record<string, unknown>> = [];
  let droppedNewFact = !Array.isArray(newFacts);
  if (Array.isArray(newFacts)) {
    for (const fact of newFacts) {
      const normalized = normalizeFact(fact);
      if (normalized) {
        normalizedNewFacts.push(normalized);
      } else {
        droppedNewFact = true;
      }
    }
  }

  if (normalizedFactsToRemove.length > 0 && droppedNewFact) {
    throw new Error("Unsafe partial memory update: factsToRemove with malformed newFacts");
  }

  return {
    user: typeof user === "object" && user !== null ? (user as Record<string, unknown>) : {},
    history:
      typeof history === "object" && history !== null
        ? (history as Record<string, unknown>)
        : {},
    newFacts: normalizedNewFacts,
    factsToRemove: normalizedFactsToRemove,
  };
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const pieces: string[] = [];
    const pending: string[] = [];
    for (const block of content) {
      if (typeof block === "string") {
        pending.push(block);
      } else if (block !== null && typeof block === "object") {
        if (pending.length > 0) {
          pieces.push(pending.join(""));
          pending.length = 0;
        }
        const textVal = (block as Record<string, unknown>).text;
        if (typeof textVal === "string") {
          pieces.push(textVal);
        }
      }
    }
    if (pending.length > 0) {
      pieces.push(pending.join(""));
    }
    return pieces.join("\n");
  }
  return String(content);
}

function parseMemoryUpdateResponse(responseContent: unknown): {
  user: Record<string, unknown>;
  history: Record<string, unknown>;
  newFacts: Array<Record<string, unknown>>;
  factsToRemove: string[];
} {
  const responseText = extractTextFromContent(responseContent).trim();
  const firstBrace = responseText.indexOf("{");
  if (firstBrace < 0) {
    throw new Error("No valid memory update JSON object found");
  }
  for (let i = firstBrace; i < responseText.length; i++) {
    if (responseText[i] !== "{") continue;
    try {
      const parsed = JSON.parse(responseText.slice(i));
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        REQUIRED_UPDATE_KEYS.size ===
          new Set([...REQUIRED_UPDATE_KEYS].filter((k) => k in parsed)).size
      ) {
        return normalizeUpdateData(parsed as Record<string, unknown>);
      }
    } catch {
      // continue scanning
    }
  }
  throw new Error("No valid memory update JSON object found");
}

const UPLOAD_SENTENCE_RE = /[^.!?]*\b(?:upload(?:ed|ing)?(?:\s+\w+){0,3}\s+(?:file|files?|document|documents?|attachment|attachments?)|file\s+upload|\/mnt\/user-data\/uploads\/|<uploaded_files>)[^.!?]*[.!?]?\s*/gi;

function stripUploadMentions(memoryData: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...memoryData };
  for (const section of ["user", "history"] as const) {
    const sectionData = copy[section] as Record<string, unknown> | undefined;
    if (!sectionData) continue;
    for (const [key, val] of Object.entries(sectionData)) {
      if (val !== null && typeof val === "object" && "summary" in (val as Record<string, unknown>)) {
        const entry = val as Record<string, unknown>;
        const summary = String(entry.summary ?? "");
        const cleaned = summary.replace(UPLOAD_SENTENCE_RE, "").replace(/  +/g, " ").trim();
        entry.summary = cleaned;
      }
    }
  }
  const facts = copy.facts;
  if (Array.isArray(facts)) {
    copy.facts = facts.filter(
      (f) => !UPLOAD_SENTENCE_RE.test(String((f as Record<string, unknown>)?.content ?? ""))
    );
  }
  return copy;
}

function factContentKey(content: unknown): string | null {
  if (typeof content !== "string") return null;
  const stripped = content.trim();
  if (!stripped) return null;
  return stripped.toLowerCase();
}

export interface MemoryUpdaterOptions {
  /** Optional model name; defaults to memory config modelName. */
  modelName?: string | null;
  /** Optional explicit memory config. */
  memoryConfig?: MemoryConfig;
  /** Optional storage provider (defaults to global FileMemoryStorage). */
  storage?: MemoryStorage;
}

/** Updates memory using an LLM based on conversation context. */
export class MemoryUpdater {
  private modelName?: string | null;
  private memoryConfig: MemoryConfig;
  private storage: MemoryStorage;

  constructor(options: MemoryUpdaterOptions = {}) {
    this.modelName = options.modelName;
    this.memoryConfig = options.memoryConfig ?? getMemoryConfig();
    this.storage = options.storage ?? getMemoryStorage();
  }

  private getModel(): BaseChatModel {
    const modelName = this.modelName ?? this.memoryConfig.modelName;
    return createChatModel(modelName, false);
  }

  private buildCorrectionHint(
    correctionDetected: boolean,
    reinforcementDetected: boolean
  ): string {
    const parts: string[] = [];
    if (correctionDetected) {
      parts.push(
        "IMPORTANT: Explicit correction signals were detected in this conversation. " +
          "Pay special attention to what the agent got wrong, what the user corrected, " +
          'and record the correct approach as a fact with category "correction" and confidence >= 0.95 when appropriate.'
      );
    }
    if (reinforcementDetected) {
      parts.push(
        "IMPORTANT: Positive reinforcement signals were detected in this conversation. " +
          "The user explicitly confirmed the agent's approach was correct or helpful. " +
          'Record the confirmed approach, style, or preference as a fact with category "preference" or "behavior" and confidence >= 0.9 when appropriate.'
      );
    }
    return parts.join("\n");
  }

  private prepareUpdatePrompt(
    messages: unknown[],
    agentName: string | null,
    correctionDetected: boolean,
    reinforcementDetected: boolean,
    userId: string | null
  ): [Record<string, unknown>, string] | null {
    if (!this.memoryConfig.enabled || messages.length === 0) {
      return null;
    }
    const currentMemory = this.storage.load(agentName, userId);
    const conversationText = formatConversationForUpdate(messages);
    if (!conversationText.trim()) {
      return null;
    }
    const correctionHint = this.buildCorrectionHint(correctionDetected, reinforcementDetected);
    const prompt = MEMORY_UPDATE_PROMPT.replace("{current_memory}", JSON.stringify(currentMemory, null, 2))
      .replace("{conversation}", conversationText)
      .replace("{correction_hint}", correctionHint);
    return [currentMemory, prompt];
  }

  private applyUpdates(
    currentMemory: Record<string, unknown>,
    updateData: {
      user: Record<string, unknown>;
      history: Record<string, unknown>;
      newFacts: Array<Record<string, unknown>>;
      factsToRemove: string[];
    },
    threadId: string | null
  ): Record<string, unknown> {
    const now = utcNowIsoZ();
    const updated: Record<string, unknown> = { ...currentMemory };

    const ensureSection = (name: string): Record<string, unknown> => {
      const existing = updated[name];
      if (existing !== null && typeof existing === "object") {
        return existing as Record<string, unknown>;
      }
      const created: Record<string, unknown> = {};
      updated[name] = created;
      return created;
    };

    const userSection = ensureSection("user");
    for (const key of ["workContext", "personalContext", "topOfMind"]) {
      const data = updateData.user[key] as Record<string, unknown> | undefined;
      if (data?.shouldUpdate && data?.summary) {
        userSection[key] = { summary: String(data.summary), updatedAt: now };
      }
    }

    const historySection = ensureSection("history");
    for (const key of ["recentMonths", "earlierContext", "longTermBackground"]) {
      const data = updateData.history[key] as Record<string, unknown> | undefined;
      if (data?.shouldUpdate && data?.summary) {
        historySection[key] = { summary: String(data.summary), updatedAt: now };
      }
    }

    const facts = Array.isArray(updated.facts) ? [...updated.facts] : [];
    const toRemove = new Set(updateData.factsToRemove);
    const keptFacts = facts.filter((f) => !toRemove.has(String((f as Record<string, unknown>).id ?? "")));

    const existingKeys = new Set<string>();
    for (const fact of keptFacts) {
      const key = factContentKey((fact as Record<string, unknown>).content);
      if (key) existingKeys.add(key);
    }

    for (const fact of updateData.newFacts) {
      const confidence = Number(fact.confidence ?? 0.5);
      if (confidence < this.memoryConfig.factConfidenceThreshold) continue;
      const content = String(fact.content ?? "").trim();
      const key = factContentKey(content);
      if (!key || existingKeys.has(key)) continue;

      const entry: Record<string, unknown> = {
        id: `fact_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`,
        content,
        category: String(fact.category ?? "context"),
        confidence,
        createdAt: now,
        source: threadId || "unknown",
      };
      const sourceError = fact.sourceError;
      if (typeof sourceError === "string" && sourceError.trim()) {
        entry.sourceError = sourceError.trim();
      }
      keptFacts.push(entry);
      existingKeys.add(key);
    }

    if (keptFacts.length > this.memoryConfig.maxFacts) {
      keptFacts.sort((a, b) => {
        const ca = Number((b as Record<string, unknown>).confidence ?? 0);
        const cb = Number((a as Record<string, unknown>).confidence ?? 0);
        return ca - cb;
      });
      updated.facts = keptFacts.slice(0, this.memoryConfig.maxFacts);
    } else {
      updated.facts = keptFacts;
    }

    return updated;
  }

  private finalizeUpdate(
    currentMemory: Record<string, unknown>,
    responseContent: unknown,
    threadId: string | null,
    agentName: string | null,
    userId: string | null
  ): boolean {
    const updateData = parseMemoryUpdateResponse(responseContent);
    let updatedMemory = this.applyUpdates(currentMemory, updateData, threadId);
    updatedMemory = stripUploadMentions(updatedMemory);
    return this.storage.save(updatedMemory, agentName, userId);
  }

  /** Update memory using the configured LLM. */
  async updateMemory(
    messages: unknown[],
    threadId: string | null = null,
    agentName: string | null = null,
    correctionDetected = false,
    reinforcementDetected = false,
    userId: string | null = null
  ): Promise<boolean> {
    try {
      const prepared = this.prepareUpdatePrompt(
        messages,
        agentName,
        correctionDetected,
        reinforcementDetected,
        userId
      );
      if (!prepared) return false;
      const [currentMemory, prompt] = prepared;
      const model = this.getModel();
      const response = await model.invoke(prompt);
      const content = (response as unknown as { content?: unknown }).content;
      return this.finalizeUpdate(currentMemory, content, threadId, agentName, userId);
    } catch (error) {
      console.warn("Memory update failed:", error);
      return false;
    }
  }
}

/** Convenience function to update memory from a conversation. */
export function updateMemoryFromConversation(
  messages: unknown[],
  threadId: string | null = null,
  agentName: string | null = null,
  correctionDetected = false,
  reinforcementDetected = false,
  userId: string | null = null
): Promise<boolean> {
  const updater = new MemoryUpdater();
  return updater.updateMemory(
    messages,
    threadId,
    agentName,
    correctionDetected,
    reinforcementDetected,
    userId
  );
}

/** Get the formatted memory block wrapped in XML tags for prompt injection. */
export function getMemoryContext(
  agentName: string | null = null,
  userId: string | null = null,
  options?: {
    memoryConfig?: MemoryConfig;
    storage?: MemoryStorage;
  }
): string {
  const config = options?.memoryConfig ?? getMemoryConfig();
  if (!config.enabled || !config.injectionEnabled) {
    return "";
  }
  try {
    const storage = options?.storage ?? getMemoryStorage();
    const memoryData = storage.load(agentName, userId);
    const memoryContent = formatMemoryForInjection(
      memoryData,
      config.maxInjectionTokens,
      {
        useTiktoken: config.tokenCounting === "tiktoken",
        guaranteedCategories: config.guaranteedCategories,
        guaranteedTokenBudget: config.guaranteedTokenBudget,
      }
    );
    if (!memoryContent.trim()) return "";
    return `<memory>\n${memoryContent}\n</memory>\n`;
  } catch (error) {
    console.warn("Failed to load memory context:", error);
    return "";
  }
}

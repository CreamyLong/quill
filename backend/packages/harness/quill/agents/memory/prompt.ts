/**
 * Prompt templates and formatting for memory update and injection.
 *
 * Mirrors `quill.agents.memory.prompt` from the Python backend.
 */

export const MEMORY_UPDATE_PROMPT = `You are a memory management system. Your task is to analyze a conversation and update the user's memory profile.

Current Memory State:
<current_memory>
{current_memory}
</current_memory>

New Conversation to Process:
<conversation>
{conversation}
</conversation>

Instructions:
1. Analyze the conversation for important information about the user
2. Extract relevant facts, preferences, and context with specific details (numbers, names, technologies)
3. Update the memory sections as needed following the detailed length guidelines below

Before extracting facts, perform a structured reflection on the conversation:
1. Error/Retry Detection: Did the agent encounter errors, require retries, or produce incorrect results?
   If yes, record the root cause and correct approach as a high-confidence fact with category "correction".
2. User Correction Detection: Did the user correct the agent's direction, understanding, or output?
   If yes, record the correct interpretation or approach as a high-confidence fact with category "correction".
   Include what went wrong in "sourceError" only when category is "correction" and the mistake is explicit in the conversation.
3. Project Constraint Discovery: Were any project-specific constraints discovered during the conversation?
   If yes, record them as facts with the most appropriate category and confidence.

{correction_hint}

Memory Section Guidelines:

**User Context** (Current state - concise summaries):
- workContext: Professional role, company, key projects, main technologies (2-3 sentences)
- personalContext: Languages, communication preferences, key interests (1-2 sentences)
- topOfMind: Multiple ongoing focus areas and priorities (3-5 sentences, detailed paragraph)

**History** (Temporal context - rich paragraphs):
- recentMonths: Detailed summary of recent activities (4-6 sentences or 1-2 paragraphs)
- earlierContext: Important historical patterns (3-5 sentences or 1 paragraph)
- longTermBackground: Persistent background and foundational context (2-4 sentences)

**Facts Extraction**:
- Categories: preference, knowledge, context, behavior, goal, correction
- Confidence levels:
  * 0.9-1.0: Explicitly stated facts
  * 0.7-0.8: Strongly implied from actions/discussions
  * 0.5-0.6: Inferred patterns (use sparingly)

Output Format (JSON):
{
  "user": {
    "workContext": { "summary": "...", "shouldUpdate": true/false },
    "personalContext": { "summary": "...", "shouldUpdate": true/false },
    "topOfMind": { "summary": "...", "shouldUpdate": true/false }
  },
  "history": {
    "recentMonths": { "summary": "...", "shouldUpdate": true/false },
    "earlierContext": { "summary": "...", "shouldUpdate": true/false },
    "longTermBackground": { "summary": "...", "shouldUpdate": true/false }
  },
  "newFacts": [
    { "content": "...", "category": "preference|knowledge|context|behavior|goal|correction", "confidence": 0.0-1.0 }
  ],
  "factsToRemove": ["fact_id_1", "fact_id_2"]
}

Important Rules:
- Only set shouldUpdate=true if there's meaningful new information
- Include specific metrics, version numbers, and proper nouns in facts
- Only add facts that are clearly stated (0.9+) or strongly implied (0.7+)
- Use category "correction" for explicit agent mistakes or user corrections; assign confidence >= 0.95 when explicit
- Include "sourceError" only for explicit correction facts when the prior mistake is clearly stated
- Remove facts that are contradicted by new information
- Do NOT record file upload events in memory. Uploaded files are session-specific and ephemeral.

Return ONLY valid JSON, no explanation or markdown.`;

export const FACT_EXTRACTION_PROMPT = `Extract factual information about the user from this message.

Message:
{message}

Extract facts in this JSON format:
{
  "facts": [
    { "content": "...", "category": "preference|knowledge|context|behavior|goal|correction", "confidence": 0.0-1.0 }
  ]
}

Rules:
- Only extract clear, specific facts
- Confidence should reflect certainty (explicit statement = 0.9+, implied = 0.6-0.8)
- Skip vague or temporary information

Return ONLY valid JSON.`;

/** Network-free token estimate that accounts for CJK density. */
export function charBasedTokenEstimate(text: string): number {
  let cjk = 0;
  for (const ch of text) {
    if (
      ("\u4e00" <= ch && ch <= "\u9fff") ||
      ("\u3040" <= ch && ch <= "\u30ff") ||
      ("\uac00" <= ch && ch <= "\ud7a3")
    ) {
      cjk += 1;
    }
  }
  return Math.floor((text.length - cjk) / 4) + Math.floor(cjk / 2);
}

/** Count tokens using the configured strategy. */
export function countTokens(text: string, useTiktoken: boolean): number {
  if (useTiktoken) {
    // tiktoken is intentionally not bundled with the TS runtime to avoid
    // network-dependent BPE downloads. Fall back to the char-based estimator.
    return charBasedTokenEstimate(text);
  }
  return charBasedTokenEstimate(text);
}

function coerceConfidence(value: unknown, defaultValue = 0): number {
  let confidence: number;
  try {
    confidence = Number(value);
  } catch {
    return Math.max(0, Math.min(1, defaultValue));
  }
  if (!Number.isFinite(confidence)) {
    return Math.max(0, Math.min(1, defaultValue));
  }
  return Math.max(0, Math.min(1, confidence));
}

function formatFactLine(fact: Record<string, unknown>): string | null {
  const contentValue = fact.content;
  if (typeof contentValue !== "string") return null;
  const content = contentValue.trim();
  if (!content) return null;
  const category = String(fact.category ?? "context").trim() || "context";
  const confidence = coerceConfidence(fact.confidence, 0);
  const sourceError = fact.sourceError;
  if (category === "correction" && typeof sourceError === "string" && sourceError.trim()) {
    return `- [${category} | ${confidence.toFixed(2)}] ${content} (avoid: ${sourceError.trim()})`;
  }
  return `- [${category} | ${confidence.toFixed(2)}] ${content}`;
}

function selectFactLines(
  rankedFacts: Array<Record<string, unknown>>,
  tokenBudget: number,
  useTiktoken: boolean
): [string[], number] {
  const lines: string[] = [];
  let consumed = 0;
  for (const fact of rankedFacts) {
    const formatted = formatFactLine(fact);
    if (formatted === null) continue;
    const lineText = lines.length > 0 ? "\n" + formatted : formatted;
    const lineTokens = countTokens(lineText, useTiktoken);
    if (consumed + lineTokens > tokenBudget) break;
    lines.push(formatted);
    consumed += lineTokens;
  }
  return [lines, consumed];
}

/** Format memory data for injection into the system prompt. */
export function formatMemoryForInjection(
  memoryData: Record<string, unknown> | null | undefined,
  maxTokens = 2000,
  options: {
    useTiktoken?: boolean;
    guaranteedCategories?: string[];
    guaranteedTokenBudget?: number;
  } = {}
): string {
  const useTiktoken = options.useTiktoken ?? true;
  const guaranteedCategories = options.guaranteedCategories ?? [];
  const guaranteedTokenBudget = options.guaranteedTokenBudget ?? 500;

  if (!memoryData || typeof memoryData !== "object") {
    return "";
  }

  const effectiveGuaranteed = new Set(
    guaranteedCategories
      .filter((c): c is string => typeof c === "string")
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
  );

  const sections: string[] = [];

  const userData = (memoryData.user ?? {}) as Record<string, unknown>;
  if (userData && typeof userData === "object") {
    const userSections: string[] = [];
    const workCtx = (userData.workContext ?? {}) as Record<string, unknown>;
    if (workCtx.summary) userSections.push(`Work: ${workCtx.summary}`);
    const personalCtx = (userData.personalContext ?? {}) as Record<string, unknown>;
    if (personalCtx.summary) userSections.push(`Personal: ${personalCtx.summary}`);
    const topOfMind = (userData.topOfMind ?? {}) as Record<string, unknown>;
    if (topOfMind.summary) userSections.push(`Current Focus: ${topOfMind.summary}`);
    if (userSections.length > 0) {
      sections.push("User Context:\n" + userSections.map((s) => `- ${s}`).join("\n"));
    }
  }

  const historyData = (memoryData.history ?? {}) as Record<string, unknown>;
  if (historyData && typeof historyData === "object") {
    const historySections: string[] = [];
    const recent = (historyData.recentMonths ?? {}) as Record<string, unknown>;
    if (recent.summary) historySections.push(`Recent: ${recent.summary}`);
    const earlier = (historyData.earlierContext ?? {}) as Record<string, unknown>;
    if (earlier.summary) historySections.push(`Earlier: ${earlier.summary}`);
    const background = (historyData.longTermBackground ?? {}) as Record<string, unknown>;
    if (background.summary) historySections.push(`Background: ${background.summary}`);
    if (historySections.length > 0) {
      sections.push("History:\n" + historySections.map((s) => `- ${s}`).join("\n"));
    }
  }

  const factsData = memoryData.facts;
  let guaranteedLineTokens = 0;
  let allFactLines: string[] = [];
  const factsHeader = "Facts:\n";
  if (Array.isArray(factsData) && factsData.length > 0) {
    const baseText = sections.join("\n\n");
    const baseTokens = baseText ? countTokens(baseText, useTiktoken) : 0;

    const validFacts = factsData.filter(
      (f): f is Record<string, unknown> =>
        f !== null &&
        typeof f === "object" &&
        typeof (f as Record<string, unknown>).content === "string" &&
        String((f as Record<string, unknown>).content).trim().length > 0
    );

    try {
      const confidenceKey = (fact: Record<string, unknown>): number =>
        coerceConfidence(fact.confidence, 0);

      let guaranteed: Array<Record<string, unknown>> = [];
      let regular: Array<Record<string, unknown>> = [];
      if (effectiveGuaranteed.size > 0) {
        guaranteed = validFacts
          .filter((f) => {
            const raw = f.category;
            if (typeof raw !== "string") return false;
            const cat = raw.trim();
            return cat.length > 0 && effectiveGuaranteed.has(cat);
          })
          .sort((a, b) => confidenceKey(b) - confidenceKey(a));
        regular = validFacts
          .filter((f) => {
            const raw = f.category;
            if (typeof raw !== "string") return true;
            const cat = raw.trim();
            return cat.length === 0 || !effectiveGuaranteed.has(cat);
          })
          .sort((a, b) => confidenceKey(b) - confidenceKey(a));
      } else {
        regular = [...validFacts].sort((a, b) => confidenceKey(b) - confidenceKey(a));
      }

      const headerCost = countTokens(factsHeader, useTiktoken);

      let guaranteedLines: string[] = [];
      if (guaranteed.length > 0) {
        [guaranteedLines, guaranteedLineTokens] = selectFactLines(
          guaranteed,
          guaranteedTokenBudget,
          useTiktoken
        );
      }

      let regularLines: string[] = [];
      if (regular.length > 0) {
        const interGroupNewlineTokens = guaranteedLines.length > 0 ? countTokens("\n", useTiktoken) : 0;
        const usedBeforeRegular = baseTokens + headerCost + guaranteedLineTokens + interGroupNewlineTokens;
        const regularLineBudget = maxTokens - usedBeforeRegular;
        if (regularLineBudget > 0) {
          [regularLines] = selectFactLines(regular, regularLineBudget, useTiktoken);
        }
      }

      allFactLines = guaranteedLines.concat(regularLines);
      if (allFactLines.length > 0) {
        sections.push(factsHeader + allFactLines.join("\n"));
      }
    } catch {
      // Fallback: confidence-only ranking with a single budget.
      const ranked = [...validFacts].sort((a, b) => coerceConfidence(b.confidence, 0) - coerceConfidence(a.confidence, 0));
      const overhead = countTokens(factsHeader, useTiktoken);
      const lineBudget = maxTokens - baseTokens - overhead;
      if (lineBudget > 0) {
        const [lines] = selectFactLines(ranked, lineBudget, useTiktoken);
        if (lines.length > 0) {
          sections.push(factsHeader + lines.join("\n"));
          allFactLines = lines;
        }
      }
    }
  }

  if (sections.length === 0) {
    return "";
  }

  let result = sections.join("\n\n");
  const effectiveLimit = maxTokens + guaranteedLineTokens;
  if (countTokens(result, useTiktoken) > effectiveLimit) {
    const factsBlock = allFactLines.length > 0 ? factsHeader + allFactLines.join("\n") : "";
    const factsBlockTokens = factsBlock ? countTokens(factsBlock, useTiktoken) : 0;
    const separatorTokens = countTokens("\n\n", useTiktoken);
    const budgetForNonFacts = Math.max(
      0,
      effectiveLimit - factsBlockTokens - (factsBlock ? separatorTokens : 0)
    );
    const precedingSections = allFactLines.length > 0 ? sections.slice(0, -1) : sections;
    let preceding = precedingSections.join("\n\n");
    if (preceding) {
      const precedingTokens = countTokens(preceding, useTiktoken);
      if (precedingTokens > budgetForNonFacts) {
        const charPerToken = preceding.length / Math.max(precedingTokens, 1);
        const targetChars = Math.floor(budgetForNonFacts * charPerToken * 0.95);
        preceding = preceding.slice(0, targetChars).trimEnd() + "\n...";
      }
      result = factsBlock ? preceding + "\n\n" + factsBlock : preceding;
    } else {
      result = factsBlock;
    }
  }

  return result;
}

function extractTextParts(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const textParts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        textParts.push(part);
      } else if (part !== null && typeof part === "object") {
        const textVal = (part as Record<string, unknown>).text;
        if (typeof textVal === "string") {
          textParts.push(textVal);
        }
      }
    }
    return textParts.join(" ");
  }
  return String(content);
}

/** Format conversation messages for the memory-update prompt. */
export function formatConversationForUpdate(messages: unknown[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    const role = String(m.type ?? "unknown");
    let content = extractTextParts(m.content);

    if (role === "human") {
      content = content.replace(/<uploaded_files>[\s\S]*?<\/uploaded_files>\n*/gi, "").trim();
      if (!content) continue;
    }

    if (content.length > 1000) {
      content = content.slice(0, 1000) + "...";
    }

    if (role === "human") {
      lines.push(`User: ${content}`);
    } else if (role === "ai") {
      lines.push(`Assistant: ${content}`);
    }
  }
  return lines.join("\n\n");
}

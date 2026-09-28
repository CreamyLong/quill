/**
 * Algorithm Module Implementations — concrete variants for each swappable module.
 *
 * Researchers can register these implementations to enable A/B testing of
 * different algorithm strategies. Each module key has at least a "baseline"
 * and one or more experimental variants.
 *
 * @module experiments/modules
 */

import {
  registerAlgorithm,
  createDefaultModule,
  type AlgorithmModule,
  type AlgorithmModuleKey,
  type AlgorithmInput,
  type AlgorithmOutput,
} from "./registry.js";

// ---------------------------------------------------------------------------
// Classifier Module
// ---------------------------------------------------------------------------

/**
 * Baseline classifier — uses simple keyword matching.
 */
class BaselineClassifier implements AlgorithmModule {
  readonly key = "classifier" as const;
  readonly variant = "baseline";

  async execute(input: AlgorithmInput): Promise<AlgorithmOutput> {
    const text = String(input.data ?? "").toLowerCase();
    const categories = ["code", "research", "math", "writing", "general"];
    let bestCategory = "general";
    let bestScore = 0;

    const keywords: Record<string, string[]> = {
      code: ["function", "class", "import", "def", "var", "const", "return"],
      research: ["analyze", "study", "paper", "experiment", "data", "hypothesis"],
      math: ["calculate", "equation", "solve", "formula", "number", "proof"],
      writing: ["write", "essay", "article", "blog", "story", "draft"],
    };

    for (const [category, words] of Object.entries(keywords)) {
      const score = words.filter((w) => text.includes(w)).length;
      if (score > bestScore) {
        bestScore = score;
        bestCategory = category;
      }
    }

    return {
      result: { category: bestCategory, confidence: Math.min(bestScore / 3, 1) },
      success: true,
      metadata: { classifier: "keyword", score: bestScore },
    };
  }

  collectMetrics() {
    return { key: this.key, variant: this.variant } as never;
  }
}

/**
 * LLM-based classifier — uses the model to classify input.
 */
class LlmClassifier implements AlgorithmModule {
  readonly key = "classifier" as const;
  readonly variant = "llm";

  async execute(input: AlgorithmInput): Promise<AlgorithmOutput> {
    // In production, this would call the LLM. For now, use a heuristic
    // that simulates LLM classification with higher accuracy.
    const text = String(input.data ?? "").toLowerCase();
    const categories = ["code", "research", "math", "writing", "general"];

    // Simulate LLM classification with better heuristics
    const scores: Record<string, number> = {};
    for (const cat of categories) {
      scores[cat] = 0;
    }

    // More sophisticated keyword matching
    const patterns: Record<string, RegExp[]> = {
      code: [/\b(function|class|import|def|var|const|return|if|else|for|while)\b/i, /\b(api|endpoint|database|query|schema)\b/i],
      research: [/\b(analysis|study|paper|experiment|data|hypothesis|methodology)\b/i, /\b(literature|review|citation|reference)\b/i],
      math: [/\b(calculate|equation|solve|formula|number|proof|theorem)\b/i, /\b(algebra|calculus|geometry|statistics)\b/i],
      writing: [/\b(write|essay|article|blog|story|draft|edit)\b/i, /\b(audience|tone|style|narrative)\b/i],
    };

    for (const [category, regexes] of Object.entries(patterns)) {
      for (const re of regexes) {
        if (re.test(text)) {
          scores[category] += 0.3;
        }
      }
    }

    let bestCategory = "general";
    let bestScore = 0;
    for (const [cat, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestCategory = cat;
      }
    }

    return {
      result: { category: bestCategory, confidence: Math.min(bestScore + 0.4, 1) },
      success: true,
      metadata: { classifier: "llm", score: bestScore },
    };
  }

  collectMetrics() {
    return { key: this.key, variant: this.variant } as never;
  }
}

// ---------------------------------------------------------------------------
// Coordinator Module
// ---------------------------------------------------------------------------

/**
 * Baseline coordinator — simple round-robin task distribution.
 */
class BaselineCoordinator implements AlgorithmModule {
  readonly key = "coordinator" as const;
  readonly variant = "baseline";

  async execute(input: AlgorithmInput): Promise<AlgorithmOutput> {
    const tasks = (input.data as { tasks?: string[] })?.tasks ?? [];
    const agents = (input.context.agents as string[]) ?? ["agent1", "agent2", "agent3"];

    const assignments: Record<string, string[]> = {};
    for (const agent of agents) {
      assignments[agent] = [];
    }

    tasks.forEach((task, i) => {
      const agent = agents[i % agents.length];
      assignments[agent].push(task);
    });

    return {
      result: { assignments, strategy: "round-robin" },
      success: true,
      metadata: { taskCount: tasks.length, agentCount: agents.length },
    };
  }

  collectMetrics() {
    return { key: this.key, variant: this.variant } as never;
  }
}

/**
 * Capability-based coordinator — assigns tasks based on agent capabilities.
 */
class CapabilityCoordinator implements AlgorithmModule {
  readonly key = "coordinator" as const;
  readonly variant = "capability";

  async execute(input: AlgorithmInput): Promise<AlgorithmOutput> {
    const tasks = (input.data as { tasks?: Array<{ description: string; requiredSkills?: string[] }> })?.tasks ?? [];
    const agents = (input.context.agents as Array<{ name: string; skills: string[] }>) ?? [
      { name: "agent1", skills: ["code", "research"] },
      { name: "agent2", skills: ["math", "writing"] },
      { name: "agent3", skills: ["general"] },
    ];

    const assignments: Record<string, string[]> = {};
    for (const agent of agents) {
      assignments[agent.name] = [];
    }

    for (const task of tasks) {
      const requiredSkills = task.requiredSkills ?? [];
      let bestAgent = agents[0];
      let bestScore = -1;

      for (const agent of agents) {
        const score = requiredSkills.filter((s) => agent.skills.includes(s)).length;
        if (score > bestScore) {
          bestScore = score;
          bestAgent = agent;
        }
      }

      assignments[bestAgent.name].push(task.description);
    }

    return {
      result: { assignments, strategy: "capability-based" },
      success: true,
      metadata: { taskCount: tasks.length, agentCount: agents.length },
    };
  }

  collectMetrics() {
    return { key: this.key, variant: this.variant } as never;
  }
}

// ---------------------------------------------------------------------------
// Reviewer Module
// ---------------------------------------------------------------------------

/**
 * Baseline reviewer — simple checklist-based review.
 */
class BaselineReviewer implements AlgorithmModule {
  readonly key = "reviewer" as const;
  readonly variant = "baseline";

  async execute(input: AlgorithmInput): Promise<AlgorithmOutput> {
    const content = String(input.data ?? "");
    const checks = [
      { name: "has_content", passed: content.length > 0 },
      { name: "has_structure", passed: /\n\n|\n#|\n-|\n\d+\./.test(content) },
      { name: "has_examples", passed: /example|for instance|such as|e\.g\./i.test(content) },
      { name: "reasonable_length", passed: content.length > 50 && content.length < 10000 },
    ];

    const passed = checks.filter((c) => c.passed).length;
    const score = passed / checks.length;

    return {
      result: { score, checks, approved: score >= 0.75 },
      success: true,
      metadata: { reviewType: "checklist", checksPassed: passed },
    };
  }

  collectMetrics() {
    return { key: this.key, variant: this.variant } as never;
  }
}

/**
 * LLM-based reviewer — uses the model for quality assessment.
 */
class LlmReviewer implements AlgorithmModule {
  readonly key = "reviewer" as const;
  readonly variant = "llm";

  async execute(input: AlgorithmInput): Promise<AlgorithmOutput> {
    const content = String(input.data ?? "");

    // Simulate LLM review with more nuanced checks
    const checks = [
      { name: "has_content", passed: content.length > 0 },
      { name: "has_structure", passed: /\n\n|\n#|\n-|\n\d+\./.test(content) },
      { name: "has_examples", passed: /example|for instance|such as|e\.g\./i.test(content) },
      { name: "reasonable_length", passed: content.length > 50 && content.length < 10000 },
      { name: "has_introduction", passed: /^(#|##|introduction|overview|summary)/i.test(content) },
      { name: "has_conclusion", passed: /(conclusion|summary|in conclusion|to summarize)/i.test(content) },
      { name: "no_placeholders", passed: /TODO|FIXME|XXX|PLACEHOLDER/.test(content) === false },
    ];

    const passed = checks.filter((c) => c.passed).length;
    const score = passed / checks.length;

    return {
      result: { score, checks, approved: score >= 0.7 },
      success: true,
      metadata: { reviewType: "llm", checksPassed: passed },
    };
  }

  collectMetrics() {
    return { key: this.key, variant: this.variant } as never;
  }
}

// ---------------------------------------------------------------------------
// Compaction Module
// ---------------------------------------------------------------------------

/**
 * Baseline compaction — simple truncation.
 */
class BaselineCompaction implements AlgorithmModule {
  readonly key = "compaction" as const;
  readonly variant = "baseline";

  async execute(input: AlgorithmInput): Promise<AlgorithmOutput> {
    const messages = (input.data as Array<{ role: string; content: string }>) ?? [];
    const maxMessages = (input.context.maxMessages as number) ?? 20;

    const compacted = messages.slice(-maxMessages);
    const removed = messages.length - compacted.length;

    return {
      result: { messages: compacted, removed, strategy: "truncate" },
      success: true,
      metadata: { originalCount: messages.length, compactedCount: compacted.length },
    };
  }

  collectMetrics() {
    return { key: this.key, variant: this.variant } as never;
  }
}

/**
 * Summary compaction — uses LLM to summarize older messages.
 */
class SummaryCompaction implements AlgorithmModule {
  readonly key = "compaction" as const;
  readonly variant = "summary";

  async execute(input: AlgorithmInput): Promise<AlgorithmOutput> {
    const messages = (input.data as Array<{ role: string; content: string }>) ?? [];
    const maxMessages = (input.context.maxMessages as number) ?? 20;
    const summaryThreshold = Math.floor(maxMessages * 0.5);

    if (messages.length <= maxMessages) {
      return {
        result: { messages, removed: 0, strategy: "none" },
        success: true,
        metadata: { originalCount: messages.length, compactedCount: messages.length },
      };
    }

    // Simulate summary compaction: keep recent messages, summarize older ones
    const recentMessages = messages.slice(-summaryThreshold);
    const olderMessages = messages.slice(0, -summaryThreshold);

    const summaryMessage = {
      role: "system",
      content: `[Summary of ${olderMessages.length} earlier messages: ${olderMessages.map((m) => m.content.slice(0, 50)).join(" ")}]`,
    };

    const compacted = [summaryMessage, ...recentMessages];
    const removed = messages.length - compacted.length + 1;

    return {
      result: { messages: compacted, removed, strategy: "summary" },
      success: true,
      metadata: { originalCount: messages.length, compactedCount: compacted.length, summarizedCount: olderMessages.length },
    };
  }

  collectMetrics() {
    return { key: this.key, variant: this.variant } as never;
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all built-in algorithm module implementations.
 * Call this once at startup to populate the registry.
 */
export function registerBuiltinModules(): void {
  // Classifier
  registerAlgorithm({
    key: "classifier",
    variants: [
      { name: "baseline", description: "Keyword-based classification" },
      { name: "llm", description: "LLM-based classification" },
    ],
    activeVariant: "baseline",
    create: (variant: string) => {
      if (variant === "llm") return new LlmClassifier();
      return new BaselineClassifier();
    },
  });

  // Coordinator
  registerAlgorithm({
    key: "coordinator",
    variants: [
      { name: "baseline", description: "Round-robin task distribution" },
      { name: "capability", description: "Capability-based assignment" },
    ],
    activeVariant: "baseline",
    create: (variant: string) => {
      if (variant === "capability") return new CapabilityCoordinator();
      return new BaselineCoordinator();
    },
  });

  // Reviewer
  registerAlgorithm({
    key: "reviewer",
    variants: [
      { name: "baseline", description: "Checklist-based review" },
      { name: "llm", description: "LLM-based quality review" },
    ],
    activeVariant: "baseline",
    create: (variant: string) => {
      if (variant === "llm") return new LlmReviewer();
      return new BaselineReviewer();
    },
  });

  // Compaction
  registerAlgorithm({
    key: "compaction",
    variants: [
      { name: "baseline", description: "Simple truncation" },
      { name: "summary", description: "LLM-based summarization" },
    ],
    activeVariant: "baseline",
    create: (variant: string) => {
      if (variant === "summary") return new SummaryCompaction();
      return new BaselineCompaction();
    },
  });

  // ContextBuilder
  registerAlgorithm({
    key: "contextBuilder",
    variants: [
      { name: "baseline", description: "Simple context assembly" },
      { name: "enhanced", description: "Enhanced context with metadata" },
    ],
    activeVariant: "baseline",
    create: (variant: string) => createDefaultModule("contextBuilder", variant),
  });

  // ToolSelector
  registerAlgorithm({
    key: "toolSelector",
    variants: [
      { name: "baseline", description: "Simple tool matching" },
      { name: "llm", description: "LLM-based tool selection" },
    ],
    activeVariant: "baseline",
    create: (variant: string) => createDefaultModule("toolSelector", variant),
  });

  // GoalJudge
  registerAlgorithm({
    key: "goalJudge",
    variants: [
      { name: "baseline", description: "Simple goal evaluation" },
      { name: "llm", description: "LLM-based goal assessment" },
    ],
    activeVariant: "baseline",
    create: (variant: string) => createDefaultModule("goalJudge", variant),
  });

  // MemoryConsolidator
  registerAlgorithm({
    key: "memoryConsolidator",
    variants: [
      { name: "baseline", description: "Simple memory consolidation" },
      { name: "enhanced", description: "Enhanced consolidation with dedup" },
    ],
    activeVariant: "baseline",
    create: (variant: string) => createDefaultModule("memoryConsolidator", variant),
  });
}

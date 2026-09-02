/**
 * Budgeted tool catalog — fair token-budget allocation across tool namespaces.
 *
 * Port of OpenWork CodeMode's budgeted catalog system. When the tool catalog
 * exceeds a token budget, a round-robin fair allocation ensures every
 * namespace gets some representation before any namespace gets everything.
 *
 * This solves the "1000 MCP tools" problem: you can't send all tool schemas
 * to the LLM without blowing the context window. Instead, you allocate a
 * token budget fairly across namespaces and let the agent discover more
 * tools via a search tool.
 *
 * Design (from OpenWork):
 * - Tools are grouped by namespace (e.g. "github", "slack", "filesystem")
 * - Each namespace has a token cost (sum of its tool schema sizes)
 * - The catalog allocates budget round-robin: each namespace gets one
 *   tool described in full before any namespace gets a second
 * - A built-in search tool lets the agent find tools not inlined
 * - Search scoring is deterministic and field-weighted
 */

/** A tool entry in the catalog. */
export interface CatalogTool {
  name: string;
  description: string;
  /** Namespace this tool belongs to (e.g. "github", "filesystem"). */
  namespace: string;
  /** Estimated token cost of this tool's schema. */
  tokenCost: number;
  /** Input schema (used for cost estimation and search). */
  inputSchema?: Record<string, unknown>;
  /** Tags for search. */
  tags?: string[];
}

/** A namespace group in the catalog. */
export interface CatalogNamespace {
  name: string;
  description: string;
  tools: CatalogTool[];
  /** Total token cost of all tools in this namespace. */
  totalTokenCost: number;
}

export interface BudgetedCatalogOptions {
  /** Total token budget for tool descriptions. */
  tokenBudget: number;
  /**
   * Strategy for budget allocation:
   * - "round_robin": Fair allocation across namespaces (default)
   * - "greedy": Fill budget with largest namespaces first
   * - "priority": Use namespace priority ordering
   */
  strategy?: "round_robin" | "greedy" | "priority";
  /** Optional priority ordering for namespaces (highest first). */
  namespacePriority?: string[];
}

/**
 * Budgeted tool catalog — allocates a token budget across tool namespaces.
 *
 * Usage:
 *   const catalog = new BudgetedCatalog(tools, { tokenBudget: 4000 });
 *   const visible = catalog.getVisibleTools(); // Tools that fit in budget
 *   const search = catalog.search("create issue"); // Find specific tools
 */
export class BudgetedCatalog {
  private tools: CatalogTool[];
  private namespaces: CatalogNamespace[];
  private options: Required<BudgetedCatalogOptions>;
  private visibleTools: CatalogTool[] | null = null;

  constructor(tools: CatalogTool[], options: BudgetedCatalogOptions) {
    this.tools = tools;
    this.options = {
      tokenBudget: options.tokenBudget,
      strategy: options.strategy ?? "round_robin",
      namespacePriority: options.namespacePriority ?? [],
    };
    this.namespaces = this.buildNamespaces();
    this.visibleTools = null; // Computed lazily.
  }

  /**
   * Get the tools that fit within the token budget.
   *
   * Uses the configured strategy to allocate budget across namespaces.
   * The result is deterministic for a given catalog state.
   */
  getVisibleTools(): CatalogTool[] {
    if (this.visibleTools) return this.visibleTools;

    switch (this.options.strategy) {
      case "round_robin":
        this.visibleTools = this.allocateRoundRobin();
        break;
      case "greedy":
        this.visibleTools = this.allocateGreedy();
        break;
      case "priority":
        this.visibleTools = this.allocatePriority();
        break;
    }
    return this.visibleTools;
  }

  /**
   * Get the total token cost of all visible tools.
   */
  getUsedBudget(): number {
    return this.getVisibleTools().reduce((sum, t) => sum + t.tokenCost, 0);
  }

  /**
   * Get the remaining budget.
   */
  getRemainingBudget(): number {
    return this.options.tokenBudget - this.getUsedBudget();
  }

  /**
   * Get all namespaces.
   */
  getNamespaces(): CatalogNamespace[] {
    return this.namespaces;
  }

  /**
   * Search for tools matching a query.
   *
   * Deterministic field-weighted scoring (from OpenWork):
   * - Exact name match: 20 points
   * - Name substring: 8 points
   * - Description substring: 4 points
   * - Tag match: 6 points
   * - Namespace match: 3 points
   */
  search(query: string, limit = 10): CatalogTool[] {
    const q = query.toLowerCase();
    const scored: Array<{ tool: CatalogTool; score: number }> = [];

    for (const tool of this.tools) {
      let score = 0;

      // Exact name match.
      if (tool.name.toLowerCase() === q) {
        score += 20;
      } else if (tool.name.toLowerCase().includes(q)) {
        score += 8;
      }

      // Description substring.
      if (tool.description.toLowerCase().includes(q)) {
        score += 4;
      }

      // Tag match.
      if (tool.tags?.some((t) => t.toLowerCase().includes(q))) {
        score += 6;
      }

      // Namespace match.
      if (tool.namespace.toLowerCase().includes(q)) {
        score += 3;
      }

      // Input schema field match.
      if (tool.inputSchema) {
        const schemaStr = JSON.stringify(tool.inputSchema).toLowerCase();
        if (schemaStr.includes(q)) {
          score += 2;
        }
      }

      if (score > 0) {
        scored.push({ tool, score });
      }
    }

    // Sort by score descending, then by name for determinism.
    scored.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
    return scored.slice(0, limit).map((s) => s.tool);
  }

  /**
   * Get a tool by exact name.
   */
  getTool(name: string): CatalogTool | null {
    return this.tools.find((t) => t.name === name) ?? null;
  }

  /**
   * Get all tools (regardless of budget).
   */
  getAllTools(): CatalogTool[] {
    return [...this.tools];
  }

  /**
   * Invalidate the cached visible tools (call after modifying the catalog).
   */
  invalidate(): void {
    this.visibleTools = null;
  }

  // ---------------------------------------------------------------------------
  // Allocation strategies
  // ---------------------------------------------------------------------------

  /**
   * Round-robin allocation: each namespace gets one tool described in full
   * before any namespace gets a second. This ensures fair representation
   * across all namespaces.
   */
  private allocateRoundRobin(): CatalogTool[] {
    const visible: CatalogTool[] = [];
    let usedBudget = 0;

    // Sort tools within each namespace by token cost (smallest first).
    const sortedNamespaces = this.namespaces.map((ns) => ({
      ...ns,
      tools: [...ns.tools].sort((a, b) => a.tokenCost - b.tokenCost),
    }));

    // Track current index per namespace.
    const indices = new Map<string, number>();
    for (const ns of sortedNamespaces) {
      indices.set(ns.name, 0);
    }

    let madeProgress = true;
    while (madeProgress) {
      madeProgress = false;
      for (const ns of sortedNamespaces) {
        const idx = indices.get(ns.name)!;
        if (idx >= ns.tools.length) continue;

        const tool = ns.tools[idx];
        if (usedBudget + tool.tokenCost <= this.options.tokenBudget) {
          visible.push(tool);
          usedBudget += tool.tokenCost;
          indices.set(ns.name, idx + 1);
          madeProgress = true;
        }
      }
    }

    return visible;
  }

  /**
   * Greedy allocation: fill budget with largest namespaces first.
   * Good when you want to fully describe a few namespaces rather than
   * partially describe many.
   */
  private allocateGreedy(): CatalogTool[] {
    const visible: CatalogTool[] = [];
    let usedBudget = 0;

    // Sort namespaces by total cost descending.
    const sorted = [...this.namespaces].sort((a, b) => b.totalTokenCost - a.totalTokenCost);

    for (const ns of sorted) {
      for (const tool of ns.tools) {
        if (usedBudget + tool.tokenCost <= this.options.tokenBudget) {
          visible.push(tool);
          usedBudget += tool.tokenCost;
        }
      }
    }

    return visible;
  }

  /**
   * Priority allocation: use the configured namespace priority ordering.
   * Higher-priority namespaces get their full tool set before lower-priority
   * namespaces get any.
   */
  private allocatePriority(): CatalogTool[] {
    const visible: CatalogTool[] = [];
    let usedBudget = 0;

    // Build priority-ordered list.
    const prioritySet = new Set(this.options.namespacePriority);
    const ordered: CatalogNamespace[] = [];

    // First, namespaces in priority order.
    for (const name of this.options.namespacePriority) {
      const ns = this.namespaces.find((n) => n.name === name);
      if (ns) ordered.push(ns);
    }

    // Then, remaining namespaces alphabetically.
    const remaining = this.namespaces
      .filter((n) => !prioritySet.has(n.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    ordered.push(...remaining);

    for (const ns of ordered) {
      for (const tool of ns.tools) {
        if (usedBudget + tool.tokenCost <= this.options.tokenBudget) {
          visible.push(tool);
          usedBudget += tool.tokenCost;
        }
      }
    }

    return visible;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private buildNamespaces(): CatalogNamespace[] {
    const byNamespace = new Map<string, CatalogTool[]>();

    for (const tool of this.tools) {
      const list = byNamespace.get(tool.namespace) ?? [];
      list.push(tool);
      byNamespace.set(tool.namespace, list);
    }

    const namespaces: CatalogNamespace[] = [];
    for (const [name, tools] of byNamespace) {
      namespaces.push({
        name,
        description: `Tools for ${name}`,
        tools,
        totalTokenCost: tools.reduce((sum, t) => sum + t.tokenCost, 0),
      });
    }

    return namespaces.sort((a, b) => a.name.localeCompare(b.name));
  }
}

/**
 * Estimate the token cost of a tool's schema.
 *
 * Uses a simple heuristic: ~4 chars per token (OpenAI's rough estimate).
 * For more accuracy, use a proper tokenizer.
 */
export function estimateTokenCost(tool: Omit<CatalogTool, "tokenCost">): number {
  const schemaStr = JSON.stringify(tool.inputSchema ?? {});
  const descLen = tool.description.length;
  const nameLen = tool.name.length;
  const totalChars = schemaStr.length + descLen + nameLen + 50; // 50 for overhead
  return Math.ceil(totalChars / 4);
}

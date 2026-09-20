/**
 * Progressive Skill Loading — 3-level disclosure system.
 *
 * Inspired by Hermes Agent's progressive disclosure pattern. Skills are not
 * loaded all at once; instead, they are revealed to the agent in levels:
 *
 *   Level 0 (Catalog):    name + description only (~3k tokens for 100 skills)
 *   Level 1 (Summary):    full SKILL.md content + metadata
 *   Level 2 (Deep Dive):  specific reference file within the skill
 *
 * This keeps context windows lean — the agent only loads full skill content
 * when actually needed. Intent-term ranking (coverage scoring across names
 * and descriptions) selects which skills to load at each level.
 *
 * Source patterns:
 * - Hermes Agent: 3-level progressive disclosure with skills_list/skill_view
 * - DeerFlow 2.0: Intent-term ranking for deferred skill discovery
 * - Codex CLI: Structured skills with agents/references/scripts directories
 */

import type { Skill } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Level 0 — catalog entry: minimal skill metadata for discovery.
 */
export interface SkillCatalogEntry {
  name: string;
  description: string;
  category: string;
  /** Token cost of loading this skill to Level 1. */
  estimatedTokens: number;
}

/**
 * Level 1 — summary: full skill content without reference files.
 */
export interface SkillSummary extends SkillCatalogEntry {
  /** Full SKILL.md body content. */
  content: string;
  /** Allowed tools (from frontmatter). */
  allowedTools: string[] | null;
  /** License identifier. */
  license: string | null;
  /** Available reference files. */
  references: string[];
}

/**
 * Level 2 2— deep dive: specific reference file content.
 */
export interface SkillDeepDive extends SkillSummary {
  /** The specific reference file content loaded. */
  referenceFile: string;
  referenceContent: string;
}

/**
 * Intent-term ranking result for skill discovery.
 */
export interface SkillRanking {
  skill: SkillCatalogEntry;
  /** Relevance score (higher = more relevant). */
  score: number;
  /** Which fields matched the query. */
  matchedFields: Array<"name" | "description">;
}

// ---------------------------------------------------------------------------
// Progressive Loader
// ---------------------------------------------------------------------------

export interface ProgressiveLoaderOptions {
  /** Maximum tokens for the Level 0 catalog display. */
  catalogBudget?: number;
  /** Maximum tokens for a single Level 1 skill load. */
  summaryBudget?: number;
  /** Maximum skills to load to Level 1 per turn. */
  maxLevel1Loads?: number;
}

const DEFAULT_OPTIONS: Required<ProgressiveLoaderOptions> = {
  catalogBudget: 4000,
  summaryBudget: 2000,
  maxLevel1Loads: 5,
};

/**
 * Progressive skill loader — manages the 3-level disclosure lifecycle.
 */
export class ProgressiveSkillLoader {
  private options: Required<ProgressiveLoaderOptions>;
  private level1Loaded = new Set<string>();

  constructor(options: ProgressiveLoaderOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Level 0: Build the skill catalog (name + description only).
   *
   * This is the cheapest view — all skills fit within a small token budget.
   * The agent uses this to decide which skills warrant deeper inspection.
   */
  buildCatalog(skills: Skill[]): {
    entries: SkillCatalogEntry[];
    rendered: string;
    totalTokens: number;
    truncated: boolean;
  } {
    const entries: SkillCatalogEntry[] = skills
      .filter((s) => s.enabled)
      .map((s) => ({
        name: s.name,
        description: s.description,
        category: s.category,
        estimatedTokens: estimateTokenCount(s.description) + 200, // rough estimate
      }));

    const rendered = this.renderCatalog(entries);
    const totalTokens = estimateTokenCount(rendered);
    const truncated = totalTokens > this.options.catalogBudget;

    return { entries, rendered, totalTokens, truncated };
  }

  /**
   * Level 1: Load full skill content for a specific skill.
   *
   * This is the agent's "skill_view" — it loads the full SKILL.md body
   * without reference files. Called when the agent needs the full instructions.
   */
  loadLevel1(
    skillName: string,
    skills: Skill[],
    readSkillContent: (skill: Skill) => string,
  ): SkillSummary | null {
    const skill = skills.find((s) => s.name === skillName);
    if (!skill || !skill.enabled) return null;

    const content = readSkillContent(skill);
    const references = detectReferences(content);

    this.level1Loaded.add(skillName);

    // Parse frontmatter from content
    const frontMatterMatch = /^---\s*\n([\s\S]*?)\n---\s*\n/.exec(content);
    let allowedTools: string[] | null = null;
    let license: string | null = null;

    if (frontMatterMatch) {
      try {
        const YAML = require("yaml");
        const meta = YAML.parse(frontMatterMatch[1]);
        if (meta) {
          license = meta.license ? String(meta.license) : null;
          if (Array.isArray(meta["allowed-tools"])) {
            allowedTools = meta["allowed-tools"].map(String);
          } else if (typeof meta["allowed-tools"] === "string") {
            allowedTools = meta["allowed-tools"].trim().split(/\s+/);
          }
        }
      } catch {
        // Frontmatter parsing failed — continue without metadata
      }
    }

    return {
      name: skill.name,
      description: skill.description,
      category: skill.category,
      estimatedTokens: estimateTokenCount(content),
      content: content.slice(0, this.options.summaryBudget * 4), // rough char limit
      allowedTools,
      license,
      references,
    };
  }

  /**
   * Level 2: Load a specific reference file from a skill.
   *
   * This is the deepest level — the agent loads only the specific reference
   * file it needs, avoiding loading all references.
   */
  loadLevel2(
    skillName: string,
    referencePath: string,
    skills: Skill[],
    readSkillContent: (skill: Skill) => string,
    readReferenceFile: (skill: Skill, path: string) => string,
  ): SkillDeepDive | null {
    const summary = this.loadLevel1(skillName, skills, readSkillContent);
    if (!summary) return null;

    const skill = skills.find((s) => s.name === skillName);
    if (!skill) return null;

    let referenceContent = "";
    try {
      referenceContent = readReferenceFile(skill, referencePath);
    } catch {
      return null;
    }

    return {
      ...summary,
      referenceFile: referencePath,
      referenceContent,
    };
  }

  /**
   * Rank skills by relevance to a query using intent-term scoring.
   *
   * Scoring:
   * - Name match (full or prefix): +10
   * - Name token overlap: +5 per token
   * - Description token overlap: +2 per token
   * - Category match: +3
   *
   * This is a lightweight alternative to vector search for skill discovery.
   */
  rankSkills(query: string, catalog: SkillCatalogEntry[], maxResults = 5): SkillRanking[] {
    const queryTokens = tokenize(query.toLowerCase());
    const queryLower = query.toLowerCase();

    const rankings: SkillRanking[] = catalog.map((entry) => {
      let score = 0;
      const matchedFields: Array<"name" | "description"> = [];
      const nameLower = entry.name.toLowerCase();
      const descLower = entry.description.toLowerCase();

      // Full name match (highest signal)
      if (nameLower === queryLower) {
        score += 100;
        matchedFields.push("name");
      }
      // Prefix match
      else if (nameLower.startsWith(queryLower) || queryLower.startsWith(nameLower)) {
        score += 20;
        matchedFields.push("name");
      }
      // Name token overlap
      else {
        const nameTokens = tokenize(nameLower);
        const nameOverlap = queryTokens.filter((t) => nameTokens.includes(t));
        if (nameOverlap.length > 0) {
          score += nameOverlap.length * 5;
          matchedFields.push("name");
        }
      }

      // Description token overlap
      const descTokens = tokenize(descLower);
      const descOverlap = queryTokens.filter((t) => descTokens.includes(t));
      if (descOverlap.length > 0) {
        score += descOverlap.length * 2;
        matchedFields.push("description");
      }

      return { skill: entry, score, matchedFields };
    });

    // Sort by score descending and return top results
    rankings.sort((a, b) => b.score - a.score);
    return rankings.filter((r) => r.score > 0).slice(0, maxResults);
  }

  /**
   * Reset the Level 1 loaded tracking (call at session start).
   */
  reset(): void {
    this.level1Loaded.clear();
  }

  /**
   * Get the set of skills that have been loaded to Level 1.
   */
  getLevel1Loaded(): ReadonlySet<string> {
    return this.level1Loaded;
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------

  private renderCatalog(entries: SkillCatalogEntry[]): string {
    if (entries.length === 0) return "## Skills Catalog\nNo skills available.\n";

    const lines = ["## Skills Catalog", ""];
    let currentChars = 0;
    const maxChars = this.options.catalogBudget * 4; // rough char-to-token ratio

    for (const entry of entries) {
      const line = `- **${entry.name}** (${entry.category}): ${entry.description}`;
      if (currentChars + line.length > maxChars) {
        lines.push(`\n... and ${entries.length - entries.indexOf(entry)} more skills. Use skill_view(name) to inspect.`);
        break;
      }
      lines.push(line);
      currentChars += line.length;
    }

    return lines.join("\n");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Estimate token count from character length.
 * Rough heuristic: ~4 characters per token for English text.
 */
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Simple tokenization for intent matching.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * Detect reference files mentioned in skill content.
 *
 * Looks for markdown links to files in references/, templates/, scripts/,
 * examples/, or assets/ directories.
 */
function detectReferences(content: string): string[] {
  const refs: string[] = [];
  const linkPattern = /\[([^\]]+)\]\((references|templates|scripts|examples|assets)\/([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(content)) !== null) {
    refs.push(`${match[2]}/${match[3]}`);
  }
  return [...new Set(refs)];
}

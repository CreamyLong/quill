/**
 * Deterministic capture and rendering for loaded skill files.
 *
 * Port of Python `deerflow.agents.middlewares.skill_context`. Extracts skill-file
 * reads from AI tool calls and paired ToolMessage results, then renders them as
 * a compact reminder for the model — not the skill body.
 */

import type { AIMessage, BaseMessage, ToolMessage } from "@langchain/core/messages";

import type { SkillEntry } from "../thread_state.js";

// SKILL_FILE_NAME mirrors Python's `_SKILL_FILE_NAME`.
const SKILL_FILE_NAME = "SKILL.md";

// Frontmatter regex — extracts the first `---\n...\n---` block from SKILL.md.
const FRONT_MATTER_RE = /^---\s*\n(.*?)\n---\s*\n/s;

function toolCallName(toolCall: Record<string, unknown>): string {
  const name = toolCall.name;
  if (typeof name === "string") return name;
  const fn = toolCall.function;
  if (fn && typeof fn === "object" && typeof (fn as Record<string, unknown>).name === "string") {
    return (fn as Record<string, unknown>).name as string;
  }
  return "";
}

function toolCallId(toolCall: Record<string, unknown>): string | null {
  const id = toolCall.id;
  return typeof id === "string" ? id : null;
}

function toolCallPath(toolCall: Record<string, unknown>): string | null {
  const args = toolCall.args;
  if (!args || typeof args !== "object") return null;
  const a = args as Record<string, unknown>;
  for (const key of ["path", "file_path", "filepath"]) {
    const value = a[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

function normalizeUnderRoot(path: string, normalizedRoot: string): string | null {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`)) {
    return normalized;
  }
  return null;
}

function isSkillFile(path: string): boolean {
  return path.replace(/\\/g, "/").split("/").pop() === SKILL_FILE_NAME;
}

function skillNameFromPath(skillMdPath: string): string {
  const parts = skillMdPath.replace(/\\/g, "/").split("/");
  parts.pop(); // remove SKILL.md
  return parts.pop() || "unknown";
}

function parseDescription(content: string): string {
  const match = FRONT_MATTER_RE.exec(content);
  if (!match) return "";
  // Minimal YAML frontmatter description extraction — extract `description:`
  // line from the raw frontmatter text (avoids pulling in a YAML dependency).
  const fm = match[1];
  const descMatch = /(?:^|\n)\s*description\s*:\s*(.+?)(?:\n\S|\n\s*\n|$)/is.exec(fm);
  if (!descMatch) return "";
  let desc = descMatch[1].trim();
  // Strip surrounding quotes.
  if ((desc.startsWith('"') && desc.endsWith('"')) || (desc.startsWith("'") && desc.endsWith("'"))) {
    desc = desc.slice(1, -1);
  }
  return desc.split(/\s+/).join(" ").slice(0, 500);
}

function isToolErrorText(content: string): boolean {
  return content.trimStart().startsWith("Error:");
}

function escapeContextText(value: unknown): string {
  return String(value).replace(/\s+/g, " ").replace(/[<>]/g, "");
}

/**
 * Enumerate skill-file reads (AI read_file call + paired ToolMessage result).
 * Returns entries with skill name, virtual path, and frontmatter description.
 */
export function extractSkills(
  messages: BaseMessage[],
  skillsRoot: string,
  readToolNames: Set<string>
): SkillEntry[] {
  const normalizedRoot = skillsRoot.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  const skillPathsById = new Map<string, string>();

  for (const message of messages) {
    if (message.getType() !== "ai") continue;
    const aiMsg = message as AIMessage;
    for (const tc of aiMsg.tool_calls ?? []) {
      if (!readToolNames.has(toolCallName(tc))) continue;
      const id = toolCallId(tc);
      const rawPath = toolCallPath(tc);
      const path = rawPath ? normalizeUnderRoot(rawPath, normalizedRoot) : null;
      if (id && path && isSkillFile(path)) {
        skillPathsById.set(id, path);
      }
    }
  }

  const entries: SkillEntry[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.getType() !== "tool") continue;
    const tm = message as ToolMessage;
    if (tm.status === "error") continue;
    const toolCallIdStr = tm.tool_call_id ?? "";
    const path = skillPathsById.get(toolCallIdStr);
    if (!path) continue;
    const content = typeof tm.content === "string" ? tm.content : JSON.stringify(tm.content);
    if (isToolErrorText(content)) continue;
    entries.push({
      name: skillNameFromPath(path),
      path,
      description: parseDescription(content),
      loaded_at: index,
    });
  }
  return entries;
}

/**
 * Render active-skill references as a compact reminder, not the body.
 * Reminds the model to re-read the file before applying its instructions.
 */
export function renderSkillContext(entries: SkillEntry[]): string {
  if (entries.length === 0) return "";
  const lines = [
    "## Active skills (loaded earlier - re-read the file before applying its instructions)",
  ];
  for (const entry of entries) {
    const name = escapeContextText(entry.name);
    const path = escapeContextText(entry.path);
    const rawDescription = entry.description || "";
    const description = escapeContextText(rawDescription);
    const suffix = description ? `: ${description}` : "";
    lines.push(`- ${name}${suffix} -> ${path}`);
  }
  return lines.join("\n");
}

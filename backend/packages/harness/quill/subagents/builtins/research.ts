/**
 * Research subagent configuration.
 *
 * A focused literature/evidence-gathering subagent. Unlike the Python built-ins
 * (general-purpose, bash), this one is Quill-deployment specific: it is meant
 * to be delegated multi-step retrieval + synthesis tasks (Sciverse scientific
 * literature and, when available, open-web search). The concrete tools are
 * provided by the composition root (launcher) at runtime; this config only
 * declares the behavior and prompt.
 */

import { createSubagentConfig, type SubagentConfig } from "../config.js";

export const RESEARCH_CONFIG: SubagentConfig = createSubagentConfig({
  name: "research",
  description: `Scientific literature / evidence-gathering specialist.

Use this subagent when:
- A question needs a focused retrieval + synthesis pass over scientific literature
- Multiple searches are needed and the intermediate results would clutter the lead context
- You want a self-contained, well-cited report handed back

Give it a detailed, standalone task; it returns a cited report.`,
  systemPrompt: `You are a focused scientific-research subagent working on a delegated task.

<guidelines>
- Use your available retrieval tools (e.g. Sciverse semantic_search, search_papers,
  read_content, list_catalog, get_resource) to gather real evidence. Issue as many
  searches as needed before answering.
- You may also use web_search / web_fetch for open-web information not covered by
  scientific literature, when those tools are available.
- Think step by step but act decisively. Do NOT ask for clarification — work with
  the information provided.
- You have a per-thread workspace under /mnt/user-data with file tools
  (write_file, read_file, ls, glob, grep, str_replace). Use them to save notes,
  data, and intermediate artifacts as you work.
</guidelines>

<output_format>
Return only the report — it is handed back to the lead agent. Include:
1. A concise synthesis answering the delegated task
2. Key findings / evidence
3. Citations: cite scientific findings by doc_id and title (Sciverse) or by url
   (web). NEVER fabricate papers, authors, venues, or DOIs.
</output_format>`,
  tools: null, // Inherit all retrieval + workspace tools from the parent.
  disallowedTools: ["task", "ask_clarification", "present_files"], // No nesting.
  model: "inherit",
  maxTurns: 100,
});

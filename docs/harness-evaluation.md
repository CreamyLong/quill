# Harness Framework Evaluation & Feature Comparison

> **Date**: 2026-08-29
> **Scope**: Systematic evaluation of Quill's harness against DeerFlow 2.0, OpenClaw, Kimi Code, and OpenAI Codex.
> **Goal**: Identify actionable improvements to bring Quill up to current best practices.

---

## 1. Reference Project Overview

| Project | Language | Stars | Focus | Architecture |
|---------|----------|-------|-------|-------------|
| **DeerFlow 2.0** (ByteDance) | Python + TS | 81k | Long-horizon super agent harness | LangGraph-based, multi-layer middleware, subagent orchestration |
| **OpenClaw** | TypeScript | 388k | Personal AI assistant, any OS | Gateway + channels + tools + plugins, single-operator |
| **Kimi Code CLI** (Moonshot) | TypeScript | 7.1k | Terminal coding agent | Subagents (coder/explore/plan), lifecycle hooks, ACP integration |
| **Codex CLI** (OpenAI) | Rust | 119k | Terminal coding agent | Single binary, fast startup, session management, IDE integration |
| **Awesome Harness Eng.** | Python | 3.9k | Curated patterns & tools | Security, evals, memory, MCP, permissions, observability |

---

## 2. Architecture Comparison: Quill vs DeerFlow

Both Quill and DeerFlow 2.0 share an identical high-level architecture:
- LangGraph-based agent graph
- Multi-layer middleware chain (outermost -> innermost)
- Subagent delegation with a delegation ledger
- Sandbox management
- Skills + tool policy system
- Memory + summarization
- Tracing (LangSmith/Langfuse)

### 2.1 Module Structure Mapping

```
Module              | Quill                  | DeerFlow
------------------- | ---------------------- | ----------------------
Agents              | agents/               | agents/  ✓
  -LeadAgent        | agents/lead_agent/    | agents/lead_agent/ ✓
  -Memory           | agents/memory/        | agents/memory/  ✓
  -Middlewares      | agents/middlewares/   | agents/middlewares/ ✓
Community tools     | community/            | community/  ✓
Config              | config/               | config/  ✓
Guardrails          | guardrails/           | guardrails/  ✓
MCP                 | mcp/                  | mcp/  ✓
Models              | models/               | models/  ✓
Persistence         | persistence/          | persistence/ ✓
Reflection          | reflection/           | reflection/  ✓
Runtime             | runtime/              | runtime/  ✓
Sandbox             | sandbox/              | sandbox/  ✓
Skills              | skills/               | skills/  ✓
Subagents           | subagents/            | subagents/ ✓
Tools               | tools/                | tools/  ✓
Tracing             | tracing/              | tracing/  ✓
TUI                 | tui/                  | tui/  ✓
Uploads             | uploads/              | uploads/ ✓
Utils               | utils/                | utils/  ✓
------------------- | ---------------------- | ----------------------
Unique to Quill     | scheduling/           |
                    | server/                 |
                    | subagents/runtime/    |
------------------- | ---------------------- | ----------------------
Unique to DeerFlow  | authz/                |
                    | extensions/             |
                    | integrations/           |
                    | scheduler/              |
                    | workspace_changes/      |
```

---

## 3. Middleware Feature Gap Analysis

### 3.1 Middlewares Quill Has That DeerFlow Does NOT

| Quill Middleware | Description |
|-----------------|-------------|
| `sandbox_middleware.ts` | Dedicated sandbox lifecycle middleware |
| `present_files_middleware.ts` | Present file list to user before execution |
| `tool_search_middleware.ts` | Tool catalog search/promotion |

### 3.2 Middlewares DeerFlow Has That Quill Does NOT

| DeerFlow Middleware | What It Does | Priority |
|--------------------|---------------|----------|
| **configured_extensions** | Plugin system for loading extension middlewares from config | **High** |
| **mcp_routing_middleware** | Auto-promotes MCP tools from catalog without tool_search | **High** |
| **skill_tool_policy_middleware** | Filters tool schemas by skill allowed_tools at model binding level | **Medium** |
| **tool_progress_middleware** | Tracks and reports tool execution progress | **Medium** |
| **tool_receipt_middleware** | Validates and tracks tool call receipts (audit trail) | **Medium** |
| **tool_result_sanitization_middleware** | Sanitizes tool results before they reach the LLM | **Medium** |
| **read_before_write_middleware** | Ensures read-before-write pattern for safety-critical tools | **Low** |
| **model_length_finish_reason_middleware** | Detects and handles model-length termination (not just safety) | **Low** |
| **terminal_response_middleware** | Post-processing terminal responses (formatting, summary) | **Low** |
| **tool_output_synopsis** | Generates brief synopses of tool outputs for context compression | **Low** |

---

## 4. Key Feature Insights from Other Projects

### 4.1 OpenClaw (388k stars)
- **Channel-based architecture**: Connect to any messaging platform (WhatsApp, Telegram, Slack, Discord, etc.)
- **Single binary distribution**: `npm install -g openclaw`
- **Plugin SDK**: Extensible plugin system (ClawHub marketplace)
- **Companion apps**: Add voice, canvas, camera, screen, device-local actions
- **Session isolation**: Per-user session isolation from day one

### 4.2 Kimi Code CLI (7.1k stars)
- **Subagent delegation**: Built-in `coder`, `explore`, `plan` subagents in isolated contexts
- **Lifecycle hooks**: Run local commands at key points (gate risky tool calls, audit decisions)
- **ACP integration**: Agent Client Protocol for IDE integration (Zed, JetBrains)
- **Video input**: Support for screen recordings and demo clips
- **MCP config**: Conversational MCP server configuration

### 4.3 OpenAI Codex (119k stars)
- **Single binary**: Rust-based, no Node.js required
- **Fast startup**: Terminal ready in milliseconds
- **Session management**: Built-in session history and recovery
- **IDE integration**: Deep VS Code / Cursor / Windsurf integration
- **Self-healing**: Automatically fixes its own errors

### 4.4 Key Takeaways
1. **Plugin/Extension systems** are now expected in harness frameworks
2. **Lifecycle hooks** are a common pattern for safety and automation
3. **ACP integration** is emerging as the standard for IDE integration
4. **Session management** and **auto-recovery** are becoming table stakes
5. **Conversational configuration** (for MCP, skills, etc.) is a UX differentiator

---

## 5. Feature Matrix

| Feature | Quill | DeerFlow 2.0 | OpenClaw | Kimi Code | Codex |
|---------|:-----:|:------------:|:--------:|:---------:|:-----:|
| LangGraph-based | Yes | Yes | | | |
| Multi-layer middleware | Yes | Yes | | | |
| Subagent delegation | Yes | Yes | | Yes | |
| Sandbox | Yes | Yes | Yes | | |
| Memory system | Yes | Yes | Yes | | |
| Skill system | Yes | Yes | Yes | Yes | |
| Tool policy | Yes | Yes | Yes | | |
| MCP integration | Yes | Yes | Yes | Yes | |
| Tracing (LangSmith) | Yes | Yes | | | |
| Tracing (Langfuse) | Yes | Yes | | | |
| Extension system | No | Yes | Yes | | |
| Authz/RBAC | Partial | Yes | | | |
| Lifecycle hooks | No | Partial | | Yes | |
| Tool receipt/audit | Partial | Yes | | | |
| ACP support | No | No | | Yes | |
| Video input | No | No | | Yes | |
| Single binary | No | No | Yes | Yes | Yes |

---

## 6. Recommended Actions

Based on this evaluation, the following improvements are recommended for Quill:

### High Priority (implement immediately)

1. **Extension Plugin System** (`extensions/`)
   - Add a plugin framework for loading custom middlewares from config
   - Enable users to add custom behavior without code changes

2. **Tool Result Sanitization** (`tool_result_sanitization_middleware.ts`)
   - Sanitize raw tool output before it reaches the LLM
   - Prevent context pollution from verbose tool outputs

3. **Lifecycle Hooks** (`lifecycle_hooks.ts`)
   - Add hook system for gating risky tool calls
   - Support pre-tool-call, post-tool-call, and pre-model-call hooks

### Medium Priority

4. **Tool Progress Tracking** (`tool_progress_middleware.ts`)
   - Track and report tool execution progress
   - Useful for long-running operations

5. **Tool Receipt/Audit System** (`tool_receipt_middleware.ts`)
   - Track tool call receipts for audit trail
   - Enable compliance and debugging

6. **MCP Routing Middleware** (`mcp_routing_middleware.ts`)
   - Auto-promote MCP tools from catalog
   - Better integration with MCP ecosystem

### Low Priority (nice to have)

7. **Skill Tool Policy** (`skill_tool_policy_middleware.ts`)
   - Filter tool schemas by skill allowed_tools
   - Additional layer of tool policy enforcement

8. **Terminal Response Formatting** (`terminal_response_middleware.ts`)
   - Post-process final responses for better UX
   - Add summaries, action items, etc.

9. **ACP Integration** (`acp_integration/`)
   - Support Agent Client Protocol for IDE integration
   - Enable integration with Zed, JetBrains, etc.

---

## 7. Conclusion

Quill already has a very mature harness that closely mirrors DeerFlow 2.0's architecture. The main gaps are:

1. **Extension plugin system** - DeerFlow's `extensions/` provides a complete plugin framework
2. **Tool result sanitization** - Protect LLM context from raw tool output
3. **Lifecycle hooks** - Safety gates and automation hooks
4. **Tool receipt/audit** - Compliance and debugging

Quill already exceeds DeerFlow in:
- More community search tool integrations (10+ providers)
- More granular middleware system
- Built-in sandbox lifecycle management
- File system tools and uploads

The recommendations above would bring Quill to feature parity with DeerFlow while maintaining its unique advantages.

# Harness Framework Research & Feature Backlog

**Date:** 2026-08-28 · **Scope:** systematic evaluation of current open agent-harness
frameworks against Quill's codebase, and the capability gaps worth closing.

## 1. Methodology

Six reference projects were surveyed (architecture, tool system, context management,
memory, sandboxing, scheduling, safety/authorization, observability):

| Framework | License | Stack | One-line summary |
| --- | --- | --- | --- |
| [bytedance/deer-flow](https://github.com/bytedance/deer-flow) | MIT | Python / LangGraph | Quill's parent architecture: lead agent + long middleware chain, subagents, skills, IM channels, pluggable sandboxes |
| [different-ai/openwork](https://github.com/different-ai/openwork) | MIT+EE | Electron / OpenCode engine | Desktop shell over an engine pool: meta-MCP capability gateway, Memory Bank, automations engine, approval modes, spec-driven evals in sandboxes |
| [openclaw/openclaw](https://github.com/openclaw/openclaw) | MIT | Node/TS gateway daemon | Channel-centric gateway: **cron/heartbeat scheduled tasks**, swarm fan-out, plugin SDK, SQLite state, file-based memory |
| [moonshotai/kimi-code](https://github.com/moonshotai/kimi-code) | MIT | Rust/TS CLI | Stateless loop, overlapping tool scheduling, auto-compaction at ~85% context with micro/full/handoff variants, goal-mode state machine, secondary model for compaction |
| [openai/codex](https://github.com/openai/codex) | Apache-2.0 | Rust CLI | **exec-policy: command-level allow/deny rules**, Seatbelt/Landlock sandbox, rollout JSONL, Guardian safety reviewer, OTel observability, local+remote compaction |
| [ai-boost/awesome-harness-engineering](https://github.com/ai-boost/awesome-harness-engineering) | CC0 | n/a | 12-category capability taxonomy + checklist; useful as an audit frame (LangGraph explicitly in scope; note: "subagents use ~67% fewer tokens than skills for multi-step work") |

**Framing:** Quill is a DeerFlow 2.x derivative *and* a TypeScript rewrite, so the
useful comparison is not "which architecture" (already settled) but **cross-framework
capability gap analysis against the current TS codebase** — i.e., what does Quill not
have that two or more mature frameworks ship, and what is cheap to add given its
existing seams.

## 2. Quill capability baseline (as of this change set)

Already present in the TS runtime (verified in code, not docs):

- Lead-agent + subagent delegation with parallel `task` tool, concurrency limits,
  cascading cancel
- 25-middleware chain: input sanitization, output budgets, thread data, uploads,
  sandbox lifecycle, dangling-tool-call repair, LLM error handling, sandbox audit,
  tool error handling, dynamic context, skill activation, summarization (with
  **secondary/lightweight model option**), todo list, token usage/title/memory,
  deferred tool filtering (MCP schemas hidden until `tool_search` promotes them),
  system-message coalescing, subagent limit, loop detection, token budget,
  safety-finish-reason, clarification
- Guardrail *interface* (`GuardrailProvider` + `GuardrailMiddleware`, OAP-aligned
  decision codes) with a built-in tool-level `AllowlistProvider` — but the
  middleware was **not wired into any agent chain** (provider resolution via
  `resolve_variable` was unported), so the whole guardrail layer was dead code
- IM channel bridges, skills system, persistent memory store, request-scoped
  secrets (Python era), IM channels, JSONL/SQLite run-event stores
- Token budgeting, loop detection, run cancellation, subagent timeline events

Genuinely missing (gap list in §3).

## 3. Gap analysis & decisions

| # | Capability | Who has it | Quill today | Verdict |
| - | --- | --- | --- | --- |
| 1 | **Scheduled tasks / cron runs** | OpenClaw (cron+heartbeat), OpenWork (automations engine) | Nothing — every run is user-initiated | **Implement** (Feature 1) |
| 2 | **Command-level allow/deny policy** (exec-policy) | Codex (`command_prefix_read` allow/deny rules) | Tool-level allowlist only; guardrail layer unwired | **Implement** (Feature 2, incl. wiring the dormant guardrail middleware) |
| 3 | Auto-compaction with micro/full/handoff variants + goal-mode state machine | Kimi-code | Basic summarization with secondary model + token budget + loop detection already | Defer — current stack already caps context; revisit if long-horizon goal runs become core |
| 4 | Overlapping/parallel tool-call scheduler (Kimi's non-conflicting overlap) | Kimi-code | LangGraph handles parallel tool calls; no overlap-across-steps | Defer — risky concurrency semantics, low marginal value vs. existing parallel `task` tool |
| 5 | Meta-MCP capability gateway (`search_capabilities`/`execute_capability`) | OpenWork | Deferred tool search already provides schema hiding + on-demand promotion | Defer — `tool_search` covers the core problem |
| 6 | Seatbelt/Landlock OS sandboxing | Codex | Sandboxed execution with provisioner/K8s/local modes | Defer — platform-specific, out of scope for a harness feature |
| 7 | Memory Bank with human-verified writes | OpenWork | Memory middleware + store exists (auto-update path) | Defer — product decision, not a harness gap |
| 8 | Rollout JSONL / OTel tracing | Codex | Run-event store (JSONL/SQLite) + LangFuse/LangSmith tracing already | Present |
| 9 | Swarm fan-out | OpenClaw | Subagents with concurrency limit 3 + cascading cancel | Present (simpler, adequate) |

### Feature 1 — Scheduled Tasks (from OpenClaw cron + OpenWork automations)

Quill has no way to run the agent *autonomously on a schedule* (daily digests,
CI-style audits, heartbeat checks). Design:

- `quill/scheduling/cron.ts` — pure 5-field cron parser (minute/hour/dom/month/dow;
  `*`, numbers, `*/n`, ranges, lists; standard dom/dow OR-semantics) +
  `nextCronRun(expr, after)`
- `quill/scheduling/scheduler.ts` — `ScheduledTaskScheduler`: due-task selection,
  fire via injected `fireRun` callback, last/next-run bookkeeping, in-flight guard,
  injectable clock for tests
- `quill/scheduling/store.ts` — `FileScheduledTaskStore` (atomic JSON at
  `.scitops/scheduled_tasks.json`, matching the runtime-home convention) +
  `MemoryScheduledTaskStore`
- Gateway: `/scheduled-tasks` CRUD + `POST /scheduled-tasks/{id}/run` (fire now),
  in-process scheduled-run execution (reuses the thread/run bookkeeping of the
  streaming path), 30 s tick loop (unref'd) started with the server
- Tasks may pin a `thread_id` (continue a conversation) or spawn a fresh thread
  per fire; a pinned thread that is busy is *skipped* (recorded), never
  double-executed

### Feature 2 — Command-level guardrail policy (from Codex exec-policy)

Codex's exec-policy allows `command_prefix_read`-style allow/deny rules on shell
commands — strictly more granular than tool-level allow/deny, and the right level
for a `bash` tool that can run anything. Design:

- `CommandPolicyProvider` (new built-in `GuardrailProvider`):
  regex rules `{tool, pattern, effect: allow|deny, description}` evaluated against
  the tool-input `command` field (deny rules win first, then allow rules, then
  `default_decision`); OAP decision codes `oap.command_denied` /
  `oap.command_allowed`
- **Wiring (the important part):** `GuardrailMiddleware` is now actually
  instantiated from `guardrails:` config and inserted into both the lead-agent and
  sub-agent runtime middleware chains. Provider `use` paths resolve through a
  static built-in registry (`quill.guardrails.builtin:*`) with an async
  `resolveVariable` fallback for external providers; resolution is lazy (first
  tool call) because the graph factory is synchronous
- `failClosed` semantics preserved: provider error → block when `fail_closed: true`

## 4. Verification

- `cd backend && npx tsc --noEmit` — type check
- `cd backend && npx vitest run` — full suite, including new tests:
  - `scheduling/__tests__/cron.test.ts` — parser + next-fire-time (incl. dom/dow OR semantics)
  - `scheduling/__tests__/scheduler.test.ts` — tick with fake clock, in-flight guard, error recording
  - `scheduling/__tests__/store.test.ts` — file-store round-trip + atomic write
  - `guardrails/__tests__/command_policy.test.ts` — allow/deny/default semantics
  - `guardrails/__tests__/loader.test.ts` — provider path resolution

## 5. Follow-ups (not in this change set)

- Frontend UI for scheduled tasks (Settings tab mirroring Community Tools)
- Subagent goal-mode state machine + handoff compaction (Kimi-style) for
  long-horizon runs
- Human-verification gate for memory writes (OpenWork Memory Bank style)

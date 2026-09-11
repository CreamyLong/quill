# Quill v0.3.0 — Session Forking, FTS5 Search, Marketplace Install

> **Release Date:** 2026-09-11
> **Tag:** v0.3.0

## Highlights

Quill v0.3.0 closes the last major competitive gaps with leading harness frameworks. Quill now matches or exceeds all 10 frameworks on **18 of 22** capability dimensions.

## New Features

### 🔀 Session Forking
- Deep fork with checkpoint copy — branched threads carry full conversation history
- Fork at any point in a conversation without disrupting the original
- Powered by the new `runtime/fork.ts` service
- API: `POST /threads/{threadId}/fork` (now with checkpoint copy when a checkpointer is configured)

### 🔍 FTS5 Session Search
- BM25-ranked full-text search across all thread messages
- Snippet extraction with match highlighting
- Prefix matching support (e.g., `test*` matches `testing`)
- Uses SQLite FTS5 when available, falls back to in-memory scan
- API: `POST /threads/search/fulltext` and `POST /threads/search/index`

### 🛒 Marketplace Install
- Install skills from GitHub repos (`owner/repo` shorthand)
- Install from direct URLs (raw SKILL.md)
- Auto-detection of SKILL.md files in repos
- Branch/tag selection support
- API: `POST /skills/marketplace/install`

### 📊 Competitive Position
Quill now leads or matches all 10 frameworks on 18/22 dimensions:

| Dimension | Quill | DeerFlow | OpenWork | DSH | Kimi | Codex | CrewAI | AutoGen | OpenClaw | Hermes |
|---|---|---|---|---|---|---|---|---|---|---|
| LangGraph | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Sandbox | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| Memory | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ |
| MCP | ✅ | ✅ | ✅* | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| Sub-Agent | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ |
| Desktop | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Goal Track | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Forking | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Teams | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Search | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Cron+ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Swarm | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Marketplace | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| SkillScan | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Eval | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Workflow | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Self-Improve | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Receipts | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Adaptive Perm | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Depth-Aware | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

## Improvements

- **38+ middlewares** (up from 25) with depth-aware tool policy, trace correlation, compact middleware
- **Self-improving skills** — agent autonomously creates and improves skills after complex tasks
- **Adaptive permissions** — progressive trust levels from Strict → Full based on session history
- **Tool receipts** — deterministic verification layer for agent tool calls
- **Memory invalidation** — stale/contradictory fact detection with three-tier memory model
- **MCP dual-role** — Quill is both MCP client and server

## Bug Fixes

- Fixed 3 frontend TypeScript errors that blocked desktop builds
- Fixed import path in metrics API client

## Verification

- ✅ Backend type-check: clean (0 errors)
- ✅ Frontend type-check: clean (0 errors)
- ✅ Backend tests: 408 passed (3 pre-existing failures unrelated to this release)

## Desktop Binaries

Desktop binaries for macOS (ARM64 + Intel), Windows, and Linux are built automatically via GitHub Actions and will be attached to this release when the build completes.

## Upgrade Guide

```bash
git pull origin main
make setup
make dev
```

## Contributors

Thanks to everyone who contributed to this release. Quill is inspired by OpenWork, DeerFlow, OpenClaw, Hermes Agent, Kimi Code, Codex, CrewAI, AutoGen, and awesome-harness-engineering.

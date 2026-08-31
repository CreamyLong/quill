# 🪶 Quill

> Open-source AI work assistant — research, code, and create, all in one place

<div align="center">

**English** · [中文](README_zh.md) · [한국어](README_ko.md)

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15.x-000000.svg?logo=next.js&logoColor=white)](https://nextjs.org/)
[![LangGraph](https://img.shields.io/badge/LangGraph-Agent%20Runtime-1C1C1C.svg)](https://langchain-ai.github.io/langgraph/)

</div>

Quill is an open-source super agent framework. With sub-agent orchestration, sandbox execution, and an extensible skills system, it helps you accomplish multimodal work — research, coding, data analysis, document generation, and more.

---

## 📸 Feature Showcase

### 🔬 Deep Research
Multi-source search with cross-validation and cited reports. Quill orchestrates multiple sub-agents to investigate topics in depth.

### 💻 Code Execution
Safely run Python / Bash / file operations in an isolated sandbox environment with full filesystem access.

### 🤖 Sub-Agent Collaboration
Main agent dispatches specialized sub-agents for parallel complex tasks — general-purpose, bash, and custom agents.

### 🧩 Extensible Skills & Extensions
Install skills to extend capabilities. Build custom extensions with lifecycle hooks (pre_model, post_model, pre_tool, post_tool).

### 🧠 Long-Term Memory
Continuously records user profile and conversation history with confidence-based fact eviction policies.

### 🌐 Multi-Model & Multi-Language
DeepSeek / OpenAI / Anthropic / vLLM / Ollama and more. UI supports English, 中文, and 한국어.

---

## 🏗️ System Architecture

### High-Level Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        WEB[Next.js Frontend<br/>React + Tailwind]
        IM[IM Channels<br/>Telegram, Slack, Discord<br/>Feishu, DingTalk]
    end

    subgraph "Gateway Layer (Port 8001)"
        GW[Gateway API<br/>FastAPI + LangGraph Runtime]
        SB[Stream Bridge<br/>SSE Delivery]
        RM[Run Manager<br/>Task Lifecycle]
    end

    subgraph "Agent Runtime"
        LA[Lead Agent<br/>StateGraph]
        MW[Middleware Chain<br/>25+ Middlewares]
        SA[Sub-Agent Executor<br/>Thread Pool]
    end

    subgraph "Infrastructure"
        DB[(Database<br/>SQLite / Postgres)]
        SK[Skills System<br/>SKILL.md + Extensions]
        MCP[MCP Servers<br/>Multi-Protocol]
        MEM[Memory System<br/>LLM Extraction + Eviction]
    end

    WEB -->|HTTP/SSE| GW
    IM -->|Webhook| GW
    GW --> LA
    GW --> SB
    GW --> RM
    LA --> MW
    LA --> SA
    LA -->|Tool Calls| MCP
    LA -->|Read/Write| DB
    LA -->|Load/Save| SK
    LA -->|Extract/Inject| MEM
    SA -->|Background| LA
```

### Agent Loop & Middleware Chain

```mermaid
flowchart LR
    START([START]) --> PREP[Prepare<br/>Inject System Prompt]
    PREP --> BM[beforeModel<br/>25+ Hooks]
    BM --> MODEL[Model Call<br/>LLM Inference]
    MODEL --> AM[afterModel<br/>Post-Processing]
    AM --> TOOLS{Tool Calls?}
    TOOLS -->|Yes| EXEC[Execute Tools<br/>Sandbox + MCP]
    EXEC --> AA[afterAgent<br/>State Updates]
    AA -->|Continue| BM
    TOOLS -->|No| END([END])
    AA -->|Finish| END

    style START fill:#4ade80,stroke:#166534
    style END fill:#f87171,stroke:#991b1b
    style MODEL fill:#60a5fa,stroke:#1e40af
    style EXEC fill:#fbbf24,stroke:#92400e
```

### Middleware Pipeline (Lead Agent)

```mermaid
flowchart TB
    subgraph "Input Layer"
        M1[1. Input Sanitization<br/>Prompt Injection Defense]
        M2[2. Tool Output Budget<br/>Size Caps]
        M3[3. Thread Data<br/>Per-Thread Directories]
    end

    subgraph "Context Layer"
        M4[4. Dynamic Context<br/>Date + Memory Reminders]
        M5[5. Skill Activation<br/>/skill-name Slash Commands]
        M6[6. Durable Context<br/>Delegation + Skill References]
    end

    subgraph "Safety Layer"
        M7[7. Guardrail<br/>Pre-Tool Authorization]
        M8[8. Sandbox Audit<br/>Security Logging]
        M9[9. Tool Error Handling<br/>Graceful Recovery]
    end

    subgraph "Model Layer"
        M10[10. LLM Error Handling<br/>Retry + Backoff]
        M11[11. System Message Coalescing<br/>Provider Compatibility]
        M12[12. Deferred Tool Filter<br/>MCP Schema Hiding]
    end

    subgraph "Output Layer"
        M13[13. Summarization<br/>Context Reduction]
        M14[14. Loop Detection<br/>Repetition Breaker]
        M15[15. Token Budget<br/>Per-Run Limits]
        M16[16. Clarification<br/>User Interaction]
    end

    M1 --> M2 --> M3 --> M4 --> M5 --> M6
    M6 --> M7 --> M8 --> M9 --> M10 --> M11 --> M12
    M12 --> M13 --> M14 --> M15 --> M16

    style M1 fill:#dbeafe,stroke:#1e40af
    style M4 fill:#fef3c7,stroke:#92400e
    style M7 fill:#fee2e2,stroke:#991b1b
    style M10 fill:#dcfce7,stroke:#166534
    style M13 fill:#f3e8ff,stroke:#6b21a8
```

### Sub-Agent Delegation Flow

```mermaid
sequenceDiagram
    participant U as User
    participant LA as Lead Agent
    participant EX as Sub-Agent Executor
    participant SA as Sub-Agent
    participant T as Tools

    U->>LA: Send message
    LA->>LA: Model generates tool_call
    LA->>EX: task(description, type)
    EX->>SA: Create sub-agent graph
    loop Execute turns
        SA->>T: Tool calls (bash, read, write)
        T-->>SA: Results
        SA->>SA: Model reasoning
    end
    SA-->>EX: Final result
    EX-->>LA: task_completed event
    LA-->>U: Response with results
```

### Extension System Architecture

```mermaid
flowchart TB
    subgraph "Extension Lifecycle"
        DISC[Discovery<br/>Scan extension.yaml]
        VAL[Validation<br/>Manifest + Hooks]
        LOAD[Load Module<br/>Dynamic Import]
        INIT[Initialize<br/>Setup Resources]
        REG[Register Hooks<br/>Lifecycle Middleware]
        EXEC[Execute Hooks<br/>pre/post model/tool]
        DISP[Dispose<br/>Cleanup on Remove]
    end

    subgraph "Hook Phases"
        PRE_M[pre_model]
        POST_M[post_model]
        PRE_T[pre_tool]
        POST_T[post_tool]
        ON_START[on_agent_start]
        ON_END[on_agent_end]
    end

    DISC --> VAL --> LOAD --> INIT --> REG
    REG --> EXEC
    EXEC --> DISP

    REG --- PRE_M
    REG --- POST_M
    REG --- PRE_T
    REG --- POST_T
    REG --- ON_START
    REG --- ON_END

    style DISC fill:#dbeafe,stroke:#1e40af
    style LOAD fill:#fef3c7,stroke:#92400e
    style EXEC fill:#dcfce7,stroke:#166534
    style DISP fill:#fee2e2,stroke:#991b1b
```

---

## ✨ Core Capabilities

| Capability | Description |
|-----------|-------------|
| **Deep Research** | Multi-source search + cross-validation + cited reports |
| **Code Execution** | Safely run Python / Bash / file operations in a sandbox |
| **Sub-Agent Collaboration** | Main agent dispatches sub-agents for parallel complex tasks |
| **Extensible Skills** | Install skills to extend capabilities (academic review, PPT, charts, GitHub research, and more) |
| **Extension System** | Build plugins with lifecycle hooks (pre_model, post_model, pre_tool, post_tool) |
| **Long-Term Memory** | Continuously records user profile and conversation history with eviction policies |
| **Multi-Model** | DeepSeek / OpenAI / Anthropic / vLLM / Ollama and more |
| **Multi-Language** | UI supports English, 中文, 한국어 |
| **IM Channels** | Telegram, Slack, Discord, Feishu, DingTalk integration |
| **Scheduled Tasks** | Cron/interval-driven scheduled runs with multi-instance support |

---

## 🚀 Quick Start

### Prerequisites

- Node.js 22+ / pnpm 10+
- Python 3.12+ (optional, for sandbox execution)

### Local Development

```bash
git clone https://github.com/<your-org>/quill.git
cd quill
make setup        # interactive wizard, done in ~2 minutes
make dev          # start services, open http://localhost:2126
```

### Docker Deployment

```bash
docker compose up -d
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 15 · React 19 · Tailwind CSS · shadcn/ui |
| **Backend** | LangGraph · TypeScript · FastAPI (Python) |
| **Database** | SQLite / PostgreSQL · LangGraph Checkpointer |
| **Agent Runtime** | StateGraph · 25+ Middlewares · Sub-Agent Executor |
| **Protocols** | MCP (Model Context Protocol) · SSE · HTTP/SSE/Stdio |

---

## 📦 Skills & Extensions Ecosystem

Quill ships with 20+ built-in skills: academic review, deep research, data analysis, PPT generation, chart visualization, image / video / music generation, frontend design, GitHub research, newsletter, and more.

**Extensions** enable third-party developers to build plugins that hook into the agent lifecycle:
- `pre_model` / `post_model` — intercept and modify model calls
- `pre_tool` / `post_tool` — intercept and modify tool execution
- `on_agent_start` / `on_agent_end` — setup and cleanup

Connect additional MCP services via `extensions_config.json`.

---

## 🌐 Internationalization

Quill supports three languages:

| Language | Locale | Status |
|----------|--------|--------|
| English | `en-US` | ✅ Complete |
| 中文 (Chinese) | `zh-CN` | ✅ Complete |
| 한국어 (Korean) | `ko-KR` | ✅ Complete |

Switch languages in Settings → Appearance → Language.

---

## 🤝 Contributing

Issues and PRs are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

## 📜 License

[Apache 2.0](./LICENSE)

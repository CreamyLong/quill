# 🪶 Quill

> 开源 AI 工作助手 — 研究、编码、创作，尽在一体

<div align="center">

[English](README.md) · **中文** · [한국어](README_ko.md) · [日本語](README_ja.md) · [Français](README_fr.md) · [Русский](README_ru.md) · [Español](README_es.md) · [العربية](README_ar.md)

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15.x-000000.svg?logo=next.js&logoColor=white)](https://nextjs.org/)
[![LangGraph](https://img.shields.io/badge/LangGraph-Agent%20Runtime-1C1C1C.svg)](https://langchain-ai.github.io/langgraph/)

</div>

Quill 是一个开源的超级智能体框架。通过子智能体编排、沙箱执行和可扩展的技能系统，帮助您完成多模态工作 — 研究、编码、数据分析、文档生成等等。

---

## 📸 功能展示

### 🔬 深度研究
多源搜索，交叉验证，生成带引用的报告。Quill 协调多个子智能体深入调查主题。

### 💻 代码执行
在隔离的沙箱环境中安全运行 Python / Bash / 文件操作。

### 🤖 子智能体协作
主智能体调度专门的子智能体并行处理复杂任务。

### 🧩 可扩展技能与插件
安装技能以扩展功能。使用生命周期钩子构建自定义扩展。

### 🧠 长期记忆
持续记录用户画像和对话历史，支持基于置信度的事实淘汰策略。

### 🌐 多模型与多语言
DeepSeek / OpenAI / Anthropic / vLLM / Ollama 等。界面支持 English、中文、한국어。

---

## 🏗️ 系统架构

### 高层架构

```mermaid
graph TB
    subgraph "客户端层"
        WEB[Next.js 前端<br/>React + Tailwind]
        IM[IM 频道<br/>Telegram, Slack, Discord<br/>Feishu, DingTalk]
    end

    subgraph "网关层 (端口 8001)"
        GW[网关 API<br/>FastAPI + LangGraph 运行时]
        SB[流桥接<br/>SSE 投递]
        RM[运行管理器<br/>任务生命周期]
    end

    subgraph "智能体运行时"
        LA[主智能体<br/>状态图]
        MW[中间件链<br/>25+ 中间件]
        SA[子智能体执行器<br/>线程池]
    end

    subgraph "基础设施"
        DB[(数据库<br/>SQLite / Postgres)]
        SK[技能系统<br/>SKILL.md + 扩展]
        MCP[MCP 服务器<br/>多协议]
        MEM[记忆系统<br/>LLM 提取 + 淘汰]
    end

    WEB -->|HTTP/SSE| GW
    IM -->|Webhook| GW
    GW --> LA
    GW --> SB
    GW --> RM
    LA --> MW
    LA --> SA
    LA -->|工具调用| MCP
    LA -->|读写| DB
    LA -->|加载/保存| SK
    LA -->|提取/注入| MEM
    SA -->|后台| LA
```

### 智能体循环与中间件链

```mermaid
flowchart LR
    START([开始]) --> PREP[准备<br/>注入系统提示]
    PREP --> BM[模型前<br/>25+ 钩子]
    BM --> MODEL[模型调用<br/>LLM 推理]
    MODEL --> AM[模型后<br/>后处理]
    AM --> TOOLS{工具调用?}
    TOOLS -->|是| EXEC[执行工具<br/>沙箱 + MCP]
    EXEC --> AA[智能体后<br/>状态更新]
    AA -->|继续| BM
    TOOLS -->|否| END([结束])
    AA -->|完成| END

    style START fill:#4ade80,stroke:#166534
    style END fill:#f87171,stroke:#991b1b
    style MODEL fill:#60a5fa,stroke:#1e40af
    style EXEC fill:#fbbf24,stroke:#92400e
```

---

## ✨ 核心能力

| 能力 | 描述 |
|------|------|
| **深度研究** | 多源搜索 + 交叉验证 + 带引用报告 |
| **代码执行** | 在沙箱中安全运行 Python / Bash / 文件操作 |
| **子智能体协作** | 主智能体调度子智能体并行处理复杂任务 |
| **可扩展技能** | 安装技能扩展功能（学术审查、PPT、图表、GitHub 研究等） |
| **扩展系统** | 使用生命周期钩子构建插件 |
| **长期记忆** | 持续记录用户画像和对话历史，支持淘汰策略 |
| **多模型** | DeepSeek / OpenAI / Anthropic / vLLM / Ollama 等 |
| **多语言** | 界面支持 English、中文、한국어 |
| **IM 频道** | Telegram、Slack、Discord、飞书、钉钉集成 |
| **定时任务** | 支持多实例的 cron/间隔调度执行 |

---

## 🚀 快速开始

### 前置要求

- Node.js 22+ / pnpm 10+
- Python 3.12+（可选，用于沙箱执行）

### 本地开发

```bash
git clone https://github.com/<your-org>/quill.git
cd quill
make setup        # 交互式向导，约 2 分钟完成
make dev          # 启动服务，在 http://localhost:2126 打开
```

### Docker 部署

```bash
docker compose up -d
```

---

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | Next.js 15 · React 19 · Tailwind CSS · shadcn/ui |
| **后端** | LangGraph · TypeScript · FastAPI (Python) |
| **数据库** | SQLite / PostgreSQL · LangGraph Checkpointer |
| **智能体运行时** | StateGraph · 25+ 中间件 · 子智能体执行器 |
| **协议** | MCP (模型上下文协议) · SSE · HTTP/SSE/Stdio |

---

## 📦 技能与扩展生态系统

Quill 内置 20+ 技能：学术审查、深度研究、数据分析、PPT 生成、图表可视化、图片 / 视频 / 音乐生成、前端设计、GitHub 研究、新闻通讯等。

**扩展**允许第三方开发者构建插件，钩入智能体生命周期：
- `pre_model` / `post_model` — 拦截和修改模型调用
- `pre_tool` / `post_tool` — 拦截和修改工具执行
- `on_agent_start` / `on_agent_end` — 设置和清理

通过 `extensions_config.json` 连接更多 MCP 服务。

---

## 🌐 国际化

Quill 支持三种语言：

| 语言 | 区域设置 | 状态 |
|------|---------|------|
| English | `en-US` | ✅ 完成 |
| 中文 (Chinese) | `zh-CN` | ✅ 完成 |
| 한국어 (Korean) | `ko-KR` | ✅ 完成 |

在 设置 → 外观 → 语言 中切换语言。

---

## 🤝 贡献

欢迎提交 Issue 和 PR。详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 📜 许可证

[Apache 2.0](./LICENSE)

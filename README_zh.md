# 🪶 Quill

> 开源 AI 工作助手 —— 研究、编码、创作，一站式完成

[English](./README.md) | 中文

Quill 是一个开源超级代理（super agent）框架，通过子代理协同、沙箱执行、可扩展技能系统，帮你完成研究、编码、数据分析、文档生成等多模态工作。

## ✨ 核心能力

- **深度研究** — 多源搜索 + 交叉验证 + 引用报告
- **代码执行** — 沙箱内安全运行 Python / Bash / 文件操作
- **子代理协同** — 主 Agent 可派发子代理并行处理复杂任务
- **技能扩展** — 安装技能即可扩展能力（学术综述、PPT、图表、GitHub 研究等）
- **长期记忆** — 持续记录用户画像与对话历史
- **多模型支持** — DeepSeek / OpenAI / Anthropic / vLLM / Ollama 等

## 🚀 快速开始

### 前置要求

- Node.js 22+ / pnpm 10+
- Python 3.12+（可选，用于沙箱执行）

### 本地开发

```bash
git clone https://github.com/<your-org>/quill.git
cd quill
make setup        # 交互式向导，2 分钟完成配置
make dev          # 启动服务，浏览器访问 http://localhost:2126
```

### Docker 部署

```bash
docker compose up -d
```

## 🛠️ 技术栈

TypeScript · Next.js · LangGraph · Tailwind CSS · SQLite / Postgres

## 📦 技能生态

Quill 内置 20+ 技能：学术综述、深度研究、数据分析、PPT 制作、图表可视化、图片 / 视频 / 音乐生成、前端设计、GitHub 研究、新闻通讯等。通过 `extensions_config.json` 可接入更多 MCP 服务。

## 🤝 贡献

欢迎提交 Issue 和 PR。详情见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 📜 License

[Apache 2.0](./LICENSE)

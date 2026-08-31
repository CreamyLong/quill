# 🪶 Quill

> オープンソースのAIワークアシスタント — リサーチ、コーディング、作成を一つに

<div align="center">

[English](README.md) · [中文](README_zh.md) · [한국어](README_ko.md) · **日本語** · [Français](README_fr.md) · [Русский](README_ru.md) · [Español](README_es.md) · [العربية](README_ar.md)

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15.x-000000.svg)](https://nextjs.org/)
[![LangGraph](https://img.shields.io/badge/LangGraph-Agent%20Runtime-1C1C1C.svg)](https://langchain-ai.github.io/langgraph/)

</div>

Quillはオープンソースのスーパーエージェントフレームワークです。サブエージェントオーケストレーション、サンドボックス実行、拡張可能なスキルシステムで、リサーチ、コーディング、データ分析、文書生成などのマルチモーダル作業をサポートします。

---

## 📸 機能ショーケース

### 🔬 ディープリサーチ
クロス検証と引用付きのマルチソース検索。Quillは複数のサブエージェントを編成してテーマを深く調査します。

### 💻 コード実行
分離されたサンドボックス環境でPython / Bash /ファイル操作を安全に実行します。

### 🤖 サブエージェント協調
メインエージェントが専用サブエージェントを並行してディスパッチします。

### 🧩 拡張可能なスキルと拡張機能
スキルをインストールして機能を拡張。ライフサイクルフックでカスタム拡張機能を構築できます。

### 🧠 長期記憶
信頼度ベースの事実削除ポリシーで、ユーザープロファイルと会話履歴を継続的に記録します。

### 🌐 マルチモデル・多言語
DeepSeek / OpenAI / Anthropic / vLLM / Ollamaなど。UIは8言語をサポートします。

---

## ✨ コア機能

| 機能 | 説明 |
|------|------|
| **ディープリサーチ** | マルチソース検索 + クロス検証 + 引用レポート |
| **コード実行** | サンドボックスでPython / Bash /ファイル操作を安全に実行 |
| **サブエージェント協調** | 複雑なタスクのためのサブエージェント並行ディスパッチ |
| **拡張可能なスキル** | 学術レビュー、PPT、チャート、GitHubリサーチなどのスキル |
| **拡張システム** | ライフサイクルフックでプラグインを構築 |
| **長期記憶** | 信頼度ベースの削除ポリシーによる継続的な記録 |
| **マルチモデル** | DeepSeek / OpenAI / Anthropic / vLLM / Ollamaなど |
| **多言語** | 8言語対応UI |
| **IMチャネル** | Telegram、Slack、Discord、Feishu、DingTalk統合 |
| **スケジュールタスク** | マルチインスタンス対応cron/間隔スケジュール実行 |

---

## 🚀 クイックスタート

### 前提条件

- Node.js 22+ / pnpm 10+
- Python 3.12+（オプション、サンドボックス実行用）

### ローカル開発

```bash
git clone https://github.com/<your-org>/quill.git
cd quill
make setup        # 対話型ウィザード、約2分で完了
make dev          # サービス起動、http://localhost:2126で開く
```

### Docker デプロイ

```bash
docker compose up -d
```

---

## 🛠️ 技術スタック

| レイヤー | 技術 |
|---------|------|
| **フロントエンド** | Next.js 15 · React 19 · Tailwind CSS · shadcn/ui |
| **バックエンド** | LangGraph · TypeScript · FastAPI (Python) |
| **データベース** | SQLite / PostgreSQL · LangGraph Checkpointer |
| **エージェントランタイム** | StateGraph · 25+ Middlewares · Sub-Agent Executor |
| **プロトコル** | MCP (Model Context Protocol) · SSE · HTTP/SSE/Stdio |

---

## 🌐 国際化

Quillは8つの言語をサポートしています：

| 言語 | ロケール | 状態 |
|------|---------|------|
| English | `en-US` | ✅ 完了 |
| 中文 | `zh-CN` | ✅ 完了 |
| 한국어 | `ko-KR` | ✅ 完了 |
| 日本語 | `ja-JP` | ✅ 完了 |
| Français | `fr-FR` | ✅ 完了 |
| Русский | `ru-RU` | ✅ 完了 |
| Español | `es-ES` | ✅ 完了 |
| العربية | `ar-SA` | ✅ 完了 |

設定 → 外観 → 言語で言語を切り替えます。

---

## 🤝 コントリビュート

IssueとPRは大歓迎です。詳細は[CONTRIBUTING.md](./CONTRIBUTING.md)をご覧ください。

## 📜 ライセンス

[Apache 2.0](./LICENSE)

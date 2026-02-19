# 流光 PrismFlowAgent 

流光 (PrismFlowAgent) 是一个基于 Node.js (ESM) 和 TypeScript 构建的现代化、全栈资讯处理与 AI Agent 系统。它能够自动化地从全球多源渠道抓取高质量资讯，利用顶级大语言模型进行深度总结，并将其分发至多种终端（如 GitHub、微信公众号、RSS 等）。

采用了模块化、插件化的架构设计，特别加强了对 AI Agent 工作流和多媒体资产处理的支持。

## ✨ 核心能力

-   **智能数据抓取 (Adapters)**:
    -   **GitHub Trending**: 实时监控全球热门开源项目。
    -   **Follow API (Folo)**: 深度集成 Folo API，支持学术论文、Twitter/Reddit 社交动态及各类 RSS 源。
    -   **模块化设计**: 通过继承 `BaseAdapter` 可快速扩展任意第三方数据源。
-   **顶级 AI 生态集成**:
    -   **多模型支持**: 原生适配 **Google Gemini**, **Anthropic Claude**, **OpenAI** 和 **Ollama**。
    -   **Tool Use (Function Calling)**: AI 可调用本地工具执行复杂任务。
-   **AI Agent & 插件架构**:
    -   **MCP (Model Context Protocol)**: 支持 MCP 协议，可动态加载和扩展 Agent 能力。
    -   **工作流引擎**: 支持定义复杂的自动化处理流程（Workflows）。
    -   **技能系统 (Skills)**: 可插拔的技能包，增强 AI 在特定领域（如报告生成）的表现。
-   **工业级多媒体处理 (Media Pipeline)**:
    -   **图像转换**: 自动将下载的图像转换为高压缩比的 **AVIF** 格式（基于 `sharp`）。
    -   **视频优化**: 使用 `ffmpeg` 对视频进行重新编码和压缩（H.264/MP4）。
    -   **云端存储**: 支持 **Cloudflare R2** (S3 兼容) 和 **GitHub** 作为资源托管服务器。
-   **自动化分发管道**:
    -   **GitHub Archive**: 自动生成每日资讯的 Markdown 历史存档。
    -   **微信公众号**: 自动处理排版、图片上传并发布至草稿箱。
    -   **RSS 生成**: 标准化 RSS XML 订阅源支持。
-   **管理控制台 (Admin Dashboard)**:
    -   **实时监控**: 观察各适配器运行状态与数据抓取量。
    -   **手动干预**: 支持手动触发抓取、生成摘要及一键发布。
    -   **Agent 管理**: 完整的 Agent、Skill 和 MCP 配置界面。

## 🛠 技术架构

-   **后端 (Backend)**: Fastify (高性能 Web 框架), TypeScript 5+, SQLite (KV 存储与关系数据), `node-cron`.
-   **前端 (Frontend)**: React 19, Vite, Tailwind CSS, Framer Motion (交互动画).
-   **基础设施**: 
    -   **指令审批系统 (Exec Approvals)**: 对 Agent 执行的关键指令进行拦截与审批。
    -   **单例模式上下文 (ServiceContext)**: 统一管理全局服务生命周期。

## 📂 核心目录结构

```text
├── src/
│   ├── adapters/       # 数据源适配器实现 (GitHub, Folo等)
│   ├── api/            # Fastify 接口定义与路由配置
│   ├── infra/          # 系统底层设施（权限、审批等）
│   ├── services/       # 核心业务逻辑
│   │   ├── agents/     # Agent, Workflow 与 MCP 核心引擎
│   │   ├── ImageService.ts # 资产下载、转换、上传管道
│   │   └── TaskService.ts  # 调度、抓取与聚合逻辑
│   ├── types/          # 全局 TypeScript 强类型定义
│   └── utils/          # 渲染引擎、辅助工具函数
├── frontend/           # React 前端单页应用 (SPA)
└── data/               # 默认数据目录 (SQLite 数据库及本地缓存)
```

## 🚀 快速开始

### 1. 安装与构建

```bash

# 安装后端依赖
npm install

# 安装前端依赖
cd frontend
npm install
cd ..
```

### 2. 环境配置

复制 `.env.example` 为 `.env`，并配置以下关键项：

-   **AI API**: `GEMINI_API_KEY`, `OPENAI_API_KEY` 等。
-   **GitHub**: `GITHUB_TOKEN` 用于发布存档；`IMAGE_GITHUB_TOKEN` 用于图片存储。
-   **WeChat**: `WECHAT_APP_ID`, `WECHAT_APP_SECRET`。
-   **Storage**: 设置 `IMAGE_STORAGE_STRATEGY` 为 `r2` 或 `github`。

### 3. 本地开发

```bash
# 启动全栈模式 (后端 + 前端)
npm run dev:all

# 仅启动后端
npm run dev

# 仅启动前端
npm run dev:frontend
```

### 4. 生产部署

```bash
# 全量构建并运行
npm run prod

# 或者手动构建
npm run build:all
npm run serve
```

## 📅 开发路线图

这份规划将杂乱的需求整理为一条清晰的**技术演进路线**。我们将开发过程分为五个阶段，遵循**从基础设施 -> 核心架构 -> 数据接入 -> 智能处理 -> 交互与调度**的逻辑。

---

### ✅ 阶段一：重构与基础设施（已完成）
**目标**：解决代码架构、自动化部署及基础运行环境问题。

- [x] **代码重构与模块化 (Refactoring)**
    - [x] **核心逻辑解耦**：已将原有代码拆分为 `Services`, `Adapters`, `Plugins` 等模块。
    - [x] **统一配置管理**：建立 `ConfigService`，支持从 `.env` 读取配置。
    - [x] **类型定义**：完善 TypeScript 类型定义，确保全链路类型安全。
- [x] **Docker 容器化 (Containerization)**
    - [x] 编写 `Dockerfile`：多阶段构建，优化镜像体积。
    - [x] 编写 `docker-compose.yml`：集成应用与持久化存储。
    - [x] **启动脚本**：实现 `entrypoint.sh` 自动化环境检查。
- [x] **CI/CD 基础**
    - [x] 项目结构已支持 GitHub Actions 等持续集成工具。

---

### ✅ 阶段二：插件化架构设计（已完成）
**目标**：实现数据源、工具、发布平台的标准化与多模型适配。

- [x] **定义标准接口 (Interface Definition)**
    - [x] `BaseAdapter`：统一数据抓取与转换流程。
    - [x] `IPublisher`：定义标准的发布接口。
    - [x] `AIProvider`：支持多模型、多供应商切换。
- [x] **插件注册表 (Plugin Registries)**
    - [x] 实现 `AdapterRegistry`, `PublisherRegistry`, `StorageRegistry` 等动态加载机制。
- [x] **LLM 适配层 (Model Adaptation)**
    - [x] **多供应商接入**：原生适配 OpenAI, Claude, Gemini, Ollama。
    - [x] **Prompt 管理**：实现 `PromptService` 进行模板化管理。
    - [x] **Tool Use (Function Calling)**：建立统一工具定义标准，支持跨模型调用。

---

### 🚀 阶段三：数据全域接入与增强（进行中）
**目标**：丰富数据来源，提升数据处理的深度与多媒体能力。

- [x] **多模态数据源开发**
    - [x] **GitHub Trending**: 实时开源趋势追踪。
    - [x] **Follow API (RSS/Twitter/Reddit)**: 深度集成社交与学术动态。
- [ ] **增强功能开发**
    - [x] **工业级多媒体管道**: 自动 AVIF 转换、视频压缩处理。
    - [ ] **AI 搜索插件**: 接入 Serper/Tavily API，支持根据关键词自动联网检索。
    - [ ] **RAG 检索增强 (Memory & Retrieval)**
        - [ ] 向量数据库接入（如 Qdrant/Chroma）。
        - [ ] 知识库分块、清洗与嵌入（Embedding）流程。
- [ ] **编辑器/生成增强**
    - [ ] **AI 绘图集成**: 接入 DALL-E 3/Midjourney，支持根据内容自动生成配图。

---

### 🧠 阶段四：智能体与内容生产（进行中）
**目标**：实现深度内容加工、自动化任务调度与多端分发。

- [ ] **内容处理 Agent**
    - [ ] **摘要生成**: 自动对 Raw Data 进行清洗、去重与摘要。
    - [ ] **多端发布**: 支持 GitHub Archive、微信公众号、RSS 等渠道。
- [ ] **高级聚合 Agent**
    - [ ] **日报/周报整合**: 智能筛选高权重内容，生成带导语、分类总结与趋势分析的深度报告。
    - [ ] **自动化任务流**: 基于 `WorkflowEngine` 定义复杂的自动化处理逻辑。
- [ ] **任务调度系统 (Scheduler)**
    - [ ] **Cron 管理**: 实现基于 `node-cron` 的多任务定时调度。
    - [ ] **手动干预**: 管理后台支持手动触发抓取与分发。

---

### 🤖 阶段五：AI 交互与编排（规划中）
**目标**：实现对话式主控 Agent，将系统能力封装为易用的交互界面。

- [ ] **AI 主 Agent (Master Agent)**
    - [ ] **对话式界面**: 支持通过自然语言指令管理系统（如“添加一个 RSS 源”、“生成上周的 AI 趋势周报”）。
    - [ ] **意图识别与任务分发**: 自动调度底层插件与工具。
- [ ] **人机协作工作流 (HITL)**
    - [ ] **预览与二次编辑**: AI 生成初稿 -> 用户对话修正 -> 确认一键发布。
- [ ] **MCP 深度集成**
    - [ ] 允许动态加载外部 MCP 服务器，无限扩展 Agent 能力边界。

---

### 📅 开发路线图总结

| 阶段 | 状态 | 核心产物 |
| :--- | :--- | :--- |
| **1. 基础** | ✅ | Docker 镜像, 模块化代码库, `ConfigService` |
| **2. 架构** | ✅ | 插件注册表, 多模型适配层, Tool Use 框架 |
| **3. 数据** | 🚀 | 社交/学术源接入, 多媒体管道, (待) RAG 知识库 |
| **4. 智能** | 🚀 | 自动摘要, 任务调度器, (待) 深度报告 Agent |
| **5. 交互** | 📅 | 对话式主 Agent, 任务编排, MCP 集成 |

## 🤖 开发者/Agent 指南

如果您是参与此项目开发的 AI Agent，请**务必**阅读 [AGENTS.md](./AGENTS.md)。它规定了严格的 ESM 模块化导入规范、强类型要求以及安全性准则，确保代码的稳定与一致。

有关如何开发和集成自定义插件（适配器、发布器、存储），请参考 [插件接入文档](./PLUGINS.md)。

## 📜 许可证

本项目基于 [ISC License](./LICENSE) 授权。

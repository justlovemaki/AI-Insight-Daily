## 项目部署与维护

### 🏗️ 项目架构

本项目依托 Cloudflare 强大的生态系统，实现了高效、轻量与良好的可扩展性。

> 各核心组件协同工作，构成了一个从数据输入、处理到输出的完整闭环。

*   **☁️ Cloudflare Workers**: 作为项目的**核心执行环境**，负责处理所有 HTTP 请求、调度任务、调用外部 API 以及执行 AI 内容生成逻辑。
*   **🗄️ Cloudflare KV**: 作为项目的**持久化存储**，用于保存配置信息、缓存数据以及每日生成的报告内容，提供了低延迟的键值对存储能力。
*   **🔌 外部 API 整合**:
    *   **AI 模型 API**: 集成 Google Gemini 和 OpenAI 兼容 API，为内容摘要和再创作提供强大的 AI 支持。
    *   **内容源 API**:
        *   **Folo API**: 默认的信息聚合来源，可灵活配置抓取不同的 Folo 源。
        *   **GitHub Trending API**: 获取 GitHub 每日热门项目，追踪开源趋势。
    *   **发布渠道 API**:
        *   **GitHub API**: 用于将处理好的内容自动推送到指定的 GitHub 仓库。
*   **🛠️ Wrangler**: Cloudflare官方的命令行工具，用于项目的本地开发、环境配置和一键部署。

### 🚀 快速开始

#### 1. 准备工作

首先，请确保您的开发环境中已安装 Node.js 和 npm。

- **安装 Wrangler CLI**:
  ```bash
  npm install -g wrangler
  或
  npm install -g @cloudflare/wrangler
  ```

- **克隆项目代码**:
  ```bash
  git clone https://github.com/justlovemaki/CloudFlare-AI-Insight-Daily.git
  cd CloudFlare-AI-Insight-Daily
  ```

#### 2. 配置环境变量

项目的核心配置均在 `wrangler.toml` 文件中完成。请根据您的需求修改 `[vars]` 部分的配置。

> **注意**：使用 `**` 标记的为 **必填项**。

```toml
# wrangler.toml

# 项目名称
name = "ai-insight-daily" 
# Worker 入口文件
main = "src/index.js" 
# 兼容性日期
compatibility_date = "2024-05-20"
# 在开发模式下是否启用 Worker，设置为 true 可以在 workers.dev 子域上预览。
workers_dev = true

[vars]
# ========================
# 基础功能配置
# ========================
**LOGIN_USERNAME** = "your_login_username"
**LOGIN_PASSWORD** = "your_login_password"
DAILY_TITLE = "AI洞察日报"
PODCAST_TITLE = "来生小酒馆"
PODCAST_BEGIN = "嘿，亲爱的V，欢迎收听新一期的来生情报站，我是你们的老朋友，何夕2077"
PODCAST_END = "今天的情报就到这里，注意隐蔽，赶紧撤离"

# ========================
# AI 模型配置
# ========================
# 可选值: "GEMINI" 或 "OPEN"
**USE_MODEL_PLATFORM** = "GEMINI" 
OPEN_TRANSLATE = "true"

# Gemini 配置
**GEMINI_API_KEY** = "your_gemini_api_key"
GEMINI_API_URL = "https://generativelanguage.googleapis.com"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-preview-05-20"

# OpenAI 兼容 API 配置 (如 DeepSeek)
OPENAI_API_KEY = "your_openai_compatible_key"
OPENAI_API_URL = "https://api.deepseek.com"
DEFAULT_OPEN_MODEL = "deepseek-chat"

# ========================
# GitHub 发布配置
# ========================
**GITHUB_TOKEN** = "your_github_personal_access_token"
**GITHUB_REPO_OWNER** = "your_github_username"
**GITHUB_REPO_NAME** = "your_repo_name"
**GITHUB_BRANCH** = "main"

# ========================
# 内容源配置 (按需配置)
# ========================
# Folo 源
FOLO_COOKIE_KV_KEY = "folo_auth_cookie"
FOLO_DATA_API = "https://api.follow.is/entries"
FOLO_FILTER_DAYS = "1"

# 其他内容源 ID 和抓取页数...
AIBASE_FEED_ID = "......" 
AIBASE_FETCH_PAGES = "2" 
XIAOHU_FEED_ID = "......" 
XIAOHU_FETCH_PAGES = "2" 
HGPAPERS_FEED_ID = "......"
HGPAPERS_FETCH_PAGES = "2" 
TWITTER_LIST_ID = "......"
TWITTER_FETCH_PAGES = "2" 
```

#### 3. 本地开发与调试

- **配置 KV 命名空间**:
  1.  在 Cloudflare 控制台 > `Workers 和 Pages` > `KV` 中创建一个新的 KV 命名空间。
  2.  将创建的 KV ID 添加到 `wrangler.toml` 文件中：
      ```toml
      kv_namespaces = [
        { 
            binding = "DATA_KV",  # 代码中使用的绑定名称
            id = "your_kv_namespace_id"  # 在 Cloudflare 控制台找到的 ID
        }
      ]
      ```

- **启动本地开发服务**:
  ```bash
  wrangler dev
  ```
  该命令会启动一个本地服务器（通常在 `http://localhost:8787`），您可以直接在浏览器中访问以进行调试。

#### 4. 部署到 Cloudflare

- **登录 Cloudflare**:
  ```bash
  wrangler login
  ```

- **一键部署**:
  ```bash
  wrangler deploy
  ```
  部署成功后，Wrangler 会返回一个公开的 `*.workers.dev` 域名，您的 AI 洞察日报服务已在线上运行！

### 🗓️ 定时生成 Pages 站点 (可选)

如果您希望将每日报告自动发布为 GitHub Pages 静态网站，可以按照以下步骤配置一个 Docker 定时任务。

1.  **前提条件**: 确保您的目标 GitHub 仓库已开启 GitHub Actions 和 GitHub Pages 功能。仓库中应包含 `unzip_and_commit.yml` 工作流文件。

2.  **修改配置**: 进入 `cron-docker` 目录。
    *   编辑 `Dockerfile`，修改 `ENV` 部分为您自己的仓库信息和可选的图片代理地址。
    *   编辑 `scripts/work/book.toml`，修改 `title` 和 `src` 路径。
    *   (可选) 修改 `Dockerfile` 中的 cron 表达式以自定义每日执行时间。

3.  **构建并运行 Docker 容器**:
    ```bash
    # 进入 cron-docker 目录
    cd cron-docker

    # 构建 Docker 镜像
    docker build -t ai-daily-cron-job .

    # 在后台启动容器
    docker run -d --name ai-daily-cron ai-daily-cron-job
    ```

4.  **验证部署**: 定时任务触发后，会自动生成内容并推送到您的仓库。稍等片刻，即可通过您的 GitHub Pages 地址（例如 `https://<user>.github.io/<repo>/today/book/`）访问生成的日报。

### ❓ F.A.Q

#### 如何获取 `feedId` 和 `listId`？

-   **Folo Feed ID**: 登录 Folo.so 后，在浏览器地址栏中找到 `feedId`。
    ![获取 Folo Feed ID](images/folo-1.png)

-   **Twitter List ID**: 在 Twitter 上打开您想关注的列表，`listId` 就在地址栏中。
    ![获取 Twitter List ID](images/folo-2.png)

#### 🔑 如何获取 API 密钥？

-   **Google Gemini API Key**:
    访问 [Google AI for Developers](https://ai.google.dev/gemini-api/docs/api-key?hl=zh-cn) 创建您的 API 密钥。

-   **GitHub Personal Access Token**:
    请参照 [GitHub 官方文档](https://docs.github.com/zh/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) 生成一个具有 `repo` 权限的 Token。
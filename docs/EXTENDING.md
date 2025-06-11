## 项目拓展性：如何添加新的数据源

“AI 洞察日报”项目设计具有良好的可扩展性，允许开发者轻松集成新的数据源，以丰富内容类型或增加现有类型的覆盖范围。以下是添加新数据源的详细步骤：

1.  **创建新的数据源文件**：
    -   在 `src/dataSources/` 目录下创建一个新的 JavaScript 文件，例如 `src/dataSources/yourNewDataSource.js`。
    -   这个文件需要导出一个包含两个核心方法的对象：
        -   `fetch(env)`：一个异步函数，负责从外部 API 获取原始数据。`env` 参数包含了 `wrangler.toml` 中配置的环境变量，你可以利用这些变量来配置 API 密钥、URL 等。
        -   `transform(rawData, sourceType)`：一个函数，负责将 `fetch` 方法获取到的原始数据转换为项目统一的数据格式。统一格式应包含 `id`, `url`, `title`, `content_html` (或 `description`), `date_published` (或 `pubDate`), `authors` (或 `author`) 等字段，以便项目能够正确处理和展示。`sourceType` 参数表示当前数据源的类型（例如 'news', 'project'）。
        -   `generateHtml(item)` (可选)：一个函数，如果该数据源的内容需要特定的 HTML 渲染方式，则实现此方法。它接收一个统一格式的 `item` 对象，并返回用于在前端页面展示的 HTML 字符串。如果未提供此方法，系统将使用默认的 HTML 渲染逻辑。注意：同一分类下，只有第一个数据源需要实现 `generateHtml` 方法。

    **示例 `src/dataSources/yourNewDataSource.js` 结构：**
    ```javascript
    // src/dataSources/yourNewDataSource.js
    const YourNewDataSource = {
        type: 'your-new-type', // 定义数据源的唯一类型标识
        async fetch(env) {
            // 使用 env.YOUR_API_KEY, env.YOUR_API_URL 等配置进行 API 请求
            const response = await fetch(env.YOUR_API_URL);
            const data = await response.json();
            return data; // 返回原始数据
        },
        transform(rawData, sourceType) {
            // 将原始数据转换为统一格式
            return rawData.items.map(item => ({
                id: item.id,
                url: item.url,
                title: item.title,
                content_html: item.content, // 或 item.description
                published_date: item.publishedAt, // 或 item.date_published
                authors: [{ name: item.author }], // 或 item.authors
                source_type: sourceType, // 标记数据来源类型
            }));
        },
        generateHtml(item) {
            // 可选：自定义 HTML 渲染逻辑
            return `
                <h3><a href="${item.url}" target="_blank">${item.title}</a></h3>
                <small>发布日期: ${new Date(item.published_date).toLocaleDateString()} - 作者: ${item.authors.map(a => a.name).join(', ')}</small>
                <div class="content-html">${item.content_html}</div>
            `;
        }
    };
    export default YourNewDataSource;
    ```

2.  **导入新的数据源**：
    -   打开 `src/dataFetchers.js` 文件。
    -   在文件顶部，使用 `import` 语句导入你新创建的数据源模块：
        ```javascript
        import YourNewDataSource from './dataSources/yourNewDataSource.js';
        ```

3.  **注册新的数据源**：
    -   在 `src/dataFetchers.js` 文件中找到 `dataSources` 对象。
    -   根据你的需求，将新的数据源添加到现有类型（如 `news`, `project`, `paper`, `socialMedia`）的 `sources` 数组中，或者创建一个新的数据类型并添加进去。
    -   **添加到现有类型示例**：
        ```javascript
        export const dataSources = {
            news: { name: '新闻', sources: [AibaseDataSource, XiaohuDataSource, YourNewDataSource] },
            // ... 其他类型
        };
        ```
    -   **创建新的数据类型示例**：
        ```javascript
        export const dataSources = {
            // ... 现有类型
            yourNewCategory: { name: '你的新类别名称', sources: [YourNewDataSource] },
        };
        ```

4.  **更新 `wrangler.toml` (如果需要)**：
    -   如果你的新数据源需要额外的 API 密钥、URL 或其他配置，请在 `wrangler.toml` 文件的 `[vars]` 部分添加相应的环境变量。
    -   例如：
        ```toml
        [vars]
        # ... 其他变量
        YOUR_API_KEY = "your_api_key_here"
        YOUR_API_URL = "https://api.yournewsource.com"
        ```

5.  **调整提示词 (如果需要 AI 处理)**：
    -   如果新添加的数据源内容需要通过 AI 模型进行摘要、格式化或生成其他形式的内容，你可能需要调整或创建新的提示词。
    -   **创建新的提示词文件**：在 `src/prompt/` 目录下，可以创建新的 JavaScript 文件（例如 `yourNewPrompt.js`）来定义如何根据新数据源的特点构建 AI 提示词。同时，可以创建相应的 Markdown 文件（例如 `systemPromptYourNewType.md`）来存储系统提示词的文本内容。
    -   **在 `src/handlers/genAIContent.js` 中集成**：根据新数据源的类型，修改 `src/handlers/genAIContent.js` 文件。这通常包括：
        -   引入并调用新的提示词逻辑（如果创建了新的提示词文件）。
        -   在 `handleGenAIContent` 函数内部的 `switch (item.type)` 语句中，为新的 `item.type` 添加一个 `case`，定义如何从新数据源的统一格式数据中提取文本内容，作为 AI 模型的输入。

通过以上步骤，你就可以轻松地为“AI 洞察日报”项目添加新的数据源，使其能够聚合更多样化的 AI 相关内容，或其他垂直领域的信息。这使得项目的功能更加丰富，同时也为开发者提供了一个灵活的扩展机制，以满足不断变化的需求。
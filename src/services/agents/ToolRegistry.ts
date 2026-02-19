import { ToolDefinition } from '../../types/agent.js';
import { UnifiedData } from '../../types/index.js';
import { ServiceContext } from '../ServiceContext.js';
import { ExecApprovals } from '../../infra/exec-approvals.js';
import { WechatRenderer } from '../../utils/wechatRenderer.js';
import { LogService } from '../LogService.js';
import { PromptService } from '../PromptService.js';
import { 
  extractContentFromSecondHash, 
  truncateContent, 
  getAppUrl, 
  removeMarkdownCodeBlock,
  formatDateToGMT8WithTime
} from '../../utils/helpers.js';


export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<string, ToolDefinition & { handler: (args: any) => Promise<any> }> = new Map();

  private constructor() {}

  public static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
      ToolRegistry.instance.registerDefaultTools();
    }
    return ToolRegistry.instance;
  }

  private registerDefaultTools() {
    // 0. Shell Command Execution Tool
    this.registerTool({
      id: 'execute_command',
      name: 'execute_command',
      description: '执行系统命令行指令。使用此工具运行 Skill 中定义的脚本或系统命令。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的完整命令行指令' },
          cwd: { type: 'string', description: '执行命令的工作目录 (可选)' }
        },
        required: ['command']
      },
      handler: async (args: { command: string; cwd?: string }) => {
        return await ExecApprovals.execute(args.command, args.cwd);
      }
    });

    // 1. Fetch News Data Tool
    this.registerTool({
      id: 'fetch_data',
      name: 'fetch_data',
      description: '从指定的适配器或所有适配器获取资讯数据',
      parameters: {
        type: 'object',
        properties: {
          adapterName: { type: 'string', description: '适配器名称 (可选)' },
          date: { type: 'string', description: '目标日期 (YYYY-MM-DD, 可选)' }
        }
      },
      handler: async (args: { adapterName?: string; date?: string }) => {
        const context = await ServiceContext.getInstance();
        if (args.adapterName) {
          return await context.taskService.runSingleAdapterIngestion(args.adapterName, args.date);
        } else {
          return await context.taskService.runDailyIngestion(args.date);
        }
      }
    });

    // 2. Publish to GitHub Tool
    this.registerTool({
      id: 'publish_to_github',
      name: 'publish_to_github',
      description: '将生成的 Markdown 内容发布到 GitHub 仓库',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: '日期 (YYYY-MM-DD)' },
          dailyMd: { type: 'string', description: '日报 Markdown 内容' }
        },
        required: ['date', 'dailyMd']
      },
      handler: async (args: { date: string; dailyMd: string }) => {
        const context = await ServiceContext.getInstance();
        const githubPublisher = context.publisherInstances.find(p => p.id === 'github') as any;
        const prefix = githubPublisher?.config?.pathPrefix || 'daily';

        return await context.taskService.publish('github', args.dailyMd, {
          filePath: `${prefix}/${args.date}.md`,
          message: `Push Github for ${args.date}`,
          date: args.date
        });
      }
    });

    // 3. Knowledge Base Search (RAG Tool)
    this.registerTool({
      id: 'search_knowledge_base',
      name: 'search_knowledge_base',
      description: '搜索已抓取的资讯库以获取相关上下文',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          date: { type: 'string', description: '日期 (YYYY-MM-DD, 默认今日)' },
          topK: { type: 'number', description: '返回结果数量 (默认 5)' },
          categories: { type: 'array', items: { type: 'string' }, description: '限定搜索的分类列表 (可选, 不传则搜索全部分类)' }
        },
        required: ['query']
      },
      handler: async (args: { query: string; date?: string; topK?: number; categories?: string[] }) => {
        const context = await ServiceContext.getInstance();
        const targetDate = args.date || new Date().toISOString().split('T')[0];
        const data = await context.taskService.getAggregatedData(targetDate);
        
        // Filter by categories if specified
        const entries = args.categories?.length
          ? Object.entries(data).filter(([key]) => args.categories!.includes(key))
          : Object.entries(data);
        
        const allItems = entries.flatMap(([, items]) => items) as UnifiedData[];
        const results = allItems.filter(item => 
          item.title.toLowerCase().includes(args.query.toLowerCase()) || 
          item.description?.toLowerCase().includes(args.query.toLowerCase())
        ).slice(0, args.topK || 5);
        
          return results;
        }
      });
  
      // 4. Process Markdown Images Tool
      this.registerTool({
        id: 'process_markdown_media',
        name: 'process_markdown_media',
        description: '处理 Markdown 中的图片和视频，将其转换为高效格式并上传到图床 (GitHub 或 R2)',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Markdown 内容' },
            filePath: { type: 'string', description: '原始文件路径 (可选，用于确定临时目录位置)' },
            storageId: { type: 'string', description: '存储插件 ID (如 "github-storage", "r2")。如果不指定，将使用第一个已启用的存储插件。' }
          },
          required: ['content']
        },
        handler: async (args: { content: string; filePath?: string; storageId?: string }) => {
          const context = await ServiceContext.getInstance();
          let storageProvider = args.storageId ? context.storageInstances.find(s => s.id === args.storageId) : context.storageInstances[0];
          
          if (args.storageId && !storageProvider) {
            LogService.warn(`Specified storageId ${args.storageId} not found, falling back to ${context.storageInstances[0]?.id}`);
            storageProvider = context.storageInstances[0];
          }

          return await context.imageService.processMarkdown(args.content, context.settings, args.filePath, storageProvider);
        }
      });



      // 5. Render WeChat HTML Tool
      this.registerTool({
        id: 'render_wechat_html',
        name: 'render_wechat_html',
        description: '将日报 Markdown 内容渲染为微信公众号专用的 HTML 格式。必须传入 markdown 参数。',
        parameters: {
          type: 'object',
          properties: {
            markdown: { type: 'string', description: '日报 Markdown 完整内容 (重要: 请务必传入此参数)' },
            showVoice: { type: 'boolean', description: '是否显示语音版/渠道卡片 (可选)' }
          },
          required: ['markdown']
        },
        handler: async (args: any) => {
          try {
            LogService.info(`Tool: render_wechat_html started. Received keys: ${Object.keys(args || {}).join(', ')}`);
            const markdown = args.markdown || args.content || args.dailyMd;
            if (!markdown) {
              LogService.error('Tool: render_wechat_html failed - missing markdown. Args received: ' + JSON.stringify(args));
              throw new Error('缺少必要参数: markdown (请确保将生成的 Markdown 内容传入此参数)');
            }
            const data = WechatRenderer.parseMarkdown(markdown);
            const html = WechatRenderer.render(data, args.showVoice);
            LogService.info(`Tool: render_wechat_html success. Date: ${data.date}`);
            return { 
              summary: `已成功渲染微信 HTML。日期: ${data.date}, 包含 ${data.allLinks.length} 个链接。`,
              data: data,
              html: html
            };
          } catch (error: any) {
            LogService.error(`Tool: render_wechat_html failed: ${error.message}`);
            return { error: `渲染微信 HTML 失败: ${error.message}` };
          }
        }
      });

      // 6. Publish to WeChat Tool
      this.registerTool({
        id: 'publish_to_wechat',
        name: 'publish_to_wechat',
        description: '将内容发布到微信公众号草稿箱。会自动处理图片上传。必须传入 markdown 参数。',
        parameters: {
          type: 'object',
          properties: {
            markdown: { type: 'string', description: '日报 Markdown 完整内容 (重要: 请务必传入此参数)' },
            title: { type: 'string', description: '文章标题 (可选)' },
            author: { type: 'string', description: '作者 (可选)' },
            digest: { type: 'string', description: '摘要 (可选)' },
            showVoice: { type: 'boolean', description: '是否显示语音版/渠道卡片 (可选)' }
          },
          required: ['markdown']
        },
        handler: async (args: any) => {
          try {
            LogService.info(`Tool: publish_to_wechat started. Received keys: ${Object.keys(args || {}).join(', ')}`);
            const markdown = args.markdown || args.content || args.dailyMd;
            if (!markdown) {
              LogService.error('Tool: publish_to_wechat failed - missing markdown. Args received: ' + JSON.stringify(args));
              throw new Error('缺少必要参数: markdown (请确保将生成的 Markdown 内容传入此参数)');
            }
            const context = await ServiceContext.getInstance();
            
            // 1. Render HTML
            const data = WechatRenderer.parseMarkdown(markdown);
            const html = WechatRenderer.render(data, args.showVoice);

            // 2. Publish to WeChat via TaskService (Handles image processing and history)
            LogService.info('Tool: publish_to_wechat - publishing via TaskService');
            const result = await context.taskService.publish('wechat', html, {
              title: `${args.title || ''}`,
              author: args.author || '',
              digest: args.digest || data.summaryLines.join(' '),
              displayDate: data.date
            });

            LogService.info(`Tool: publish_to_wechat success. media_id: ${result.media_id}`);
            return { status: 'success', media_id: result.media_id, title: args.title || data.date };
          } catch (error: any) {
            LogService.error(`Tool: publish_to_wechat failed: ${error.message}`);
            return { error: `发布到微信失败: ${error.message}` };
          }
        }
      });

      // 7. Generate Image Tool
      this.registerTool({
        id: 'generate_image',
        name: 'generate_image',
        description: '根据描述生成图片（DALL-E 3）。',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: '图片生成描述' },
            size: { type: 'string', enum: ['256x256', '512x512', '1024x1024'], description: '图片尺寸 (默认 1024x1024)' }
          },
          required: ['prompt']
        },
        handler: async (args: { prompt: string; size?: string }) => {
          try {
            const context = await ServiceContext.getInstance();
            const providers = context.settings.AI_PROVIDERS || [];
            const activeProvider = providers.find((p: any) => p.id === context.settings.ACTIVE_AI_PROVIDER_ID);
            
            if (!activeProvider || activeProvider.type !== 'OPENAI') {
              throw new Error('当前激活的 AI 提供商不支持图片生成 (仅支持 OpenAI)');
            }

            const url = `${activeProvider.apiUrl}/v1/images/generations`;
            const response = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${activeProvider.apiKey}`
              },
              body: JSON.stringify({
                model: 'dall-e-3',
                prompt: args.prompt,
                n: 1,
                size: args.size || '1024x1024'
              }),
              dispatcher: activeProvider.useProxy ? context.proxyAgent : undefined
            } as any);

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`OpenAI Image API error: ${response.status} ${errorText}`);
            }

            const data = await response.json() as any;
            return { url: data.data[0].url };
          } catch (error: any) {
            LogService.error(`Tool: generate_image failed: ${error.message}`);
            throw error;
          }
        }
      });

      // 8. Generate RSS Content Tool
      this.registerTool({
        id: 'generate_rss_content',
        name: 'generate_rss_content',
        description: '从 daily 目录读取内容，生成 AI 简化的 RSS 内容并写入 rss 目录',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: '日期 (YYYY-MM-DD)' }
          },
          required: ['date']
        },
        handler: async (args: { date: string }) => {
          try {
            const context = await ServiceContext.getInstance();
            const githubPublisher = context.publisherInstances.find(p => p.id === 'github') as any;
            if (!githubPublisher) throw new Error('GitHub Publisher not configured');
            if (!context.aiProvider) throw new Error('AI Provider not configured');

            const dateStr = args.date;
            const prefix = githubPublisher.config?.pathPrefix || 'daily';
            const dailyPath = `${prefix}/${dateStr}.md`;
            LogService.info(`Tool: generate_rss_content - Reading from ${dailyPath}`);

            let content = await githubPublisher.getFileContent(dailyPath);
            if (!content) throw new Error(`No content found for ${dailyPath}`);


            content = extractContentFromSecondHash(content);

            // Generate AI content using template
            const prompt = PromptService.getInstance().getPrompt('rss_generation');
            if (!prompt) {
              throw new Error('Prompt template rss_generation not found');
            }
            
            const aiResponse = await context.aiProvider.generateContent(content, prompt);
            let aiContent = aiResponse.content;


            aiContent = removeMarkdownCodeBlock(aiContent);
            aiContent = truncateContent(aiContent, 360);
            aiContent = "[前往官网查看完整版 (ai.hubtoday.app)](https://ai.hubtoday.app/)\n\n" + aiContent + "\n\n" + getAppUrl();

            // Write to rss directory
            const rssPath = `rss/${dateStr}.md`;
            const commitMessage = `Create/Update RSS content for ${dateStr}`;
            await githubPublisher.publish(aiContent, { filePath: rssPath, message: commitMessage });


            // const yearMonth = dateStr.substring(0, 7);
            // const result = {
            //   report_date: dateStr,
            //   title: dateStr + '日刊',
            //   link: '/' + yearMonth + '/' + dateStr + '/',
            //   content_markdown: aiContent,
            //   github_path: rssPath,
            //   published_date: formatDateToGMT8WithTime(new Date())
            // };

            LogService.info(`Tool: generate_rss_content success for ${dateStr}`);
            return aiContent;
          } catch (error: any) {
            LogService.error(`Tool: generate_rss_content failed: ${error.message}`);
            throw error;
          }
        }
      });
    }
  
  public registerTool(tool: ToolDefinition & { handler: (args: any) => Promise<any> }) {
    this.tools.set(tool.id, tool);
  }

  public getTool(id: string) {
    return this.tools.get(id);
  }

  public getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(({ handler, ...rest }) => rest);
  }

  public async callTool(id: string, args: any) {
    const tool = this.tools.get(id);
    if (!tool) throw new Error(`Tool ${id} not found`);
    return await tool.handler(args);
  }
}

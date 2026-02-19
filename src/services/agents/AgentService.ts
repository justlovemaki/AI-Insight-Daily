import { AgentDefinition, SkillDefinition, AgentExecutionResult } from '../../types/agent.js';
import { LocalStore } from '../LocalStore.js';
import { AIProvider, createAIProvider } from '../AIProvider.js';
import { ToolRegistry } from './ToolRegistry.js';
import { LogService } from '../LogService.js';
import { SkillService } from './SkillService.js';

export class AgentService {
  private store: LocalStore;
  private aiProvider: AIProvider;
  private skillService: SkillService;
  private toolRegistry: ToolRegistry;
  private proxyAgent?: any;

  constructor(store: LocalStore, aiProvider: AIProvider, skillService: SkillService, proxyAgent?: any) {
    this.store = store;
    this.aiProvider = aiProvider;
    this.skillService = skillService;
    this.toolRegistry = ToolRegistry.getInstance();
    this.proxyAgent = proxyAgent;
  }

  async runAgent(agentId: string, input: string, date?: string): Promise<AgentExecutionResult> {
    const agentDef = await this.store.getAgent(agentId);
    if (!agentDef) throw new Error(`Agent ${agentId} not found`);

    LogService.info(`Running agent: ${agentDef.name}${date ? ` for date: ${date}` : ''}`);

    // 0. Resolve AI Provider from agent's own config
    let provider: AIProvider = this.aiProvider;
    if (agentDef.providerId) {
      const settings = await this.store.get('system_settings');
      const providers = settings?.AI_PROVIDERS || [];
      const providerConfig = providers.find((p: any) => p.id === agentDef.providerId);
      if (providerConfig) {
        const model = agentDef.model || providerConfig.models?.[0];
        // 确保从 ServiceContext 或设置中获取代理 Agent
        const dispatcher = providerConfig.useProxy === true ? (this as any).proxyAgent : undefined;
        LogService.info(`Initializing AI provider ${providerConfig.id} for agent ${agentDef.name}. Using Proxy: ${!!dispatcher}`);
        const created = createAIProvider({ ...providerConfig, model }, dispatcher);
        if (created) provider = created;
      }
    }

    // 1. Prepare Skills
    const combinedSkillInstructions = await this.skillService.buildSkillsPrompt(agentDef.skillIds || []);

    // 2. Prepare Tools
    const toolIds = new Set<string>([
      ...(agentDef.toolIds || [])
    ]);

    // If skills are present, ensure execute_command is available
    if ((agentDef.skillIds || []).length > 0) {
      toolIds.add('execute_command');
    }

    const tools = Array.from(toolIds)
      .map(id => this.toolRegistry.getTool(id))
      .filter(Boolean);

    // 3. Construct System Message
    let systemInstruction = `${combinedSkillInstructions}\n${agentDef.systemPrompt}`;
    if (date) {
      systemInstruction += `\n\n当前处理日期为: ${date}`;
    }

    // 4. Execution Loop (Simplified for now: max 3 rounds of tool calls)
    let currentInput = input;
    let finalContent = '';
    let lastToolResult: any = null;
    let rounds = 0;
    const maxRounds = 3;

    while (rounds < maxRounds) {
      const response = await provider.generateWithTools(currentInput, tools, systemInstruction);

      if (response.tool_calls && response.tool_calls.length > 0) {
        LogService.info(`Agent ${agentDef.name} calling tools: ${response.tool_calls.map(tc => tc.name).join(', ')}`);
        
        const toolResults = [];
        for (const tc of response.tool_calls) {
          try {
            const result = await this.toolRegistry.callTool(tc.name, tc.arguments);
            toolResults.push({ tool_call_id: tc.id, result });
            lastToolResult = result; // 记录最后一个工具结果
          } catch (error: any) {
            toolResults.push({ tool_call_id: tc.id, error: error.message });
          }
        }

        // Inform the AI about tool results and continue
        currentInput = `Tool results:\n${JSON.stringify(toolResults)}\n\nPlease continue based on these results.`;
        rounds++;
      } else {
        finalContent = response.content;
        break;
      }
    }

    return { 
      content: finalContent || 'No response generated',
      data: lastToolResult // 返回最后一个工具的执行结果
    };
  }
}

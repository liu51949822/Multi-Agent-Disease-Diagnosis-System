import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage } from '@langchain/core/messages';
import { IAgent, AgentState } from './types';
import pino from 'pino';
import dotenv from 'dotenv';

dotenv.config();

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

if (!process.env.GOOGLE_API_KEY) {
  throw new Error('GOOGLE_API_KEY 未配置在环境变量中');
}

// 模块级单例：所有 Agent 共享同一个模型实例，避免并发时重复创建
export const sharedModel = new ChatGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_API_KEY,
  model: 'gemini-2.5-flash',
  temperature: 0.7,
});

export abstract class BaseAgent implements IAgent {
  public name: string;
  public description: string;
  protected model = sharedModel;

  constructor(name: string, description: string) {
    this.name = name;
    this.description = description;
  }

  abstract execute(state: AgentState): Promise<Partial<AgentState>>;

  // 用正则提取第一个完整 JSON 对象或数组，忽略前后文字
  protected async invokeJSON<T>(prompt: string): Promise<T> {
    const raw = await this.model.invoke(prompt);
    const text = raw.content.toString();
    const match = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!match) throw new Error(`JSON 提取失败: ${text.slice(0, 100)}`);
    return JSON.parse(match[0]) as T;
  }

  protected async invokeText(prompt: string): Promise<string> {
    const raw = await this.model.invoke(prompt);
    return raw.content.toString().trim();
  }

  /**
   * 图文混合调用：照片以 data URI 形式随文字一起发送给 Gemini 视觉分析。
   * 通过 this.model.invoke（共享单例）发送，保证单测可用 vi.spyOn(sharedModel,'invoke') 覆盖。
   */
  protected async invokeVision<T>(prompt: string, imageDataUri: string): Promise<T> {
    const message = new HumanMessage({
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imageDataUri } },
      ],
    });
    const raw = await this.model.invoke([message]);
    const text = raw.content.toString();
    const match = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!match) throw new Error(`JSON 提取失败: ${text.slice(0, 100)}`);
    return JSON.parse(match[0]) as T;
  }

  protected log(msg: string): void {
    logger.info({ agent: this.name }, msg);
  }

  protected logError(msg: string, err?: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ agent: this.name }, `${msg}: ${message}`);
  }
}

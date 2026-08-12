import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage } from '@langchain/core/messages';
import { z, ZodSchema } from 'zod';
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

const MAX_RETRIES = 1; // zod 校验失败时的自纠正重试次数

export abstract class BaseAgent implements IAgent {
  public name: string;
  public description: string;
  protected model = sharedModel;

  constructor(name: string, description: string) {
    this.name = name;
    this.description = description;
  }

  abstract execute(state: AgentState): Promise<Partial<AgentState>>;

  // ---- 结构化输出（zod + withStructuredOutput + 自纠正重试） ----
  // 替代旧的 invokeJSON（正则提取），提供类型安全的结构化输出。
  // Zod schema 描述期望的 JSON 形状；模型原生约束输出 + 解析失败时
  // 自纠正重试（带错误反馈），最后兜底正则提取 + zod 解析。

  /** 结构化输出：zod 约束 + 自纠正重试 */
  protected async invokeStructured<T>(
    prompt: string,
    schema: ZodSchema<T>,
  ): Promise<T> {
    const constrained = this.model.withStructuredOutput(schema, { name: this.name });

    // 尝试 1：模型原生结构化输出（Gemini 支持 responseSchema）
    try {
      const result = await constrained.invoke(prompt);
      return schema.parse(result) as T;
    } catch (err) {
      this.log(`结构化输出首试失败，尝自纠正重试... ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`);
    }

    // 尝试 2：带错误反馈重试（自纠正）
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const retryPrompt = `${prompt}\n\n⚠️ 上一轮输出格式不正确，请严格按照 JSON schema 返回。`;
        const result = await constrained.invoke(retryPrompt);
        return schema.parse(result) as T;
      } catch (err) {
        const msg = err instanceof Error ? err.message.slice(0, 80) : String(err);
        this.log(`自纠正重试 ${attempt + 1} 失败: ${msg}`);
      }
    }

    // 兜底：正则提取 + zod 解析（兼容旧 invokeJSON 逻辑）
    this.log('结构化输出降级为正则提取 + zod 解析');
    return this.invokeJSONFallback(prompt, schema);
  }

  /** 兜底：正则提取 JSON + zod 校验（不依赖 withStructuredOutput） */
  private async invokeJSONFallback<T>(prompt: string, schema: ZodSchema<T>): Promise<T> {
    const raw = await this.model.invoke(prompt);
    const text = raw.content.toString();
    const match = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!match) {
      throw new Error(`JSON 提取失败（正则无匹配）: ${text.slice(0, 100)}`);
    }
    const parsed = JSON.parse(match[0]);
    return schema.parse(parsed) as T;
  }

  // ---- 兼容旧 API（仍可用，但不推荐新代码使用） ----
  // 保留旧 invokeJSON 供渐变迁移；新 Agent 应优先用 invokeStructured

  /** @deprecated Use invokeStructured(prompt, zodSchema) instead */
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


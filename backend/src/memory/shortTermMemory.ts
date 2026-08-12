// 短期会话记忆（Short-term / thread-scoped memory）
//
// 官方模式对应：LangGraph Checkpointer + Summarization。
// 实现为内存版 sessionStore（生产可替换为 PostgresSaver 等持久化检查点），
// 提供：
//   - 滚动窗口：客户端 history 是短期上下文的唯一事实来源（避免双写冲突）
//   - 摘要累积：服务端只负责把超过窗口的早期对话压缩成 summary（LLM 摘要）
//
// 关键设计（对应面试常考点）：
//   1. 客户端 history = 事实来源；服务端 sessionStore 只做"摘要累积"，
//      两者职责分离，避免同一份对话被双端重复维护。
//   2. 摘要由 LLM 生成并缓存到 store；下次请求时 summary + 最近 N 条原文
//      一起注入 agent，既保留关键历史又控制 token 成本。

import { sharedModel } from '../agents/BaseAgent';

export interface MemoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface SessionEntry {
  summary: string;
  messagesSeen: number; // 已参与摘要的消息数（用于判断是否需增量摘要）
}

const MAX_RECENT = 6; // 保留的最近原文条数（超出部分进入摘要）
const MIN_FOR_SUMMARY = 10; // 达到该消息数才触发摘要

const sessionStore = new Map<string, SessionEntry>();

/** 从 history 构建注入 agent 的短期上下文：summary + 最近 N 条原文 */
export async function getShortTermContext(
  sessionId: string | undefined,
  history: MemoryMessage[] | undefined,
): Promise<{ summary: string; recent: MemoryMessage[] }> {
  const safeHistory = Array.isArray(history) ? history : [];

  // 服务端已缓存摘要（如果有）
  const entry = sessionId ? sessionStore.get(sessionId) : undefined;
  const cachedSummary = entry?.summary ?? '';

  // 增量摘要：仅在 history 比上次见到的消息数更多时才重算（避免每轮全量重算）
  const shouldSummarize =
    safeHistory.length >= MIN_FOR_SUMMARY &&
    (!entry || safeHistory.length > entry.messagesSeen);

  let summary = cachedSummary;
  if (shouldSummarize) {
    try {
      summary = await summarizeConversation(safeHistory, cachedSummary);
      if (sessionId) {
        sessionStore.set(sessionId, {
          summary,
          messagesSeen: safeHistory.length,
        });
      }
    } catch (err) {
      // 摘要失败静默降级：保留缓存摘要，不打断主流程
      console.warn('[memory] summarize failed, fallback to cache:', err);
    }
  }

  const recent = safeHistory.slice(-MAX_RECENT);
  return { summary, recent };
}

/** 用 LLM 把旧对话压缩成一段摘要（增量式：结合上次摘要） */
async function summarizeConversation(
  messages: MemoryMessage[],
  existing: string,
): Promise<string> {
  const historyText = messages
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
    .join('\n');

  const prompt = `你是对话记忆压缩器。请把以下整形咨询对话压缩成一段简洁的中文摘要（保留：用户关注点、既往咨询项目、重要结论、关键事实），不要超过 200 字。

${existing ? `【已有摘要】\n${existing}\n` : ''}
【本轮对话】
${historyText}

只输出摘要，不要其他内容。`;

  const raw = await sharedModel.invoke(prompt);
  return raw.content.toString().trim().slice(0, 500);
}

/** 测试辅助：清空内存 store */
export function _clearSessionStoreForTest(): void {
  sessionStore.clear();
}

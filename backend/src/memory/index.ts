// 记忆门面（MemoryService）
//
// 统一出口：把"短期会话记忆 + 长期用户档案 + 向量历史记忆"三件套
// 组装成注入 agent 的上下文，并在对话结束后更新各类记忆。
// 对上层（routes/multiAgentService）只暴露两个方法：
//   - buildMemoryContext()  请求时：取回全部记忆上下文
//   - updateMemory()        请求后：写入/更新记忆
//
// 关键设计（对应面试常考点）：
//   1. 三件套职责清晰：短期管"本轮上下文"，长期管"用户画像"，
//      向量管"跨会话语义回忆"。
//   2. 全部内存版实现 + 接口抽象，无 DB 也能跑；生产可整体替换为
//      LangGraph Checkpointer + Store（Postgres 系）。
//   3. 任一层失败静默降级，绝不让记忆问题打断主对话/SSE。

import {
  getShortTermContext,
  MemoryMessage,
} from './shortTermMemory';
import {
  getProfile,
  updateProfileFromConversation,
  formatProfile,
  UserProfile,
} from './longTermMemory';
import {
  saveToVectorMemory,
  searchVectorMemory,
  formatRelevantHistory,
} from './vectorMemory';

export interface MemoryContext {
  sessionId?: string;
  userId?: string;
  summary: string;
  recent: MemoryMessage[];
  profileText: string;
  relevantHistoryText: string;
}

export interface MemoryInput {
  sessionId?: string;
  userId?: string;
  history?: MemoryMessage[];
  userMessage: string;
  assistantReply?: string;
}

/** 请求前：组装全部记忆上下文（任一层失败静默降级） */
export async function buildMemoryContext(input: MemoryInput): Promise<MemoryContext> {
  const { sessionId, userId, history, userMessage } = input;

  const short = await getShortTermContext(sessionId, history);
  const profile = getProfile(userId);

  const [relevant] = await Promise.all([
    searchVectorMemory(userId, userMessage, 3),
  ]);

  return {
    sessionId,
    userId,
    summary: short.summary,
    recent: short.recent,
    profileText: formatProfile(profile),
    relevantHistoryText: formatRelevantHistory(relevant),
  };
}

/** 请求后：更新长期档案 + 向量记忆（失败静默降级） */
export async function updateMemory(input: MemoryInput): Promise<void> {
  const { userId, userMessage, assistantReply } = input;
  if (!userId) return;
  await Promise.all([
    updateProfileFromConversation(userId, userMessage),
    saveToVectorMemory(userId, userMessage, assistantReply ?? ''),
  ]);
}

export type { UserProfile };

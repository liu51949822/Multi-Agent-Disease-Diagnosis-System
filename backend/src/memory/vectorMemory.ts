// 向量历史记忆（Vector / semantic memory）
//
// 官方模式对应：LangGraph Store 内建 semantic search（pgvector）。
// 实现为内存版向量存储 + 余弦相似度检索（生产可替换为 PostgresStore/pgvector）。
// 作用：把历史对话（QA 对）嵌入向量，用户新问题到来时，
//       检索语义最相关的历史对话作为补充上下文，实现"跨会话的语义回忆"。
//
// 关键设计（对应面试常考点）：
//   1. 复用共享 embedding 模型（gemini-embedding-001），与 RAG 检索同构。
//   2. 内存向量 + 余弦相似度，零 DB 依赖可运行；接口抽象生产可换 pgvector。
//   3. 检索失败静默降级：无记忆/嵌入失败时返回空，不打断主流程。

import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';

export interface VectorMemoryItem {
  id: string;
  question: string;
  answer: string;
  userId: string;
  timestamp: number;
}

interface IndexedItem extends VectorMemoryItem {
  embedding: number[];
}

const store = new Map<string, IndexedItem>();
const MAX_ITEMS = 500;

let embeddings: GoogleGenerativeAIEmbeddings | null = null;

function getEmbeddings(): GoogleGenerativeAIEmbeddings {
  if (!embeddings) {
    embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GOOGLE_API_KEY,
      model: 'gemini-embedding-001',
    });
  }
  return embeddings;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** 保存一条历史对话到向量记忆（失败静默降级） */
export async function saveToVectorMemory(
  userId: string | undefined,
  question: string,
  answer: string,
): Promise<void> {
  if (!userId || !question || !answer) return;
  try {
    const [embedding] = await getEmbeddings().embedDocuments([question]);
    const id = `${userId}:${Date.now()}`;
    store.set(id, { id, question, answer, userId, timestamp: Date.now(), embedding });
    // 简单容量控制：超出上限移除最旧的
    if (store.size > MAX_ITEMS) {
      const oldest = [...store.values()].sort((a, b) => a.timestamp - b.timestamp)[0];
      store.delete(oldest.id);
    }
  } catch (err) {
    console.warn('[memory] save vector memory failed:', err);
  }
}

/** 检索与 query 语义最相关的历史对话（默认 k 条） */
export async function searchVectorMemory(
  userId: string | undefined,
  query: string,
  k = 3,
): Promise<VectorMemoryItem[]> {
  if (!userId || !query) return [];
  const items = [...store.values()].filter((i) => i.userId === userId);
  if (items.length === 0) return [];

  try {
    const [qEmb] = await getEmbeddings().embedDocuments([query]);
    return items
      .map((i) => ({ ...i, score: cosine(qEmb, i.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ score: _s, embedding: _e, ...rest }) => rest);
  } catch (err) {
    console.warn('[memory] search vector memory failed:', err);
    return [];
  }
}

/** 把检索结果格式化为注入 agent 的文本 */
export function formatRelevantHistory(items: VectorMemoryItem[]): string {
  if (items.length === 0) return '';
  return items
    .map((i) => `【相关历史】Q: ${i.question}\nA: ${i.answer.slice(0, 200)}`)
    .join('\n\n');
}

/** 测试辅助：清空内存 */
export function _clearVectorMemoryForTest(): void {
  store.clear();
}

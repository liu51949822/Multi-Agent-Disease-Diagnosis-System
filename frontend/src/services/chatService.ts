import type { SseEvent } from '../types/chat';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

export const chatService = {
  /**
   * 流式咨询：POST /chat/stream，通过 SSE 接收执行进度和最终结果。
   * @param message 用户文字
   * @param image 照片 data URI（可选）
   * @param memory 记忆参数：sessionId/userId/历史对话（可选）
   */
  async streamConsult(
    message: string,
    image: string | undefined,
    onEvent: (event: SseEvent) => void,
    signal?: AbortSignal,
    memory?: { sessionId?: string; userId?: string; history?: { role: 'user' | 'assistant'; content: string }[] },
    hitl?: { resume?: unknown; threadId?: string },
  ): Promise<void> {
    const { resume, threadId } = hitl ?? {};
    const body: Record<string, unknown> = { message, image, ...memory };
    if (resume !== undefined) { body.resume = resume; }
    if (threadId) { body.threadId = threadId; }
    const response = await fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error ?? `HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('响应流不可用');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6)) as SseEvent;
              onEvent(event);
            } catch {
              // 忽略格式异常行
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },

  async checkHealth(): Promise<{ status: string }> {
    const res = await fetch(`${API_BASE}/health`);
    return res.json();
  },
};

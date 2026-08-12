import { Router, Request, Response } from 'express';
import { executeWithStream } from '../services/multiAgentService';
import type { SseEvent } from '../agents/types';

const router = Router();

// 校验 image 为合法的 base64 data URI（png/jpeg/webp），防止任意 JSON 直达 Gemini
// 同时限制解码后的图片体积（base64 长度 ≈ 原大小的 4/3）
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 与前端一致：5MB
const MAX_MESSAGE_LEN = 2000;

function isValidImageDataUri(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(value)) return false;
  const b64 = value.slice(value.indexOf(',') + 1);
  if (b64.length % 4 !== 0) return false;
  if (b64.length * 3 / 4 > MAX_IMAGE_BYTES) return false;
  return /^[A-Za-z0-9+/=]+$/.test(b64);
}

/**
 * POST /api/chat/stream
 * 多智能体流式咨询接口，通过 SSE 推送执行进度和最终结果。
 * 请求体: {
 *   message: string,            // 用户消息（必填）
 *   image?: string,             // 照片 data URI（可选）
 *   sessionId?: string,         // 会话 id（短期记忆，可选）
 *   userId?: string,            // 用户 id（长期档案/向量记忆，可选）
 *   history?: {role,content}[]  // 历史对话（短期记忆事实来源，可选）
 *   resume?: unknown             // HITL resume 值（用户确认/拒绝）
 *   threadId?: string           // 恢复时复用 thread_id（checkpointer 用）
 * }
 */
router.post('/chat/stream', async (req: Request, res: Response) => {
  const { message, image, sessionId, userId, history, resume, threadId } = req.body as {
    message?: string;
    image?: unknown;
    sessionId?: string;
    userId?: string;
    history?: { role: 'user' | 'assistant'; content: string }[];
    resume?: unknown;
    threadId?: string;
  };

  if (!message || typeof message !== 'string' || message.trim() === '') {
    res.status(400).json({ error: '消息内容不能为空' });
    return;
  }

  if (message.length > MAX_MESSAGE_LEN) {
    res.status(400).json({ error: `消息内容不能超过 ${MAX_MESSAGE_LEN} 字符` });
    return;
  }

  if (image !== undefined && !isValidImageDataUri(image)) {
    res.status(400).json({ error: '图片格式无效，仅支持 5MB 以内的 png/jpeg/webp base64 图片' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let closed = false;
  req.on('close', () => {
    // 客户端断开时标记关闭，后续 send 不再写响应，避免已销毁 socket 触发未捕获异常
    closed = true;
  });
  res.on('error', () => { closed = true; });

  const send = (event: SseEvent) => {
    if (closed) return;
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      closed = true;
    }
  };

  await executeWithStream(
    message.trim(),
    image as string | undefined,
    send,
    { sessionId: sessionId as string | undefined, userId: userId as string | undefined, history, resume, threadId },
  );
  if (!closed) res.end();
});

/**
 * GET /api/health
 * 健康检查（兼容旧路径）
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

export default router;

import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import chatRoutes from './routes/chatRoutes';
import { executeWithStream } from './services/multiAgentService';
import type { SseEvent } from './agents/types';

// 加载环境变量
dotenv.config();

// LangSmith 追踪（可选：无 LANGCHAIN_API_KEY 时自动降级，不影响应用）
try {
  if (process.env.LANGCHAIN_TRACING_V2 === 'true' && process.env.LANGCHAIN_API_KEY) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('langsmith');
    console.log('[LangSmith] 追踪已启用');
  }
} catch {
  // langsmith 包未安装或配置缺失，静默跳过
}

const app: Express = express();
const PORT = process.env.PORT || 3000;

// 中间件配置：支持 *、逗号分隔多域名、默认本地开发
function resolveCorsOrigin(): cors.CorsOptions['origin'] {
  const raw = process.env.ALLOWED_ORIGINS?.trim();
  if (!raw || raw === '*') return true;
  const origins = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (origins.length === 0) return 'http://localhost:5173';
  if (origins.length === 1) return origins[0];
  return origins;
}

app.use(cors({ origin: resolveCorsOrigin() }));
app.use(express.json({ limit: '20mb' }));

// 健康检查路由
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    protocol: (req as any).socket?.server ? 'http+ws' : 'http',
  });
});

// 聊天路由（SSE，兼容旧接口）
app.use('/api', chatRoutes);

// ---- WebSocket 双向流式 ----
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/chat' });

wss.on('connection', (ws: WebSocket) => {
  console.log('[WS] client connected');

  ws.on('message', async (raw) => {
    let payload: any;
    try { payload = JSON.parse(raw.toString()); } catch { return; }

    const { message, image, sessionId, userId, history, resume, threadId } = payload;
    if (!message || typeof message !== 'string') {
      ws.send(JSON.stringify({ type: 'error', message: 'message required' }));
      return;
    }

    const send = (event: SseEvent) => {
      try { ws.send(JSON.stringify(event)); } catch { /* client disconnected */ }
    };

    await executeWithStream(
      message.trim(),
      image as string | undefined,
      send,
      { sessionId, userId, history, resume, threadId },
    );

    try { ws.send(JSON.stringify({ type: 'done' })); } catch { /* disconnected */ }
  });

  ws.on('close', () => console.log('[WS] client disconnected'));
  ws.on('error', (err) => console.error('[WS] error:', err.message));
});

// 启动服务器（HTTP + WebSocket 共用端口）
server.listen(PORT, () => {
  console.log(`🚀 Server running http://localhost:${PORT}`);
  console.log(`📡 WebSocket at ws://localhost:${PORT}/ws/chat`);
  console.log(`📊 Health: http://localhost:${PORT}/api/health`);
});

export default app;

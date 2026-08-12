import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import chatRoutes from './routes/chatRoutes';

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
// 照片以 base64 随 JSON 传输，需调大 body 限制（默认 100kb 无法承载图片）
app.use(express.json({ limit: '20mb' }));

// 健康检查路由
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// 聊天路由
app.use('/api', chatRoutes);

// 启动服务器
app.listen(PORT, () => {
  console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
  console.log(`📊 健康检查: http://localhost:${PORT}/api/health`);
});

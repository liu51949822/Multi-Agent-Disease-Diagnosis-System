# 🚀 Quick Start Guide

Get the multi-agent plastic surgery consultation system running locally in a few minutes.

## Prerequisites

- Node.js 20+ (recommended 22+)
- npm
- Google Gemini API key (`GOOGLE_API_KEY`)

## 1. Backend

```bash
cd backend

# First time only
npm install --legacy-peer-deps

# Configure environment
cp .env.example .env
# edit .env → set GOOGLE_API_KEY=your_key

# Start (http://localhost:3000)
npm run dev
```

Health check: http://localhost:3000/api/health

## 2. Frontend

```bash
cd frontend

# First time only
npm install

# Start (http://localhost:5173)
npm run dev
```

## 3. Use it

Open http://localhost:5173/ in a browser.

- Type a plastic surgery / aesthetic question.
- (Optional) Click the 📷 button to upload a photo (PNG/JPEG/WebP, ≤5MB) for visual aesthetic analysis.
- Watch the real-time agent execution trace panel, then read the structured final result.

## Optional: Enable the RAG knowledge base

The system runs fine without a database (the surgeon agent degrades to general guidance). To enable retrieval:

1. Create a PostgreSQL database with pgvector: `CREATE EXTENSION IF NOT EXISTS vector;`
2. Set `DATABASE_URL` in `backend/.env`.
3. Ingest the seed data:

```bash
cd backend
npm run ingest
```

See [docs/rag-deployment-guide.md](./docs/rag-deployment-guide.md).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Frontend shows "未连接" | Start the backend first; check `VITE_API_URL` in `frontend/.env` |
| `GOOGLE_API_KEY 未配置` | Set `GOOGLE_API_KEY` in `backend/.env` |
| 400 "图片格式无效" | Use PNG/JPEG/WebP, and a proper base64 data URI |
| 413 payload too large | Ensure the image is ≤5MB (backend limit is 20MB) |

> AI replies are for reference only. Consult a licensed plastic surgeon before any procedure.

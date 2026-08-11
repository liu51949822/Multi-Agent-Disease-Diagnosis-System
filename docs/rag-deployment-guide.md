# RAG Retrieval Deployment Guide

This guide walks you through enabling the pgvector-backed plastic surgery knowledge base for the **Surgeon** agent, from zero to running.

> The rest of the system works **without** a database — the surgeon agent degrades to general LLM guidance. This guide is only needed if you want retrieval-backed procedure recommendations with cited sources.

## 1. Requirements

- A PostgreSQL instance (local or hosted) with the **pgvector** extension.
- The `GOOGLE_API_KEY` set (used for both dialog and embeddings).

## 2. Set up the database

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Create a database (e.g. `plastic_consult`) and a user with privileges on it.

## 3. Configure the backend

In `backend/.env`:

```bash
DATABASE_URL=postgres://user:password@host:5432/plastic_consult
GOOGLE_API_KEY=your_gemini_api_key_here
```

## 4. Ingest the seed data

The seed data lives in `backend/data/plastic-guides/*.txt` — a small set of educational plastic-surgery documents (procedures + post-op care) formatted as:

```
# Procedure name

## Section title
content lines...
```

Ingest (parses files into chunks, embeds them with `gemini-embedding-001`, stores in pgvector):

```bash
cd backend
npm run ingest
```

You should see output like:

```
解析 6 份整形资料，共 30 个切块，开始入库...
入库完成
```

## 5. Verify

Start the backend and send a consultation request mentioning a procedure:

```bash
curl -N -X POST http://localhost:3000/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message":"我想做双眼皮，恢复期多久？"}'
```

The surgeon agent should retrieve matching chunks, and its `sources` will reference the knowledge base (visible in server logs / the structured result).

## 6. Notes

- The collection name is `plastic_guides` (see `backend/src/retrieval/vectorStore.ts`).
- Re-running `npm run ingest` adds documents again; delete/recreate the table first if you want a clean rebuild.
- `NCBI_API_KEY` / PubMed is **not** used in this fork — the research path was replaced by plastic-surgery domain agents.

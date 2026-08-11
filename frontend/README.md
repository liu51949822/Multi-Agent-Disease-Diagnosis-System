# Frontend — Multi-Agent Plastic Surgery Consultant

React 19 + TypeScript + Vite + Tailwind CSS frontend for the multi-agent plastic surgery consultation system.

## Tech Stack

- React 19 · TypeScript · Vite 7 · Tailwind CSS
- Server-Sent Events (SSE) streaming via `fetch` + `ReadableStream`
- Photo upload: client-side `FileReader` → base64 data URI, sent with the message

## Quick Start

```bash
npm install
npm run dev        # http://localhost:5173
```

## Environment

Create `.env` (optional):

```bash
# Local development
VITE_API_URL=http://localhost:3000/api

# Production (deployed backend)
# VITE_API_URL=https://your-backend.onrender.com/api
```

## Features

- Chat with the multi-agent plastic surgery consultant (SSE streaming)
- Upload a photo (PNG/JPEG/WebP, ≤5MB) for visual aesthetic analysis
- Real-time agent execution trace panel
- Rich result cards: aesthetic analysis, recommended procedures, risk assessment, post-op care plan

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server |
| `npm run build` | Type-check + production build |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint |

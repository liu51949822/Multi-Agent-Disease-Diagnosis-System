# Multi-Agent Plastic Surgery Consultation System

A **multi-agent AI consultation system for plastic surgery and aesthetic medicine**, built with **LangGraph.js**. Six specialized agents collaborate to analyze facial/body aesthetics (optionally from an uploaded **photo**), recommend procedures, assess pre-operative risks, and provide post-operative care guidance — streamed to the user in real time via Server-Sent Events (SSE).

> ⚠️ **Disclaimer**: This project is a technical demonstration and educational reference only. Its output does **not** constitute medical, surgical, or aesthetic advice. See the [Disclaimer](#-disclaimer) at the end.

---

## Table of Contents

- [Features](#-features)
- [System Architecture](#-system-architecture)
- [Technology Stack](#-technology-stack)
- [Quick Start](#-quick-start)
- [Configuration](#-configuration)
- [API Reference](#-api-reference)
- [Project Structure](#-project-structure)
- [Photo Analysis (Vision)](#-photo-analysis-vision)
- [RAG Retrieval (Optional)](#-rag-retrieval-optional)
- [Testing](#-testing)
- [Design Notes](#-design-notes)
- [Roadmap](#-roadmap)
- [Disclaimer](#-disclaimer)
- [License](#-license)

---

## ✨ Features

**Multi-Agent Collaboration**

- LangGraph stateful orchestration: a coordinator dynamically routes to specialized experts, then an advisor synthesizes the final response.
- Structured shared state (`AgentState`), isolated per request.
- Advisor context projection + length guard to prevent context bloat.

**AI & Vision**

- Aesthetic analysis from an uploaded **photo** (Gemini multimodal) or from text description alone.
- Procedure recommendations (blepharoplasty, rhinoplasty, liposuction, hyaluronic acid fillers, botox, etc.).
- Pre-operative risk assessment (risk level, contraindications, recommendations).
- Post-operative care guidance (recovery timeline, care tips, warning signs).

**RAG (Optional)**

- pgvector-powered retrieval over a curated plastic surgery knowledge base.
- When `DATABASE_URL` is unset, the surgeon agent **safely degrades** to general LLM guidance instead of failing.

**Engineering Quality**

- Vitest unit tests across agents and retrieval layer.
- pino structured logging.
- Safe degradation at every boundary — no dead ends, no swallowed errors.
- Full-stack TypeScript type safety.

**UX**

- SSE streaming with a real-time agent execution trace panel.
- Responsive chat UI with photo upload & preview, sample questions, and backend connectivity check.

---

## 🏗️ System Architecture

Six agents cooperate. The **Coordinator** decides which experts to invoke based on the user's intent and whether a photo was uploaded; the **Advisor** always runs last.

```mermaid
graph TB
    User[👤 User input<br/>text + optional photo] --> Coordinator[🎯 Coordinator<br/>CoordinatorAgent]

    Coordinator -->|with photo / aesthetic intent| Aesthetic[🪞 Aesthetic Analyst<br/>AestheticAgent]
    Coordinator -->|procedure intent| Surgeon[🏥 Surgery Consultant<br/>SurgeonAgent]
    Coordinator -->|risk intent| Risk[⚠️ Risk Assessor<br/>RiskAssessorAgent]
    Coordinator -->|care intent| Care[🩹 Post-op Care<br/>CareAgent]

    Aesthetic -->|aesthetic analysis| Advisor[💡 Advisor<br/>AdvisorAgent]
    Surgeon -->|procedure plan| Advisor
    Risk -->|risk assessment| Advisor
    Care -->|care plan| Advisor

    Advisor -->|SSE stream| Response[📝 Final result]

    style Coordinator fill:#4a9eff,stroke:#2563eb,color:#fff
    style Aesthetic fill:#ec4899,stroke:#db2777,color:#fff
    style Surgeon fill:#8b5cf6,stroke:#7c3aed,color:#fff
    style Risk fill:#f59e0b,stroke:#d97706,color:#fff
    style Care fill:#10b981,stroke:#059669,color:#fff
    style Advisor fill:#6366f1,stroke:#4f46e5,color:#fff
```

| Agent | Responsibility | Core Capability |
|---|---|---|
| 🎯 **Coordinator** | Analyzes intent, decides which experts to call, builds the execution `plan` | Intent recognition, routing, plan ordering |
| 🪞 **Aesthetic** | Aesthetic analysis of face/body, optional **photo vision analysis** | Gemini multimodal, aesthetic assessment |
| 🏥 **Surgeon** | Recommends procedures with recovery & risk info (RAG-backed) | pgvector retrieval, safe degradation |
| ⚠️ **RiskAssessor** | Pre-operative risk evaluation | Risk level, contraindications, recommendations |
| 🩹 **Care** | Post-operative care & recovery guidance | Recovery timeline, care tips, warning signs |
| 💡 **Advisor** | Synthesizes everything into one final structured answer | Context projection, length guard |

**Routing logic**: the coordinator produces a `plan` array (e.g. `['aesthetic', 'surgeon', 'risk', 'care', 'advisor']`). When a photo is present, `aesthetic` is placed first; without a photo but with aesthetic intent, `aesthetic` still runs in **text-only mode** (degradation path). Conditional edges chain nodes in plan order; `advisor` is always last.

### Routing Graph

```mermaid
flowchart LR
    START([START]) --> C[🎯 Coordinator]
    C -->|"plan has aesthetic"| A[🪞 Aesthetic]
    C -->|"no aesthetic"| S[🏥 Surgeon]
    A --> S
    S --> R[⚠️ Risk]
    R --> CA[🩹 Care]
    CA --> AD[💡 Advisor]
    AD --> END([END])
```

### Multi-Agent Execution Sequence (SSE)

```mermaid
sequenceDiagram
    autonumber
    participant U as 👤 User
    participant FE as 🖥️ Frontend
    participant API as 🌐 Express API
    participant G as 🔄 LangGraph StateGraph
    participant A1 as 🪞 AestheticAgent
    participant A2 as 🏥 SurgeonAgent
    participant A3 as ⚠️ RiskAssessorAgent
    participant A4 as 🩹 CareAgent
    participant A5 as 💡 AdvisorAgent

    U->>FE: type message (+ optional photo)
    FE->>API: POST /api/chat/stream { message, image }
    API-->>FE: SSE: agent_start (coordinator)
    API->>G: executeWithStream(state)
    G->>A1: coordinator plan → aesthetic
    API-->>FE: SSE: agent_start (aesthetic)
    A1-->>G: AestheticResult
    API-->>FE: SSE: agent_complete (aesthetic)
    G->>A2: → surgeon
    API-->>FE: SSE: agent_start (surgeon)
    A2-->>G: SurgeonResult
    API-->>FE: SSE: agent_complete (surgeon)
    G->>A3: → risk
    A3-->>G: RiskAssessmentResult
    API-->>FE: SSE: agent_complete (risk)
    G->>A4: → care
    A4-->>G: CareResult
    API-->>FE: SSE: agent_complete (care)
    G->>A5: → advisor
    A5-->>G: AdvisorResult
    API-->>FE: SSE: final_result + done
    FE-->>U: render ResultCard + trace panel
```

### Context Management

The advisor does **not** pass raw agent outputs through. Instead it builds a **structured projection** — extracting only key fields (aesthetic conclusion, procedure names + indications + recovery, risk level, care tips) into the prompt. A **length guard** (`MAX_CONTEXT_LEN = 4000`) truncates oversized contexts and logs the truncation — it never silently drops core information. Importantly, the projection **never** includes the base64 photo, avoiding token waste and privacy leakage. Every request logs the context length for calibration.

---

## 📋 Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 · TypeScript · Vite 7 · Tailwind CSS |
| Backend | Node.js · Express 4 · TypeScript · tsx |
| AI Orchestration | LangGraph.js 1.0 · @langchain/core · @langchain/community |
| LLM | Google Gemini (`gemini-2.5-flash`), multimodal for photo analysis |
| Retrieval (optional) | PostgreSQL + pgvector (plastic surgery knowledge base) |
| Logging / Testing | pino · vitest |

> The LLM is injected through the shared `BaseAgent` model singleton, so the architecture is decoupled from any specific model — swapping providers only requires changing the model initialization.

---

## 🚀 Quick Start

### Prerequisites

- Node.js 20+ (recommended 22+)
- npm
- A Google Gemini API key
- (Optional) PostgreSQL with pgvector for the RAG knowledge base

### 1. Backend environment

Create `backend/.env`:

```bash
# LLM (dialog + embedding share this key)
GOOGLE_API_KEY=your_gemini_api_key_here

# Server
PORT=3000
NODE_ENV=development

# Surgeon RAG (optional): Postgres connection string with pgvector enabled
DATABASE_URL=postgres://user:pass@host/db

# CORS: "*" or comma-separated origins for production
ALLOWED_ORIGINS=*

# Optional: raise rate limits
# NCBI_API_KEY=
```

### 2. Frontend environment (optional)

Create `frontend/.env`:

```bash
VITE_API_URL=http://localhost:3000/api
```

### 3. Start

```bash
# Backend → http://localhost:3000
cd backend && npm install --legacy-peer-deps && npm run dev

# Frontend → http://localhost:5173
cd frontend && npm install && npm run dev
```

### 4. Ingest the plastic surgery knowledge base (only if using RAG)

```bash
cd backend && npm run ingest
```

> The surgeon agent depends on `DATABASE_URL`. If unset, it safely degrades to general LLM guidance without breaking the rest of the system. First-time setup requires `CREATE EXTENSION IF NOT EXISTS vector;` in your database. See [docs/rag-deployment-guide.md](./docs/rag-deployment-guide.md).

### Smoke test

```bash
# Text-only consultation
curl -N -X POST http://localhost:3000/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message":"我想做双眼皮，需要注意什么？"}'

# With a photo (base64 data URI)
curl -N -X POST http://localhost:3000/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message":"分析一下我的脸型","image":"data:image/jpeg;base64,<base64data>"}'
```

---

## ⚙️ Configuration

| Variable | Scope | Description |
|---|---|---|
| `GOOGLE_API_KEY` | backend | Gemini API key (dialog + embeddings) |
| `PORT` | backend | Server port, default 3000 |
| `NODE_ENV` | backend | `development` / `production` |
| `DATABASE_URL` | backend | (Optional) Postgres URL for pgvector RAG |
| `ALLOWED_ORIGINS` | backend | `*` or comma-separated origins |
| `LOG_LEVEL` | backend | pino level, default `info` |
| `VITE_API_URL` | frontend | Backend API base URL |

---

## 🔌 API Reference

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/chat/stream` | Multi-agent streaming consultation (SSE) |
| `GET` | `/api/health` | Health check |

**Request body**: `{ "message": string, "image"?: string }`

- `message` — the user's text (required).
- `image` — a photo as a base64 **data URI** (`data:image/png|jpeg|webp;base64,...`, optional). Invalid formats are rejected with HTTP 400.

**SSE event types**:

| Event | Meaning |
|---|---|
| `agent_start` | An agent begins execution |
| `agent_complete` | An agent finishes, with a one-line summary |
| `final_result` | The advisor's structured final answer |
| `error` | Execution error |
| `done` | Stream end |

**Example SSE payload** (final result):

```json
{
  "type": "final_result",
  "data": {
    "summary": "...",
    "aestheticAnalysis": "...",
    "recommendedProcedures": [
      { "name": "重睑术", "reason": "...", "expectedOutcome": "...", "precautions": ["..."] }
    ],
    "riskAssessment": "...",
    "carePlan": "...",
    "precautions": ["..."],
    "references": [],
    "urgency": "...",
    "disclaimer": "..."
  }
}
```

**SSE event sequence**

```mermaid
sequenceDiagram
    participant FE as 🖥️ Frontend
    participant API as 🌐 Express API
    FE->>API: POST /api/chat/stream
    loop each agent node
        API-->>FE: agent_start
        Note over API: agent executes
        API-->>FE: agent_complete { summary }
    end
    API-->>FE: final_result { AdvisorResult }
    API-->>FE: done
```

---

## 📁 Project Structure

```
├── backend/                       # Node + Express + LangGraph
│   ├── src/
│   │   ├── agents/                # Multi-agent system
│   │   │   ├── BaseAgent.ts        # Shared model + JSON/text/vision invoke helpers
│   │   │   ├── CoordinatorAgent.ts # Intent analysis & routing
│   │   │   ├── AestheticAgent.ts   # Aesthetic analysis (photo vision)
│   │   │   ├── SurgeonAgent.ts     # Procedure consultation (RAG)
│   │   │   ├── RiskAssessorAgent.ts# Pre-operative risk assessment
│   │   │   ├── CareAgent.ts        # Post-operative care guidance
│   │   │   ├── AdvisorAgent.ts     # Final synthesis (projection + length guard)
│   │   │   └── types.ts            # Shared state & result types
│   │   ├── retrieval/
│   │   │   └── vectorStore.ts      # pgvector store & plastic-guide retrieval
│   │   ├── services/
│   │   │   ├── multiAgentService.ts# LangGraph orchestration + SSE
│   │   │   └── llmService.ts       # (legacy) LLM service wrapper
│   │   ├── routes/chatRoutes.ts     # API routes (SSE, image validation)
│   │   └── index.ts                 # Server entry (20mb JSON limit)
│   ├── scripts/ingest.ts            # Knowledge-base ingestion (npm run ingest)
│   ├── data/plastic-guides/         # Plastic surgery seed data (demo)
│   └── src/__tests__/               # Vitest unit tests
├── frontend/                        # React 19 + Vite + Tailwind
│   └── src/
│       ├── services/chatService.ts  # SSE streaming client
│       ├── types/chat.ts            # Shared types
│       └── App.tsx                  # Chat UI + photo upload
├── docs/                            # English guides & design docs
├── render.yaml                      # Render deploy config
└── START.md                         # Quick-start guide
```

---

## 🖼️ Photo Analysis (Vision)

1. Frontend reads the selected file with `FileReader` (PNG/JPEG/WebP, ≤5MB) → base64 data URI.
2. The data URI travels in the JSON body: `POST /api/chat/stream` with `{ message, image }`.
3. Backend validates the data URI format (`^data:image/(png|jpeg|webp);base64,`), rejects invalid input with HTTP 400.
4. `AestheticAgent` calls the shared Gemini model with **mixed text + image content parts** via `BaseAgent.invokeVision`.
5. The model returns a structured aesthetic analysis (observations, assessment, concerns, suggestions, confidence).

Without a photo, the agent falls back to **text-only aesthetic analysis**, clearly marked `analyzed: false`.

> The advisor projection intentionally excludes the photo to avoid token waste and privacy exposure.

### Vision Flow

```mermaid
sequenceDiagram
    autonumber
    participant U as 👤 User
    participant FE as 🖥️ Frontend
    participant API as 🌐 Express API
    participant AE as 🪞 AestheticAgent
    participant GM as 💬 Gemini (multimodal)

    U->>FE: select photo (PNG/JPEG/WebP ≤5MB)
    FE->>FE: FileReader → base64 data URI
    FE->>API: POST /chat/stream { message, image }
    API->>API: validate ^data:image/(png|jpeg|webp);base64,
    API-->>FE: 400 if invalid
    API->>AE: state.image present?
    AE->>GM: invokeVision(prompt, imageDataUri)<br/>[text + image_url parts]
    GM-->>AE: AestheticResult (JSON)
    AE-->>API: aestheticResults
    API-->>FE: SSE: agent_complete
    Note over FE: photo NOT passed to advisor projection
```

---

## 📚 RAG Retrieval (Optional)

The surgeon agent retrieves relevant chunks from a pgvector store seeded from `backend/data/plastic-guides/*.txt` (formatted as `# procedure name` + `## section`). When `DATABASE_URL` is missing, `searchPlasticGuides` throws and the agent degrades gracefully to general LLM guidance with a warning note.

```bash
cd backend
npm run ingest   # parse data/plastic-guides/ → chunks → pgvector
```

### RAG Data Flow

```mermaid
flowchart LR
    TXT[data/plastic-guides/*.txt<br/># procedure + ## section] -->|npm run ingest| PARSE[parseLabel<br/>chunking]
    PARSE -->|gemini-embedding-001| EMB[Embeddings]
    EMB -->|PGVectorStore.addDocuments| DB[(PostgreSQL + pgvector<br/>table: plastic_guides)]
    DB -->|similaritySearch k=4| RET[searchPlasticGuides]
    RET -->|has DATABASE_URL| SURG[🏥 SurgeonAgent]
    SURG -->|no DATABASE_URL| DEGRADE[⚠️ degrade to general LLM guidance]
    RET -->|context chunks| LLM[Gemini 2.5 flash]
```

Deployment details: [docs/rag-deployment-guide.md](./docs/rag-deployment-guide.md)

---

## 🧪 Testing

```bash
cd backend
npm test            # run all unit tests
npm run test:watch  # watch mode
```

Tests mock the shared model (`vi.spyOn(sharedModel, 'invoke')`) and the vector store, so they run offline. The `invokeVision` test verifies the image content part is correctly assembled as a `data:` URI.

---

## 💡 Design Notes

**Why multi-agent?** Division of labor keeps each agent focused on one domain and easy to maintain. The coordinator only invokes the experts the request needs, balancing quality and cost. Adding a capability is as simple as adding an agent.

**Key trade-offs:**
- **Single-turn stateless** design isolates each request, avoiding multi-turn context bloat.
- **Projection + length guard** at the advisor is the primary defense line for context management.
- **Vision path** reuses the same shared model via `invokeVision`, keeping tests and architecture uniform.
- **Image validation** at the route layer prevents arbitrary JSON from reaching the model.

---

## 🗺️ Roadmap

- [ ] Multi-turn conversation memory (session history with rolling summaries)
- [ ] Chat history persistence
- [ ] User authentication & profiles
- [ ] Retrieval caching & performance monitoring
- [ ] Frontend procedure cards visualization, voice input

---

## ⚠️ Disclaimer

> This application provides information for reference and educational purposes only and **cannot replace professional medical or surgical consultation**.
>
> - ❌ Do not use system output as a basis for any medical or surgical decision.
> - ❌ Do not undergo any procedure based on system recommendations.
> - ✅ Consult a licensed plastic surgeon for any procedure, assessment, or treatment.
> - ✅ Photos and personal health information should be shared only with qualified professionals.
>
> The demo knowledge base (`data/plastic-guides/`) contains simplified educational material and is **not** a substitute for professional medical sources.

---

## 📄 License

**Proprietary / Non-Open-Source** — All rights reserved. Personal, non-commercial use and studying the code for learning is permitted; **commercial use requires a separate written license**. See [LICENSE](LICENSE).

## 🙏 Acknowledgements

- [LangGraph.js](https://github.com/langchain-ai/langgraphjs) · [LangChain.js](https://github.com/langchain-ai/langchainjs) · [React](https://react.dev/) · [Tailwind CSS](https://tailwindcss.com/)

# ---- Backend ----
FROM node:22-alpine AS backend
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --legacy-peer-deps
COPY backend/ .
EXPOSE 3000
CMD ["npx", "tsx", "src/index.ts"]

# ---- Frontend ----
FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
ENV VITE_API_URL=/api
RUN npm run build
CMD ["npx", "serve", "dist", "-l", "5173"]

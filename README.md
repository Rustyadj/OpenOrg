# OpenOrg — OpenClaw Command Center

Full-stack command center for the OpenClaw/Cash AI agent platform.

## Structure

```
OpenOrg/
├── frontend/          # React + TypeScript + Vite command center UI
├── backend/           # Fastify memory service (pgvector, Redis, Neo4j)
└── server/            # OpenClaw Cash memory proxy server
```

## Frontend

React 18 · TypeScript · Vite · Tailwind · Radix UI · Framer Motion · Zustand · ReactFlow

```bash
cd frontend
npm install
npm run dev
```

## Backend

Node.js · Fastify · PostgreSQL/pgvector · Redis · Neo4j · VoyageAI embeddings

```bash
cd backend
npm install
npm run migrate
npm run dev
```

## Server

OpenClaw Cash memory proxy — bridges the core agent with the memory service.

```bash
node server/openclaw-cash-server.mjs
```

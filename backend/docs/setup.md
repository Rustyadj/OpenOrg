# Setup

## Prerequisites

- Node.js 20+
- PostgreSQL with `uuid-ossp` and `pgvector`
- Neo4j Community
- Redis

## Environment Variables

| Variable | Required | Example |
| --- | --- | --- |
| `DATABASE_URL` | yes | `postgresql://openclaw:openclaw@openclaw-pgvector:5435/openclaw` |
| `NEO4J_URI` | yes | `bolt://openclaw-neo4j:7687` |
| `NEO4J_USER` | yes | `neo4j` |
| `NEO4J_PASSWORD` | yes | `openclaw` |
| `REDIS_URL` | yes | `redis://localhost:6379` |
| `OPENAI_API_KEY` | for LLM routes | injected secret |
| `MEMORY_SERVICE_PORT` | no | `4000` |
| `AUTH_TOKEN` | optional | bearer token for non-health routes |
| `MEMORY_SERVICE_TOKEN` | optional | alternate bearer token name |
| `SECURITY_TOKEN` | yes for security routes | header `X-Security-Token` |

## Commands

```bash
npm install
npm run migrate
npm run dev
```

The service listens on `MEMORY_SERVICE_PORT`, defaulting to port `4000`.

## Docker Compose

Use the existing platform compose file to start PostgreSQL/pgvector, Neo4j, and Redis. After those services are healthy, run migrations from this project.

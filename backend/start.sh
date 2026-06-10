#!/bin/bash
set -e

export DATABASE_URL="postgresql://openclaw:openclaw@localhost:5435/openclaw"
export NEO4J_URI="bolt://localhost:7687"
export NEO4J_USER="neo4j"
export NEO4J_PASSWORD="openclaw"
export REDIS_URL="redis://localhost:6380"
export MEMORY_SERVICE_PORT=4000
export AUTH_TOKEN="openclaw-memory-secret"
export SECURITY_TOKEN="openclaw-memory-secret"
export VOYAGE_API_KEY="pa-Jjh5vQLSHHvQ6nzGVDig801fNdn3OPPQ5_nkZLhlE2E"

cd "$(dirname "$0")"
exec node dist/index.js

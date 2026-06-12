#!/usr/bin/env bash
# Hermes-Lisa VPS setup — run once on a fresh Hostinger VPS
# Usage: bash setup.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HERMES_DIR="$REPO_DIR/hermes"

echo "==> Checking Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | bash
fi

echo "==> Checking Docker Compose plugin..."
docker compose version &>/dev/null || (
  apt-get install -y docker-compose-plugin 2>/dev/null || true
)

echo "==> Ensuring openorg network exists..."
docker network create openorg 2>/dev/null || true

echo "==> Checking .env..."
if [[ ! -f "$HERMES_DIR/.env" ]]; then
  cp "$HERMES_DIR/.env.example" "$HERMES_DIR/.env"
  echo ""
  echo "  !! .env created from template. Fill in secrets before continuing:"
  echo "     $HERMES_DIR/.env"
  echo ""
  echo "  Required:"
  echo "    ANTHROPIC_API_KEY"
  echo "    HERMES_SECRET_KEY        (run: openssl rand -hex 32)"
  echo "    HERMES_DASH_SECRET_KEY   (run: openssl rand -hex 32)"
  echo ""
  echo "  Then re-run: bash setup.sh"
  exit 1
fi

source "$HERMES_DIR/.env"

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "ERROR: ANTHROPIC_API_KEY is not set in .env"
  exit 1
fi
if [[ -z "${HERMES_SECRET_KEY:-}" ]]; then
  echo "ERROR: HERMES_SECRET_KEY is not set in .env"
  exit 1
fi

echo "==> Pulling images..."
cd "$HERMES_DIR"
docker compose pull

echo "==> Starting Hermes-Lisa services..."
docker compose up -d

echo "==> Waiting for Lisa to be ready..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8080/health &>/dev/null; then
    break
  fi
  sleep 3
done

echo ""
echo "==> Done. Services running:"
docker compose ps

echo ""
echo "  Lisa:      https://hermes.srv1427612.hstgr.cloud"
echo "  Dashboard: https://hermes-dash.srv1427612.hstgr.cloud"
echo ""
echo "  Run inhale.sh to load the Lisa agent configuration."

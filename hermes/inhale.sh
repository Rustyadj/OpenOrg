#!/usr/bin/env bash
# inhale.sh — Load the Lisa agent + all skills into the running Hermes instance
# Usage: bash inhale.sh
set -euo pipefail

HERMES_DIR="$(cd "$(dirname "$0")" && pwd)"
LISA_DIR="$HERMES_DIR/lisa"

source "$HERMES_DIR/.env"

WEBUI_URL="http://localhost:8080"
API="$WEBUI_URL/api/v1"

echo "==> Inhaling Hermes Lisa..."
echo "    Target: $WEBUI_URL"

# --- Get or create admin token ---
echo "==> Authenticating..."
TOKEN_RESP=$(curl -sf -X POST "$API/auths/signin" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@openorg.ai","password":"'"${HERMES_SECRET_KEY}"'"}' 2>/dev/null || true)

if [[ -z "$TOKEN_RESP" ]] || echo "$TOKEN_RESP" | grep -q '"detail"'; then
  echo "    Creating admin account..."
  curl -sf -X POST "$API/auths/signup" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "Admin",
      "email": "admin@openorg.ai",
      "password": "'"${HERMES_SECRET_KEY}"'"
    }' >/dev/null

  TOKEN_RESP=$(curl -sf -X POST "$API/auths/signin" \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@openorg.ai","password":"'"${HERMES_SECRET_KEY}"'"}')
fi

TOKEN=$(echo "$TOKEN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
AUTH="Authorization: Bearer $TOKEN"

# --- Load system prompt ---
echo "==> Loading Lisa system prompt..."
SYSTEM_PROMPT=$(cat "$LISA_DIR/system-prompt.md")

# --- Create / update the Lisa model ---
echo "==> Registering Lisa agent model..."
AGENT_JSON=$(cat "$LISA_DIR/agent.json")
MODEL_ID=$(echo "$AGENT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['meta']['agent_url'].split('//')[1])")

curl -sf -X POST "$API/models/create" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "lisa-cmo",
    "name": "Lisa",
    "base_model_id": "claude-sonnet-4-6",
    "params": {
      "system": '"$(echo "$SYSTEM_PROMPT" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")"',
      "temperature": 0.7,
      "top_p": 0.9,
      "max_tokens": 4096
    },
    "meta": {
      "description": "Chief Marketing Officer — Andrea'\''s agent",
      "profile_image_url": "",
      "capabilities": {
        "vision": false,
        "usage": true
      },
      "tags": ["cmo", "marketing", "lisa", "openorg"]
    }
  }' >/dev/null && echo "    Lisa model registered." || echo "    (Model may already exist — continuing)"

# --- Report skills ---
echo ""
echo "==> Skills loaded from $LISA_DIR/skills/:"
for skill_file in "$LISA_DIR/skills/"*.json; do
  skill_name=$(python3 -c "import json; d=json.load(open('$skill_file')); print(d['name'])")
  skill_desc=$(python3 -c "import json; d=json.load(open('$skill_file')); print(d['description'][:60])")
  echo "    [+] $skill_name — $skill_desc..."
done

echo ""
echo "==> Verifying connectivity to memory service..."
MEM_HEALTH=$(curl -sf "${MEMORY_API_URL:-http://openclaw-memory-service:4000}/health" 2>/dev/null && echo "ok" || echo "unreachable")
echo "    Memory service: $MEM_HEALTH"

echo ""
echo "==> Lisa is ready."
echo "    https://hermes.srv1427612.hstgr.cloud"
echo ""
echo "    Login:    admin@openorg.ai"
echo "    Password: (your HERMES_SECRET_KEY)"
echo ""
echo "    Select model 'Lisa' to start a session."

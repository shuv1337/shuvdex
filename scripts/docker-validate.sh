#!/usr/bin/env bash
# =============================================================================
# docker-validate.sh — smoke-test the docker compose stack end-to-end
#
# Usage:
#   ./scripts/docker-validate.sh              # full build + validate + teardown
#   SKIP_BUILD=1 ./scripts/docker-validate.sh # skip build (use cached images)
#   KEEP_UP=1    ./scripts/docker-validate.sh # don't tear down on exit
#
# Requires: docker, docker compose v2, curl, jq
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SKIP_BUILD="${SKIP_BUILD:-0}"
KEEP_UP="${KEEP_UP:-0}"

MCP_PORT="${MCP_PORT:-3848}"
API_PORT="${API_PORT:-3847}"
WEB_PORT="${WEB_PORT:-5173}"

MCP_BASE="http://localhost:${MCP_PORT}"
API_BASE="http://localhost:${API_PORT}"
WEB_BASE="http://localhost:${WEB_PORT}"

PASS=0
FAIL=0
STEP=0

# ── Helpers ──────────────────────────────────────────────────────────────────

log()    { printf '\n\033[1;34m[docker-validate] %s\033[0m\n' "$*"; }
ok()     { printf '  \033[1;32m✓\033[0m  %s\n' "$*"; ((PASS++)) || true; }
fail()   { printf '  \033[1;31m✗\033[0m  %s\n' "$*"; ((FAIL++)) || true; }
step()   { ((STEP++)) || true; log "Step ${STEP}: $*"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }
}

wait_for_url() {
  local url="$1"
  local label="${2:-$url}"
  local max_attempts="${3:-60}"
  local attempt=0
  printf '  Waiting for %s' "$label"
  while ! curl -fsS "$url" -o /dev/null 2>/dev/null; do
    ((attempt++)) || true
    if [[ $attempt -ge $max_attempts ]]; then
      printf ' timeout!\n'
      return 1
    fi
    printf '.'
    sleep 2
  done
  printf ' ready\n'
  return 0
}

mcp_request() {
  local method="$1"
  local params="$2"
  local id="${3:-1}"
  curl -fsS "${MCP_BASE}/mcp" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    --data "$(jq -nc --arg m "$method" --argjson p "$params" --argjson id "$id" \
      '{jsonrpc:"2.0",id:$id,method:$m,params:$p}')"
}

cleanup() {
  if [[ "$KEEP_UP" == "1" ]]; then
    log "KEEP_UP=1 — leaving stack running"
    return
  fi
  log "Tearing down compose stack"
  docker compose down --volumes --remove-orphans 2>/dev/null || true
}

summary() {
  printf '\n'
  printf '═%.0s' {1..60}; printf '\n'
  if [[ $FAIL -eq 0 ]]; then
    printf '\033[1;32m  ALL %d CHECKS PASSED\033[0m\n' "$PASS"
  else
    printf '\033[1;31m  %d PASSED / %d FAILED\033[0m\n' "$PASS" "$FAIL"
  fi
  printf '═%.0s' {1..60}; printf '\n\n'
  [[ $FAIL -eq 0 ]]
}

# ── Main ─────────────────────────────────────────────────────────────────────

require_cmd docker
require_cmd curl
require_cmd jq

trap cleanup EXIT

# Step 1 — Build
step "Build docker compose images"
if [[ "$SKIP_BUILD" == "1" ]]; then
  log "SKIP_BUILD=1 — skipping image build"
  ok "build skipped (using cached images)"
else
  if docker compose build 2>&1 | tail -5; then
    ok "docker compose build succeeded"
  else
    fail "docker compose build failed"
    exit 1
  fi
fi

# Step 2 — Start
step "Start stack with docker compose up -d (mcp-server + api-server + web)"
if docker compose up -d mcp-server api-server web 2>&1 | tail -3; then
  ok "docker compose up -d succeeded"
else
  fail "docker compose up -d failed"
  docker compose logs --tail=30
  exit 1
fi

# Step 3 — Wait for health
step "Wait for MCP server health"
if wait_for_url "${MCP_BASE}/health" "MCP /health" 60; then
  ok "MCP server is up"
else
  fail "MCP server health timeout"
  docker compose logs mcp-server | tail -30
fi

step "Wait for API server health"
if wait_for_url "${API_BASE}/health" "API /health" 60; then
  ok "API server is up"
else
  fail "API server health timeout"
  docker compose logs api-server | tail -30
fi

step "Wait for web server"
if wait_for_url "${WEB_BASE}/health" "Web /health" 30; then
  ok "Web server is up"
else
  fail "Web server health timeout"
  docker compose logs web | tail -20
fi

# Step 4 — Health endpoint assertions
step "Validate MCP /health response"
MCP_HEALTH="$(curl -fsS "${MCP_BASE}/health")"
if echo "$MCP_HEALTH" | jq -e '.status == "ok"' >/dev/null 2>&1; then
  ok "MCP /health → status=ok"
else
  fail "MCP /health missing status=ok (got: $MCP_HEALTH)"
fi
if echo "$MCP_HEALTH" | jq -e '.service == "shuvdex-mcp-server"' >/dev/null 2>&1; then
  ok "MCP /health → service=shuvdex-mcp-server"
else
  fail "MCP /health missing service field"
fi

step "Validate API /health response"
API_HEALTH="$(curl -fsS "${API_BASE}/health")"
if echo "$API_HEALTH" | jq -e '.status == "ok"' >/dev/null 2>&1; then
  ok "API /health → status=ok"
else
  fail "API /health missing status=ok (got: $API_HEALTH)"
fi

step "Validate Web /health response (nginx)"
WEB_HEALTH="$(curl -fsS "${WEB_BASE}/health")"
if echo "$WEB_HEALTH" | jq -e '.status == "ok"' >/dev/null 2>&1; then
  ok "Web /health → status=ok"
else
  fail "Web /health missing status=ok (got: $WEB_HEALTH)"
fi

# Step 5 — Web proxies work
step "Validate Web → API proxy (/api/health via nginx)"
PROXY_HEALTH="$(curl -fsS "${WEB_BASE}/api/health" 2>/dev/null)" || true
if echo "$PROXY_HEALTH" | jq -e '.status == "ok"' >/dev/null 2>&1; then
  ok "Web nginx /api/health proxy → ok"
else
  fail "Web nginx /api/health proxy failed (got: $PROXY_HEALTH)"
fi

# Step 6 — Basic MCP protocol
step "MCP initialize handshake"
INIT_JSON="$(mcp_request 'initialize' \
  '{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"docker-validate","version":"0.0.0"}}' \
  1 2>/dev/null)" || INIT_JSON="{}"
if echo "$INIT_JSON" | jq -e '.result.serverInfo.name == "shuvdex"' >/dev/null 2>&1; then
  ok "MCP initialize → serverInfo.name=shuvdex"
else
  fail "MCP initialize failed (got: $INIT_JSON)"
fi

step "MCP tools/list (expect at least 0 tools without seeds)"
TOOLS_JSON="$(mcp_request 'tools/list' '{}' 2 2>/dev/null)" || TOOLS_JSON="{}"
if echo "$TOOLS_JSON" | jq -e '.result.tools | type == "array"' >/dev/null 2>&1; then
  TOOL_COUNT="$(echo "$TOOLS_JSON" | jq '.result.tools | length')"
  ok "MCP tools/list → ${TOOL_COUNT} tool(s) returned"
else
  fail "MCP tools/list did not return an array (got: $TOOLS_JSON)"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
summary

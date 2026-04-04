#!/usr/bin/env bash
# Check the health of all shuvdex services: admin API and MCP server.
#
# Usage:
#   ./scripts/ops/health-check.sh [options]
#
# Options:
#   --host <host>     Override the target hostname (default: localhost)
#   --api-port <n>    Admin API port   (default: 3847)
#   --mcp-port <n>    MCP server port  (default: 3848)
#   --json            Output results as JSON
#   --quiet           Only print on failure (exit 0 = all healthy)
#   --mcp-init        Also run a minimal MCP initialize probe
#   -h, --help        Show this help
#
# Environment:
#   SHUVDEX_API_URL   Override full API base URL
#   SHUVDEX_MCP_URL   Override full MCP base URL
#   SHUVDEX_TOKEN     Bearer token for API auth
#
# Exit codes:
#   0   All checked services are healthy
#   1   One or more services are unhealthy or unreachable

set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

log_ok()    { printf "${GREEN}[ok]${RESET}    %s\n" "$*"; }
log_warn()  { printf "${YELLOW}[warn]${RESET}  %s\n" "$*"; }
log_error() { printf "${RED}[error]${RESET} %s\n" "$*"; }
log_info()  { printf "${CYAN}[info]${RESET}  %s\n" "$*" >&2; }

die() {
  printf "${RED}[fatal]${RESET} %s\n" "$1" >&2
  exit 1
}

usage() {
  cat >&2 <<EOF

${BOLD}Usage:${RESET} $(basename "$0") [options]

Check health of shuvdex admin API and MCP server.

${BOLD}Options:${RESET}
  --host <host>    Target hostname  (default: localhost)
  --api-port <n>   Admin API port   (default: 3847)
  --mcp-port <n>   MCP server port  (default: 3848)
  --json           JSON output
  --quiet          Silent on success; print only on failure
  --mcp-init       Run a minimal MCP initialize probe
  -h, --help       Show this help

${BOLD}Environment:${RESET}
  SHUVDEX_API_URL   Full API base URL  (overrides --host/--api-port)
  SHUVDEX_MCP_URL   Full MCP base URL  (overrides --host/--mcp-port)
  SHUVDEX_TOKEN     Bearer token for API auth

${BOLD}Examples:${RESET}
  $(basename "$0")
  $(basename "$0") --host shuvdev
  $(basename "$0") --host shuvdev --mcp-init
  $(basename "$0") --json | jq .

EOF
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

require_cmd curl
require_cmd jq

# ---------------------------------------------------------------------------
# Cross-platform millisecond timestamp
# macOS BSD date does not support %N; fall back to Python3 then seconds*1000
# ---------------------------------------------------------------------------

ms_now() {
  local v
  # GNU date
  v="$(date +%s%3N 2>/dev/null)"
  if [[ "$v" =~ ^[0-9]+$ ]]; then printf '%s' "$v"; return; fi
  # Python3
  v="$(python3 -c 'import time; print(int(time.time()*1000))' 2>/dev/null)"
  if [[ "$v" =~ ^[0-9]+$ ]]; then printf '%s' "$v"; return; fi
  # Fallback: seconds * 1000 (no sub-second precision)
  printf '%s' "$(( $(date +%s) * 1000 ))"
}

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------

HOST="localhost"
API_PORT="3847"
MCP_PORT="3848"
JSON_OUTPUT=0
QUIET=0
MCP_INIT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)      HOST="$2";     shift 2 ;;
    --api-port)  API_PORT="$2"; shift 2 ;;
    --mcp-port)  MCP_PORT="$2"; shift 2 ;;
    --json)      JSON_OUTPUT=1; shift ;;
    --quiet)     QUIET=1;       shift ;;
    --mcp-init)  MCP_INIT=1;    shift ;;
    -h|--help)   usage ;;
    *) die "Unknown option: $1" ;;
  esac
done

API_URL="${SHUVDEX_API_URL:-http://${HOST}:${API_PORT}}"
MCP_URL="${SHUVDEX_MCP_URL:-http://${HOST}:${MCP_PORT}}"

AUTH_ARGS=()
if [[ -n "${SHUVDEX_TOKEN:-}" ]]; then
  AUTH_ARGS+=(-H "Authorization: Bearer ${SHUVDEX_TOKEN}")
fi

# ---------------------------------------------------------------------------
# Probe functions
# ---------------------------------------------------------------------------

RESULTS=()
OVERALL_OK=1

probe_http() {
  local name="$1" url="$2"
  local start_ms end_ms latency_ms http_code body status_val result_detail

  start_ms="$(ms_now)"

  local response
  response="$(curl -s -w "\n%{http_code}" --max-time 5 "$url" "${AUTH_ARGS[@]}" 2>/dev/null)" || {
    end_ms="$(ms_now)"
    RESULTS+=("{\"service\":\"${name}\",\"url\":\"${url}\",\"status\":\"unreachable\",\"latencyMs\":$((end_ms - start_ms)),\"ok\":false}")
    OVERALL_OK=0
    return 0
  }

  end_ms="$(ms_now)"
  latency_ms=$(( end_ms - start_ms ))

  http_code="$(printf '%s' "$response" | tail -n1)"
  body="$(printf '%s' "$response" | head -n -1)"

  if [[ "$http_code" == "200" ]]; then
    status_val="$(printf '%s\n' "$body" | jq -r '.status // "ok"' 2>/dev/null || echo "ok")"
    result_detail="$(printf '%s\n' "$body" | jq -c '{version,capabilitiesDir,status} | with_entries(select(.value != null))' 2>/dev/null || echo "{}")"
    RESULTS+=("{\"service\":\"${name}\",\"url\":\"${url}\",\"status\":\"${status_val}\",\"latencyMs\":${latency_ms},\"ok\":true,\"detail\":${result_detail}}")
  else
    OVERALL_OK=0
    RESULTS+=("{\"service\":\"${name}\",\"url\":\"${url}\",\"status\":\"error\",\"httpCode\":${http_code},\"latencyMs\":${latency_ms},\"ok\":false}")
  fi
}

probe_mcp_initialize() {
  local url="${MCP_URL}/mcp"
  local start_ms end_ms latency_ms http_code body server_name protocol

  local INIT_PAYLOAD='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"health-check","version":"0.0.0"}}}'

  start_ms="$(ms_now)"

  local response
  response="$(curl -s -w "\n%{http_code}" --max-time 10 \
    -X POST "$url" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    "${AUTH_ARGS[@]}" \
    -d "$INIT_PAYLOAD" 2>/dev/null)" || {
    end_ms="$(ms_now)"
    RESULTS+=("{\"service\":\"mcp-initialize\",\"url\":\"${url}\",\"status\":\"unreachable\",\"latencyMs\":$((end_ms - start_ms)),\"ok\":false}")
    OVERALL_OK=0
    return 0
  }

  end_ms="$(ms_now)"
  latency_ms=$(( end_ms - start_ms ))

  http_code="$(printf '%s' "$response" | tail -n1)"
  body="$(printf '%s' "$response" | head -n -1)"

  if [[ "$http_code" == "200" ]]; then
    server_name="$(printf '%s\n' "$body" | jq -r '.result.serverInfo.name // "unknown"' 2>/dev/null || echo "unknown")"
    protocol="$(printf '%s\n' "$body" | jq -r '.result.protocolVersion // "unknown"' 2>/dev/null || echo "unknown")"
    RESULTS+=("{\"service\":\"mcp-initialize\",\"url\":\"${url}\",\"status\":\"ok\",\"serverName\":\"${server_name}\",\"protocolVersion\":\"${protocol}\",\"latencyMs\":${latency_ms},\"ok\":true}")
  else
    OVERALL_OK=0
    RESULTS+=("{\"service\":\"mcp-initialize\",\"url\":\"${url}\",\"status\":\"error\",\"httpCode\":${http_code},\"latencyMs\":${latency_ms},\"ok\":false}")
  fi
}

probe_package_count() {
  local count active_caps http_code body_pkg response

  response="$(curl -s -w "\n%{http_code}" --max-time 5 \
    "${API_URL}/api/packages" "${AUTH_ARGS[@]}" 2>/dev/null)" || return 0

  http_code="$(printf '%s' "$response" | tail -n1)"
  body_pkg="$(printf '%s' "$response" | head -n -1)"

  if [[ "$http_code" == "200" ]]; then
    count="$(printf '%s\n' "$body_pkg" | jq 'length' 2>/dev/null || echo 0)"
    active_caps="$(printf '%s\n' "$body_pkg" | \
      jq '[.[] | .capabilities | map(select(.enabled == true)) | length] | add // 0' 2>/dev/null || echo 0)"
    RESULTS+=("{\"service\":\"api-packages\",\"packageCount\":${count},\"activeCapabilities\":${active_caps},\"ok\":true}")
  fi
}

# ---------------------------------------------------------------------------
# Run probes
# ---------------------------------------------------------------------------

probe_http "api-health" "${API_URL}/health"
probe_http "mcp-health" "${MCP_URL}/health"

if [[ "$MCP_INIT" == "1" ]]; then
  probe_mcp_initialize
fi

probe_package_count

# ---------------------------------------------------------------------------
# Format output
# ---------------------------------------------------------------------------

RESULTS_JSON="[$(IFS=','; echo "${RESULTS[*]}")]"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ "$JSON_OUTPUT" == "1" ]]; then
  jq -n \
    --argjson results "$RESULTS_JSON" \
    --arg timestamp "$TIMESTAMP" \
    --argjson ok "$OVERALL_OK" \
    '{timestamp: $timestamp, healthy: ($ok == 1), results: $results}'
  exit $((1 - OVERALL_OK))
fi

if [[ "$QUIET" == "1" && "$OVERALL_OK" == "1" ]]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Human-readable table
# ---------------------------------------------------------------------------

printf '\n'
printf "${BOLD}shuvdex health check${RESET}  —  %s\n\n" "$TIMESTAMP"
printf "${BOLD}%-20s  %-40s  %-10s  %s${RESET}\n" "SERVICE" "URL" "LATENCY" "STATUS"
printf '%0.s─' {1..80}; printf '\n'

for result in "${RESULTS[@]}"; do
  service="$(printf '%s' "$result" | jq -r '.service')"
  url_raw="$(printf '%s' "$result" | jq -r '.url // ""')"
  latency="$(printf '%s' "$result" | jq -r 'if .latencyMs then "\(.latencyMs)ms" else "—" end')"
  ok="$(printf '%s' "$result" | jq -r '.ok')"
  status_str="$(printf '%s' "$result" | jq -r '.status // "—"')"
  extra=""

  if [[ "$service" == "api-packages" ]]; then
    pkg_count="$(printf '%s' "$result" | jq -r '.packageCount // 0')"
    cap_count="$(printf '%s' "$result" | jq -r '.activeCapabilities // 0')"
    url_raw="${API_URL}/api/packages"
    latency="—"
    status_str="${pkg_count} pkgs / ${cap_count} caps"
    ok="true"
  fi

  if [[ "$service" == "mcp-initialize" ]]; then
    srv_name="$(printf '%s' "$result" | jq -r '.serverName // ""')"
    proto="$(printf '%s' "$result" | jq -r '.protocolVersion // ""')"
    [[ -n "$srv_name" ]] && extra=" (${srv_name} / ${proto})"
  fi

  url_display="${url_raw}"
  [[ ${#url_raw} -gt 38 ]] && url_display="${url_raw:0:35}..."

  if [[ "$ok" == "true" ]]; then
    printf "%-20s  %-40s  %-10s  ${GREEN}%-8s${RESET}%s\n" \
      "$service" "$url_display" "$latency" "$status_str" "$extra"
  else
    printf "%-20s  %-40s  %-10s  ${RED}%-8s${RESET}\n" \
      "$service" "$url_display" "$latency" "$status_str"
  fi
done

printf '%0.s─' {1..80}; printf '\n'
printf '\n'

if [[ "$OVERALL_OK" == "1" ]]; then
  printf "${GREEN}${BOLD}All services healthy.${RESET}\n\n"
else
  printf "${RED}${BOLD}One or more services are unhealthy.${RESET}\n\n"
  exit 1
fi

#!/usr/bin/env bash
# Check health of all registered upstreams via the shuvdex API.
#
# Reports:
#   - Health status per upstream (healthy / degraded / unhealthy / unknown)
#   - Trust state (trusted / untrusted / suspended / pending_review)
#   - Last sync timestamp
#   - Tool count
#   - Mutation flags
#
# Usage:
#   ./scripts/ops/upstream-health-check.sh [options]
#
# Options:
#   --host <host>       API hostname (default: localhost)
#   --port <n>          API port     (default: 3847)
#   --json              Output JSON instead of table
#   --sync              Trigger a sync of all upstreams before reporting
#   --quiet             Exit non-zero on any unhealthy/suspicious upstream; no output on clean
#   -h, --help          Show this help
#
# Environment:
#   SHUVDEX_API_URL     Override full API base URL
#   SHUVDEX_TOKEN       Bearer token for API auth
#
# Exit codes:
#   0   All upstreams healthy and trusted
#   1   One or more upstreams unhealthy, suspended, or mutated

set -euo pipefail

# ---------------------------------------------------------------------------
# Colours
# ---------------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

log_info() { printf "${CYAN}[info]${RESET}  %s\n" "$*" >&2; }
log_warn() { printf "${YELLOW}[warn]${RESET}  %s\n" "$*" >&2; }
log_error() { printf "${RED}[error]${RESET} %s\n" "$*" >&2; }

die() {
  log_error "$1"
  exit 1
}

usage() {
  cat >&2 <<EOF

${BOLD}Usage:${RESET} $(basename "$0") [options]

Check health of all registered shuvdex upstreams.

${BOLD}Options:${RESET}
  --host <host>    API hostname   (default: localhost)
  --port <n>       API port       (default: 3847)
  --json           Output as JSON
  --sync           Trigger sync on all upstreams first
  --quiet          Silent on success; exit 1 on any problem
  -h, --help       Show this help

${BOLD}Environment:${RESET}
  SHUVDEX_API_URL   Full API base URL
  SHUVDEX_TOKEN     Bearer token for API auth

${BOLD}Examples:${RESET}
  $(basename "$0")
  $(basename "$0") --host shuvdev --sync
  $(basename "$0") --json | jq '.summary'

EOF
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

require_cmd curl
require_cmd jq

# ---------------------------------------------------------------------------
# Cross-platform ms timestamp
# ---------------------------------------------------------------------------

ms_now() {
  local v
  v="$(date +%s%3N 2>/dev/null)"
  if [[ "$v" =~ ^[0-9]+$ ]]; then printf '%s' "$v"; return; fi
  v="$(python3 -c 'import time; print(int(time.time()*1000))' 2>/dev/null)"
  if [[ "$v" =~ ^[0-9]+$ ]]; then printf '%s' "$v"; return; fi
  printf '%s' "$(( $(date +%s) * 1000 ))"
}

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------

HOST="localhost"
PORT="3847"
JSON_OUTPUT=0
DO_SYNC=0
QUIET=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)   HOST="$2";  shift 2 ;;
    --port)   PORT="$2";  shift 2 ;;
    --json)   JSON_OUTPUT=1; shift ;;
    --sync)   DO_SYNC=1;  shift ;;
    --quiet)  QUIET=1;    shift ;;
    -h|--help) usage ;;
    *) die "Unknown option: $1" ;;
  esac
done

API_URL="${SHUVDEX_API_URL:-http://${HOST}:${PORT}}"

AUTH_ARGS=()
if [[ -n "${SHUVDEX_TOKEN:-}" ]]; then
  AUTH_ARGS+=(-H "Authorization: Bearer ${SHUVDEX_TOKEN}")
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

api_get() {
  local path="$1"
  curl -s --max-time 15 "${AUTH_ARGS[@]}" "${API_URL}${path}"
}

api_post() {
  local path="$1"
  curl -s -X POST --max-time 30 "${AUTH_ARGS[@]}" \
    -H "Content-Type: application/json" \
    "${API_URL}${path}"
}

# Relative time formatting (e.g. "2h ago", "3d ago")
relative_time() {
  local iso_ts="$1"
  local now_s
  now_s="$(date +%s)"

  local ts_s
  # Try GNU date first, then BSD date
  ts_s="$(date -d "$iso_ts" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "${iso_ts%%.*}" +%s 2>/dev/null || echo 0)"

  local diff=$(( now_s - ts_s ))

  if   [[ $diff -lt 120 ]];        then echo "${diff}s ago"
  elif [[ $diff -lt 7200 ]];       then echo "$(( diff / 60 ))m ago"
  elif [[ $diff -lt 172800 ]];     then echo "$(( diff / 3600 ))h ago"
  else                                  echo "$(( diff / 86400 ))d ago"
  fi
}

# ---------------------------------------------------------------------------
# Fetch upstream list
# ---------------------------------------------------------------------------

log_info "Fetching upstreams from ${API_URL}/api/upstreams"

UPSTREAMS_RESPONSE="$(api_get "/api/upstreams" 2>/dev/null)" || die "Failed to reach API at ${API_URL}"

UPSTREAM_COUNT="$(echo "$UPSTREAMS_RESPONSE" | jq 'length' 2>/dev/null || echo 0)"

if [[ "$UPSTREAM_COUNT" == "0" ]]; then
  if [[ "$QUIET" == "1" ]]; then exit 0; fi
  printf "\n${DIM}No upstreams registered.${RESET}\n\n"
  exit 0
fi

# ---------------------------------------------------------------------------
# Optional: trigger sync on all upstreams
# ---------------------------------------------------------------------------

if [[ "$DO_SYNC" == "1" ]]; then
  log_info "Triggering sync on ${UPSTREAM_COUNT} upstream(s)..."
  UPSTREAM_IDS="$(echo "$UPSTREAMS_RESPONSE" | jq -r '.[].upstreamId')"

  while IFS= read -r upstream_id; do
    sync_result="$(api_post "/api/upstreams/${upstream_id}/sync" 2>/dev/null)" || {
      log_warn "Sync failed for upstream: ${upstream_id}"
      continue
    }
    mutation="$(echo "$sync_result" | jq -r '.mutationDetected // false' 2>/dev/null)"
    changed_count="$(echo "$sync_result" | jq '.changed | length' 2>/dev/null || echo 0)"
    if [[ "$mutation" == "true" ]]; then
      log_warn "MUTATION DETECTED on upstream: ${upstream_id}"
    elif [[ "$changed_count" -gt 0 ]]; then
      log_info "Upstream ${upstream_id}: ${changed_count} tool(s) changed"
    fi
  done <<< "$UPSTREAM_IDS"

  # Re-fetch with updated data
  UPSTREAMS_RESPONSE="$(api_get "/api/upstreams" 2>/dev/null)"
fi

# ---------------------------------------------------------------------------
# Analyse results
# ---------------------------------------------------------------------------

OVERALL_OK=1
RESULTS_JSON="[]"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Build per-upstream analysis
RESULTS_JSON="$(echo "$UPSTREAMS_RESPONSE" | jq -c '[.[] | {
  upstreamId: .upstreamId,
  name: (.name // .upstreamId),
  namespace: .namespace,
  transport: .transport,
  healthStatus: (.healthStatus // "unknown"),
  trustState: (.trustState // "unknown"),
  lastSync: (.lastCapabilitySync // null),
  toolCount: (.toolCount // 0),
  updatedAt: (.updatedAt // null),
  ok: ((.healthStatus == "healthy") and (.trustState == "trusted" or .trustState == "untrusted"))
}]' 2>/dev/null)"

# Check overall ok
UNHEALTHY_COUNT="$(echo "$RESULTS_JSON" | jq '[.[] | select(.ok == false)] | length' 2>/dev/null || echo 0)"
SUSPENDED_COUNT="$(echo "$RESULTS_JSON" | jq '[.[] | select(.trustState == "suspended")] | length' 2>/dev/null || echo 0)"

if [[ "$UNHEALTHY_COUNT" -gt 0 ]] || [[ "$SUSPENDED_COUNT" -gt 0 ]]; then
  OVERALL_OK=0
fi

# ---------------------------------------------------------------------------
# JSON output
# ---------------------------------------------------------------------------

if [[ "$JSON_OUTPUT" == "1" ]]; then
  jq -n \
    --argjson upstreams "$RESULTS_JSON" \
    --arg timestamp "$TIMESTAMP" \
    --argjson total "$UPSTREAM_COUNT" \
    --argjson unhealthy "$UNHEALTHY_COUNT" \
    --argjson suspended "$SUSPENDED_COUNT" \
    --argjson ok "$OVERALL_OK" \
    '{
      timestamp: $timestamp,
      healthy: ($ok == 1),
      summary: {
        total: $total,
        unhealthy: $unhealthy,
        suspended: $suspended
      },
      upstreams: $upstreams
    }'
  exit $((1 - OVERALL_OK))
fi

# ---------------------------------------------------------------------------
# Quiet mode
# ---------------------------------------------------------------------------

if [[ "$QUIET" == "1" && "$OVERALL_OK" == "1" ]]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Human-readable table
# ---------------------------------------------------------------------------

printf '\n'
printf "${BOLD}shuvdex upstream health${RESET}  —  %s\n\n" "$TIMESTAMP"
printf "${BOLD}%-20s  %-12s  %-10s  %-16s  %-8s  %-10s  %s${RESET}\n" \
  "UPSTREAM" "NAMESPACE" "TRANSPORT" "TRUST" "TOOLS" "LAST SYNC" "HEALTH"
printf '%0.s─' {1..100}; printf '\n'

# Parse and display each upstream
while IFS= read -r upstream_json; do
  name="$(echo "$upstream_json" | jq -r '.name')"
  namespace="$(echo "$upstream_json" | jq -r '.namespace')"
  transport="$(echo "$upstream_json" | jq -r '.transport')"
  health="$(echo "$upstream_json" | jq -r '.healthStatus')"
  trust="$(echo "$upstream_json" | jq -r '.trustState')"
  tool_count="$(echo "$upstream_json" | jq -r '.toolCount')"
  last_sync_raw="$(echo "$upstream_json" | jq -r '.lastSync // ""')"
  ok="$(echo "$upstream_json" | jq -r '.ok')"

  # Truncate long names
  name_display="${name}"
  [[ ${#name} -gt 18 ]] && name_display="${name:0:15}..."

  namespace_display="${namespace}"
  [[ ${#namespace} -gt 10 ]] && namespace_display="${namespace:0:7}..."

  # Relative time
  last_sync_display="—"
  if [[ -n "$last_sync_raw" && "$last_sync_raw" != "null" ]]; then
    last_sync_display="$(relative_time "$last_sync_raw" 2>/dev/null || echo "${last_sync_raw:0:10}")"
  fi

  # Colour-code trust state
  trust_display="${trust}"
  case "$trust" in
    "trusted")       trust_colored="${GREEN}${trust_display}${RESET}" ;;
    "untrusted")     trust_colored="${YELLOW}${trust_display}${RESET}" ;;
    "suspended")     trust_colored="${RED}${trust_display}${RESET}" ;;
    "pending_review") trust_colored="${YELLOW}${trust_display}${RESET}" ;;
    *)               trust_colored="${DIM}${trust_display}${RESET}" ;;
  esac

  # Colour-code health
  case "$health" in
    "healthy")   health_colored="${GREEN}${health}${RESET}" ;;
    "degraded")  health_colored="${YELLOW}${health}${RESET}" ;;
    "unhealthy") health_colored="${RED}${health}${RESET}" ;;
    *)           health_colored="${DIM}${health}${RESET}" ;;
  esac

  # Mutation flag
  mutation_flag=""
  if [[ "$trust" == "suspended" ]]; then
    mutation_flag=" ${RED}⚠ MUTATION${RESET}"
  fi

  printf "%-20s  %-12s  %-10s  " "$name_display" "$namespace_display" "$transport"
  printf "%-25b  %-8s  %-10s  " "$trust_colored" "$tool_count" "$last_sync_display"
  printf "%b%b\n" "$health_colored" "$mutation_flag"

done < <(echo "$RESULTS_JSON" | jq -c '.[]')

printf '%0.s─' {1..100}; printf '\n'
printf '\n'

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

printf "${BOLD}Summary:${RESET} %d upstream(s) total" "$UPSTREAM_COUNT"

if [[ "$UNHEALTHY_COUNT" -gt 0 ]]; then
  printf ",  ${RED}${BOLD}%d unhealthy${RESET}" "$UNHEALTHY_COUNT"
fi
if [[ "$SUSPENDED_COUNT" -gt 0 ]]; then
  printf ",  ${RED}${BOLD}%d suspended (mutation)${RESET}" "$SUSPENDED_COUNT"
fi
if [[ "$OVERALL_OK" == "1" ]]; then
  printf ",  ${GREEN}all healthy${RESET}"
fi
printf '\n\n'

# ---------------------------------------------------------------------------
# Actionable hints
# ---------------------------------------------------------------------------

if [[ "$SUSPENDED_COUNT" -gt 0 ]]; then
  printf "${YELLOW}${BOLD}Suspended upstreams require attention:${RESET}\n"
  echo "$RESULTS_JSON" | jq -r '.[] | select(.trustState == "suspended") | "  • \(.name) (\(.upstreamId))"'
  printf "\nSee the connection-maintenance runbook for remediation steps:\n"
  printf "  docs/runbooks/connection-maintenance.md\n\n"
fi

if [[ "$UNHEALTHY_COUNT" -gt 0 ]]; then
  printf "${YELLOW}${BOLD}Unhealthy upstreams:${RESET}\n"
  echo "$RESULTS_JSON" | jq -r '.[] | select(.healthStatus != "healthy") | "  • \(.name) → \(.healthStatus)"'
  printf '\n'
fi

# No-sync hint
STALE_COUNT="$(echo "$RESULTS_JSON" | jq '[.[] | select(.lastSync == null or .lastSync == "")] | length' 2>/dev/null || echo 0)"
if [[ "$STALE_COUNT" -gt 0 ]]; then
  printf "${DIM}%d upstream(s) have never been synced. Run with --sync to trigger.${RESET}\n\n" "$STALE_COUNT"
fi

exit $((1 - OVERALL_OK))

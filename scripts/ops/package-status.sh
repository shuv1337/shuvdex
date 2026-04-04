#!/usr/bin/env bash
# Show status of all registered packages with capability counts and enabled state.
#
# Usage:
#   ./scripts/ops/package-status.sh [options]
#
# Options:
#   --enabled-only    Show only enabled packages
#   --disabled-only   Show only packages with at least one disabled capability
#   --json            Output raw JSON instead of formatted table
#   --refresh         Force reindex before listing
#   -h, --help        Show this help message
#
# Environment:
#   SHUVDEX_API_URL   Admin API base URL  (default: http://localhost:3847)
#   SHUVDEX_TOKEN     Bearer token for API auth

set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

log_info()  { printf "${CYAN}[info]${RESET}  %s\n" "$*" >&2; }
log_ok()    { printf "${GREEN}[ok]${RESET}    %s\n" "$*" >&2; }
log_error() { printf "${RED}[error]${RESET} %s\n" "$*" >&2; }

die() {
  log_error "$1"
  exit 1
}

usage() {
  cat >&2 <<EOF

${BOLD}Usage:${RESET} $(basename "$0") [options]

Show all registered capability packages with their status and capability counts.

${BOLD}Options:${RESET}
  --enabled-only    Only show enabled packages
  --disabled-only   Only show packages with at least one disabled capability
  --json            Raw JSON output
  --refresh         Reindex before listing
  -h, --help        Show this help

${BOLD}Environment:${RESET}
  SHUVDEX_API_URL   Admin API base URL  (default: http://localhost:3847)
  SHUVDEX_TOKEN     Bearer token for API auth

EOF
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

require_cmd curl
require_cmd jq

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------

ENABLED_ONLY=0
DISABLED_ONLY=0
JSON_OUTPUT=0
FORCE_REFRESH=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --enabled-only)  ENABLED_ONLY=1 ;;
    --disabled-only) DISABLED_ONLY=1 ;;
    --json)          JSON_OUTPUT=1 ;;
    --refresh)       FORCE_REFRESH=1 ;;
    -h|--help)       usage ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

API_URL="${SHUVDEX_API_URL:-http://localhost:3847}"

AUTH_ARGS=()
if [[ -n "${SHUVDEX_TOKEN:-}" ]]; then
  AUTH_ARGS+=(-H "Authorization: Bearer ${SHUVDEX_TOKEN}")
fi

# ---------------------------------------------------------------------------
# Reindex if requested
# ---------------------------------------------------------------------------

if [[ "$FORCE_REFRESH" == "1" ]]; then
  log_info "Reindexing packages..."
  curl -s -X POST "${API_URL}/api/packages/reindex" \
    "${AUTH_ARGS[@]}" >/dev/null
  log_ok "Reindex complete"
fi

# ---------------------------------------------------------------------------
# Fetch packages
# ---------------------------------------------------------------------------

QUERY=""
[[ "$FORCE_REFRESH" == "1" ]] || QUERY="?refresh=0"
URL="${API_URL}/api/packages${QUERY}"

PACKAGES="$(curl -s -w "\n%{http_code}" "$URL" "${AUTH_ARGS[@]}")"
HTTP_CODE="$(printf '%s' "$PACKAGES" | tail -n1)"
BODY="$(printf '%s' "$PACKAGES" | head -n -1)"

if [[ "$HTTP_CODE" != "200" ]]; then
  log_error "Failed to fetch packages (HTTP ${HTTP_CODE})"
  printf '%s\n' "$BODY" | jq . >&2 2>/dev/null || printf '%s\n' "$BODY" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Apply filters and format
# ---------------------------------------------------------------------------

FILTER="."
if [[ "$ENABLED_ONLY" == "1" ]]; then
  FILTER='. | map(select(.enabled == true))'
fi
if [[ "$DISABLED_ONLY" == "1" ]]; then
  FILTER='. | map(select(.capabilities | map(select(.enabled == false)) | length > 0))'
fi

FILTERED="$(printf '%s\n' "$BODY" | jq "$FILTER")"

if [[ "$JSON_OUTPUT" == "1" ]]; then
  printf '%s\n' "$FILTERED"
  exit 0
fi

# ---------------------------------------------------------------------------
# Formatted table output
# ---------------------------------------------------------------------------

PKG_COUNT="$(printf '%s\n' "$FILTERED" | jq 'length')"

printf '\n'
printf "${BOLD}%-40s  %-8s  %-10s  %-6s  %-6s  %s${RESET}\n" \
  "PACKAGE ID" "VERSION" "SOURCE" "TOTAL" "ACTIVE" "STATUS"
printf '%0.s─' {1..90}; printf '\n'

printf '%s\n' "$FILTERED" | jq -r '.[] |
  [
    .id,
    (.version // "—"),
    (.source.type // "unknown"),
    (.capabilities | length | tostring),
    (.capabilities | map(select(.enabled == true)) | length | tostring),
    (if .enabled == false then "DISABLED"
     elif (.capabilities | map(select(.enabled == false)) | length) > 0 then "PARTIAL"
     else "ok"
     end)
  ] | @tsv' | \
while IFS=$'\t' read -r pkg_id version source total active status; do
  # Color the status column
  case "$status" in
    ok)       status_fmt="${GREEN}${status}${RESET}" ;;
    PARTIAL)  status_fmt="${YELLOW}${status}${RESET}" ;;
    DISABLED) status_fmt="${RED}${status}${RESET}" ;;
    *)        status_fmt="${status}" ;;
  esac

  # Truncate long IDs
  if [[ ${#pkg_id} -gt 38 ]]; then
    pkg_id="${pkg_id:0:35}..."
  fi

  # Shorten source type
  case "$source" in
    local_repo)       source_short="local" ;;
    imported_archive) source_short="import" ;;
    generated)        source_short="gen" ;;
    openapi_source)   source_short="openapi" ;;
    *)                source_short="${source:0:10}" ;;
  esac

  printf "%-40s  %-8s  %-10s  %-6s  %-6s  %b\n" \
    "$pkg_id" "$version" "$source_short" "$total" "$active" "$status_fmt"
done

printf '%0.s─' {1..90}; printf '\n'
printf "${BOLD}Total packages: ${PKG_COUNT}${RESET}\n"

# Show summary counts
ENABLED_COUNT="$(printf '%s\n' "$FILTERED" | jq '[.[] | select(.enabled == true)] | length')"
PARTIAL_COUNT="$(printf '%s\n' "$FILTERED" | \
  jq '[.[] | select(.capabilities | map(select(.enabled == false)) | length > 0)] | length')"
TOTAL_CAPS="$(printf '%s\n' "$FILTERED" | jq '[.[] | .capabilities | length] | add // 0')"
ACTIVE_CAPS="$(printf '%s\n' "$FILTERED" | \
  jq '[.[] | .capabilities | map(select(.enabled == true)) | length] | add // 0')"

printf '\n'
printf "  Packages:     %s enabled" "$ENABLED_COUNT"
[[ "$PARTIAL_COUNT" -gt 0 ]] && printf ", ${YELLOW}%s partial${RESET}" "$PARTIAL_COUNT"
printf '\n'
printf "  Capabilities: %s / %s active\n" "$ACTIVE_CAPS" "$TOTAL_CAPS"
printf '\n'

# ---------------------------------------------------------------------------
# Orphan check
# ---------------------------------------------------------------------------

ORPHAN_CHECK="$(curl -s -X POST "${API_URL}/api/packages/cleanup" \
  "${AUTH_ARGS[@]}" \
  -H "Content-Type: application/json" \
  -d '{}')"
ORPHAN_COUNT="$(printf '%s\n' "$ORPHAN_CHECK" | jq '.orphans | length')"

if [[ "$ORPHAN_COUNT" -gt 0 ]]; then
  log_info "Orphaned import directories found: ${ORPHAN_COUNT}"
  printf '%s\n' "$ORPHAN_CHECK" | jq -r '.orphans[]' | while read -r orphan; do
    printf "  ${YELLOW}⚠${RESET}  %s\n" "$orphan"
  done
  printf '\n'
  printf "  To clean up: %s\n" "curl -sX POST ${API_URL}/api/packages/cleanup -d '{\"force\":true}'"
  printf '\n'
fi

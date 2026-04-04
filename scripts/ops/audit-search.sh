#!/usr/bin/env bash
# Search audit events by subject, action, capability, decision, or time range.
#
# Usage:
#   ./scripts/ops/audit-search.sh [options]
#
# Options:
#   --subject <id>      Filter by subjectId (exact match)
#   --action <action>   Filter by action: list_tools | call_tool | list_resources |
#                         read_resource | list_prompts | get_prompt
#   --capability <id>   Filter by capabilityId (exact or prefix match)
#   --package <id>      Filter by packageId (exact or prefix match)
#   --decision <d>      Filter by decision: allow | deny
#   --from <date>       Start of time range (ISO 8601, e.g. 2026-04-04T00:00:00Z)
#   --to <date>         End of time range   (ISO 8601)
#   --limit <n>         Maximum events to return (default: 50)
#   --json              Output raw JSON instead of formatted table
#   --denied-only       Shorthand for --decision deny
#   -h, --help          Show this help
#
# Environment:
#   SHUVDEX_API_URL   Admin API base URL  (default: http://localhost:3847)
#   SHUVDEX_TOKEN     Bearer token for API auth
#
# Examples:
#   ./scripts/ops/audit-search.sh --subject "user@example.com"
#   ./scripts/ops/audit-search.sh --action call_tool --decision deny
#   ./scripts/ops/audit-search.sh --from 2026-04-04T00:00:00Z --to 2026-04-04T06:00:00Z
#   ./scripts/ops/audit-search.sh --capability "openapi.quickbooks" --denied-only

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

log_info()  { printf "${CYAN}[info]${RESET}  %s\n" "$*" >&2; }
log_error() { printf "${RED}[error]${RESET} %s\n" "$*" >&2; }

die() {
  log_error "$1"
  exit 1
}

usage() {
  cat >&2 <<EOF

${BOLD}Usage:${RESET} $(basename "$0") [options]

Search audit events with optional filters.

${BOLD}Filters:${RESET}
  --subject <id>      Filter by subjectId
  --action <action>   list_tools | call_tool | list_resources | read_resource | list_prompts | get_prompt
  --capability <id>   Filter by capabilityId (prefix match)
  --package <id>      Filter by packageId (prefix match)
  --decision <d>      allow | deny
  --from <date>       Start time (ISO 8601: 2026-04-04T00:00:00Z)
  --to <date>         End time (ISO 8601)
  --limit <n>         Max results (default: 50)

${BOLD}Output:${RESET}
  --json              Raw JSON output
  --denied-only       Shorthand for --decision deny

${BOLD}Environment:${RESET}
  SHUVDEX_API_URL   Admin API base URL  (default: http://localhost:3847)
  SHUVDEX_TOKEN     Bearer token for API auth

${BOLD}Examples:${RESET}
  $(basename "$0") --subject "user@example.com"
  $(basename "$0") --action call_tool --denied-only
  $(basename "$0") --from 2026-04-04T00:00:00Z --capability "openapi.quickbooks"
  $(basename "$0") --json | jq 'group_by(.subjectId) | map({subject: .[0].subjectId, count: length})'

EOF
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

require_cmd curl
require_cmd jq

# ---------------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------------

FILTER_SUBJECT=""
FILTER_ACTION=""
FILTER_CAPABILITY=""
FILTER_PACKAGE=""
FILTER_DECISION=""
FILTER_FROM=""
FILTER_TO=""
LIMIT=50
JSON_OUTPUT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --subject)    FILTER_SUBJECT="$2";    shift 2 ;;
    --action)     FILTER_ACTION="$2";     shift 2 ;;
    --capability) FILTER_CAPABILITY="$2"; shift 2 ;;
    --package)    FILTER_PACKAGE="$2";    shift 2 ;;
    --decision)   FILTER_DECISION="$2";   shift 2 ;;
    --from)       FILTER_FROM="$2";       shift 2 ;;
    --to)         FILTER_TO="$2";         shift 2 ;;
    --limit)      LIMIT="$2";             shift 2 ;;
    --json)       JSON_OUTPUT=1;          shift ;;
    --denied-only) FILTER_DECISION="deny"; shift ;;
    -h|--help)    usage ;;
    *) die "Unknown option: $1" ;;
  esac
done

API_URL="${SHUVDEX_API_URL:-http://localhost:3847}"

AUTH_ARGS=()
if [[ -n "${SHUVDEX_TOKEN:-}" ]]; then
  AUTH_ARGS+=(-H "Authorization: Bearer ${SHUVDEX_TOKEN}")
fi

# ---------------------------------------------------------------------------
# Fetch audit events
# ---------------------------------------------------------------------------

AUDIT_RESPONSE="$(curl -s -w "\n%{http_code}" "${API_URL}/api/audit" "${AUTH_ARGS[@]}")"
HTTP_CODE="$(printf '%s' "$AUDIT_RESPONSE" | tail -n1)"
BODY="$(printf '%s' "$AUDIT_RESPONSE" | head -n -1)"

if [[ "$HTTP_CODE" != "200" ]]; then
  log_error "Failed to fetch audit events (HTTP ${HTTP_CODE})"
  printf '%s\n' "$BODY" | jq . >&2 2>/dev/null || printf '%s\n' "$BODY" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Build jq filter chain
# ---------------------------------------------------------------------------

JQ_FILTER="."

# Sort chronologically first
JQ_FILTER="${JQ_FILTER} | sort_by(.timestamp)"

# Subject filter
if [[ -n "$FILTER_SUBJECT" ]]; then
  JQ_FILTER="${JQ_FILTER} | map(select(.subjectId == \"${FILTER_SUBJECT}\"))"
fi

# Action filter
if [[ -n "$FILTER_ACTION" ]]; then
  JQ_FILTER="${JQ_FILTER} | map(select(.action == \"${FILTER_ACTION}\"))"
fi

# Capability prefix filter
if [[ -n "$FILTER_CAPABILITY" ]]; then
  JQ_FILTER="${JQ_FILTER} | map(select(.capabilityId != null and (.capabilityId | startswith(\"${FILTER_CAPABILITY}\"))))"
fi

# Package prefix filter
if [[ -n "$FILTER_PACKAGE" ]]; then
  JQ_FILTER="${JQ_FILTER} | map(select(.packageId != null and (.packageId | startswith(\"${FILTER_PACKAGE}\"))))"
fi

# Decision filter
if [[ -n "$FILTER_DECISION" ]]; then
  JQ_FILTER="${JQ_FILTER} | map(select(.decision == \"${FILTER_DECISION}\"))"
fi

# Time range filters
if [[ -n "$FILTER_FROM" ]]; then
  JQ_FILTER="${JQ_FILTER} | map(select(.timestamp >= \"${FILTER_FROM}\"))"
fi
if [[ -n "$FILTER_TO" ]]; then
  JQ_FILTER="${JQ_FILTER} | map(select(.timestamp <= \"${FILTER_TO}\"))"
fi

# Reverse to show newest first, apply limit
JQ_FILTER="${JQ_FILTER} | reverse | .[0:${LIMIT}]"

# Apply filter
FILTERED="$(printf '%s\n' "$BODY" | jq "$JQ_FILTER")"
RESULT_COUNT="$(printf '%s\n' "$FILTERED" | jq 'length')"

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

if [[ "$JSON_OUTPUT" == "1" ]]; then
  printf '%s\n' "$FILTERED"
  exit 0
fi

# Print active filters
ACTIVE_FILTERS=()
[[ -n "$FILTER_SUBJECT"    ]] && ACTIVE_FILTERS+=("subject=${FILTER_SUBJECT}")
[[ -n "$FILTER_ACTION"     ]] && ACTIVE_FILTERS+=("action=${FILTER_ACTION}")
[[ -n "$FILTER_CAPABILITY" ]] && ACTIVE_FILTERS+=("capability≈${FILTER_CAPABILITY}")
[[ -n "$FILTER_PACKAGE"    ]] && ACTIVE_FILTERS+=("package≈${FILTER_PACKAGE}")
[[ -n "$FILTER_DECISION"   ]] && ACTIVE_FILTERS+=("decision=${FILTER_DECISION}")
[[ -n "$FILTER_FROM"       ]] && ACTIVE_FILTERS+=("from=${FILTER_FROM}")
[[ -n "$FILTER_TO"         ]] && ACTIVE_FILTERS+=("to=${FILTER_TO}")

printf '\n'
if [[ ${#ACTIVE_FILTERS[@]} -gt 0 ]]; then
  printf "${BOLD}Filters:${RESET} %s\n" "$(IFS=', '; echo "${ACTIVE_FILTERS[*]}")"
fi
printf "${BOLD}Results:${RESET} %s event(s) (limit %s, newest first)\n\n" "$RESULT_COUNT" "$LIMIT"

if [[ "$RESULT_COUNT" -eq 0 ]]; then
  printf "  ${CYAN}No matching events.${RESET}\n\n"
  exit 0
fi

# Column header
printf "${BOLD}%-24s  %-28s  %-16s  %-30s  %-6s  %s${RESET}\n" \
  "TIMESTAMP" "SUBJECT" "ACTION" "CAPABILITY" "DECIDE" "REASON"
printf '%0.s─' {1..120}; printf '\n'

printf '%s\n' "$FILTERED" | jq -r '.[] |
  [
    (.timestamp | split("T") | join(" ") | .[0:23]),
    .subjectId,
    .action,
    (.capabilityId // (.packageId // "—")),
    .decision,
    (.reason // "—")
  ] | @tsv' | \
while IFS=$'\t' read -r ts subject action cap_id decision reason; do
  # Truncate long fields
  [[ ${#subject} -gt 26 ]] && subject="${subject:0:23}..."
  [[ ${#cap_id}  -gt 28 ]] && cap_id="${cap_id:0:25}..."
  [[ ${#reason}  -gt 40 ]] && reason="${reason:0:37}..."

  case "$decision" in
    allow) dec_fmt="${GREEN}allow ${RESET}" ;;
    deny)  dec_fmt="${RED}deny  ${RESET}" ;;
    *)     dec_fmt="${decision}" ;;
  esac

  printf "%-24s  %-28s  %-16s  %-30s  %b  %s\n" \
    "$ts" "$subject" "$action" "$cap_id" "$dec_fmt" "$reason"
done

printf '%0.s─' {1..120}; printf '\n'
printf "\n"

# ---------------------------------------------------------------------------
# Summary stats
# ---------------------------------------------------------------------------

TOTAL_ALL="$(printf '%s\n' "$BODY" | jq 'length')"
ALLOW_COUNT="$(printf '%s\n' "$FILTERED" | jq '[.[] | select(.decision == "allow")] | length')"
DENY_COUNT="$(printf '%s\n' "$FILTERED" | jq '[.[] | select(.decision == "deny")] | length')"

printf "  Showing %s of %s total events  |  " "$RESULT_COUNT" "$TOTAL_ALL"
printf "${GREEN}%s allow${RESET}  |  " "$ALLOW_COUNT"
printf "${RED}%s deny${RESET}\n\n" "$DENY_COUNT"

# Top denied capabilities (if we have denies)
if [[ "$DENY_COUNT" -gt 0 ]]; then
  printf "${BOLD}Top denied capabilities:${RESET}\n"
  printf '%s\n' "$FILTERED" | jq -r '
    [.[] | select(.decision == "deny") | .capabilityId // "unknown"] |
    group_by(.) | sort_by(-length) | .[0:5] |
    .[] | "\(.[0])  (\(length) denials)"' | \
    while read -r line; do printf "  %s\n" "$line"; done
  printf '\n'
fi

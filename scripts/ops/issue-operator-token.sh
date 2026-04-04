#!/usr/bin/env bash
# Issue an operator token with a specified subject, role/scopes, and optional TTL.
#
# Usage:
#   ./scripts/ops/issue-operator-token.sh <subject-id> <role> [ttl-seconds]
#
# Arguments:
#   subject-id   Identifier for the token subject (e.g. "operator@latitudes.io")
#   role         Role/scope to grant: admin | operator | skill:read | skill:apply
#                  or a comma-separated list: "skill:read,skill:apply"
#   ttl-seconds  Token lifetime in seconds (default: 3600)
#
# Environment:
#   SHUVDEX_API_URL   Base URL for the admin API (default: http://localhost:3847)
#   SHUVDEX_TOKEN     Bearer token for API auth (optional)
#   SUBJECT_TYPE      Token subject type: user | host | install | service (default: user)
#
# Examples:
#   ./scripts/ops/issue-operator-token.sh "operator@latitudes.io" admin
#   ./scripts/ops/issue-operator-token.sh "claude-desktop-1" "skill:read,skill:apply" 2592000
#   ./scripts/ops/issue-operator-token.sh "svc-ci" service 86400

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
log_ok()    { printf "${GREEN}[ok]${RESET}    %s\n" "$*" >&2; }
log_warn()  { printf "${YELLOW}[warn]${RESET}  %s\n" "$*" >&2; }
log_error() { printf "${RED}[error]${RESET} %s\n" "$*" >&2; }

die() {
  log_error "$1"
  exit 1
}

usage() {
  cat >&2 <<EOF

${BOLD}Usage:${RESET} $(basename "$0") <subject-id> <role> [ttl-seconds]

${BOLD}Arguments:${RESET}
  subject-id   Token subject identifier (e.g. "operator@latitudes.io")
  role         Scope(s) to grant — comma-separated if multiple
                 Predefined: admin, operator, skill:read, skill:apply
  ttl-seconds  Lifetime in seconds (default: 3600)

${BOLD}Environment:${RESET}
  SHUVDEX_API_URL   Admin API base URL   (default: http://localhost:3847)
  SHUVDEX_TOKEN     Bearer token for API auth
  SUBJECT_TYPE      user | host | install | service   (default: user)

${BOLD}Examples:${RESET}
  $(basename "$0") "operator@latitudes.io" admin
  $(basename "$0") "claude-desktop-1" "skill:read,skill:apply" 2592000
  $(basename "$0") "svc-ci" admin 86400

EOF
  exit 1
}

# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

require_cmd curl
require_cmd jq

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------

[[ "${1:-}" == "--help" || "${1:-}" == "-h" ]] && usage
[[ $# -lt 2 ]] && { log_error "Missing required arguments."; usage; }

SUBJECT_ID="$1"
ROLE_ARG="$2"
TTL_SECONDS="${3:-3600}"
API_URL="${SHUVDEX_API_URL:-http://localhost:3847}"
SUBJECT_TYPE="${SUBJECT_TYPE:-user}"

# Convert comma-separated roles to a JSON array
SCOPES_JSON="$(printf '%s' "$ROLE_ARG" | \
  tr ',' '\n' | \
  sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | \
  jq -R . | jq -s .)"

# ---------------------------------------------------------------------------
# Build auth header
# ---------------------------------------------------------------------------

AUTH_HEADER=""
if [[ -n "${SHUVDEX_TOKEN:-}" ]]; then
  AUTH_HEADER="Authorization: Bearer ${SHUVDEX_TOKEN}"
fi

# ---------------------------------------------------------------------------
# Issue token
# ---------------------------------------------------------------------------

log_info "Issuing token for subject '${SUBJECT_ID}' (${SUBJECT_TYPE})"
log_info "Scopes: ${ROLE_ARG}"
log_info "TTL: ${TTL_SECONDS}s"
log_info "API: ${API_URL}"

PAYLOAD="$(jq -n \
  --arg subjectType "$SUBJECT_TYPE" \
  --arg subjectId "$SUBJECT_ID" \
  --argjson scopes "$SCOPES_JSON" \
  --argjson ttl "$TTL_SECONDS" \
  '{
    subjectType: $subjectType,
    subjectId: $subjectId,
    scopes: $scopes,
    ttlSeconds: $ttl
  }')"

if [[ -n "$AUTH_HEADER" ]]; then
  RESPONSE="$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/api/tokens" \
    -H "Content-Type: application/json" \
    -H "$AUTH_HEADER" \
    -d "$PAYLOAD")"
else
  RESPONSE="$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/api/tokens" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")"
fi

HTTP_CODE="$(printf '%s' "$RESPONSE" | tail -n1)"
BODY="$(printf '%s' "$RESPONSE" | head -n -1)"

if [[ "$HTTP_CODE" != "201" ]]; then
  log_error "Token issuance failed (HTTP ${HTTP_CODE})"
  printf '%s\n' "$BODY" | jq . >&2 2>/dev/null || printf '%s\n' "$BODY" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

TOKEN="$(printf '%s' "$BODY" | jq -r '.token')"
JTI="$(printf '%s' "$BODY" | jq -r '.claims.jti')"
EXPIRES_AT="$(printf '%s' "$BODY" | jq -r '.claims.expiresAt')"
EXPIRES_ISO="$(date -d "@${EXPIRES_AT}" -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || \
               date -r "${EXPIRES_AT}" -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || \
               printf '%s' "$EXPIRES_AT")"

log_ok "Token issued"
printf '\n' >&2
printf "${BOLD}Token:${RESET}\n%s\n\n" "$TOKEN"
printf "${BOLD}Details:${RESET}\n" >&2
printf '%s' "$BODY" | jq '.claims | {jti, subjectId, subjectType, scopes, expiresAt}' >&2
printf '\n' >&2
log_info "JTI (for revocation): ${JTI}"
log_info "Expires: ${EXPIRES_ISO}"
printf '\n' >&2
log_warn "To revoke this token:"
printf "  curl -sX POST %s/api/tokens/revoke -H 'Content-Type: application/json' -d '{\"jti\":\"%s\"}'\n\n" \
  "$API_URL" "$JTI" >&2

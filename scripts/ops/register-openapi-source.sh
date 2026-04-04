#!/usr/bin/env bash
# Register an OpenAPI source and optionally sync it.
#
# Usage:
#   ./scripts/ops/register-openapi-source.sh <source-id> <spec-url> <server-url> [credential-id]
#
# Arguments:
#   source-id      Stable identifier for this source (e.g. "gitea-api")
#   spec-url       URL to the OpenAPI JSON/YAML spec
#   server-url     Base URL for actual API calls (the server that handles requests)
#   credential-id  (optional) ID of a credential already in the credential store
#
# Environment:
#   SHUVDEX_API_URL   Base URL for the admin API  (default: http://localhost:3847)
#   SHUVDEX_TOKEN     Bearer token for API auth
#   SOURCE_TITLE      Human-readable title         (default: derived from source-id)
#   SOURCE_DESC       Optional description
#   SOURCE_TAGS       Comma-separated tags          (default: "openapi")
#   RISK_LEVEL        Capability risk level: low | medium | high  (default: medium)
#   INSPECT_ONLY      Set to "1" to inspect without registering   (default: 0)
#   SKIP_REFRESH      Set to "1" to skip the post-register sync   (default: 0)
#
# Examples:
#   ./scripts/ops/register-openapi-source.sh gitea-api \
#       http://gitea.internal:3000/swagger.v1.json \
#       http://gitea.internal:3000
#
#   ./scripts/ops/register-openapi-source.sh dnsfilter-api \
#       https://api.dnsfilter.com/v2/swagger/doc.json \
#       https://api.dnsfilter.com \
#       dnsfilter-api-key

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

${BOLD}Usage:${RESET} $(basename "$0") <source-id> <spec-url> <server-url> [credential-id]

${BOLD}Arguments:${RESET}
  source-id      Stable source identifier (e.g. "gitea-api")
  spec-url       URL to the OpenAPI JSON or YAML spec
  server-url     Base URL for actual API calls
  credential-id  (optional) Credential ID from the credential store

${BOLD}Environment:${RESET}
  SHUVDEX_API_URL   Admin API base URL   (default: http://localhost:3847)
  SHUVDEX_TOKEN     Bearer token for API auth
  SOURCE_TITLE      Human-readable title (default: derived from source-id)
  SOURCE_DESC       Optional description
  SOURCE_TAGS       Comma-separated tags (default: openapi)
  RISK_LEVEL        low | medium | high  (default: medium)
  INSPECT_ONLY      1 = inspect without registering
  SKIP_REFRESH      1 = skip post-register sync

${BOLD}Examples:${RESET}
  $(basename "$0") gitea-api \\
      http://gitea.internal:3000/swagger.v1.json \\
      http://gitea.internal:3000

  $(basename "$0") dnsfilter-api \\
      https://api.dnsfilter.com/v2/swagger/doc.json \\
      https://api.dnsfilter.com \\
      dnsfilter-api-key

EOF
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

require_cmd curl
require_cmd jq

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------

[[ "${1:-}" == "--help" || "${1:-}" == "-h" ]] && usage
[[ $# -lt 3 ]] && { log_error "Missing required arguments."; usage; }

SOURCE_ID="$1"
SPEC_URL="$2"
SERVER_URL="$3"
CREDENTIAL_ID="${4:-}"

API_URL="${SHUVDEX_API_URL:-http://localhost:3847}"
INSPECT_ONLY="${INSPECT_ONLY:-0}"
SKIP_REFRESH="${SKIP_REFRESH:-0}"
RISK_LEVEL="${RISK_LEVEL:-medium}"

# Derive a title from source ID if not provided
DEFAULT_TITLE="$(printf '%s' "$SOURCE_ID" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)} 1')"
SOURCE_TITLE="${SOURCE_TITLE:-${DEFAULT_TITLE}}"
SOURCE_DESC="${SOURCE_DESC:-}"

# Tags as JSON array
TAGS_RAW="${SOURCE_TAGS:-openapi}"
TAGS_JSON="$(printf '%s' "$TAGS_RAW" | \
  tr ',' '\n' | \
  sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | \
  jq -R . | jq -s .)"

# ---------------------------------------------------------------------------
# Auth header
# ---------------------------------------------------------------------------

AUTH_ARGS=()
if [[ -n "${SHUVDEX_TOKEN:-}" ]]; then
  AUTH_ARGS+=(-H "Authorization: Bearer ${SHUVDEX_TOKEN}")
fi

api_call() {
  local method="$1"; shift
  local path="$1"; shift
  curl -s -w "\n%{http_code}" -X "$method" "${API_URL}${path}" \
    "${AUTH_ARGS[@]}" \
    -H "Content-Type: application/json" \
    "$@"
}

check_response() {
  local label="$1"
  local expected_code="$2"
  local response="$3"
  local http_code body

  http_code="$(printf '%s' "$response" | tail -n1)"
  body="$(printf '%s' "$response" | head -n -1)"

  if [[ "$http_code" != "$expected_code" ]]; then
    log_error "${label} failed (HTTP ${http_code})"
    printf '%s\n' "$body" | jq . >&2 2>/dev/null || printf '%s\n' "$body" >&2
    exit 1
  fi

  printf '%s\n' "$body"
}

# ---------------------------------------------------------------------------
# Build payload
# ---------------------------------------------------------------------------

build_payload() {
  local include_cred="${1:-0}"
  local base
  base="$(jq -n \
    --arg sourceId "$SOURCE_ID" \
    --arg specUrl "$SPEC_URL" \
    --arg title "$SOURCE_TITLE" \
    --arg serverUrl "$SERVER_URL" \
    --arg riskLevel "$RISK_LEVEL" \
    --argjson tags "$TAGS_JSON" \
    '{
      sourceId: $sourceId,
      specUrl: $specUrl,
      title: $title,
      selectedServerUrl: $serverUrl,
      defaultRiskLevel: $riskLevel,
      tags: $tags
    }')"

  if [[ -n "$SOURCE_DESC" ]]; then
    base="$(printf '%s' "$base" | jq --arg d "$SOURCE_DESC" '. + {description: $d}')"
  fi

  if [[ "$include_cred" == "1" && -n "$CREDENTIAL_ID" ]]; then
    base="$(printf '%s' "$base" | jq --arg cid "$CREDENTIAL_ID" '. + {credentialId: $cid}')"
  fi

  printf '%s\n' "$base"
}

# ---------------------------------------------------------------------------
# Inspect
# ---------------------------------------------------------------------------

log_info "Source ID:  ${SOURCE_ID}"
log_info "Spec URL:   ${SPEC_URL}"
log_info "Server URL: ${SERVER_URL}"
[[ -n "$CREDENTIAL_ID" ]] && log_info "Credential: ${CREDENTIAL_ID}"
log_info "Risk level: ${RISK_LEVEL}"
log_info "API:        ${API_URL}"
printf '\n' >&2

log_info "Inspecting spec..."
INSPECT_PAYLOAD="$(build_payload 1)"
INSPECT_RESPONSE="$(api_call POST "/api/sources/openapi/inspect" -d "$INSPECT_PAYLOAD")"
INSPECT_BODY="$(check_response "Inspect" "200" "$INSPECT_RESPONSE")"

CAP_COUNT="$(printf '%s' "$INSPECT_BODY" | jq '.capabilities | length')"
WARN_COUNT="$(printf '%s' "$INSPECT_BODY" | jq '.warnings | length' 2>/dev/null || echo 0)"

log_ok "Spec inspected: ${CAP_COUNT} capabilities"

if [[ "$WARN_COUNT" -gt 0 ]]; then
  log_warn "${WARN_COUNT} warning(s) in spec:"
  printf '%s' "$INSPECT_BODY" | jq -r '.warnings[]' >&2
fi

printf '\n' >&2
printf '%s' "$INSPECT_BODY" | \
  jq '.capabilities[0:5] | .[] | {id, kind, title}' >&2

if [[ "$CAP_COUNT" -gt 5 ]]; then
  log_info "... and $((CAP_COUNT - 5)) more (showing first 5)"
fi

if [[ "$INSPECT_ONLY" == "1" ]]; then
  printf '\n' >&2
  log_info "INSPECT_ONLY=1 — stopping before registration."
  printf '%s\n' "$INSPECT_BODY"
  exit 0
fi

printf '\n' >&2

# ---------------------------------------------------------------------------
# Register
# ---------------------------------------------------------------------------

log_info "Registering source '${SOURCE_ID}'..."
REG_PAYLOAD="$(build_payload 1)"
REG_RESPONSE="$(api_call POST "/api/sources/openapi" -d "$REG_PAYLOAD")"
REG_BODY="$(check_response "Register" "201" "$REG_RESPONSE")"

PKG_ID="$(printf '%s' "$REG_BODY" | jq -r '.packageId // .sourceId')"
log_ok "Source registered → package: ${PKG_ID}"

# ---------------------------------------------------------------------------
# Post-register sync (refresh)
# ---------------------------------------------------------------------------

if [[ "$SKIP_REFRESH" == "1" ]]; then
  log_info "SKIP_REFRESH=1 — skipping sync."
else
  log_info "Syncing source (refresh)..."
  REFRESH_RESPONSE="$(api_call POST "/api/sources/openapi/${SOURCE_ID}/refresh")"
  REFRESH_BODY="$(check_response "Refresh" "200" "$REFRESH_RESPONSE")"
  SYNCED_COUNT="$(printf '%s' "$REFRESH_BODY" | jq '.capabilities | length' 2>/dev/null || echo "?")"
  log_ok "Sync complete: ${SYNCED_COUNT} capabilities active"
fi

# ---------------------------------------------------------------------------
# Test auth (if credential provided)
# ---------------------------------------------------------------------------

if [[ -n "$CREDENTIAL_ID" ]]; then
  log_info "Testing auth with credential '${CREDENTIAL_ID}'..."
  AUTH_RESPONSE="$(api_call POST "/api/sources/openapi/${SOURCE_ID}/test-auth")"
  AUTH_HTTP="$(printf '%s' "$AUTH_RESPONSE" | tail -n1)"
  AUTH_BODY="$(printf '%s' "$AUTH_RESPONSE" | head -n -1)"

  if [[ "$AUTH_HTTP" == "200" ]]; then
    log_ok "Auth test passed"
  else
    log_warn "Auth test returned HTTP ${AUTH_HTTP} — check credential"
    printf '%s\n' "$AUTH_BODY" | jq . >&2 2>/dev/null || printf '%s\n' "$AUTH_BODY" >&2
  fi
fi

printf '\n' >&2
log_ok "Done. Source '${SOURCE_ID}' is registered and active."
printf '\n' >&2
log_info "To refresh later:   curl -sX POST ${API_URL}/api/sources/openapi/${SOURCE_ID}/refresh"
log_info "To delete:          curl -sX DELETE ${API_URL}/api/sources/openapi/${SOURCE_ID}"

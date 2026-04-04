#!/usr/bin/env bash
# Rotate a credential: create a new version, update all references, verify, delete the old one.
#
# Usage:
#   ./scripts/ops/rotate-credential.sh <credential-id>
#
# The script will:
#   1. Show current references to the credential
#   2. Prompt for the new secret value(s) based on the scheme type
#   3. Create a new credential with ID <credential-id>-v<N+1>
#   4. Update all OpenAPI sources referencing the old credential
#   5. Test auth on each updated source
#   6. Prompt for confirmation before deleting the old credential
#
# Environment:
#   SHUVDEX_API_URL    Admin API base URL  (default: http://localhost:3847)
#   SHUVDEX_TOKEN      Bearer token for API auth
#   NEW_CRED_ID        Override the new credential ID (default: <old-id>-rotated)
#   SKIP_DELETE        Set to "1" to keep the old credential after rotation
#   FORCE              Set to "1" to skip confirmation prompts
#
# Examples:
#   ./scripts/ops/rotate-credential.sh dnsfilter-api-key
#   NEW_CRED_ID=dnsfilter-api-key-v2 ./scripts/ops/rotate-credential.sh dnsfilter-api-key

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

${BOLD}Usage:${RESET} $(basename "$0") <credential-id>

Rotate a credential: create replacement, update references, verify, delete old.

${BOLD}Arguments:${RESET}
  credential-id   ID of the credential to rotate

${BOLD}Environment:${RESET}
  SHUVDEX_API_URL   Admin API base URL   (default: http://localhost:3847)
  SHUVDEX_TOKEN     Bearer token for API auth
  NEW_CRED_ID       Override the new credential ID
  SKIP_DELETE       1 = keep the old credential after rotation
  FORCE             1 = skip confirmation prompts

${BOLD}Example:${RESET}
  $(basename "$0") dnsfilter-api-key
  NEW_CRED_ID=dnsfilter-api-key-v2 $(basename "$0") dnsfilter-api-key

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
[[ $# -lt 1 ]] && { log_error "Missing credential-id argument."; usage; }

OLD_CRED_ID="$1"
API_URL="${SHUVDEX_API_URL:-http://localhost:3847}"
SKIP_DELETE="${SKIP_DELETE:-0}"
FORCE="${FORCE:-0}"

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
  local label="$1" expected_code="$2" response="$3"
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

confirm() {
  local prompt="$1"
  if [[ "$FORCE" == "1" ]]; then
    log_info "(FORCE=1) Auto-confirming: $prompt"
    return 0
  fi
  printf "${YELLOW}%s [y/N]:${RESET} " "$prompt" >&2
  read -r answer
  [[ "$answer" =~ ^[Yy]$ ]] || { log_warn "Aborted."; exit 1; }
}

# ---------------------------------------------------------------------------
# Step 1: Fetch existing credential metadata
# ---------------------------------------------------------------------------

log_info "Fetching credential list..."
ALL_CREDS="$(api_call GET "/api/credentials" | head -n -1)"

OLD_CRED="$(printf '%s' "$ALL_CREDS" | \
  jq -e --arg id "$OLD_CRED_ID" '.[] | select(.credentialId == $id)')" || \
  die "Credential '${OLD_CRED_ID}' not found"

SCHEME_TYPE="$(printf '%s' "$OLD_CRED" | jq -r '.schemeType')"
OLD_DESC="$(printf '%s' "$OLD_CRED" | jq -r '.description // ""')"

log_info "Found credential: ${OLD_CRED_ID}"
log_info "  Scheme type: ${SCHEME_TYPE}"
log_info "  Description: ${OLD_DESC:-<none>}"
printf '\n' >&2

# ---------------------------------------------------------------------------
# Step 2: Find all references
# ---------------------------------------------------------------------------

log_info "Finding references to '${OLD_CRED_ID}'..."

SOURCES_USING_CRED="$(api_call GET "/api/sources/openapi" | head -n -1 | \
  jq -r --arg id "$OLD_CRED_ID" '[.[] | select(.credentialId == $id) | .sourceId] | .[]')" || true

if [[ -z "$SOURCES_USING_CRED" ]]; then
  log_warn "No OpenAPI sources reference this credential."
else
  log_info "OpenAPI sources using this credential:"
  printf '%s\n' "$SOURCES_USING_CRED" | while read -r src; do
    printf "  - %s\n" "$src" >&2
  done
fi
printf '\n' >&2

# ---------------------------------------------------------------------------
# Step 3: Generate new credential ID
# ---------------------------------------------------------------------------

DATE_STAMP="$(date -u +%Y%m%d)"
DEFAULT_NEW_ID="${OLD_CRED_ID}-${DATE_STAMP}"
NEW_CRED_ID="${NEW_CRED_ID:-${DEFAULT_NEW_ID}}"

log_info "New credential ID will be: ${NEW_CRED_ID}"

# ---------------------------------------------------------------------------
# Step 4: Collect new secret values
# ---------------------------------------------------------------------------

printf '\n' >&2
log_info "Enter the new secret values for scheme type '${SCHEME_TYPE}':"
printf '\n' >&2

build_new_scheme() {
  case "$SCHEME_TYPE" in
    api_key)
      printf '%s' "$OLD_CRED" | jq '{type: "api_key", in: .in, name: .name}' 2>/dev/null || \
        jq -n '{type: "api_key", in: "header", name: "Authorization"}'
      local field_name
      field_name="$(printf '%s' "$OLD_CRED" | jq -r '.name // "key"' 2>/dev/null || echo "key")"
      printf "${BOLD}New API key value (field: %s):${RESET} " "$field_name" >&2
      read -rs NEW_VALUE; printf '\n' >&2
      jq -n \
        --arg type "api_key" \
        --arg in "$(printf '%s' "$OLD_CRED" | jq -r '.in // "header"' 2>/dev/null || echo "header")" \
        --arg name "$field_name" \
        --arg value "$NEW_VALUE" \
        '{type: $type, in: $in, name: $name, value: $value}'
      ;;
    bearer)
      printf "${BOLD}New bearer token:${RESET} " >&2
      read -rs NEW_TOKEN; printf '\n' >&2
      jq -n --arg token "$NEW_TOKEN" '{type: "bearer", token: $token}'
      ;;
    basic)
      printf "${BOLD}Username (leave blank to keep existing):${RESET} " >&2
      read -r NEW_USER; printf '\n' >&2
      printf "${BOLD}New password:${RESET} " >&2
      read -rs NEW_PASS; printf '\n' >&2
      if [[ -z "$NEW_USER" ]]; then
        log_warn "Username not changed. Enter the existing username:"
        printf "${BOLD}Existing username:${RESET} " >&2
        read -r NEW_USER; printf '\n' >&2
      fi
      jq -n --arg username "$NEW_USER" --arg password "$NEW_PASS" \
        '{type: "basic", username: $username, password: $password}'
      ;;
    oauth2_client_credentials)
      printf '%s' "$OLD_CRED" | jq '{type: "oauth2_client_credentials", tokenUrl: .tokenUrl, clientId: .clientId}' 2>/dev/null || true
      printf "${BOLD}Token URL (leave blank to keep existing):${RESET} " >&2
      read -r NEW_TOKEN_URL; printf '\n' >&2
      printf "${BOLD}Client ID (leave blank to keep existing):${RESET} " >&2
      read -r NEW_CLIENT_ID; printf '\n' >&2
      printf "${BOLD}New client secret:${RESET} " >&2
      read -rs NEW_CLIENT_SECRET; printf '\n' >&2
      [[ -z "$NEW_TOKEN_URL" ]] && NEW_TOKEN_URL="PLACEHOLDER_TOKEN_URL"
      [[ -z "$NEW_CLIENT_ID" ]] && NEW_CLIENT_ID="PLACEHOLDER_CLIENT_ID"
      jq -n \
        --arg tokenUrl "$NEW_TOKEN_URL" \
        --arg clientId "$NEW_CLIENT_ID" \
        --arg clientSecret "$NEW_CLIENT_SECRET" \
        '{type: "oauth2_client_credentials", tokenUrl: $tokenUrl, clientId: $clientId, clientSecret: $clientSecret}'
      ;;
    custom_headers)
      printf "${BOLD}Enter headers as JSON object (e.g. {\"X-API-Key\":\"val\"}):${RESET} " >&2
      read -r NEW_HEADERS; printf '\n' >&2
      jq -n --argjson headers "$NEW_HEADERS" '{type: "custom_headers", headers: $headers}'
      ;;
    *)
      die "Unknown scheme type: ${SCHEME_TYPE}. Edit the credential manually via the API."
      ;;
  esac
}

NEW_SCHEME="$(build_new_scheme)"

# ---------------------------------------------------------------------------
# Step 5: Create new credential
# ---------------------------------------------------------------------------

printf '\n' >&2
confirm "Create new credential '${NEW_CRED_ID}'?"

NEW_DESC="Rotated from ${OLD_CRED_ID} on $(date -u +%Y-%m-%d)"
[[ -n "$OLD_DESC" ]] && NEW_DESC="${OLD_DESC} (rotated $(date -u +%Y-%m-%d))"

CREATE_PAYLOAD="$(jq -n \
  --arg credentialId "$NEW_CRED_ID" \
  --arg description "$NEW_DESC" \
  --argjson scheme "$NEW_SCHEME" \
  '{credentialId: $credentialId, description: $description, scheme: $scheme}')"

CREATE_RESPONSE="$(api_call POST "/api/credentials" -d "$CREATE_PAYLOAD")"
check_response "Create credential" "201" "$CREATE_RESPONSE" >/dev/null
log_ok "New credential created: ${NEW_CRED_ID}"

# ---------------------------------------------------------------------------
# Step 6: Update source references
# ---------------------------------------------------------------------------

if [[ -n "$SOURCES_USING_CRED" ]]; then
  printf '\n' >&2
  log_info "Updating source references..."

  AUTH_FAILURES=()
  while IFS= read -r SOURCE_ID; do
    log_info "  Updating source: ${SOURCE_ID}"
    UPDATE_RESPONSE="$(api_call PATCH "/api/sources/openapi/${SOURCE_ID}" \
      -d "{\"credentialId\": \"${NEW_CRED_ID}\"}")"
    UPDATE_HTTP="$(printf '%s' "$UPDATE_RESPONSE" | tail -n1)"
    if [[ "$UPDATE_HTTP" != "200" ]]; then
      log_warn "    Failed to update source ${SOURCE_ID} (HTTP ${UPDATE_HTTP})"
      continue
    fi
    log_ok "    Updated source: ${SOURCE_ID}"

    # Test auth
    log_info "    Testing auth on ${SOURCE_ID}..."
    TEST_RESPONSE="$(api_call POST "/api/sources/openapi/${SOURCE_ID}/test-auth")"
    TEST_HTTP="$(printf '%s' "$TEST_RESPONSE" | tail -n1)"
    if [[ "$TEST_HTTP" == "200" ]]; then
      log_ok "    Auth test passed"
    else
      log_warn "    Auth test returned HTTP ${TEST_HTTP} — review before proceeding"
      AUTH_FAILURES+=("$SOURCE_ID")
    fi
  done <<< "$SOURCES_USING_CRED"

  if [[ ${#AUTH_FAILURES[@]} -gt 0 ]]; then
    printf '\n' >&2
    log_warn "Auth tests failed for: ${AUTH_FAILURES[*]}"
    log_warn "Review these sources before deleting the old credential."
    confirm "Continue with deletion anyway?"
  fi
fi

# ---------------------------------------------------------------------------
# Step 7: Delete old credential
# ---------------------------------------------------------------------------

if [[ "$SKIP_DELETE" == "1" ]]; then
  printf '\n' >&2
  log_info "SKIP_DELETE=1 — old credential '${OLD_CRED_ID}' preserved."
else
  printf '\n' >&2
  confirm "Delete old credential '${OLD_CRED_ID}'?"
  DELETE_RESPONSE="$(api_call DELETE "/api/credentials/${OLD_CRED_ID}")"
  check_response "Delete credential" "200" "$DELETE_RESPONSE" >/dev/null
  log_ok "Old credential deleted: ${OLD_CRED_ID}"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

printf '\n' >&2
log_ok "Rotation complete."
log_info "  Old credential: ${OLD_CRED_ID} $([ "$SKIP_DELETE" == "1" ] && echo "(preserved)" || echo "(deleted)")"
log_info "  New credential: ${NEW_CRED_ID}"
[[ -n "$SOURCES_USING_CRED" ]] && \
  log_info "  Updated sources: $(printf '%s' "$SOURCES_USING_CRED" | wc -l | tr -d ' ')"

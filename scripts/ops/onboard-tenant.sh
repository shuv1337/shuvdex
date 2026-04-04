#!/usr/bin/env bash
# Interactive tenant onboarding wizard for shuvdex.
#
# Walks through the full onboarding flow:
#   1. Collect tenant details (name, tier, IdP type)
#   2. Create tenant via API
#   3. Apply the matching policy template
#   4. Create production environment
#   5. Create gateway
#   6. Output the connection URL
#
# Usage:
#   ./scripts/ops/onboard-tenant.sh [options]
#
# Options:
#   --api-url <url>    Admin API base URL (default: http://localhost:3847)
#   --token <token>    Bearer token for API auth (default: $SHUVDEX_TOKEN)
#   --non-interactive  Accept all defaults; requires --name, --tier, --idp
#   --name <name>      Tenant name (non-interactive mode)
#   --tier <tier>      Subscription tier: core | standard | custom
#   --idp <type>       Identity provider: entra | google
#   --idp-id <id>      Entra tenant ID or Google Workspace domain
#   --owner <email>    Owner/admin email
#   --dry-run          Print the API calls without executing them
#   -h, --help         Show this help
#
# Environment:
#   SHUVDEX_API_URL    Admin API base URL (overrides --api-url)
#   SHUVDEX_TOKEN      Bearer token for API auth

set -euo pipefail

# ---------------------------------------------------------------------------
# Colour helpers
# ---------------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

log_info()    { printf "${CYAN}[info]${RESET}   %s\n" "$*" >&2; }
log_ok()      { printf "${GREEN}[ok]${RESET}     %s\n" "$*" >&2; }
log_warn()    { printf "${YELLOW}[warn]${RESET}   %s\n" "$*" >&2; }
log_error()   { printf "${RED}[error]${RESET}  %s\n" "$*" >&2; }
log_step()    { printf "\n${BOLD}${BLUE}▶ Step %s — %s${RESET}\n" "$1" "$2" >&2; }
log_detail()  { printf "  ${DIM}%s${RESET}\n" "$*" >&2; }
log_result()  { printf "  ${GREEN}✓${RESET} %s\n" "$*" >&2; }

die() {
  log_error "$1"
  exit 1
}

usage() {
  cat >&2 <<EOF

${BOLD}Usage:${RESET} $(basename "$0") [options]

Interactive tenant onboarding wizard for shuvdex.

${BOLD}Options:${RESET}
  --api-url <url>      Admin API base URL   (default: http://localhost:3847)
  --token <token>      Bearer token for auth (default: \$SHUVDEX_TOKEN)
  --non-interactive    Accept all defaults; use with --name / --tier / --idp
  --name <name>        Tenant display name
  --tier <tier>        Subscription tier: core | standard | custom
  --idp <type>         Identity provider: entra | google
  --idp-id <id>        Entra tenant ID (UUID) or Google Workspace domain
  --owner <email>      Owner / admin email address
  --dry-run            Print API payloads without executing
  -h, --help           Show this help

${BOLD}Environment:${RESET}
  SHUVDEX_API_URL      Admin API base URL
  SHUVDEX_TOKEN        Bearer token for API auth

${BOLD}Examples:${RESET}
  # Interactive (recommended for first use)
  $(basename "$0")

  # Non-interactive for scripted onboarding
  $(basename "$0") --non-interactive \\
    --name "Acme Corp" \\
    --tier standard \\
    --idp entra \\
    --idp-id "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" \\
    --owner admin@acme.example.com

EOF
  exit 1
}

# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------

require_cmd() { command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"; }
require_cmd curl
require_cmd jq

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

API_URL="${SHUVDEX_API_URL:-http://localhost:3847}"
TOKEN="${SHUVDEX_TOKEN:-}"
NON_INTERACTIVE=0
DRY_RUN=0
OPT_NAME=""
OPT_TIER=""
OPT_IDP=""
OPT_IDP_ID=""
OPT_OWNER=""

# ---------------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-url)         API_URL="$2";          shift 2 ;;
    --token)           TOKEN="$2";             shift 2 ;;
    --non-interactive) NON_INTERACTIVE=1;      shift ;;
    --name)            OPT_NAME="$2";          shift 2 ;;
    --tier)            OPT_TIER="$2";          shift 2 ;;
    --idp)             OPT_IDP="$2";           shift 2 ;;
    --idp-id)          OPT_IDP_ID="$2";        shift 2 ;;
    --owner)           OPT_OWNER="$2";         shift 2 ;;
    --dry-run)         DRY_RUN=1;              shift ;;
    -h|--help)         usage ;;
    *) die "Unknown option: $1" ;;
  esac
done

# ---------------------------------------------------------------------------
# Auth header
# ---------------------------------------------------------------------------

AUTH_ARGS=()
if [[ -n "${TOKEN}" ]]; then
  AUTH_ARGS+=(-H "Authorization: Bearer ${TOKEN}")
else
  log_warn "No bearer token set. Set SHUVDEX_TOKEN or pass --token."
  log_warn "Proceeding — will fail if API auth is enforced."
fi

# ---------------------------------------------------------------------------
# API helper
# ---------------------------------------------------------------------------

# api_post <path> <json-payload>
# Returns the JSON response body. Exits on HTTP error.
api_post() {
  local endpoint="$1"
  local payload="$2"
  local url="${API_URL}${endpoint}"

  if [[ "$DRY_RUN" == "1" ]]; then
    printf "\n${DIM}[dry-run] POST %s${RESET}\n" "$url" >&2
    printf "${DIM}%s${RESET}\n" "$(printf '%s' "$payload" | jq .)" >&2
    echo "{}"
    return 0
  fi

  local response http_code body

  response="$(curl -s -w "\n%{http_code}" \
    -X POST "$url" \
    -H "Content-Type: application/json" \
    "${AUTH_ARGS[@]}" \
    -d "$payload" 2>/dev/null)"

  http_code="$(printf '%s' "$response" | tail -n1)"
  body="$(printf '%s' "$response" | head -n -1)"

  if [[ "$http_code" != "200" && "$http_code" != "201" ]]; then
    log_error "POST ${endpoint} failed (HTTP ${http_code})"
    printf '%s\n' "$body" | jq . >&2 2>/dev/null || printf '%s\n' "$body" >&2
    exit 1
  fi

  printf '%s' "$body"
}

# ---------------------------------------------------------------------------
# Interactive prompts
# ---------------------------------------------------------------------------

prompt() {
  local label="$1" default="${2:-}" var_name="$3"
  local value=""

  if [[ "$NON_INTERACTIVE" == "1" ]]; then
    printf '%s' "${!var_name}"
    return
  fi

  if [[ -n "$default" ]]; then
    printf "  ${BOLD}%s${RESET} ${DIM}[%s]${RESET}: " "$label" "$default" >&2
  else
    printf "  ${BOLD}%s${RESET}: " "$label" >&2
  fi

  read -r value
  if [[ -z "$value" && -n "$default" ]]; then
    value="$default"
  fi
  printf '%s' "$value"
}

prompt_choice() {
  local label="$1"
  shift
  local choices=("$@")
  local choice=""

  if [[ "$NON_INTERACTIVE" == "1" ]]; then
    return
  fi

  printf "  ${BOLD}%s${RESET} (${choices[*]}): " "$label" >&2
  read -r choice
  printf '%s' "$choice"
}

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------

printf "\n"
printf "${BOLD}${BLUE}╔══════════════════════════════════════╗${RESET}\n"
printf "${BOLD}${BLUE}║    shuvdex Tenant Onboarding Wizard  ║${RESET}\n"
printf "${BOLD}${BLUE}╚══════════════════════════════════════╝${RESET}\n"
printf "\n"
printf "  API: ${CYAN}%s${RESET}\n" "$API_URL"
[[ "$DRY_RUN" == "1" ]] && printf "  ${YELLOW}DRY RUN mode — no changes will be made${RESET}\n"
printf "\n"

# ---------------------------------------------------------------------------
# Step 1 — Collect tenant details
# ---------------------------------------------------------------------------

log_step "1" "Collect tenant details"

if [[ -z "$OPT_NAME" ]]; then
  TENANT_NAME="$(prompt "Tenant name" "" OPT_NAME)"
else
  TENANT_NAME="$OPT_NAME"
fi
[[ -z "$TENANT_NAME" ]] && die "Tenant name is required"

if [[ -z "$OPT_TIER" ]]; then
  TENANT_TIER="$(prompt "Subscription tier" "standard" OPT_TIER)"
  [[ -z "$TENANT_TIER" ]] && TENANT_TIER="standard"
else
  TENANT_TIER="$OPT_TIER"
fi
[[ "$TENANT_TIER" != "core" && "$TENANT_TIER" != "standard" && "$TENANT_TIER" != "custom" ]] && \
  die "tier must be one of: core, standard, custom"

if [[ -z "$OPT_IDP" ]]; then
  IDP_TYPE="$(prompt "Identity provider" "entra" OPT_IDP)"
  [[ -z "$IDP_TYPE" ]] && IDP_TYPE="entra"
else
  IDP_TYPE="$OPT_IDP"
fi
[[ "$IDP_TYPE" != "entra" && "$IDP_TYPE" != "google" ]] && \
  die "idp must be one of: entra, google"

IDP_LABEL="Entra tenant ID (UUID)"
[[ "$IDP_TYPE" == "google" ]] && IDP_LABEL="Google Workspace primary domain"

if [[ -z "$OPT_IDP_ID" ]]; then
  IDP_ID="$(prompt "$IDP_LABEL" "" OPT_IDP_ID)"
else
  IDP_ID="$OPT_IDP_ID"
fi
[[ -z "$IDP_ID" ]] && die "$IDP_LABEL is required"

if [[ -z "$OPT_OWNER" ]]; then
  OWNER_EMAIL="$(prompt "Owner email" "" OPT_OWNER)"
else
  OWNER_EMAIL="$OPT_OWNER"
fi
[[ -z "$OWNER_EMAIL" ]] && die "Owner email is required"

printf "\n"
log_detail "Name:  ${TENANT_NAME}"
log_detail "Tier:  ${TENANT_TIER}"
log_detail "IdP:   ${IDP_TYPE} / ${IDP_ID}"
log_detail "Owner: ${OWNER_EMAIL}"

if [[ "$NON_INTERACTIVE" == "0" && "$DRY_RUN" == "0" ]]; then
  printf "\n  Proceed with onboarding? (y/N): " >&2
  read -r confirm
  [[ "$confirm" != "y" && "$confirm" != "Y" ]] && die "Aborted."
fi

# ---------------------------------------------------------------------------
# Step 2 — Create tenant
# ---------------------------------------------------------------------------

log_step "2" "Create tenant"

if [[ "$IDP_TYPE" == "entra" ]]; then
  TENANT_PAYLOAD="$(jq -n \
    --arg name "$TENANT_NAME" \
    --arg tier "$TENANT_TIER" \
    --arg owner "$OWNER_EMAIL" \
    --arg idpType "entra" \
    --arg idpTenantId "$IDP_ID" \
    '{name: $name, tier: $tier, ownerEmail: $owner, idpType: $idpType, idpTenantId: $idpTenantId}')"
else
  TENANT_PAYLOAD="$(jq -n \
    --arg name "$TENANT_NAME" \
    --arg tier "$TENANT_TIER" \
    --arg owner "$OWNER_EMAIL" \
    --arg idpType "google" \
    --arg idpDomain "$IDP_ID" \
    '{name: $name, tier: $tier, ownerEmail: $owner, idpType: $idpType, idpDomain: $idpDomain}')"
fi

TENANT_RESP="$(api_post "/api/tenants" "$TENANT_PAYLOAD")"
TENANT_ID="$(printf '%s' "$TENANT_RESP" | jq -r '.tenantId // empty')"

if [[ -z "$TENANT_ID" && "$DRY_RUN" != "1" ]]; then
  log_error "Failed to extract tenantId from response"
  printf '%s\n' "$TENANT_RESP" | jq . >&2
  exit 1
elif [[ "$DRY_RUN" == "1" ]]; then
  TENANT_ID="tenant_dryrun00000000"
fi

log_result "Created tenant: ${TENANT_ID}"

# ---------------------------------------------------------------------------
# Step 3 — Apply policy template
# ---------------------------------------------------------------------------

log_step "3" "Apply policy template: ${TENANT_TIER}"

TEMPLATE_PAYLOAD="$(jq -n --arg t "$TENANT_TIER" '{templateId: $t}')"
api_post "/api/tenants/${TENANT_ID}/apply-template" "$TEMPLATE_PAYLOAD" > /dev/null

log_result "Template '${TENANT_TIER}' applied"

# Show key template values
TEMPLATE_FILE="$(dirname "$(dirname "$(dirname "${BASH_SOURCE[0]}")")")/docs/templates/${TENANT_TIER}.json"
if [[ -f "$TEMPLATE_FILE" ]]; then
  MAX_CONN="$(jq -r '.maxConnectors' "$TEMPLATE_FILE")"
  MAX_USERS="$(jq -r '.maxUsers' "$TEMPLATE_FILE")"
  AUDIT_DAYS="$(jq -r '.auditRetentionDays' "$TEMPLATE_FILE")"
  log_detail "Max connectors:  ${MAX_CONN}"
  log_detail "Max users:       ${MAX_USERS}"
  log_detail "Audit retention: ${AUDIT_DAYS} days"
fi

# ---------------------------------------------------------------------------
# Step 4 — Create production environment
# ---------------------------------------------------------------------------

log_step "4" "Create production environment"

ENV_PAYLOAD="$(jq -n '{name: "production", type: "production"}')"
ENV_RESP="$(api_post "/api/tenants/${TENANT_ID}/environments" "$ENV_PAYLOAD")"
ENV_ID="$(printf '%s' "$ENV_RESP" | jq -r '.environmentId // empty')"

if [[ -z "$ENV_ID" && "$DRY_RUN" != "1" ]]; then
  log_warn "Could not extract environmentId — continuing"
  ENV_ID="env_unknown"
elif [[ "$DRY_RUN" == "1" ]]; then
  ENV_ID="env_dryrun00000000"
fi

log_result "Created environment: ${ENV_ID}"

# ---------------------------------------------------------------------------
# Step 5 — Create gateway
# ---------------------------------------------------------------------------

log_step "5" "Create gateway"

AUTH_MODE="entra"
[[ "$IDP_TYPE" == "google" ]] && AUTH_MODE="google"

GW_PAYLOAD="$(jq -n \
  --arg envId "$ENV_ID" \
  --arg name "${TENANT_NAME} Production Gateway" \
  --arg authMode "$AUTH_MODE" \
  '{
    environmentId: $envId,
    name: $name,
    transport: "streamable-http",
    authMode: $authMode
  }')"

GW_RESP="$(api_post "/api/tenants/${TENANT_ID}/gateways" "$GW_PAYLOAD")"
GATEWAY_ID="$(printf '%s' "$GW_RESP" | jq -r '.gatewayId // empty')"
CONNECTION_URL="$(printf '%s' "$GW_RESP" | jq -r '.connectionUrl // empty')"

if [[ -z "$CONNECTION_URL" || "$DRY_RUN" == "1" ]]; then
  # Derive a sensible default URL even if the gateway endpoint isn't wired yet
  API_HOST="$(printf '%s' "$API_URL" | sed 's|http://||;s|https://||;s|:.*||')"
  CONNECTION_URL="http://${API_HOST}:3848/tenant/${TENANT_ID}/mcp"
  GATEWAY_ID="${GATEWAY_ID:-gw_dryrun00000000}"
fi

log_result "Created gateway: ${GATEWAY_ID}"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

printf "\n"
printf "${BOLD}${GREEN}╔══════════════════════════════════════════════════╗${RESET}\n"
printf "${BOLD}${GREEN}║              Onboarding complete ✓               ║${RESET}\n"
printf "${BOLD}${GREEN}╚══════════════════════════════════════════════════╝${RESET}\n"
printf "\n"
printf "  ${BOLD}Tenant ID:${RESET}       %s\n" "$TENANT_ID"
printf "  ${BOLD}Tenant name:${RESET}     %s\n" "$TENANT_NAME"
printf "  ${BOLD}Tier:${RESET}            %s\n" "$TENANT_TIER"
printf "  ${BOLD}Environment ID:${RESET}  %s\n" "$ENV_ID"
printf "  ${BOLD}Gateway ID:${RESET}      %s\n" "$GATEWAY_ID"
printf "\n"
printf "  ${BOLD}${CYAN}Connection URL:${RESET}\n"
printf "  %s\n" "$CONNECTION_URL"
printf "\n"
printf "  Share the connection URL with the tenant admin.\n"
printf "  Users add it to their AI assistant and sign in with their work account.\n"
printf "\n"

# ---------------------------------------------------------------------------
# Next steps hint
# ---------------------------------------------------------------------------

printf "${BOLD}Next steps:${RESET}\n"
printf "  1. Bind credentials for each integration:\n"
printf "       %s/api/credentials\n" "$API_URL"
printf "  2. Register and approve upstream connectors:\n"
printf "       %s/api/upstreams\n" "$API_URL"
printf "       %s/api/approvals\n" "$API_URL"
printf "  3. Test the connection:\n"
printf "       curl -X POST '%s' \\\n" "$CONNECTION_URL"
printf "         -H 'Content-Type: application/json' \\\n"
printf "         -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"0\"}}}'  | jq .result.serverInfo\n"
printf "  4. Review the approval queue:\n"
printf "       curl '%s/api/approvals?tenantId=%s'\n" "$API_URL" "$TENANT_ID"
printf "\n"
printf "  Full lifecycle runbook: docs/runbooks/tenant-lifecycle.md\n"
printf "\n"

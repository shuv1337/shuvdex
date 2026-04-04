#!/usr/bin/env bash
# Emergency: immediately disable a tool (capability) or all tools in a package.
#
# Usage:
#   ./scripts/ops/kill-switch.sh <id> [options]
#
# Arguments:
#   id   Capability ID (e.g. "skill.crawl.start") or
#        Package ID    (e.g. "skill.crawl" or "openapi.gitea.api")
#
#   The script detects whether the ID is a package or a capability:
#     - If it exactly matches a registered package, all capabilities in that
#       package are disabled.
#     - Otherwise it is treated as a capability ID and that single tool is
#       disabled.
#
# Options:
#   --dry-run     Show what would be disabled without making changes
#   -h, --help    Show this help
#
# Environment:
#   SHUVDEX_API_URL   Admin API base URL  (default: http://localhost:3847)
#   SHUVDEX_TOKEN     Bearer token for API auth
#
# Examples:
#   # Disable a single tool
#   ./scripts/ops/kill-switch.sh skill.module_runtime_template.echo
#
#   # Disable all tools in a package
#   ./scripts/ops/kill-switch.sh openapi.gitea.api
#
#   # Dry run to preview impact
#   ./scripts/ops/kill-switch.sh openapi.gitea.api --dry-run

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

${BOLD}Usage:${RESET} $(basename "$0") <id> [--dry-run]

Emergency disable for a capability or an entire package.

${BOLD}Arguments:${RESET}
  id   Capability ID or Package ID to disable

${BOLD}Options:${RESET}
  --dry-run   Preview without making changes
  -h, --help  Show this help

${BOLD}Environment:${RESET}
  SHUVDEX_API_URL   Admin API base URL  (default: http://localhost:3847)
  SHUVDEX_TOKEN     Bearer token for API auth

${BOLD}Examples:${RESET}
  $(basename "$0") skill.module_runtime_template.echo
  $(basename "$0") openapi.gitea.api
  $(basename "$0") openapi.gitea.api --dry-run

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

[[ "${1:-}" == "--help" || "${1:-}" == "-h" ]] && usage
[[ $# -lt 1 ]] && { log_error "Missing required argument: id"; usage; }

TARGET_ID="$1"
DRY_RUN=0

shift
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage ;;
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
# Timestamp for audit trail
# ---------------------------------------------------------------------------

KILL_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ---------------------------------------------------------------------------
# Fetch all packages
# ---------------------------------------------------------------------------

log_info "Fetching registry state from ${API_URL}..."
PACKAGES_RESPONSE="$(curl -s -w "\n%{http_code}" "${API_URL}/api/packages" "${AUTH_ARGS[@]}")"
HTTP_CODE="$(printf '%s' "$PACKAGES_RESPONSE" | tail -n1)"
PACKAGES_BODY="$(printf '%s' "$PACKAGES_RESPONSE" | head -n -1)"

if [[ "$HTTP_CODE" != "200" ]]; then
  log_error "Failed to fetch packages (HTTP ${HTTP_CODE})"
  printf '%s\n' "$PACKAGES_BODY" | jq . >&2 2>/dev/null || printf '%s\n' "$PACKAGES_BODY" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Determine target type: package or capability
# ---------------------------------------------------------------------------

IS_PACKAGE="$(printf '%s\n' "$PACKAGES_BODY" | \
  jq -r --arg id "$TARGET_ID" '[.[] | select(.id == $id)] | length > 0')"

CAPABILITIES_TO_DISABLE=()

if [[ "$IS_PACKAGE" == "true" ]]; then
  log_info "Target '${TARGET_ID}' is a ${BOLD}package${RESET}" >&2

  # Collect all capability IDs in this package
  mapfile -t CAPABILITIES_TO_DISABLE < <(
    printf '%s\n' "$PACKAGES_BODY" | \
      jq -r --arg id "$TARGET_ID" \
        '.[] | select(.id == $id) | .capabilities[] | .id'
  )

  if [[ ${#CAPABILITIES_TO_DISABLE[@]} -eq 0 ]]; then
    log_warn "Package '${TARGET_ID}' has no capabilities."
    exit 0
  fi

  log_info "Found ${#CAPABILITIES_TO_DISABLE[@]} capability(ies) in package '${TARGET_ID}'"
else
  # Check if this is a valid capability
  CAP_EXISTS="$(printf '%s\n' "$PACKAGES_BODY" | \
    jq -r --arg id "$TARGET_ID" \
      '[.[] | .capabilities[] | select(.id == $id)] | length > 0')"

  if [[ "$CAP_EXISTS" != "true" ]]; then
    log_error "ID '${TARGET_ID}' is not a known package or capability."
    printf '\n' >&2
    log_info "Known packages:"
    printf '%s\n' "$PACKAGES_BODY" | jq -r '.[].id | "  " + .' >&2
    exit 1
  fi

  log_info "Target '${TARGET_ID}' is a ${BOLD}capability${RESET}" >&2
  CAPABILITIES_TO_DISABLE=("$TARGET_ID")
fi

# ---------------------------------------------------------------------------
# Dry run: show what would be disabled
# ---------------------------------------------------------------------------

if [[ "$DRY_RUN" == "1" ]]; then
  printf '\n'
  printf "${YELLOW}${BOLD}DRY RUN — no changes will be made${RESET}\n\n"
  printf "Would disable %d capability(ies):\n\n" "${#CAPABILITIES_TO_DISABLE[@]}"
  for cap_id in "${CAPABILITIES_TO_DISABLE[@]}"; do
    CURRENTLY_ENABLED="$(printf '%s\n' "$PACKAGES_BODY" | \
      jq -r --arg id "$cap_id" \
        '.[] | .capabilities[] | select(.id == $id) | .enabled')"
    if [[ "$CURRENTLY_ENABLED" == "true" ]]; then
      printf "  ${RED}✗${RESET}  %s  ${YELLOW}(currently enabled → would disable)${RESET}\n" "$cap_id"
    else
      printf "  ${DIM:-}─${RESET}  %s  ${DIM:-}(already disabled)${RESET:-}\n" "$cap_id"
    fi
  done
  printf '\n'
  printf "Run without --dry-run to apply.\n"
  exit 0
fi

# ---------------------------------------------------------------------------
# Apply: disable each capability
# ---------------------------------------------------------------------------

printf '\n'
printf "${RED}${BOLD}⚠  KILL SWITCH ACTIVATED — %s${RESET}\n\n" "$KILL_TIMESTAMP"
printf "Target: %s\n" "$TARGET_ID"
printf "Capabilities to disable: %d\n\n" "${#CAPABILITIES_TO_DISABLE[@]}"

DISABLED_COUNT=0
ALREADY_DISABLED=0
FAILED=()

for cap_id in "${CAPABILITIES_TO_DISABLE[@]}"; do
  # Check current state
  CURRENTLY_ENABLED="$(printf '%s\n' "$PACKAGES_BODY" | \
    jq -r --arg id "$cap_id" \
      '.[] | .capabilities[] | select(.id == $id) | .enabled')"

  if [[ "$CURRENTLY_ENABLED" == "false" ]]; then
    log_info "  Already disabled: ${cap_id}"
    ((ALREADY_DISABLED++)) || true
    continue
  fi

  # Disable
  RESPONSE="$(curl -s -w "\n%{http_code}" -X POST \
    "${API_URL}/api/tools/${cap_id}/disable" \
    "${AUTH_ARGS[@]}")"
  RESP_CODE="$(printf '%s' "$RESPONSE" | tail -n1)"
  RESP_BODY="$(printf '%s' "$RESPONSE" | head -n -1)"

  if [[ "$RESP_CODE" == "200" ]]; then
    RESULT_ENABLED="$(printf '%s\n' "$RESP_BODY" | jq -r '.enabled')"
    if [[ "$RESULT_ENABLED" == "false" ]]; then
      log_ok "  Disabled: ${cap_id}"
      ((DISABLED_COUNT++)) || true
    else
      log_warn "  Disable call succeeded but enabled=${RESULT_ENABLED} for ${cap_id}"
      FAILED+=("$cap_id")
    fi
  else
    log_error "  Failed to disable ${cap_id} (HTTP ${RESP_CODE})"
    FAILED+=("$cap_id")
  fi
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

printf '\n'
printf '%0.s─' {1..60}; printf '\n'
printf "${BOLD}Kill switch summary — %s${RESET}\n" "$KILL_TIMESTAMP"
printf '%0.s─' {1..60}; printf '\n'
printf "  Target:          %s\n" "$TARGET_ID"
printf "  Newly disabled:  %s\n" "$DISABLED_COUNT"
printf "  Already off:     %s\n" "$ALREADY_DISABLED"

if [[ ${#FAILED[@]} -gt 0 ]]; then
  printf "  ${RED}Failed:          %s${RESET}\n" "${#FAILED[@]}"
  for f in "${FAILED[@]}"; do printf "    - %s\n" "$f"; done
fi

printf '\n'

if [[ "$DISABLED_COUNT" -gt 0 ]]; then
  log_ok "Kill switch applied. ${DISABLED_COUNT} capability(ies) are now disabled."
  printf '\n' >&2
  log_info "To re-enable, run:"
  for cap_id in "${CAPABILITIES_TO_DISABLE[@]}"; do
    printf "  curl -sX POST %s/api/tools/%s/enable\n" "$API_URL" "$cap_id" >&2
  done
else
  log_info "No capabilities were changed."
fi

printf '\n' >&2

exit ${#FAILED[@]}

#!/usr/bin/env bash
# Backup shuvdex state to a timestamped archive.
#
# Usage:
#   ./scripts/ops/backup.sh [options]
#
# Options:
#   --destination <path>    Directory to write the backup archive (default: /data/backups)
#   --data-dir <path>       Source /data directory to back up (default: /data)
#   --verify <archive>      Verify an existing archive instead of creating one
#   --test-restore <path>   After verify, extract archive to <path> and validate
#   --dry-run               Print what would be backed up, without creating an archive
#   -h, --help              Show this help
#
# Environment:
#   SHUVDEX_DATA_DIR        Override --data-dir
#   SHUVDEX_BACKUP_DEST     Override --destination
#
# Exit codes:
#   0   Success
#   1   Error (missing source, integrity failure, etc.)

set -euo pipefail

# ---------------------------------------------------------------------------
# Colour helpers
# ---------------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

log_ok()    { printf "${GREEN}[ok]${RESET}    %s\n" "$*"; }
log_warn()  { printf "${YELLOW}[warn]${RESET}  %s\n" "$*"; }
log_error() { printf "${RED}[error]${RESET} %s\n" "$*" >&2; }
log_info()  { printf "${CYAN}[info]${RESET}  %s\n" "$*"; }

die() {
  log_error "$1"
  exit 1
}

usage() {
  cat >&2 <<EOF

${BOLD}Usage:${RESET} $(basename "$0") [options]

Backup shuvdex state (/data volume) to a timestamped .tar.gz archive.

${BOLD}Options:${RESET}
  --destination <path>   Output directory (default: /data/backups)
  --data-dir <path>      Source data directory (default: /data)
  --verify <archive>     Verify integrity of an existing archive
  --test-restore <path>  Extract verified archive to <path> for restoration test
  --dry-run              Show what would be backed up (no archive created)
  -h, --help             Show this help

${BOLD}Environment:${RESET}
  SHUVDEX_DATA_DIR       Override --data-dir
  SHUVDEX_BACKUP_DEST    Override --destination

${BOLD}Examples:${RESET}
  $(basename "$0")
  $(basename "$0") --destination /mnt/offsite-backup
  $(basename "$0") --verify /data/backups/shuvdex_backup_20260404_020000.tar.gz
  $(basename "$0") --verify /data/backups/shuvdex_backup_20260404_020000.tar.gz \\
                   --test-restore /tmp/restore-test

EOF
  exit 1
}

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------

DATA_DIR="${SHUVDEX_DATA_DIR:-/data}"
DEST="${SHUVDEX_BACKUP_DEST:-/data/backups}"
VERIFY_ARCHIVE=""
TEST_RESTORE_DIR=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --destination)    DEST="$2";            shift 2 ;;
    --data-dir)       DATA_DIR="$2";        shift 2 ;;
    --verify)         VERIFY_ARCHIVE="$2";  shift 2 ;;
    --test-restore)   TEST_RESTORE_DIR="$2"; shift 2 ;;
    --dry-run)        DRY_RUN=1;            shift ;;
    -h|--help)        usage ;;
    *) die "Unknown option: $1" ;;
  esac
done

# ---------------------------------------------------------------------------
# Verify mode
# ---------------------------------------------------------------------------

if [[ -n "$VERIFY_ARCHIVE" ]]; then
  [[ -f "$VERIFY_ARCHIVE" ]] || die "Archive not found: $VERIFY_ARCHIVE"

  log_info "Verifying archive: $VERIFY_ARCHIVE"

  # 1. Integrity check (gzip -t)
  gzip -t "$VERIFY_ARCHIVE" && log_ok "gzip integrity check passed" \
    || die "Archive is corrupted (gzip integrity check failed)"

  # 2. List contents and check required paths
  CONTENTS="$(tar -tzf "$VERIFY_ARCHIVE" 2>/dev/null)"

  REQUIRED_PATHS=(
    "packages/"
    "policy/"
    "credentials/"
    ".credential-key"
  )

  MISSING=()
  for required in "${REQUIRED_PATHS[@]}"; do
    if ! echo "$CONTENTS" | grep -q "^${required}"; then
      MISSING+=("$required")
    fi
  done

  if [[ ${#MISSING[@]} -gt 0 ]]; then
    log_warn "Missing paths in archive: ${MISSING[*]}"
    # Don't fail on missing optional paths — warn only
  else
    log_ok "All required paths present"
  fi

  # 3. Check credential key
  if echo "$CONTENTS" | grep -q "^\.credential-key"; then
    KEY_SIZE="$(tar -xzOf "$VERIFY_ARCHIVE" .credential-key 2>/dev/null | wc -c)"
    if [[ "${KEY_SIZE:-0}" -lt 10 ]]; then
      die "Credential key in archive is suspiciously short (${KEY_SIZE} bytes)"
    fi
    log_ok "Credential key present (${KEY_SIZE} bytes)"
  else
    log_warn "Credential key (.credential-key) not found in archive"
  fi

  # 4. Count packages
  PKG_COUNT="$(echo "$CONTENTS" | grep -c "^packages/.*\.yaml$" || echo 0)"
  log_info "Packages in archive: ${PKG_COUNT}"

  ARCHIVE_SIZE="$(du -sh "$VERIFY_ARCHIVE" | cut -f1)"
  log_info "Archive size: ${ARCHIVE_SIZE}"

  # 5. Optional: test restore
  if [[ -n "$TEST_RESTORE_DIR" ]]; then
    log_info "Testing restore to: $TEST_RESTORE_DIR"
    mkdir -p "$TEST_RESTORE_DIR"
    tar -xzf "$VERIFY_ARCHIVE" -C "$TEST_RESTORE_DIR"
    if [[ -f "${TEST_RESTORE_DIR}/.credential-key" ]]; then
      log_ok "Credential key extracted successfully"
    fi
    if [[ -d "${TEST_RESTORE_DIR}/packages" ]]; then
      RESTORED_PKGS="$(find "${TEST_RESTORE_DIR}/packages" -name "*.yaml" | wc -l)"
      log_ok "Restored ${RESTORED_PKGS} package file(s)"
    fi
    log_ok "Test restore complete: $TEST_RESTORE_DIR"
  fi

  log_ok "Archive verification passed: $VERIFY_ARCHIVE"
  exit 0
fi

# ---------------------------------------------------------------------------
# Backup mode
# ---------------------------------------------------------------------------

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_NAME="shuvdex_backup_${TIMESTAMP}.tar.gz"
BACKUP_PATH="${DEST}/${BACKUP_NAME}"

# Paths to include in the backup (relative to DATA_DIR)
# Listed in priority order (critical paths first)
INCLUDE_PATHS=(
  "packages"
  "policy"
  "credentials"
  "upstreams"
  "tenants"
  "approvals"
  "certifications"
  "role-mappings"
  "audit"
  "imports"
  "tool-caches"
)

# Always include the credential key if present
CREDENTIAL_KEY=".credential-key"

# ---------------------------------------------------------------------------
# Validate source
# ---------------------------------------------------------------------------

[[ -d "$DATA_DIR" ]] || die "Data directory not found: $DATA_DIR"

# ---------------------------------------------------------------------------
# Dry run
# ---------------------------------------------------------------------------

if [[ "$DRY_RUN" == "1" ]]; then
  log_info "DRY RUN — would create: $BACKUP_PATH"
  printf '\n'
  printf "${BOLD}%-30s  %s${RESET}\n" "PATH" "STATUS"
  printf '%0.s─' {1..50}; printf '\n'

  for rel_path in "${INCLUDE_PATHS[@]}"; do
    full_path="${DATA_DIR}/${rel_path}"
    if [[ -e "$full_path" ]]; then
      SIZE="$(du -sh "$full_path" 2>/dev/null | cut -f1)"
      printf "%-30s  ${GREEN}present (%s)${RESET}\n" "$rel_path" "$SIZE"
    else
      printf "%-30s  ${YELLOW}not present (skip)${RESET}\n" "$rel_path"
    fi
  done

  if [[ -f "${DATA_DIR}/${CREDENTIAL_KEY}" ]]; then
    printf "%-30s  ${GREEN}present${RESET}\n" "$CREDENTIAL_KEY"
  else
    printf "%-30s  ${RED}MISSING${RESET}\n" "$CREDENTIAL_KEY"
  fi
  printf '\n'
  log_info "Dry run complete — no archive created"
  exit 0
fi

# ---------------------------------------------------------------------------
# Create backup
# ---------------------------------------------------------------------------

log_info "Starting backup of $DATA_DIR → $BACKUP_PATH"

mkdir -p "$DEST"

# Build the list of paths that actually exist
EXISTING_PATHS=()
SKIPPED_PATHS=()

for rel_path in "${INCLUDE_PATHS[@]}"; do
  if [[ -e "${DATA_DIR}/${rel_path}" ]]; then
    EXISTING_PATHS+=("$rel_path")
  else
    SKIPPED_PATHS+=("$rel_path")
  fi
done

if [[ -f "${DATA_DIR}/${CREDENTIAL_KEY}" ]]; then
  EXISTING_PATHS+=("$CREDENTIAL_KEY")
else
  log_warn "Credential key not found at ${DATA_DIR}/${CREDENTIAL_KEY} — backup will not include it"
fi

if [[ ${#EXISTING_PATHS[@]} -eq 0 ]]; then
  die "No data found to back up in $DATA_DIR"
fi

# Create the archive
tar -czf "$BACKUP_PATH" \
  -C "$DATA_DIR" \
  "${EXISTING_PATHS[@]}"

ARCHIVE_SIZE="$(du -sh "$BACKUP_PATH" | cut -f1)"

log_ok "Archive created: $BACKUP_PATH ($ARCHIVE_SIZE)"

if [[ ${#SKIPPED_PATHS[@]} -gt 0 ]]; then
  log_warn "Skipped (not present): ${SKIPPED_PATHS[*]}"
fi

# ---------------------------------------------------------------------------
# Quick integrity verify
# ---------------------------------------------------------------------------

gzip -t "$BACKUP_PATH" \
  && log_ok "Archive integrity verified" \
  || die "Archive failed integrity check immediately after creation"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

printf '\n'
printf "${BOLD}Backup complete${RESET}\n"
printf "  Archive:   %s\n" "$BACKUP_PATH"
printf "  Size:      %s\n" "$ARCHIVE_SIZE"
printf "  Timestamp: %s\n" "$TIMESTAMP"
printf "  Paths:     %s\n" "${EXISTING_PATHS[*]}"
printf '\n'

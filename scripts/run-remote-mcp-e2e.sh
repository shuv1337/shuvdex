#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_HOST="${TARGET_HOST:-$(hostname -s)}"
TARGET_DNS="${TARGET_DNS:-${TARGET_HOST}}"
MCP_HOST="${MCP_HOST:-0.0.0.0}"
MCP_PORT="${MCP_PORT:-3848}"
LOCAL_REPO_PATH="${LOCAL_REPO_PATH:-$REPO_ROOT}"
CAPABILITIES_DIR="${CAPABILITIES_DIR:-$REPO_ROOT/.capabilities/packages}"
POLICY_DIR="${POLICY_DIR:-$REPO_ROOT/.capabilities/policy}"
CAPABILITIES_ROOT="$(cd "$CAPABILITIES_DIR/.." && pwd)"
REMOTE_MCP_URL="${REMOTE_MCP_URL:-http://${TARGET_DNS}:${MCP_PORT}/mcp}"
REMOTE_HEALTH_URL="${REMOTE_HEALTH_URL:-http://${TARGET_DNS}:${MCP_PORT}/health}"
SESSION_NAME="${SESSION_NAME:-shuvdex-e2e}"
CLIENT="${CLIENT:-opencode}"
TARGET="${TARGET:-echo}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-45}"
ENABLE_TMUX="${ENABLE_TMUX:-1}"
SKIP_SERVER_START="${SKIP_SERVER_START:-0}"
SKIP_SEED="${SKIP_SEED:-0}"
SYSTEMD_SERVICE_NAME="${SYSTEMD_SERVICE_NAME:-shuvdex-mcp.service}"
SERVER_MODE="${SERVER_MODE:-auto}"

ARTIFACTS_DIR="/tmp/shuvdex-e2e/artifacts/$CLIENT/$TARGET"
SERVER_LOG="/tmp/shuvdex-mcp-remote.log"
SERVER_ERR="/tmp/shuvdex-mcp-remote.err"
SERVER_PID_FILE="/tmp/shuvdex-mcp-remote.pid"
DISCOVERY_OUT="$ARTIFACTS_DIR/tool-discovery.jsonl"
CALL_OUT="$ARTIFACTS_DIR/tool-call.jsonl"
TMUX_JSONL="$ARTIFACTS_DIR/tmux-timeout-run.jsonl"
TMUX_STDERR="$ARTIFACTS_DIR/tmux-timeout-run.stderr"
SUMMARY_JSON="$ARTIFACTS_DIR/summary.json"
MCP_LIST_TXT="$ARTIFACTS_DIR/mcp-list.txt"
SEED_JSON="$ARTIFACTS_DIR/seed.json"

log() {
  printf '[shuvdex-e2e] %s\n' "$*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

target_settings() {
  case "$TARGET" in
    echo)
      TARGET_KIND="module_runtime"
      TARGET_LABEL="deterministic-echo"
      EXPECTED_TOOL_NAME="shuvdex_skill_module_runtime_template_echo"
      PROMPT_TOOL_DISCOVERY="${PROMPT_TOOL_DISCOVERY:-List the available tools coming from the shuvdex MCP server only. Then tell me the exact name of the deterministic echo tool if present. Use shuvdex.}"
      PROMPT_TOOL_CALL="${PROMPT_TOOL_CALL:-Use the shuvdex_skill_module_runtime_template_echo tool to echo the exact string CLEAN_TEST_123 and show the exact structured result. Use shuvdex.}"
      PROMPT_TOOL_NEGATIVE="${PROMPT_TOOL_NEGATIVE:-Call the shuvdex_skill_module_runtime_template_echo tool without a message and report the exact error payload. Use shuvdex only.}"
      ;;
    youtube-transcript)
      TARGET_KIND="module_runtime"
      TARGET_LABEL="youtube-transcript"
      EXPECTED_TOOL_NAME="skill.youtube_transcript.fetch_transcript"
      YT_VIDEO="${YT_VIDEO:-dQw4w9WgXcQ}"
      PROMPT_TOOL_DISCOVERY="${PROMPT_TOOL_DISCOVERY:-List the available tools coming from the shuvdex MCP server only. Tell me the exact tool name for fetching a YouTube transcript. Use shuvdex only.}"
      PROMPT_TOOL_CALL="${PROMPT_TOOL_CALL:-Use the skill.youtube_transcript.fetch_transcript tool to fetch a transcript for YouTube video $YT_VIDEO and show the returned structured result, including videoId and entryCount. Use shuvdex only.}"
      PROMPT_TOOL_NEGATIVE="${PROMPT_TOOL_NEGATIVE:-Use the skill.youtube_transcript.fetch_transcript tool with an invalid empty video argument and report the exact error payload. Use shuvdex only.}"
      ;;
    gitea-version)
      TARGET_KIND="http_api"
      TARGET_LABEL="gitea-version"
      EXPECTED_TOOL_NAME="shuvdex_openapi_gitea_api_getVersion"
      PROMPT_TOOL_DISCOVERY="${PROMPT_TOOL_DISCOVERY:-List the available tools coming from the shuvdex MCP server only. Tell me the exact tool name for the Gitea version endpoint if present. Use shuvdex only.}"
      PROMPT_TOOL_CALL="${PROMPT_TOOL_CALL:-Use the shuvdex_openapi_gitea_api_getVersion tool and show me the exact structured result, including the returned version field. Use shuvdex only.}"
      PROMPT_TOOL_NEGATIVE="${PROMPT_TOOL_NEGATIVE:-Call a clearly non-existent shuvdex tool name and report the exact failure behavior. Do not fabricate success.}"
      ;;
    dnsfilter-current-user)
      TARGET_KIND="http_api"
      TARGET_LABEL="dnsfilter-current-user"
      EXPECTED_TOOL_NAME="shuvdex_openapi_dnsfilter_api_currentUser"
      PROMPT_TOOL_DISCOVERY="${PROMPT_TOOL_DISCOVERY:-List the available tools coming from the shuvdex MCP server only. Tell me the exact tool name for the DNSFilter current-user endpoint if present. Use shuvdex only.}"
      PROMPT_TOOL_CALL="${PROMPT_TOOL_CALL:-Use the shuvdex_openapi_dnsfilter_api_currentUser tool and show me the exact structured result, including the authenticated user email or id if present. Use shuvdex only.}"
      PROMPT_TOOL_NEGATIVE="${PROMPT_TOOL_NEGATIVE:-Call a clearly non-existent shuvdex tool name and report the exact failure behavior. Do not fabricate success.}"
      ;;
    *)
      echo "Unsupported TARGET: $TARGET" >&2
      echo "Supported targets: echo, youtube-transcript, gitea-version, dnsfilter-current-user" >&2
      exit 1
      ;;
  esac
}

prepare_artifacts() {
  log "Preparing artifacts directory at $ARTIFACTS_DIR"
  rm -rf "$ARTIFACTS_DIR"
  mkdir -p "$ARTIFACTS_DIR"
  pwd > "$ARTIFACTS_DIR/pwd.txt"
}

seed_target() {
  if [[ "$SKIP_SEED" == "1" ]]; then
    log "Skipping target seeding by request"
    return 0
  fi
  log "Seeding target '$TARGET'"
  case "$TARGET" in
    echo)
      node "$REPO_ROOT/scripts/seed-module-runtime-template.mjs" "$REPO_ROOT" "$REPO_ROOT/examples/module-runtime-skill-template" "$CAPABILITIES_DIR" | tee "$SEED_JSON"
      ;;
    youtube-transcript)
      node "$REPO_ROOT/scripts/stage-module-runtime-skill.mjs" "$REPO_ROOT" "/home/shuv/repos/shuvbot-skills/youtube-transcript" "$CAPABILITIES_ROOT/imports" "$CAPABILITIES_DIR" | tee "$SEED_JSON"
      ;;
    gitea-version)
      node "$REPO_ROOT/scripts/seed-gitea-openapi.mjs" "$REPO_ROOT" "$CAPABILITIES_ROOT" | tee "$SEED_JSON"
      ;;
    dnsfilter-current-user)
      node "$REPO_ROOT/scripts/seed-dnsfilter-openapi.mjs" "$REPO_ROOT" "$CAPABILITIES_ROOT" | tee "$SEED_JSON"
      ;;
  esac
}

start_remote_server() {
  if [[ "$SKIP_SERVER_START" == "1" ]]; then
    log "Skipping remote server start by request"
    curl -fsS "$REMOTE_HEALTH_URL" > "$ARTIFACTS_DIR/health.json"
    return 0
  fi

  local mode="$SERVER_MODE"
  if [[ "$mode" == "auto" ]]; then
    if command -v systemctl >/dev/null 2>&1 && systemctl --user status "$SYSTEMD_SERVICE_NAME" >/dev/null 2>&1; then
      mode="systemd"
    else
      mode="local"
    fi
  fi

  if [[ "$mode" == "systemd" ]]; then
    log "Rebuilding MCP server and restarting user systemd service $SYSTEMD_SERVICE_NAME"
    (cd "$REPO_ROOT" && npm run build --workspace @shuvdex/mcp-server)
    systemctl --user restart "$SYSTEMD_SERVICE_NAME"
  else
    log "Building remote MCP server"
    (cd "$REPO_ROOT" && npm run build --workspace @shuvdex/mcp-server)

    if [[ -f "$SERVER_PID_FILE" ]] && kill -0 "$(cat "$SERVER_PID_FILE")" 2>/dev/null; then
      log "Stopping existing remote MCP server PID $(cat "$SERVER_PID_FILE")"
      kill -TERM "$(cat "$SERVER_PID_FILE")" || true
      sleep 1
    fi

    log "Starting remote MCP server on ${MCP_HOST}:${MCP_PORT}"
    (
      cd "$REPO_ROOT"
      MCP_HOST="$MCP_HOST" \
      MCP_PORT="$MCP_PORT" \
      LOCAL_REPO_PATH="$LOCAL_REPO_PATH" \
      CAPABILITIES_DIR="$CAPABILITIES_DIR" \
      POLICY_DIR="$POLICY_DIR" \
      node apps/mcp-server/dist/http.js >"$SERVER_LOG" 2>"$SERVER_ERR" &
      echo $! > "$SERVER_PID_FILE"
    )
  fi

  for _ in $(seq 1 150); do
    if curl -fsS "$REMOTE_HEALTH_URL" > "$ARTIFACTS_DIR/health.json" 2>/dev/null; then
      return 0
    fi
    sleep 0.1
  done

  echo "Remote MCP server failed to become healthy at $REMOTE_HEALTH_URL" >&2
  if [[ "$mode" == "systemd" ]]; then
    systemctl --user status --no-pager --full "$SYSTEMD_SERVICE_NAME" | sed -n '1,120p' >&2 || true
  else
    cat "$SERVER_ERR" >&2 || true
  fi
  exit 1
}

# --- Client-specific run functions ---

run_discovery_opencode() {
  log "Running opencode discovery prompt for target '$TARGET'"
  opencode mcp list > "$MCP_LIST_TXT" 2>&1 || true
  opencode run --title "shuvdex_${TARGET}_tool_discovery" --format json "$PROMPT_TOOL_DISCOVERY" > "$DISCOVERY_OUT" 2>&1 || true
}

run_tool_call_opencode() {
  log "Running opencode invocation prompt for target '$TARGET'"
  opencode run --title "shuvdex_${TARGET}_tool_call" --format json "$PROMPT_TOOL_CALL" > "$CALL_OUT" 2>&1 || true
}

run_tmux_proof_opencode() {
  if [[ "$ENABLE_TMUX" != "1" ]]; then
    log "Skipping tmux proof by request"
    return 0
  fi

  log "Running tmux-supervised proof in session ${SESSION_NAME}-${TARGET}"
  if tmux has-session -t "${SESSION_NAME}-${TARGET}" 2>/dev/null; then
    tmux kill-session -t "${SESSION_NAME}-${TARGET}"
  fi
  tmux new-session -d -s "${SESSION_NAME}-${TARGET}" -n run
  tmux pipe-pane -o -t "${SESSION_NAME}-${TARGET}":run "cat >> $ARTIFACTS_DIR/tmux-pane.log"
  tmux send-keys -t "${SESSION_NAME}-${TARGET}":run "timeout $TIMEOUT_SECONDS opencode run --title tmux_${TARGET}_smoke --format json \"$PROMPT_TOOL_CALL\" > $TMUX_JSONL 2> $TMUX_STDERR; echo EXIT:\$?" C-m
  sleep "$(( TIMEOUT_SECONDS / 2 ))"
  tmux capture-pane -p -t "${SESSION_NAME}-${TARGET}":run -S -300 > "$ARTIFACTS_DIR/tmux-pane-capture.txt"
}

run_discovery_codex() {
  log "Running codex discovery prompt for target '$TARGET'"
  codex mcp list > "$MCP_LIST_TXT" 2>&1 || true
  codex exec --json --output-last-message "$ARTIFACTS_DIR/last-message-discovery.txt" "$PROMPT_TOOL_DISCOVERY" > "$DISCOVERY_OUT" 2>&1 || true
}

run_tool_call_codex() {
  log "Running codex invocation prompt for target '$TARGET'"
  codex exec --json --output-last-message "$ARTIFACTS_DIR/last-message-call.txt" "$PROMPT_TOOL_CALL" > "$CALL_OUT" 2>&1 || true
}

run_tmux_proof_codex() {
  if [[ "$ENABLE_TMUX" != "1" ]]; then
    log "Skipping tmux proof by request"
    return 0
  fi

  log "Running tmux-supervised codex proof in session ${SESSION_NAME}-${TARGET}"
  if tmux has-session -t "${SESSION_NAME}-${TARGET}" 2>/dev/null; then
    tmux kill-session -t "${SESSION_NAME}-${TARGET}"
  fi
  tmux new-session -d -s "${SESSION_NAME}-${TARGET}" -n run
  tmux pipe-pane -o -t "${SESSION_NAME}-${TARGET}":run "cat >> $ARTIFACTS_DIR/tmux-pane.log"
  tmux send-keys -t "${SESSION_NAME}-${TARGET}":run "timeout $TIMEOUT_SECONDS codex exec --json --output-last-message $ARTIFACTS_DIR/last-message-tmux.txt \"$PROMPT_TOOL_CALL\" > $TMUX_JSONL 2> $TMUX_STDERR; echo EXIT:\$?" C-m
  sleep "$(( TIMEOUT_SECONDS / 2 ))"
  tmux capture-pane -p -t "${SESSION_NAME}-${TARGET}":run -S -300 > "$ARTIFACTS_DIR/tmux-pane-capture.txt"
}

# --- Dispatcher ---

run_discovery() {
  case "$CLIENT" in
    opencode) run_discovery_opencode ;;
    codex)    run_discovery_codex ;;
    *)
      echo "Unsupported CLIENT: $CLIENT" >&2
      echo "Supported clients: opencode, codex" >&2
      exit 1
      ;;
  esac
}

run_tool_call() {
  case "$CLIENT" in
    opencode) run_tool_call_opencode ;;
    codex)    run_tool_call_codex ;;
    *)
      echo "Unsupported CLIENT: $CLIENT" >&2
      exit 1
      ;;
  esac
}

run_tmux_proof() {
  case "$CLIENT" in
    opencode) run_tmux_proof_opencode ;;
    codex)    run_tmux_proof_codex ;;
    *)
      echo "Unsupported CLIENT: $CLIENT" >&2
      exit 1
      ;;
  esac
}

write_summary() {
  log "Writing summary artifact"
  python3 - <<PY
import json, pathlib, time
root = pathlib.Path("$ARTIFACTS_DIR")
summary = {
  "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
  "target": "$TARGET",
  "target_label": "$TARGET_LABEL",
  "target_kind": "$TARGET_KIND",
  "expected_tool_name": "$EXPECTED_TOOL_NAME",
  "client": "$CLIENT",
  "remote_mcp_url": "$REMOTE_MCP_URL",
  "remote_health_url": "$REMOTE_HEALTH_URL",
  "session_name": "${SESSION_NAME}-${TARGET}",
  "server_mode": "$SERVER_MODE",
  "systemd_service_name": "$SYSTEMD_SERVICE_NAME",
  "server_pid": pathlib.Path("$SERVER_PID_FILE").read_text().strip() if pathlib.Path("$SERVER_PID_FILE").exists() else None,
  "artifacts": {
    "seed": str(root / "seed.json") if (root / "seed.json").exists() else None,
    "health": str(root / "health.json"),
    "pwd": str(root / "pwd.txt"),
    "mcp_list": str(root / "mcp-list.txt"),
    "tool_discovery": str(root / "tool-discovery.jsonl"),
    "tool_call": str(root / "tool-call.jsonl"),
    "tmux_jsonl": str(root / "tmux-timeout-run.jsonl"),
    "tmux_stderr": str(root / "tmux-timeout-run.stderr"),
    "tmux_capture": str(root / "tmux-pane-capture.txt"),
    "server_err": "$SERVER_ERR",
    "server_log": "$SERVER_LOG",
  },
  "prompts": {
    "discovery": "$PROMPT_TOOL_DISCOVERY",
    "call": "$PROMPT_TOOL_CALL",
    "negative": "$PROMPT_TOOL_NEGATIVE",
  },
}
(root / "summary.json").write_text(json.dumps(summary, indent=2))
print(json.dumps(summary, indent=2))
PY
}

main() {
  require_cmd node
  require_cmd npm
  require_cmd curl

  case "$CLIENT" in
    opencode) require_cmd opencode ;;
    codex)    require_cmd codex ;;
    *)
      echo "Unsupported CLIENT: $CLIENT" >&2
      echo "Supported clients: opencode, codex" >&2
      exit 1
      ;;
  esac

  if [[ "$ENABLE_TMUX" == "1" ]]; then
    require_cmd tmux
  fi

  target_settings
  prepare_artifacts
  seed_target
  start_remote_server
  run_discovery
  run_tool_call
  run_tmux_proof
  write_summary
  log "Done — client=$CLIENT target=$TARGET artifacts=$ARTIFACTS_DIR"
}

main "$@"

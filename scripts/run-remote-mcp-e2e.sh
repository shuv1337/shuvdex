#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_HOST="${TARGET_HOST:-$(hostname -s)}"
TARGET_DNS="${TARGET_DNS:-${TARGET_HOST}}"
TEST_ROOT="${TEST_ROOT:-/tmp/shuvdex-opencode-clean}"
MCP_HOST="${MCP_HOST:-0.0.0.0}"
MCP_PORT="${MCP_PORT:-3848}"
LOCAL_REPO_PATH="${LOCAL_REPO_PATH:-$REPO_ROOT}"
CAPABILITIES_DIR="${CAPABILITIES_DIR:-$REPO_ROOT/.capabilities/packages}"
POLICY_DIR="${POLICY_DIR:-$REPO_ROOT/.capabilities/policy}"
CAPABILITIES_ROOT="$(cd "$CAPABILITIES_DIR/.." && pwd)"
REMOTE_MCP_URL="${REMOTE_MCP_URL:-http://${TARGET_DNS}:${MCP_PORT}/mcp}"
REMOTE_HEALTH_URL="${REMOTE_HEALTH_URL:-http://${TARGET_DNS}:${MCP_PORT}/health}"
SESSION_NAME="${SESSION_NAME:-shuvdex-opencode-e2e}"
CLIENT="${CLIENT:-opencode}"
PROVIDER="${PROVIDER:-opencode}"
MODEL="${MODEL:-opencode/gpt-5-nano}"
SMALL_MODEL="${SMALL_MODEL:-$MODEL}"
TARGET="${TARGET:-echo}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-45}"
ENABLE_TMUX="${ENABLE_TMUX:-1}"
SKIP_SERVER_START="${SKIP_SERVER_START:-0}"
SYSTEMD_SERVICE_NAME="${SYSTEMD_SERVICE_NAME:-shuvdex-mcp.service}"
SERVER_MODE="${SERVER_MODE:-auto}"

ARTIFACTS_DIR="$TEST_ROOT/artifacts/$TARGET"
ENV_SH="$TEST_ROOT/env.sh"
CONFIG_DIR="$TEST_ROOT/config/opencode"
CONFIG_JSON="$CONFIG_DIR/opencode.json"
SERVER_LOG="/tmp/shuvdex-mcp-remote.log"
SERVER_ERR="/tmp/shuvdex-mcp-remote.err"
SERVER_PID_FILE="/tmp/shuvdex-mcp-remote.pid"
DISCOVERY_JSONL="$ARTIFACTS_DIR/tool-discovery.jsonl"
CALL_JSONL="$ARTIFACTS_DIR/tool-call.jsonl"
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
      exit 1
      ;;
  esac
}

prepare_clean_room() {
  log "Preparing clean-room client environment at $TEST_ROOT"
  rm -rf "$CONFIG_DIR" "$TEST_ROOT/data" "$TEST_ROOT/cache" "$TEST_ROOT/state" "$TEST_ROOT/workspace" "$TEST_ROOT/home" "$ARTIFACTS_DIR"
  mkdir -p "$CONFIG_DIR" "$TEST_ROOT/data" "$TEST_ROOT/cache" "$TEST_ROOT/state" "$TEST_ROOT/workspace" "$ARTIFACTS_DIR" "$TEST_ROOT/home"

  cat > "$CONFIG_JSON" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "$MODEL",
  "small_model": "$SMALL_MODEL",
  "enabled_providers": ["$PROVIDER"],
  "mcp": {
    "shuvdex": {
      "type": "remote",
      "url": "$REMOTE_MCP_URL",
      "enabled": true,
      "timeout": 10000
    }
  }
}
JSON

  cat > "$ENV_SH" <<SH
export XDG_CONFIG_HOME=$TEST_ROOT/config
export XDG_DATA_HOME=$TEST_ROOT/data
export XDG_CACHE_HOME=$TEST_ROOT/cache
export XDG_STATE_HOME=$TEST_ROOT/state
export OPENCODE_TEST_HOME=$TEST_ROOT/home
export OPENCODE_DISABLE_CLAUDE_CODE=1
export OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=1
export OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1
cd $TEST_ROOT/workspace
pwd > $ARTIFACTS_DIR/pwd.txt
SH
  chmod +x "$ENV_SH"
}

seed_target() {
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

run_discovery() {
  log "Running isolated client discovery prompt for target '$TARGET'"
  (
    source "$ENV_SH"
    opencode mcp list > "$MCP_LIST_TXT"
    opencode run --title "shuvdex_${TARGET}_tool_discovery" --format json "$PROMPT_TOOL_DISCOVERY" > "$DISCOVERY_JSONL"
  )
}

run_tool_call() {
  log "Running isolated client invocation prompt for target '$TARGET'"
  (
    source "$ENV_SH"
    opencode run --title "shuvdex_${TARGET}_tool_call" --format json "$PROMPT_TOOL_CALL" > "$CALL_JSONL"
  )
}

run_tmux_proof() {
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
  tmux send-keys -t "${SESSION_NAME}-${TARGET}":run "source $ENV_SH && timeout $TIMEOUT_SECONDS opencode run --title tmux_${TARGET}_smoke --format json \"$PROMPT_TOOL_CALL\" > $TMUX_JSONL 2> $TMUX_STDERR; echo EXIT:\$?" C-m
  sleep "$(( TIMEOUT_SECONDS / 2 ))"
  tmux capture-pane -p -t "${SESSION_NAME}-${TARGET}":run -S -300 > "$ARTIFACTS_DIR/tmux-pane-capture.txt"
}

write_summary() {
  log "Writing summary artifact"
  python - <<PY
import json, pathlib
root = pathlib.Path("$ARTIFACTS_DIR")
summary = {
  "target": "$TARGET",
  "target_label": "$TARGET_LABEL",
  "target_kind": "$TARGET_KIND",
  "expected_tool_name": "$EXPECTED_TOOL_NAME",
  "client": "$CLIENT",
  "provider": "$PROVIDER",
  "model": "$MODEL",
  "small_model": "$SMALL_MODEL",
  "remote_mcp_url": "$REMOTE_MCP_URL",
  "remote_health_url": "$REMOTE_HEALTH_URL",
  "session_name": "${SESSION_NAME}-${TARGET}",
  "server_mode": "$SERVER_MODE",
  "systemd_service_name": "$SYSTEMD_SERVICE_NAME",
  "server_pid": pathlib.Path("$SERVER_PID_FILE").read_text().strip() if pathlib.Path("$SERVER_PID_FILE").exists() else None,
  "artifacts": {
    "seed": str(root / "seed.json"),
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
  require_cmd opencode
  if [[ "$ENABLE_TMUX" == "1" ]]; then
    require_cmd tmux
  fi

  target_settings
  prepare_clean_room
  seed_target
  start_remote_server
  run_discovery
  run_tool_call
  run_tmux_proof
  write_summary
  log "Done"
}

main "$@"

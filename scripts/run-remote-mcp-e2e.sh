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
REMOTE_MCP_URL="${REMOTE_MCP_URL:-http://${TARGET_DNS}:${MCP_PORT}/mcp}"
REMOTE_HEALTH_URL="${REMOTE_HEALTH_URL:-http://${TARGET_DNS}:${MCP_PORT}/health}"
SESSION_NAME="${SESSION_NAME:-shuvdex-opencode-e2e}"
MODEL="${MODEL:-opencode/gpt-5-nano}"
SMALL_MODEL="${SMALL_MODEL:-$MODEL}"
PROMPT_TOOL_DISCOVERY="${PROMPT_TOOL_DISCOVERY:-List the available tools coming from the shuvdex MCP server only. Then tell me the exact name of the deterministic echo tool if present. Use shuvdex.}"
PROMPT_TOOL_CALL="${PROMPT_TOOL_CALL:-Use the shuvdex_skill_module_runtime_template_echo tool to echo the exact string CLEAN_TEST_123 and show the exact structured result. Use shuvdex.}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-30}"

ARTIFACTS_DIR="$TEST_ROOT/artifacts"
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

log() {
  printf '[shuvdex-e2e] %s\n' "$*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

prepare_clean_room() {
  log "Preparing clean-room OpenCode environment at $TEST_ROOT"
  rm -rf "$TEST_ROOT"
  mkdir -p "$CONFIG_DIR" "$TEST_ROOT/data" "$TEST_ROOT/cache" "$TEST_ROOT/state" "$TEST_ROOT/workspace" "$ARTIFACTS_DIR" "$TEST_ROOT/home"

  cat > "$CONFIG_JSON" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "$MODEL",
  "small_model": "$SMALL_MODEL",
  "enabled_providers": ["opencode"],
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
SH
  chmod +x "$ENV_SH"
}

seed_fixture() {
  log "Seeding deterministic module_runtime fixture into $CAPABILITIES_DIR"
  node "$REPO_ROOT/scripts/seed-module-runtime-template.mjs" "$REPO_ROOT" "$REPO_ROOT/examples/module-runtime-skill-template" "$CAPABILITIES_DIR"
}

start_remote_server() {
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

  for _ in $(seq 1 100); do
    if curl -fsS "$REMOTE_HEALTH_URL" > "$ARTIFACTS_DIR/health.json" 2>/dev/null; then
      return 0
    fi
    sleep 0.1
  done

  echo "Remote MCP server failed to become healthy at $REMOTE_HEALTH_URL" >&2
  cat "$SERVER_ERR" >&2 || true
  exit 1
}

run_discovery() {
  log "Running isolated OpenCode discovery prompt"
  (
    source "$ENV_SH"
    opencode mcp list > "$ARTIFACTS_DIR/mcp-list.txt"
    opencode run --title shuvdex_tool_discovery --format json "$PROMPT_TOOL_DISCOVERY" > "$DISCOVERY_JSONL"
  )
}

run_tool_call() {
  log "Running isolated OpenCode tool invocation prompt"
  (
    source "$ENV_SH"
    opencode run --title shuvdex_tool_call --format json "$PROMPT_TOOL_CALL" > "$CALL_JSONL"
  )
}

run_tmux_proof() {
  log "Running tmux-supervised proof in session $SESSION_NAME"
  if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    tmux kill-session -t "$SESSION_NAME"
  fi
  tmux new-session -d -s "$SESSION_NAME" -n run
  tmux pipe-pane -o -t "$SESSION_NAME":run "cat >> $ARTIFACTS_DIR/tmux-pane.log"
  tmux send-keys -t "$SESSION_NAME":run "source $ENV_SH && timeout $TIMEOUT_SECONDS opencode run --title tmux_smoke --format json \"$PROMPT_TOOL_CALL\" > $TMUX_JSONL 2> $TMUX_STDERR; echo EXIT:\$?" C-m
  sleep "$(( TIMEOUT_SECONDS / 2 ))"
  tmux capture-pane -p -t "$SESSION_NAME":run -S -300 > "$ARTIFACTS_DIR/tmux-pane-capture.txt"
}

write_summary() {
  log "Writing summary artifact"
  python - <<PY
import json, pathlib
root = pathlib.Path("$ARTIFACTS_DIR")
summary = {
  "remote_mcp_url": "$REMOTE_MCP_URL",
  "remote_health_url": "$REMOTE_HEALTH_URL",
  "model": "$MODEL",
  "small_model": "$SMALL_MODEL",
  "session_name": "$SESSION_NAME",
  "server_pid": pathlib.Path("$SERVER_PID_FILE").read_text().strip() if pathlib.Path("$SERVER_PID_FILE").exists() else None,
  "artifacts": {
    "health": str(root / "health.json"),
    "mcp_list": str(root / "mcp-list.txt"),
    "tool_discovery": str(root / "tool-discovery.jsonl"),
    "tool_call": str(root / "tool-call.jsonl"),
    "tmux_jsonl": str(root / "tmux-timeout-run.jsonl"),
    "tmux_stderr": str(root / "tmux-timeout-run.stderr"),
    "tmux_capture": str(root / "tmux-pane-capture.txt"),
    "server_err": "$SERVER_ERR",
    "server_log": "$SERVER_LOG",
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
  require_cmd tmux

  prepare_clean_room
  seed_fixture
  start_remote_server
  run_discovery
  run_tool_call
  run_tmux_proof
  write_summary
  log "Done"
}

main "$@"

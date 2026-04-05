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
TARGET="${TARGET:-echo}"
SKIP_SERVER_START="${SKIP_SERVER_START:-0}"
SKIP_SEED="${SKIP_SEED:-0}"
SYSTEMD_SERVICE_NAME="${SYSTEMD_SERVICE_NAME:-shuvdex-mcp.service}"
SERVER_MODE="${SERVER_MODE:-auto}"

ARTIFACTS_DIR="/tmp/shuvdex-mcp-certification/${TARGET}"
SERVER_LOG="/tmp/shuvdex-mcp-remote.log"
SERVER_ERR="/tmp/shuvdex-mcp-remote.err"
SERVER_PID_FILE="/tmp/shuvdex-mcp-remote.pid"
HEALTH_JSON="$ARTIFACTS_DIR/health.json"
INIT_JSON="$ARTIFACTS_DIR/initialize.json"
TOOLS_JSON="$ARTIFACTS_DIR/tools-list.json"
CALL_JSON="$ARTIFACTS_DIR/tool-call.json"
NEGATIVE_JSON="$ARTIFACTS_DIR/tool-call-negative.json"
CRAWL_START_JSON="$ARTIFACTS_DIR/crawl-start.json"
CRAWL_STATUS_JSON="$ARTIFACTS_DIR/crawl-status.json"
CRAWL_WAIT_JSON="$ARTIFACTS_DIR/crawl-wait.json"
SUMMARY_JSON="$ARTIFACTS_DIR/summary.json"
SEED_JSON="$ARTIFACTS_DIR/seed.json"

log() {
  printf '[shuvdex-mcp-cert] %s\n' "$*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

target_settings() {
  EXPECTED_TOOL_NAMES=()
  NEGATIVE_CALL_ARGS=""
  case "$TARGET" in
    echo)
      TARGET_KIND="module_runtime"
      TARGET_LABEL="deterministic-echo"
      EXPECTED_TOOL_NAMES=("skill.module_runtime_template.echo")
      POSITIVE_CALL_ARGS='{"name":"skill.module_runtime_template.echo","arguments":{"message":"CLEAN_TEST_123"}}'
      NEGATIVE_CALL_ARGS='{"name":"skill.module_runtime_template.echo","arguments":{}}'
      ;;
    youtube-transcript)
      TARGET_KIND="module_runtime"
      TARGET_LABEL="youtube-transcript"
      YT_VIDEO="${YT_VIDEO:-dQw4w9WgXcQ}"
      EXPECTED_TOOL_NAMES=("skill.youtube_transcript.fetch_transcript")
      POSITIVE_CALL_ARGS="$(jq -nc --arg video "$YT_VIDEO" '{name:"skill.youtube_transcript.fetch_transcript",arguments:{video:$video}}')"
      NEGATIVE_CALL_ARGS='{"name":"skill.youtube_transcript.fetch_transcript","arguments":{}}'
      ;;
    gitea-version)
      TARGET_KIND="http_api"
      TARGET_LABEL="gitea-version"
      EXPECTED_TOOL_NAMES=("openapi.gitea.api.getVersion")
      POSITIVE_CALL_ARGS='{"name":"openapi.gitea.api.getVersion","arguments":{}}'
      ;;
    dnsfilter-current-user)
      TARGET_KIND="http_api"
      TARGET_LABEL="dnsfilter-current-user"
      EXPECTED_TOOL_NAMES=("openapi.dnsfilter.api.currentUser")
      POSITIVE_CALL_ARGS='{"name":"openapi.dnsfilter.api.currentUser","arguments":{}}'
      ;;
    crawl)
      TARGET_KIND="module_runtime"
      TARGET_LABEL="crawl"
      CRAWL_URL="${CRAWL_URL:-https://example.com}"
      EXPECTED_TOOL_NAMES=("skill.crawl.start" "skill.crawl.status")
      ;;
    hetzner)
      TARGET_KIND="http_api"
      TARGET_LABEL="hetzner-cloud"
      EXPECTED_TOOL_NAMES=("openapi.hetzner.api.list.servers")
      POSITIVE_CALL_ARGS='{"name":"openapi.hetzner.api.list.servers","arguments":{}}'
      ;;
    *)
      echo "Unsupported TARGET: $TARGET" >&2
      echo "Supported targets: echo, youtube-transcript, gitea-version, dnsfilter-current-user, crawl, hetzner" >&2
      exit 1
      ;;
  esac
}

prepare_artifacts() {
  log "Preparing artifacts directory at $ARTIFACTS_DIR"
  rm -rf "$ARTIFACTS_DIR"
  mkdir -p "$ARTIFACTS_DIR"
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
    crawl)
      node "$REPO_ROOT/scripts/stage-module-runtime-skill.mjs" "$REPO_ROOT" "/home/shuv/repos/shuvbot-skills/crawl" "$CAPABILITIES_ROOT/imports" "$CAPABILITIES_DIR" | tee "$SEED_JSON"
      ;;
    hetzner)
      node "$REPO_ROOT/scripts/seed-hetzner-openapi.mjs" "$REPO_ROOT" "$CAPABILITIES_ROOT" | tee "$SEED_JSON"
      ;;
  esac
}

start_remote_server() {
  if [[ "$SKIP_SERVER_START" == "1" ]]; then
    log "Skipping remote server start by request"
    curl -fsS "$REMOTE_HEALTH_URL" | jq . > "$HEALTH_JSON"
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
    if curl -fsS "$REMOTE_HEALTH_URL" | jq . > "$HEALTH_JSON" 2>/dev/null; then
      return 0
    fi
    sleep 0.2
  done

  echo "Remote MCP server failed to become healthy at $REMOTE_HEALTH_URL" >&2
  if [[ "$mode" == "systemd" ]]; then
    systemctl --user status --no-pager --full "$SYSTEMD_SERVICE_NAME" | sed -n '1,120p' >&2 || true
  else
    cat "$SERVER_ERR" >&2 || true
  fi
  exit 1
}

mcp_request() {
  local method="$1"
  local params_json="$2"
  local id="$3"
  jq -nc \
    --arg method "$method" \
    --argjson params "$params_json" \
    --argjson id "$id" \
    '{jsonrpc:"2.0",id:$id,method:$method,params:$params}' \
    | curl -fsS "$REMOTE_MCP_URL" \
        -H 'content-type: application/json' \
        -H 'accept: application/json, text/event-stream' \
        --data @-
}

run_initialize() {
  log "Initializing MCP sessionless contract probe"
  local params='{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"shuvdex-mcp-cert","version":"0.0.0"}}'
  mcp_request "initialize" "$params" 1 | jq . > "$INIT_JSON"
  jq -e '.result.serverInfo.name == "shuvdex"' "$INIT_JSON" >/dev/null
}

run_tools_list() {
  log "Fetching tools/list"
  mcp_request "tools/list" '{}' 2 | jq . > "$TOOLS_JSON"
  jq -e '.result.tools | length > 0' "$TOOLS_JSON" >/dev/null

  for name in "${EXPECTED_TOOL_NAMES[@]}"; do
    jq -e --arg name "$name" '.result.tools | map(.name) | index($name) != null' "$TOOLS_JSON" >/dev/null
  done
}

run_positive_call() {
  log "Running positive call for target '$TARGET'"
  if [[ "$TARGET" == "crawl" ]]; then
    run_crawl_flow
    return 0
  fi

  mcp_request "tools/call" "$POSITIVE_CALL_ARGS" 3 | jq . > "$CALL_JSON"

  case "$TARGET" in
    echo)
      jq -e '.result.content[0].text | fromjson | .echoed == "CLEAN_TEST_123"' "$CALL_JSON" >/dev/null
      ;;
    youtube-transcript)
      jq -e --arg video "$YT_VIDEO" '.result.content[0].text | fromjson | .videoId == $video and (.entryCount > 0)' "$CALL_JSON" >/dev/null
      ;;
    gitea-version)
      jq -e '.result.content[0].text | fromjson | .data.version | strings | length > 0' "$CALL_JSON" >/dev/null
      ;;
    dnsfilter-current-user)
      jq -e '.result.content[0].text | fromjson | .data.data.attributes.email | strings | contains("@")' "$CALL_JSON" >/dev/null
      ;;
    hetzner)
      jq -e '.result.content[0].text | fromjson | .servers | arrays | length >= 0' "$CALL_JSON" >/dev/null
      ;;
  esac
}

run_negative_call_if_supported() {
  if [[ -z "$NEGATIVE_CALL_ARGS" ]]; then
    return 0
  fi

  log "Running negative call for target '$TARGET'"
  mcp_request "tools/call" "$NEGATIVE_CALL_ARGS" 4 | jq . > "$NEGATIVE_JSON"
  jq -e '.result.isError == true' "$NEGATIVE_JSON" >/dev/null
  jq -e '.result.content[0].text | strings | length > 0' "$NEGATIVE_JSON" >/dev/null
}

run_crawl_flow() {
  local start_args status_args wait_args job_id status_text

  start_args="$(jq -nc --arg url "$CRAWL_URL" '{name:"skill.crawl.start",arguments:{action:"start",url:$url,limit:3,format:"markdown",noRender:true}}')"
  mcp_request "tools/call" "$start_args" 30 | jq . > "$CRAWL_START_JSON"
  job_id="$(jq -r '.result.content[0].text | fromjson | .jobId' "$CRAWL_START_JSON")"
  [[ -n "$job_id" && "$job_id" != "null" ]]

  log "Crawl job started: $job_id"

  status_args="$(jq -nc --arg jobId "$job_id" '{name:"skill.crawl.status",arguments:{action:"status",jobId:$jobId}}')"
  for _ in $(seq 1 12); do
    mcp_request "tools/call" "$status_args" 31 | jq . > "$CRAWL_STATUS_JSON"
    status_text="$(jq -r '.result.content[0].text | fromjson | .stdout' "$CRAWL_STATUS_JSON")"
    if [[ "$status_text" == *"Status: completed"* ]]; then
      break
    fi
    sleep 2
  done

  status_text="$(jq -r '.result.content[0].text | fromjson | .stdout' "$CRAWL_STATUS_JSON")"
  [[ "$status_text" == *"Status: completed"* ]]

  wait_args="$(jq -nc --arg jobId "$job_id" '{name:"skill.crawl.status",arguments:{action:"wait",jobId:$jobId}}')"
  mcp_request "tools/call" "$wait_args" 32 | jq . > "$CRAWL_WAIT_JSON"
  jq -e '.result.content[0].text | fromjson | .stdout | contains("# Example Domain")' "$CRAWL_WAIT_JSON" >/dev/null
}

write_summary() {
  local expected_json
  expected_json="$(printf '%s\n' "${EXPECTED_TOOL_NAMES[@]}" | jq -R . | jq -s .)"

  jq -n \
    --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg target "$TARGET" \
    --arg target_label "$TARGET_LABEL" \
    --arg target_kind "$TARGET_KIND" \
    --arg remote_mcp_url "$REMOTE_MCP_URL" \
    --arg remote_health_url "$REMOTE_HEALTH_URL" \
    --arg systemd_service_name "$SYSTEMD_SERVICE_NAME" \
    --arg server_mode "$SERVER_MODE" \
    --argjson expected_tool_names "$expected_json" \
    --arg health "$HEALTH_JSON" \
    --arg initialize "$INIT_JSON" \
    --arg tools "$TOOLS_JSON" \
    --arg call "$CALL_JSON" \
    --arg negative "$NEGATIVE_JSON" \
    --arg crawl_start "$CRAWL_START_JSON" \
    --arg crawl_status "$CRAWL_STATUS_JSON" \
    --arg crawl_wait "$CRAWL_WAIT_JSON" \
    --arg seed "$SEED_JSON" \
    --arg server_log "$SERVER_LOG" \
    --arg server_err "$SERVER_ERR" \
    '{
      timestamp: $timestamp,
      target: $target,
      target_label: $target_label,
      target_kind: $target_kind,
      remote_mcp_url: $remote_mcp_url,
      remote_health_url: $remote_health_url,
      systemd_service_name: $systemd_service_name,
      server_mode: $server_mode,
      expected_tool_names: $expected_tool_names,
      status: "passed",
      artifacts: {
        seed: $seed,
        health: $health,
        initialize: $initialize,
        tools_list: $tools,
        positive_call: $call,
        negative_call: $negative,
        crawl_start: $crawl_start,
        crawl_status: $crawl_status,
        crawl_wait: $crawl_wait,
        server_log: $server_log,
        server_err: $server_err
      }
    }' > "$SUMMARY_JSON"

  cat "$SUMMARY_JSON"
}

main() {
  require_cmd node
  require_cmd npm
  require_cmd curl
  require_cmd jq

  target_settings
  prepare_artifacts
  seed_target
  start_remote_server
  run_initialize
  run_tools_list
  run_positive_call
  run_negative_call_if_supported
  write_summary
  log "Done — target=$TARGET artifacts=$ARTIFACTS_DIR"
}

main "$@"

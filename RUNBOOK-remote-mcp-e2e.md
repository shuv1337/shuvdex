# Runbook: shuvdex remote MCP E2E on shuvdev/shuvbot

Purpose: run a repeatable clean-room OpenCode test against the centralized shuvdex remote MCP server over Tailscale.

This runbook reflects the current working setup validated on `shuvdev`.

## What this proves

- one centralized shuvdex MCP endpoint is reachable over Tailscale
- clean-room OpenCode can connect without inheriting project/global MCP config
- OpenCode can discover tools from the remote MCP server
- OpenCode can invoke a deterministic module-runtime tool through the real client
- tmux-supervised evidence is captured for later inspection

## Current default topology

- Host: `shuvdev`
- Remote MCP URL: `http://shuvdev:3848/mcp`
- Health URL: `http://shuvdev:3848/health`
- Deterministic test tool source: `examples/module-runtime-skill-template/`
- Deterministic surfaced tool name in OpenCode: `shuvdex_skill_module_runtime_template_echo`

Later, the same workflow can be pointed at `shuvbot` by changing env vars.

## Preconditions

On the target host:

- repo exists locally
- `npm install` has been run
- `node`, `npm`, `tmux`, `curl`, and `opencode` are installed
- Tailscale is up
- OpenCode can use the `opencode` provider

## Important model note

The clean-room config must pin OpenCode to a working provider/model combination.

Current safe default:

- `model: opencode/gpt-5-nano`
- `small_model: opencode/gpt-5-nano`
- `enabled_providers: ["opencode"]`

Reason:
- leaving model/provider selection implicit caused OpenCode to choose `cloudflare-ai-gateway/*`
- that path failed in this environment with `sdk.languageModel is not a function`

## One-command workflow

From the repo root:

```bash
./scripts/run-remote-mcp-e2e.sh
```

This will:

1. create a clean-room OpenCode environment under `/tmp/shuvdex-opencode-clean`
2. seed the deterministic module-runtime template package into `.capabilities/packages`
3. build and start the remote MCP server on port `3848`
4. validate `/health`
5. run a clean-room OpenCode discovery prompt
6. run a clean-room OpenCode tool invocation prompt
7. run a tmux-supervised proof
8. write a summary artifact

## Artifacts

The script writes artifacts under:

- `/tmp/shuvdex-opencode-clean/artifacts/`

Important files:

- `health.json`
- `mcp-list.txt`
- `tool-discovery.jsonl`
- `tool-call.jsonl`
- `tmux-timeout-run.jsonl`
- `tmux-timeout-run.stderr`
- `tmux-pane.log`
- `tmux-pane-capture.txt`
- `summary.json`

Remote server logs:

- `/tmp/shuvdex-mcp-remote.log`
- `/tmp/shuvdex-mcp-remote.err`

Remote server PID:

- `/tmp/shuvdex-mcp-remote.pid`

## Expected success signals

### Health

`health.json` should show:

- `status: "ok"`
- `transport: "streamable-http"`

### MCP connection

`mcp-list.txt` should show:

- `shuvdex connected`

### Discovery

`tool-discovery.jsonl` should identify:

- `shuvdex_skill_module_runtime_template_echo`

### Tool invocation

`tool-call.jsonl` should contain:

```json
{
  "echoed": "CLEAN_TEST_123"
}
```

## Switching from shuvdev to shuvbot later

Override env vars when invoking the script:

```bash
TARGET_HOST=shuvbot \
TARGET_DNS=shuvbot \
MCP_PORT=3848 \
./scripts/run-remote-mcp-e2e.sh
```

If the repo path or capability dirs differ on that host, also override:

```bash
LOCAL_REPO_PATH=/path/to/shuvdex \
CAPABILITIES_DIR=/path/to/shuvdex/.capabilities/packages \
POLICY_DIR=/path/to/shuvdex/.capabilities/policy \
./scripts/run-remote-mcp-e2e.sh
```

## Manual commands

### Seed deterministic fixture only

```bash
node scripts/seed-module-runtime-template.mjs
```

### Start remote MCP server manually

```bash
npm run build --workspace @shuvdex/mcp-server
MCP_HOST=0.0.0.0 \
MCP_PORT=3848 \
LOCAL_REPO_PATH=$PWD \
CAPABILITIES_DIR=$PWD/.capabilities/packages \
POLICY_DIR=$PWD/.capabilities/policy \
node apps/mcp-server/dist/http.js
```

### Probe manually

```bash
curl http://shuvdev:3848/health
```

Initialize MCP:

```bash
curl -sS \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0.0.1"}}}' \
  http://shuvdev:3848/mcp
```

List tools:

```bash
curl -sS \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  http://shuvdev:3848/mcp
```

## Clean-room OpenCode layout

Created by the script at:

- `/tmp/shuvdex-opencode-clean`

Key files:

- `config/opencode/opencode.json`
- `env.sh`
- `workspace/`
- `artifacts/`

The clean-room env explicitly sets:

- `XDG_CONFIG_HOME`
- `XDG_DATA_HOME`
- `XDG_CACHE_HOME`
- `XDG_STATE_HOME`
- `OPENCODE_TEST_HOME`
- `OPENCODE_DISABLE_CLAUDE_CODE=1`
- `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=1`
- `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1`

## Known caveats

### tmux rendering

Interactive OpenCode output inside tmux can be awkward to scrape visually.

For that reason, the script captures a **non-interactive JSON run inside tmux** and saves the JSONL artifact, instead of relying only on pane rendering.

### HTTP server test file

There is a repo test file at:

- `apps/mcp-server/test/http.test.ts`

Manual probing proves the remote HTTP MCP path works, but that test currently has shutdown/timing behavior that still needs cleanup.

Do not treat that one test as the source of truth for runtime health; use the actual `/health`, `/mcp`, and OpenCode-run artifacts.

## systemd user service

A versioned user unit now lives at:

- `systemd/shuvdex-mcp.service`

Current state on `shuvdev`:

- installed: yes
- enabled: yes
- running: yes
- service name: `shuvdex-mcp.service`

Install on `shuvdev`:

```bash
mkdir -p ~/.config/systemd/user
cp systemd/shuvdex-mcp.service ~/.config/systemd/user/shuvdex-mcp.service
systemctl --user daemon-reload
systemctl --user enable --now shuvdex-mcp.service
```

Verify:

```bash
systemctl --user status shuvdex-mcp.service
curl http://shuvdev:3848/health
```

Logs:

```bash
journalctl --user -u shuvdex-mcp.service -f
```

If you change server code or the unit file, rebuild/restart before trusting results:

```bash
npm run build --workspace @shuvdex/mcp-server
systemctl --user restart shuvdex-mcp.service
curl http://shuvdev:3848/health
```

More details:

- `systemd/README.md`
- `AGENTS.md`

## Recommended future improvements

- add a negative-path OpenCode test to the script
- add a resource/prompt discovery step
- make the deterministic fixture import go through the API importer instead of direct seeding
- make `shuvbot` the alternate production-style target once shuvdev workflow is stable

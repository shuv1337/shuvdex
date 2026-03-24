# Runbook: shuvdex remote MCP external E2E

Purpose: run a repeatable external-client test against the centralized shuvdex remote MCP server over Tailscale.

Primary test environments:
- **opencode** on shuvbot/shuvdev (default)
- **codex** on shuvbot/shuvdev

No clean-room isolation — runs with the client's existing config and MCP setup.

## What this proves

- one centralized shuvdex MCP endpoint is reachable over Tailscale
- the client can discover tools from the remote MCP server
- the client can invoke a target capability through the real client path
- tmux-supervised evidence is captured for later inspection

## Current default topology

- Host: `shuvdev`
- Remote MCP URL: `http://shuvdev:3848/mcp`
- Health URL: `http://shuvdev:3848/health`

## Supported targets

- `echo` — deterministic module-runtime fixture
- `youtube-transcript` — real imported module-runtime skill
- `gitea-version` — real compiled OpenAPI capability for `GET /version`
- `dnsfilter-current-user` — authenticated compiled OpenAPI capability for `GET /v1/current_user`

## Supported clients

- `opencode` (default) — `CLIENT=opencode`
- `codex` — `CLIENT=codex`

## Preconditions

On the target host:

- repo exists locally
- `npm install` has been run
- `node`, `npm`, `tmux`, `curl` are installed
- Tailscale is up
- The selected client is installed and authenticated

## One-command workflow

From the repo root:

```bash
# Default: opencode + echo target
./scripts/run-remote-mcp-e2e.sh

# Explicit client and target
CLIENT=codex TARGET=dnsfilter-current-user ./scripts/run-remote-mcp-e2e.sh

# Skip server restart (use already-running service)
SKIP_SERVER_START=1 CLIENT=opencode TARGET=gitea-version ./scripts/run-remote-mcp-e2e.sh

# Skip seeding (target already loaded)
SKIP_SEED=1 ./scripts/run-remote-mcp-e2e.sh

# Skip tmux proof
ENABLE_TMUX=0 CLIENT=codex TARGET=echo ./scripts/run-remote-mcp-e2e.sh
```

This will:

1. seed the requested target into the remote runtime package store
2. build and start the remote MCP server on port `3848`
3. validate `/health`
4. run a client discovery prompt
5. run a client tool invocation prompt
6. optionally run a tmux-supervised proof
7. write a target-specific summary artifact

## Useful environment overrides

| Variable | Default | Description |
|----------|---------|-------------|
| `CLIENT` | `opencode` | Client to use (`opencode` or `codex`) |
| `TARGET` | `echo` | Test target |
| `TARGET_HOST` | `$(hostname -s)` | MCP server hostname |
| `TARGET_DNS` | `$TARGET_HOST` | DNS name for MCP URL |
| `MCP_PORT` | `3848` | MCP server port |
| `SKIP_SERVER_START` | `0` | Skip rebuild/restart |
| `SKIP_SEED` | `0` | Skip target seeding |
| `ENABLE_TMUX` | `1` | Skip tmux proof |
| `TIMEOUT_SECONDS` | `45` | tmux timeout |

## Artifacts

Written under `/tmp/shuvdex-e2e/artifacts/<client>/<target>/`:

- `seed.json`
- `health.json`
- `pwd.txt`
- `mcp-list.txt`
- `tool-discovery.jsonl`
- `tool-call.jsonl`
- `tmux-timeout-run.jsonl` (if tmux enabled)
- `tmux-timeout-run.stderr` (if tmux enabled)
- `tmux-pane.log` (if tmux enabled)
- `tmux-pane-capture.txt` (if tmux enabled)
- `summary.json`
- `last-message-*.txt` (codex only)

Remote server logs:

- `/tmp/shuvdex-mcp-remote.log`
- `/tmp/shuvdex-mcp-remote.err`

## Expected success signals by target

### `echo`

**Discovery:** `shuvdex_skill_module_runtime_template_echo`

**Invocation:**
```json
{ "echoed": "CLEAN_TEST_123" }
```

### `youtube-transcript`

**Discovery:** `skill.youtube_transcript.fetch_transcript`

**Invocation:** structured output with `videoId`, `entryCount`, `entries`, `text`

### `gitea-version`

**Discovery:** `shuvdex_openapi_gitea_api_getVersion`

**Invocation:**
```json
{ "version": "1.26.0+dev-..." }
```

### `dnsfilter-current-user`

**Discovery:** `shuvdex_openapi_dnsfilter_api_currentUser`

**Invocation:** authenticated user object with `id`, `email`, `organization_id` (or similar DNSFilter fields)

## Switching hosts

```bash
TARGET_HOST=shuvbot TARGET_DNS=shuvbot ./scripts/run-remote-mcp-e2e.sh
```

## Manual commands

### Seed targets

```bash
# Echo fixture
node scripts/seed-module-runtime-template.mjs "$PWD" "$PWD/examples/module-runtime-skill-template" "$PWD/.capabilities/packages"

# YouTube transcript skill
node scripts/stage-module-runtime-skill.mjs "$PWD" /home/shuv/repos/shuvbot-skills/youtube-transcript "$PWD/.capabilities/imports" "$PWD/.capabilities/packages"

# Gitea OpenAPI
node scripts/seed-gitea-openapi.mjs "$PWD" "$PWD/.capabilities"

# DNSFilter authenticated OpenAPI
node scripts/seed-dnsfilter-openapi.mjs "$PWD" "$PWD/.capabilities"
```

### Manual health probe

```bash
curl http://shuvdev:3848/health
```

### Manual MCP tools/list

```bash
curl -sS \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  http://shuvdev:3848/mcp
```

## systemd user service

A versioned user unit lives at `systemd/shuvdex-mcp.service`.

```bash
# Install
cp systemd/shuvdex-mcp.service ~/.config/systemd/user/shuvdex-mcp.service
systemctl --user daemon-reload
systemctl --user enable --now shuvdex-mcp.service

# Verify
systemctl --user status shuvdex-mcp.service
curl http://shuvdev:3848/health

# Rebuild + restart after code changes
npm run build --workspace @shuvdex/mcp-server
systemctl --user restart shuvdex-mcp.service
curl http://127.0.0.1:3848/health

# Logs
journalctl --user -u shuvdex-mcp.service -f
```

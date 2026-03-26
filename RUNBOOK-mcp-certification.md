# Runbook: shuvdex remote MCP certification harness

Purpose: run a repeatable, lightweight certification flow against the centralized shuvdex remote MCP server over HTTP MCP.

This harness intentionally avoids heavy external client dependencies like OpenCode or Codex. It validates the live server directly through the MCP protocol using `curl` + `jq`.

## What this proves

- the centralized shuvdex MCP endpoint is reachable
- MCP `initialize` succeeds
- `tools/list` returns the expected tool surface
- a target capability can be invoked successfully through real MCP calls
- negative-path checks work for targets that support them
- artifacts are captured in a lightweight, deterministic format

## Current default topology

- Host: `shuvdev`
- Remote MCP URL: `http://shuvdev:3848/mcp`
- Health URL: `http://shuvdev:3848/health`

## Supported targets

- `echo` — deterministic module-runtime fixture
- `youtube-transcript` — real imported module-runtime skill
- `gitea-version` — real compiled OpenAPI capability for `GET /version`
- `dnsfilter-current-user` — authenticated compiled OpenAPI capability for `GET /v1/current_user`
- `crawl` — real imported module-runtime crawl skill using a safe target

## Preconditions

On the target host:

- repo exists locally
- `npm install` has been run
- `node`, `npm`, `curl`, and `jq` are installed
- Tailscale is up if using the remote hostname
- required credentials already exist for authenticated targets
  - DNSFilter for `dnsfilter-current-user`
  - Cloudflare for `crawl`

## One-command workflow

From the repo root:

```bash
# Default: lightweight echo certification
./scripts/run-mcp-certification.sh

# Run a real imported skill check
TARGET=youtube-transcript ./scripts/run-mcp-certification.sh

# Run a public OpenAPI check
TARGET=gitea-version ./scripts/run-mcp-certification.sh

# Run an authenticated OpenAPI check
TARGET=dnsfilter-current-user ./scripts/run-mcp-certification.sh

# Run a real crawl against a safe public target
TARGET=crawl ./scripts/run-mcp-certification.sh

# Reuse an already-running server
SKIP_SERVER_START=1 TARGET=gitea-version ./scripts/run-mcp-certification.sh

# Reuse an already-seeded target
SKIP_SEED=1 TARGET=youtube-transcript ./scripts/run-mcp-certification.sh
```

This will:

1. seed the requested target into the runtime package store
2. build and restart the remote MCP server unless skipped
3. validate `/health`
4. call MCP `initialize`
5. call MCP `tools/list`
6. call the target tool directly through MCP
7. run a negative-path check when supported
8. write a deterministic summary artifact

## Useful environment overrides

| Variable | Default | Description |
|----------|---------|-------------|
| `TARGET` | `echo` | Test target |
| `TARGET_HOST` | `$(hostname -s)` | MCP server hostname |
| `TARGET_DNS` | `$TARGET_HOST` | DNS name for MCP URL |
| `MCP_PORT` | `3848` | MCP server port |
| `SKIP_SERVER_START` | `0` | Skip rebuild/restart |
| `SKIP_SEED` | `0` | Skip target seeding |
| `CRAWL_URL` | `https://example.com` | Safe crawl target for `TARGET=crawl` |

## Artifacts

Written under `/tmp/shuvdex-mcp-certification/<target>/`:

- `seed.json`
- `health.json`
- `initialize.json`
- `tools-list.json`
- `tool-call.json`
- `tool-call-negative.json` (when applicable)
- `crawl-start.json` (crawl only)
- `crawl-status.json` (crawl only)
- `crawl-wait.json` (crawl only)
- `summary.json`

Remote server logs:

- `/tmp/shuvdex-mcp-remote.log`
- `/tmp/shuvdex-mcp-remote.err`

## Expected success signals by target

### `echo`

Expected tool:
- `skill.module_runtime_template.echo`

Expected positive result:
```json
{ "echoed": "CLEAN_TEST_123" }
```

Expected negative result:
- structured error payload for missing `message`

### `youtube-transcript`

Expected tool:
- `skill.youtube_transcript.fetch_transcript`

Expected positive result:
- structured output with `videoId`, `entryCount`, `entries`, `text`

Expected negative result:
- structured error payload for missing `video`

### `gitea-version`

Expected tool:
- `openapi.gitea.api.getVersion`

Expected positive result:
```json
{ "data": { "version": "1.26.0+dev-..." } }
```

### `dnsfilter-current-user`

Expected tool:
- `openapi.dnsfilter.api.currentUser`

Expected positive result:
- authenticated user object containing an email field

### `crawl`

Expected tools:
- `skill.crawl.start`
- `skill.crawl.status`

Expected positive flow:
- `start` returns a `jobId`
- `status` eventually reports `completed`
- `wait` returns extracted markdown containing `# Example Domain`

## Switching hosts

```bash
TARGET_HOST=shuvbot TARGET_DNS=shuvbot TARGET=echo ./scripts/run-mcp-certification.sh
```

## Manual commands

### Seed targets

```bash
# Echo fixture
node scripts/seed-module-runtime-template.mjs "$PWD" "$PWD/examples/module-runtime-skill-template" "$PWD/.capabilities/packages"

# YouTube transcript skill
node scripts/stage-module-runtime-skill.mjs "$PWD" /home/shuv/repos/shuvbot-skills/youtube-transcript "$PWD/.capabilities/imports" "$PWD/.capabilities/packages"

# Crawl skill
node scripts/stage-module-runtime-skill.mjs "$PWD" /home/shuv/repos/shuvbot-skills/crawl "$PWD/.capabilities/imports" "$PWD/.capabilities/packages"

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

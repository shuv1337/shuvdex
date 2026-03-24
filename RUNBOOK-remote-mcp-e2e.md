# Runbook: shuvdex remote MCP external E2E on shuvdev/shuvbot

Purpose: run a repeatable clean-room external-client test against the centralized shuvdex remote MCP server over Tailscale.

This runbook is now **OpenCode-first, not OpenCode-only**:
- default lane: OpenCode
- preferred fallback: Codex client when OpenCode/provider behavior is the bottleneck

This runbook reflects the current working setup validated on `shuvdev`.

## What this proves

- one centralized shuvdex MCP endpoint is reachable over Tailscale
- clean-room client config can connect without inheriting project/global MCP config
- the client can discover tools from the remote MCP server
- the client can invoke a deterministic or real target capability through the real client path
- tmux-supervised evidence is captured for later inspection

## Current default topology

- Host: `shuvdev`
- Remote MCP URL: `http://shuvdev:3848/mcp`
- Health URL: `http://shuvdev:3848/health`
- Deterministic test tool source: `examples/module-runtime-skill-template/`
- Deterministic surfaced tool name in OpenCode: `shuvdex_skill_module_runtime_template_echo`

## Current supported targets in the script

- `echo`
  - deterministic module-runtime fixture
- `youtube-transcript`
  - real imported module-runtime skill
- `gitea-version`
  - real compiled OpenAPI capability for `GET /version`
- `dnsfilter-current-user`
  - authenticated compiled OpenAPI capability for `GET /v1/current_user`

## Preconditions

On the target host:

- repo exists locally
- `npm install` has been run
- `node`, `npm`, `tmux`, `curl`, and `opencode` are installed
- Tailscale is up
- OpenCode can use the selected provider

## Important provider/model note

The clean-room config must pin OpenCode to a working provider/model combination.

### Current safe default

- `CLIENT=opencode`
- `PROVIDER=opencode`
- `MODEL=opencode/gpt-5-nano`
- `SMALL_MODEL=opencode/gpt-5-nano`

Reason:
- leaving model/provider selection implicit previously caused OpenCode to choose `cloudflare-ai-gateway/*`
- that path failed in this environment with `sdk.languageModel is not a function`

## Client/provider policy

### Default lane
Use OpenCode with the pinned `opencode` provider/model above.

### Use another provider inside OpenCode when
- OpenCode itself is fine
- a different provider is already authenticated and more stable
- the exact provider/model is recorded in artifacts

### Use another client when
- OpenCode/provider behavior is the unstable part
- you still need a real external-client proof against remote `shuvdex`
- you want a second-client validation after OpenCode succeeds

Current preferred fallback client:
- Codex

This script currently automates the OpenCode lane only. If you need Codex fallback, keep the same target/capability set and record client/provider/model manually until a dedicated fallback script exists.

## One-command workflow

From the repo root:

### Deterministic echo smoke test

```bash
./scripts/run-remote-mcp-e2e.sh
```

### Explicit target examples

```bash
TARGET=echo ./scripts/run-remote-mcp-e2e.sh
TARGET=youtube-transcript ./scripts/run-remote-mcp-e2e.sh
TARGET=gitea-version ./scripts/run-remote-mcp-e2e.sh
TARGET=dnsfilter-current-user ./scripts/run-remote-mcp-e2e.sh
```

This will:

1. create a clean-room OpenCode environment under `/tmp/shuvdex-opencode-clean`
2. seed the requested target into the remote runtime package store
3. build and start the remote MCP server on port `3848`
4. validate `/health`
5. run a clean-room OpenCode discovery prompt
6. run a clean-room OpenCode tool invocation prompt
7. optionally run a tmux-supervised proof
8. write a target-specific summary artifact

## Useful environment overrides

### Change the target

```bash
TARGET=youtube-transcript ./scripts/run-remote-mcp-e2e.sh
```

### Change model/provider inside OpenCode

```bash
PROVIDER=opencode \
MODEL=opencode/gpt-5-nano \
SMALL_MODEL=opencode/gpt-5-nano \
./scripts/run-remote-mcp-e2e.sh
```

### Skip server restart if using the already-running deployed service

```bash
SKIP_SERVER_START=1 ./scripts/run-remote-mcp-e2e.sh
```

### Skip tmux proof

```bash
ENABLE_TMUX=0 ./scripts/run-remote-mcp-e2e.sh
```

## Artifacts

The script writes artifacts under:

- `/tmp/shuvdex-opencode-clean/artifacts/<target>/`

Example directories:
- `/tmp/shuvdex-opencode-clean/artifacts/echo/`
- `/tmp/shuvdex-opencode-clean/artifacts/youtube-transcript/`
- `/tmp/shuvdex-opencode-clean/artifacts/gitea-version/`
- `/tmp/shuvdex-opencode-clean/artifacts/dnsfilter-current-user/`

Important files:

- `seed.json`
- `health.json`
- `pwd.txt`
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

## Expected success signals by target

## `echo`

### Discovery
Should identify:
- `shuvdex_skill_module_runtime_template_echo`

### Invocation
Should contain:

```json
{
  "echoed": "CLEAN_TEST_123"
}
```

## `youtube-transcript`

### Discovery
Should identify a tool equivalent to:
- `skill.youtube_transcript.fetch_transcript`

### Invocation
Should include structured transcript output such as:
- `videoId`
- `entryCount`
- `entries`
- `text`

## `gitea-version`

### Discovery
Should identify a tool equivalent to:
- `shuvdex_openapi_gitea_api_getVersion`

### Invocation
Should include structured output with a version field, for example:

```json
{
  "version": "1.26.0+dev-..."
}
```

## `dnsfilter-current-user`

### Discovery
Should identify a tool equivalent to:
- `shuvdex_openapi_dnsfilter_api_currentUser`

### Invocation
Should include structured output for the authenticated current user, ideally including one or more of:
- `id`
- `email`
- `organization_id`

The exact payload is controlled by DNSFilter, but it should clearly be an authenticated user object rather than an auth error.

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

### Stage real imported skill only

```bash
node scripts/stage-module-runtime-skill.mjs "$PWD" /home/shuv/repos/shuvbot-skills/youtube-transcript "$PWD/.capabilities/imports" "$PWD/.capabilities/packages"
```

### Seed Gitea OpenAPI package only

```bash
node scripts/seed-gitea-openapi.mjs "$PWD" "$PWD/.capabilities"
```

### Seed DNSFilter authenticated OpenAPI package only

```bash
node scripts/seed-dnsfilter-openapi.mjs "$PWD" "$PWD/.capabilities"
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
- `artifacts/<target>/`

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

### Client/provider instability vs shuvdex instability

If the provider/model path fails before meaningful MCP usage, do not assume `shuvdex` is broken.

Record:
- client
- provider
- model
- exact failure point

Then either:
- switch provider inside OpenCode, or
- switch to the fallback client lane

### Remote target availability

For real targets like `youtube-transcript`, `gitea-version`, and `dnsfilter-current-user`, the package must be seeded into the remote runtime package store before discovery will succeed.

### HTTP server test status

The repo test file at:
- `apps/mcp-server/test/http.test.ts`

is now stable again, but real runtime health should still be judged from:
- `/health`
- `/mcp`
- client-run artifacts

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
curl http://127.0.0.1:3848/health
```

More details:

- `systemd/README.md`
- `AGENTS.md`

## Recommended next improvements

- add explicit negative-path automation to the script output
- add a fallback-client script or runbook section for Codex
- add target definitions for more certified capabilities as they come online
- link these artifacts into `CAPABILITY-CERTIFICATION.md` once the ledger is created

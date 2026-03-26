# shuvdex agent notes

This file is for future coding agents working in this repo.

## Current deployment shape

- The centralized remote MCP server is expected to run on **shuvdev**.
- User systemd unit:
  - `~/.config/systemd/user/shuvdex-mcp.service`
- Versioned repo copy:
  - `systemd/shuvdex-mcp.service`
- Default remote endpoint:
  - `http://shuvdev:3848/mcp`
- Health endpoint:
  - `http://shuvdev:3848/health`

## Important rule: rebuild + restart after server changes

If you change anything that affects the remote MCP server, you must rebuild and restart it before claiming success.

This includes changes under:

- `apps/mcp-server/**`
- `packages/capability-registry/**`
- `packages/skill-indexer/**`
- `packages/policy-engine/**`
- `packages/execution-providers/**`
- `systemd/shuvdex-mcp.service`
- scripts or docs that are supposed to reflect the live service behavior

## Restart procedure

### If only code changed

Run:

```bash
npm run build --workspace @shuvdex/mcp-server
systemctl --user restart shuvdex-mcp.service
systemctl --user status --no-pager --full shuvdex-mcp.service | sed -n '1,80p'
curl http://shuvdev:3848/health
```

### If the unit file changed

Run:

```bash
cp systemd/shuvdex-mcp.service ~/.config/systemd/user/shuvdex-mcp.service
systemctl --user daemon-reload
systemctl --user restart shuvdex-mcp.service
systemctl --user status --no-pager --full shuvdex-mcp.service | sed -n '1,80p'
curl http://shuvdev:3848/health
```

## Validation expectations

Minimum validation after relevant changes:

1. affected service is active
2. MCP `/health` returns 200 when MCP changed
3. API `/health` returns 200 when API changed
4. web root returns 200 when web changed
5. if MCP behavior changed, verify `/mcp` with direct MCP requests or run the lightweight certification harness

Useful command:

```bash
./scripts/run-mcp-certification.sh
```

## Deterministic test fixture

The repeatable remote MCP test currently uses:

- source skill:
  - `examples/module-runtime-skill-template/`
- seeder:
  - `scripts/seed-module-runtime-template.mjs`
- surfaced tool name:
  - `skill.module_runtime_template.echo`

## Lightweight certification note

The primary repeatable certification flow no longer depends on OpenCode or Codex.

Use the lightweight direct-MCP harness instead:
- protocol transport: HTTP MCP via `curl`
- parser/assertion tool: `jq`
- script: `scripts/run-mcp-certification.sh`
- runbook: `RUNBOOK-mcp-certification.md`

Why:
- lower dependency weight
- fewer environment-specific client failures
- deterministic artifacts
- validates the actual MCP server contract directly

Supported current targets:
- `echo`
- `youtube-transcript`
- `gitea-version`
- `dnsfilter-current-user`
- `crawl`

## Keep this file updated

When you learn something operationally useful, update this file.

Especially keep these current:

- actual MCP/API/web endpoints and ports
- systemd service names and install paths
- required restart/reload commands
- known-good validation commands
- known caveats that can waste time for future agents

If you change the deployment workflow and do **not** update this file, you are leaving a trap for the next agent.

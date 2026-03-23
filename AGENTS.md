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

1. service is active
2. `/health` returns 200
3. if MCP behavior changed, verify `/mcp` or run the clean-room E2E script

Useful command:

```bash
./scripts/run-remote-mcp-e2e.sh
```

## Deterministic test fixture

The repeatable remote MCP test currently uses:

- source skill:
  - `examples/module-runtime-skill-template/`
- seeder:
  - `scripts/seed-module-runtime-template.mjs`
- surfaced OpenCode tool name:
  - `shuvdex_skill_module_runtime_template_echo`

## OpenCode clean-room note

For the repeatable E2E flow, the clean-room OpenCode config is pinned to:

- `model: opencode/gpt-5-nano`
- `small_model: opencode/gpt-5-nano`
- `enabled_providers: ["opencode"]`

Reason:
- leaving provider selection implicit previously caused a broken `cloudflare-ai-gateway` path in this environment.

## Keep this file updated

When you learn something operationally useful, update this file.

Especially keep these current:

- actual MCP endpoint/port/host
- systemd service name and install path
- required restart/reload commands
- known-good validation commands
- known caveats that can waste time for future agents

If you change the deployment workflow and do **not** update this file, you are leaving a trap for the next agent.

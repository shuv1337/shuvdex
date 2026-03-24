# PLAN: External client testing for shuvdex MCP server

> Goal: validate `shuvdex` from **real external clients** (opencode, codex) on **shuvbot/shuvdev** against the **deployed remote MCP server**.

---

## Approach

No clean-room isolation. Use each client's existing config and MCP setup as-is on shuvbot or shuvdev. The clients already have shuvdex configured as a remote MCP server.

## Primary test environments

- **opencode** on shuvbot/shuvdev
- **codex** on shuvbot/shuvdev

## External tool added to harnesses

- `dnsfilter-current-user` — authenticated OpenAPI capability (`GET /v1/current_user` via DNSFilter API)
- This is the only real external (non-echo) tool added to the test harnesses

## Script

- `scripts/run-remote-mcp-e2e.sh`
- Supports `CLIENT=opencode` (default) and `CLIENT=codex`
- Supports targets: `echo`, `youtube-transcript`, `gitea-version`, `dnsfilter-current-user`

## Runbook

- `RUNBOOK-remote-mcp-e2e.md`

## Certification ledger

- `CAPABILITY-CERTIFICATION.md`

## Already proven

- [x] OpenCode can connect to the remote MCP endpoint on `shuvdev`
- [x] Deterministic module-runtime fixture can be discovered and invoked
- [x] Real imported skill execution works for `youtube-transcript`
- [x] Real compiled `http_api` execution works for Gitea `GET /version`
- [x] Authenticated `http_api` execution works for DNSFilter `GET /v1/current_user`
- [x] tmux-supervised artifacts can be captured
- [x] Codex added as first-class client mode

## Success criteria

- [x] deterministic echo remains repeatable
- [x] one real imported skill passes external-client testing
- [x] one real generated OpenAPI capability passes external-client testing
- [x] at least one authenticated OpenAPI capability is certified with real credentials
- [x] codex is a first-class client alongside opencode
- [x] artifacts clearly record client used

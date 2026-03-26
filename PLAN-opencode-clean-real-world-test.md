# PLAN: Lightweight MCP certification for shuvdex remote server

> Goal: validate `shuvdex` against the deployed remote MCP server using a lightweight, deterministic harness with minimal dependencies.

---

## Approach

Do not depend on heavyweight external clients like OpenCode or Codex for the core certification path.

Instead, validate the live remote MCP server directly with:
- `curl`
- `jq`
- the MCP HTTP endpoint
- deterministic seeding scripts already in this repo

This makes certification easier to repeat on any host and reduces flakiness caused by client configuration, model behavior, or interactive CLI hangs.

## Primary validation surface

- direct MCP over HTTP against `http://<host>:3848/mcp`
- direct health validation against `http://<host>:3848/health`

## Script

- `scripts/run-mcp-certification.sh`
- despite the historical name, this is now the lightweight MCP certification harness
- supported targets:
  - `echo`
  - `youtube-transcript`
  - `gitea-version`
  - `dnsfilter-current-user`
  - `crawl`

## Runbook

- `RUNBOOK-mcp-certification.md`

## Certification ledger

- `CAPABILITY-CERTIFICATION.md`

## Already proven with the lightweight approach

- [x] direct MCP `initialize` works against the remote server
- [x] direct MCP `tools/list` works against the remote server
- [x] deterministic module-runtime fixture can be seeded and invoked
- [x] real imported skill execution works for `youtube-transcript`
- [x] real compiled `http_api` execution works for Gitea `GET /version`
- [x] authenticated `http_api` execution works for DNSFilter `GET /v1/current_user`
- [x] real crawl execution works for `crawl` against `https://example.com`

## Success criteria

- [x] deterministic echo remains repeatable without external AI clients
- [x] one real imported skill passes direct MCP certification
- [x] one real generated OpenAPI capability passes direct MCP certification
- [x] at least one authenticated OpenAPI capability is certified with real credentials
- [x] crawl can complete a real safe public job through the live server
- [x] artifacts clearly record the MCP requests/responses and target used

## Non-goals

- preserving OpenCode- or Codex-specific validation as a mandatory certification layer
- depending on model/provider behavior to prove MCP correctness
- requiring tmux-supervised interactive CLI sessions for ordinary certification

## Follow-on possibilities

If desired later, external client checks can still exist as optional smoke tests, but they should not be the primary certification system.

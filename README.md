# shuvdex

Centralized capability gateway for Codex hosts.

`shuvdex` is now organized around one idea: capability discovery and policy live centrally, while truly local execution can be delegated to host-bound executors later. The old model of pulling repos, syncing skill directories, and activating symlinks across hosts has been removed from the main product surface.

## Current State

The repo currently exposes three primary surfaces:

- `@shuvdex/mcp-server`: the client-facing MCP gateway
- `@shuvdex/api`: admin/control-plane API for packages, policies, tokens, audit, runners, hosts, and compatibility tool management
- `@shuvdex/web`: React/Vite UI for capability management

The capability-gateway foundation is implemented:

- capability registry with package-scoped `tool`, `resource`, `prompt`, `module`, and `connector` definitions
- skill indexer that compiles `SKILL.md` and optional `capability.yaml` into capability packages
- policy engine with signed tokens, ACL checks, revocation, and audit logging
- dynamic MCP registration with progressive disclosure for tools, resources, and prompts

Execution provider types are wired. `module_runtime` is implemented for local JS/Python-style tool entrypoints over stdin/stdout JSON, while `host_runner`, `mcp_proxy`, and `http_api` still return structured not-yet-implemented responses.

## Target Model

The intended operating model is:

- one client-configured MCP endpoint
- centrally served capability packages
- server-side discovery, ACLs, and progressive disclosure
- optional per-host runners only for local shell, filesystem, browser, or device work

The intended operating model is not:

- cloning the same skill repo on every host
- keeping host-local skill trees in sync
- shipping capabilities through `pull`, `sync`, activation, or other git/file replication flows

## Monorepo Layout

```text
shuvdex/
├── apps/
│   ├── api/           # HTTP admin/control-plane API
│   ├── mcp-server/    # MCP capability gateway
│   └── web/           # React/Vite frontend
├── packages/
│   ├── capability-registry/   # capability/package model + storage
│   ├── core/                  # host config types + loading helpers
│   ├── execution-providers/   # executor abstraction and provider stubs
│   ├── policy-engine/         # token issuance, ACLs, audit log
│   ├── skill-indexer/         # compile skills into capability packages
│   ├── ssh/                   # SSH execution layer retained for future host work
│   └── telemetry/             # tracing/logging helpers
```

## Requirements

- Node.js with npm workspaces support (`packageManager` is pinned to `npm@11.7.0`)
- optional `fleet.yaml` only if you use the host-management API surface

## Install

```bash
git clone <repo-url> shuvdex
cd shuvdex
npm install
npm run build
```

## Configuration

Persistent gateway state defaults to local directories:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CAPABILITIES_DIR` | `./.capabilities/packages` | persisted capability package storage |
| `POLICY_DIR` | `./.capabilities/policy` | persisted policies, revocations, and audit state |
| `LOCAL_REPO_PATH` | current working directory | skill indexing source root |

If you want to use the host-management API, provide a `fleet.yaml` in the repo root or current working directory:

```yaml
laptop:
  hostname: 192.168.1.100
  connectionType: ssh
  port: 22
  user: myuser
```

## MCP Server

The MCP server is the main agent-facing surface. On startup it:

1. loads the capability registry and policy engine
2. indexes local skills into capability packages
3. serves MCP `tools`, `resources`, and `prompts`

Run it with:

```bash
npm run build --workspace @shuvdex/mcp-server
node apps/mcp-server/dist/index.js
```

An isolated fresh server advertises no built-in fleet catalog. Tools, resources, and prompts come from indexed skills and stored capability packages.

## HTTP API

The API is the admin/control-plane surface.

Start it with:

```bash
npm run dev --workspace @shuvdex/api
```

Key routes:

- `GET /health`
- `GET /api/tools`
- `GET /api/skills`
- `GET /api/packages`
- `GET /api/policies`
- `GET /api/audit`
- `GET /api/runners`
- `GET /api/hosts`
- `POST /api/tokens`

`/api/tools` is a compatibility view over capability packages for the current UI. It no longer reflects a separate fleet-tool seed system.

## Web App

The web UI lives in `apps/web`.

```bash
npm run dev --workspace @shuvdex/web
```

The current UI is focused on capability management through the API compatibility layer.

## Capability Model

Skills are treated as capability packages instead of files to distribute.

- `SKILL.md` only: compiled with markdown-derived defaults
- `SKILL.md` + `capability.yaml`: manifest metadata overrides defaults
- generated outputs:
  - summary resource
  - instructions resource
  - apply prompt
  - optional manifest-defined capabilities

This preserves skill authoring compatibility while moving discovery, policy, and disclosure to structured data.

### Module runtime tool template

A reusable example for manifest-backed local tools lives at:

- `examples/module-runtime-skill-template/`

Use it as the starting point for tool-first skill conversions such as `youtube-transcript`, `crawl`, `upload`, `model-usage`, and `ccusage`.

## Development

Top-level scripts:

```bash
npm run build
npm run test
npm run typecheck
npm run lint
npm run clean
```

Targeted examples:

```bash
npm run test --workspace @shuvdex/mcp-server
npm run test --workspace @shuvdex/skill-indexer
npm run typecheck --workspace @shuvdex/api
```

## Notes

- running the API or MCP server creates local state under `.capabilities/` unless overridden by env vars
- host management still exists as an admin surface, but capability delivery is no longer modeled as per-host repo synchronization
- the gateway catalog is intentionally empty until you index skills or create capability packages

## License

See [LICENSE](./LICENSE) for details.

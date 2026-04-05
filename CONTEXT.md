# CONTEXT — shuvdex

> For AI coding agents. For humans, see `README.md`.

## What is shuvdex?

A **centralized MCP capability gateway** that proxies AI tool calls through a governed, policy-controlled server. AI clients (Claude, ChatGPT, Cursor, etc.) connect to a single MCP endpoint and get access to curated, policy-gated tools from multiple upstream sources.

## Monorepo layout

### Apps (3)

| Package | Port | Description |
|---------|------|-------------|
| `@shuvdex/api` | 3847 | HTTP API server (Hono) — admin endpoints for packages, policies, tokens, credentials, audit, reporting, dashboard |
| `@shuvdex/mcp-server` | 3848 | Remote MCP server (HTTP transport) — the gateway endpoint AI clients connect to |
| `@shuvdex/web` | 5173 | Vite SPA — web UI for admin/governance (early stage) |

### Packages (11)

| Package | Role |
|---------|------|
| `@shuvdex/capability-registry` | In-memory registry of CapabilityPackages, lookup by tool/resource/prompt |
| `@shuvdex/skill-indexer` | Compiles skill directories (SKILL.md + capability.yaml) into CapabilityPackages |
| `@shuvdex/skill-importer` | Imports skills from external directories into the gateway |
| `@shuvdex/policy-engine` | ACL policy evaluation — allow/deny/approval-required per tool/subject |
| `@shuvdex/execution-providers` | Dispatches tool execution to the correct executor (module_runtime, http_api, mcp_proxy) |
| `@shuvdex/http-executor` | Executes HTTP API calls with credential injection and response mapping |
| `@shuvdex/openapi-source` | Ingests OpenAPI specs → inspects operations → compiles to CapabilityPackages |
| `@shuvdex/credential-store` | Stores and retrieves API credentials (API key, bearer, OAuth, custom headers) |
| `@shuvdex/mcp-proxy` | Proxies tool calls to upstream MCP servers |
| `@shuvdex/tenant-manager` | Multi-tenant configuration, role mapping, tier management |
| `@shuvdex/telemetry` | OTEL-compatible telemetry helpers |

### Other directories

| Path | Description |
|------|-------------|
| `tests/` | Security test suite (52 tests) — auth, isolation, privilege escalation, upstream security, session |
| `examples/` | Skill templates and reference implementations |
| `scripts/` | Seed scripts, certification harness, ops utilities |
| `systemd/` | Versioned systemd unit files |
| `docs/` | Deployment guides, operations runbooks, onboarding playbooks, connector catalog, pilot framework |

## Technology stack

- **Runtime:** Node.js, TypeScript
- **Effect system:** Effect-TS (services, layers, managed runtime)
- **HTTP framework:** Hono + @hono/node-server
- **MCP SDK:** @modelcontextprotocol/sdk
- **Schema:** Zod v4
- **Build:** Turborepo, tsc project references
- **Test:** Vitest
- **Process management:** systemd user units

## Deployment shape

All services run on **shuvdev** (Hetzner VPS, Tailscale):

| Service | Endpoint | systemd unit |
|---------|----------|--------------|
| MCP server | `http://shuvdev:3848/mcp` | `shuvdex-mcp.service` |
| API server | `http://shuvdev:3847` | (part of deployment) |
| Web UI | `http://shuvdev:5173` | (part of deployment) |

Health checks:
- `curl http://shuvdev:3848/health`
- `curl http://shuvdev:3847/health`

## Core data flow

```
Skill directory / OpenAPI spec
  → skill-indexer / openapi-source (compile)
    → CapabilityPackage (tools + resources + prompts)
      → capability-registry (register)
        → MCP server (expose as MCP primitives)
          → AI client calls a tool
            → policy-engine (authorize)
              → execution-providers (dispatch)
                → module_runtime / http_api / mcp_proxy (execute)
                  → result back to client
```

## Key architectural decisions

1. **CapabilityPackage** is the universal unit — every skill, API, or upstream MCP server compiles into one
2. **JSON Schema ↔ Zod bridge** — capabilities define JSON Schema, MCP SDK requires Zod; `server.ts` converts at registration time
3. **Policy-first** — every tool call goes through `authorize()` before execution
4. **Executor types:** `module_runtime` (spawn a script), `http_api` (HTTP call with credentials), `mcp_proxy` (forward to upstream MCP)
5. **Remote-only MCP** — the server runs on shuvdev, clients connect over HTTP; no local filesystem access from callers

## Certified capabilities (5)

| Tool | Executor | Source |
|------|----------|--------|
| `skill.module_runtime_template.echo` | module_runtime | examples/module-runtime-skill-template |
| `skill.youtube_transcript.get_transcript` | module_runtime | seeded skill |
| `openapi.gitea.getVersion` | http_api | OpenAPI spec |
| `openapi.dnsfilter.getCurrentUser` | http_api | OpenAPI spec |
| `skill.crawl.crawl_url` | module_runtime | seeded skill |

Certification harness: `scripts/run-mcp-certification.sh`

## API routes

| Path | Router | Description |
|------|--------|-------------|
| `/api/packages` | packagesRouter | Package CRUD |
| `/api/tools` | toolsRouter | Legacy tool listing (web compat) |
| `/api/skills` | skillsRouter | Skill management |
| `/api/policies` | policiesRouter | ACL policy management |
| `/api/tokens` | tokensRouter | Token issuance/verification |
| `/api/credentials` | credentialsRouter | Credential store |
| `/api/sources/openapi` | openapiSourcesRouter | OpenAPI source management |
| `/api/upstreams` | upstreamsRouter | Upstream MCP server management |
| `/api/audit` | auditRouter | Audit log |
| `/api/sync` | syncRouter | Trigger skill re-sync |
| `/api/approvals` | approvalsRouter | Approval workflow |
| `/api/break-glass` | breakGlassRouter | Emergency override |
| `/api/tenants` | tenantsRouter | Tenant management |
| `/api/templates` | templatesRouter | Tenant templates |
| `/api/dashboard/*` | dashboardRouter | Governance dashboard data |
| `/api/reports/*` | reportingRouter | Usage, billing, governance, compliance reports |
| `/dashboard` | — | Governance dashboard HTML |

## High-complexity files (document carefully when modifying)

- `apps/mcp-server/src/server.ts` (436 lines) — MCP server factory, tool registration, schema conversion, authorization
- `packages/skill-indexer/src/compiler.ts` (592 lines) — Skill compilation pipeline (parse → extract → generate → package)

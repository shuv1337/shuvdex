# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] — Gateway Launch (2026-03-15 → 2026-04-04)

125 commits. Architecture pivot from fleet management CLI to centralized MCP capability gateway.

### Gateway Core
- Capability registry with CapabilityPackage as the universal unit
- Skill indexer: compiles SKILL.md + capability.yaml into capability packages
- Skill importer: imports external skill directories
- Policy engine: ACL-based authorization (allow/deny/approval-required)
- Execution providers: dispatches to module_runtime, http_api, or mcp_proxy executors
- Remote HTTP MCP server with health endpoint and JSON Schema → Zod bridge
- HTTP API server (Hono) with full admin surface

### Real Capabilities (5 certified)
- `echo` — module_runtime reference implementation
- `youtube-transcript` — YouTube video transcript extraction (module_runtime)
- `gitea-version` — Gitea server version query (http_api via OpenAPI)
- `dnsfilter-current-user` — DNSFilter authenticated API (http_api via OpenAPI)
- `crawl` — URL content extraction (module_runtime)

### OpenAPI Pipeline
- OpenAPI spec ingestion with operation inspection and filtering
- HTTP API executor with credential injection and response mapping
- Credential store supporting API key, bearer, OAuth, and custom header schemes

### Multi-Tenant & Governance
- Tenant manager with role mapping and tier configuration
- Approval workflow with break-glass emergency override
- Governance dashboard served at `/dashboard`
- Reporting endpoints: usage, billing, governance score, compliance export
- 52 security tests: auth, tenant isolation, privilege escalation, upstream security, session

### Infrastructure
- Remote HTTP MCP server on shuvdev (port 3848)
- API server on shuvdev (port 3847)
- systemd user units for process management
- Lightweight MCP certification harness (curl + jq)
- Backup, upgrade, and disaster recovery scripts and runbooks

### Documentation
- Deployment reference architectures (standard hosted, dedicated, backup/restore, upgrade)
- Operations runbooks (SLA, escalation, disaster recovery, monitoring)
- Customer onboarding playbooks with vertical-specific guides
- Connector catalog with new-connector guide
- Pilot framework with checklists and case study templates

### Removed
- Fleet CLI (`apps/cli`)
- SSH executor and host management
- `@shuvdex/git-ops`, `@shuvdex/skill-ops`, `@shuvdex/tool-registry` packages
- Clean-room isolation model

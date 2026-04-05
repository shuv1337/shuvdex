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

### Web UI (vite preview mode)
- User systemd unit:
  - `~/.config/systemd/user/shuvdex-web.service`
- Runs `vite preview` on **shuvdev:5173**
- SPA history fallback is configured via custom plugin in `apps/web/vite.config.ts`
- API proxy is configured for preview mode to forward `/api` to `localhost:3847`
- Health/validation:
  - Root: `curl http://shuvdev:5173/`
  - SPA fallback: `curl http://shuvdev:5173/packages` (should return 200 + HTML)
  - API proxy: `curl http://shuvdev:5173/api/health`
  - Static asset: `curl http://shuvdev:5173/assets/index-*.js`

## Important rule: rebuild + restart after server changes

If you change anything that affects the remote MCP server **or web UI**, you must rebuild and restart before claiming success.

This includes changes under:

- `apps/mcp-server/**`
- `apps/api/**`
- `apps/web/**` (including `vite.config.ts`)
- `packages/capability-registry/**`
- `packages/skill-indexer/**`
- `packages/policy-engine/**`
- `packages/execution-providers/**`
- `systemd/*.service`
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

### Web service restart (vite preview mode)

The web service runs `vite preview` (production build served by Vite's preview server).

If web code or `vite.config.ts` changed:

```bash
systemctl --user restart shuvdex-web.service
systemctl --user status --no-pager --full shuvdex-web.service | sed -n '1,80p'
# Verify SPA fallback works:
curl -s http://shuvdev:5173/packages | head -5
```

If the unit file changed:

```bash
cp systemd/shuvdex-web.service ~/.config/systemd/user/shuvdex-web.service
systemctl --user daemon-reload
systemctl --user restart shuvdex-web.service
systemctl --user status --no-pager --full shuvdex-web.service | sed -n '1,80p'
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
- `hetzner`

## Phase 4C/4D/4E — Deployment Docs, Security Tests, Connection Maintenance (completed 2026-04-04)

### Phase 4C: Deployment Reference Architectures
- `docs/deployment/standard-hosted.md` — Hetzner VPS + Tailscale + Cloudflare step-by-step
- `docs/deployment/dedicated.md` — Isolated VPS per client with data residency guidance
- `docs/deployment/backup-restore.md` — Backup strategy, rotation, restore procedure
- `docs/deployment/upgrade.md` — Zero-downtime rolling upgrade with rollback
- `scripts/ops/backup.sh` — Timestamped archive, dry-run, verify, test-restore modes

### Phase 4D: Security Verification Suite
- `tests/` — New workspace (`@shuvdex/tests`) added to root workspaces
- `tests/src/security/auth-failures.test.ts` — Expired, wrong-key, revoked, malformed tokens (7 tests)
- `tests/src/security/tenant-isolation.test.ts` — Disclosure isolation, audit tenantId filter (6 tests)
- `tests/src/security/privilege-escalation.test.ts` — Package ACL, scope ACL, visibility, policy deny (10 tests)
- `tests/src/security/upstream-security.test.ts` — Hash pinning, mutation detection, injection scanner, suspended upstream (21 tests)
- `tests/src/security/session-security.test.ts` — Expiry, revocation persistence, circuit-breaker analog, audit metrics (8 tests)
- **52 tests total, all passing** — run with `npx vitest run tests/src/security`

### Phase 4E: Connection Stability and Maintenance
- `docs/runbooks/connection-maintenance.md` — Upstream API change workflow, maintenance windows, deprecation lifecycle, alerting setup
- `scripts/ops/upstream-health-check.sh` — Color-coded health table, JSON output, optional sync trigger, mutation flags

---

## Phase 3E — Governance Dashboard (completed 2026-04-04)

A standalone governance dashboard is now served at:
- **API direct:** `http://shuvdev:3847/dashboard`
- **Nginx proxy:** `http://shuvdev/dashboard` (via the SPA fallback — or add an explicit nginx location)

### New API endpoints (all under `/api/*`, auth required)
- `GET /api/dashboard/summary` — aggregate stats + governance score
- `GET /api/dashboard/audit-timeline?hours=N` — hourly event bins (max 168h)
- `GET /api/dashboard/health-overview` — upstream health with overallStatus rollup

### Dashboard file locations
- `apps/api/public/dashboard.html` — served by the API server
- `apps/web/public/dashboard.html` — served by nginx static files

Both files are **identical**. When updating the dashboard, edit `apps/api/public/dashboard.html` and copy to `apps/web/public/dashboard.html`.

### `DASHBOARD_HTML_PATH` env override
Set `DASHBOARD_HTML_PATH=/absolute/path/to/dashboard.html` to serve a custom location.

---

## Phase 5A/5B — Customer Onboarding Playbooks and Connector Catalog (completed 2026-04-04)

### Phase 5A: Customer Onboarding Playbook
- `docs/playbooks/customer-onboarding.md` — complete 4-step onboarding playbook (Assess → Configure → Connect → Maintain); includes pre-call questionnaire, discovery call agenda, Access Model template, full configuration commands, user connection templates for Claude/ChatGPT/Cursor/VS Code, maintenance procedures
- `docs/playbooks/vertical-m365-heavy.md` — M365-heavy shop vertical; Entra ID app registration requirements, full curl config template, standard role mapping (All Staff / Finance / Sales / Leadership)
- `docs/playbooks/vertical-google-workspace.md` — Google Workspace vertical; domain-wide delegation setup guide, service account credential pattern, HubSpot add-on config
- `docs/playbooks/vertical-mixed-saas.md` — Mixed SaaS vertical (Standard/Custom tier); 4-integration config template (M365+HubSpot+QBO+Mailchimp), complex role overlap notes
- `docs/playbooks/success-milestones.md` — 30/60/90-day client success milestones with verification commands, churn risk indicators, renewal conversation framework

### Phase 5B: Connector Catalog Expansion
- `docs/connectors/catalog.md` — full connector catalog; status table (Live/Planned/Q2 2026), per-connector capability tables, role mapping recommendations, client profile selector
- `docs/connectors/new-connector-guide.md` — 11-step new connector guide (Research → Register → Credential → Sync → Classify → Pin → Approve → Map → Test → Document → Deploy) with curl examples, readiness checklist, troubleshooting table
- `docs/connectors/examples/m365.json` — M365 connector registration example
- `docs/connectors/examples/google-workspace.json` — Google Workspace connector registration example
- `docs/connectors/examples/quickbooks.json` — QuickBooks connector registration example (high-risk defaults, restricted payment write)
- `docs/connectors/examples/hubspot.json` — HubSpot connector registration example
- `docs/connectors/examples/mailchimp.json` — Mailchimp planned connector registration example
- `docs/connectors/examples/slack.json` — Slack planned connector registration example

---

---

## Phase 5C/5D/5E — Reporting, Operations Docs, Pilot Framework (completed 2026-04-04)

### Phase 5C: Reporting and Compliance Endpoints
- `apps/api/src/routes/reporting.ts` — new; four reporting endpoints
- `apps/api/src/index.ts` — registered `reportingRouter` at `/api/reports`

#### New API endpoints (all under `/api/reports/*`, auth required)
- `GET /api/reports/usage?tenantId=&from=&to=` — tool call aggregates by app, action class, user; approval events; policy violations
- `GET /api/reports/billing?tenantId=` — tier, monthly rate, connector count, user limits, billable month
- `GET /api/reports/governance?tenantId=&from=&to=` — governance value report: score, highlights, narrative summary for renewals
- `GET /api/reports/compliance-export?tenantId=&from=&to=&format=json|csv` — downloadable audit export with sections: audit_events, policy_changes, approval_decisions, connector_drift_events, change_history

#### Tier pricing encoded in reporting.ts
- Core: $99/mo, Standard: $179/mo, Custom: null (POA)

### Phase 5D: Operations Documentation
- `docs/operations/sla.md` — uptime targets by tier, health check methodology, exclusions, SLA credits table
- `docs/operations/escalation.md` — L1–L4 escalation model, ASCII flowchart, response templates, RCA template
- `docs/operations/disaster-recovery.md` — RTO/RPO by tier, backup schedule, 5 recovery procedures (crash/restore/full-host/migration/deprecation)
- `docs/operations/monitoring.md` — health endpoints, OTEL metrics catalog, alerting thresholds, log aggregation, monthly review checklist

### Phase 5E: Pilot Framework
- `docs/pilots/pilot-framework.md` — client selection criteria, 4-6 week structure, success metrics, feedback templates, documentation framework
- `docs/pilots/pilot-checklist.md` — pre/during/post pilot checkboxes with exact commands
- `docs/pilots/case-study-template.md` — internal + public case study template with anonymisation guide

---

## Keep this file updated

When you learn something operationally useful, update this file.

Especially keep these current:

- actual MCP/API/web endpoints and ports
- systemd service names and install paths
- required restart/reload commands
- known-good validation commands
- known caveats that can waste time for future agents

If you change the deployment workflow and do **not** update this file, you are leaving a trap for the next agent.

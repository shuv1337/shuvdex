# shuvdex — Implementation Plan

## Product

**shuvdex** is the platform behind **Latitudes Managed AI Connectivity** — a governed capability gateway and control plane that gives SMBs a single, audited, policy-controlled endpoint for AI-to-business-system access.

Latitudes operates the infrastructure. Clients get governance. The product is sold as a flat monthly rate per organisation, not per query.

## Commercial context

The service is live at latitudes.io as "Managed AI Connectivity for SMBs." Pricing is set:

- **Core** — $99/mo, 2 app integrations, 20 users
- **Standard** — $179/mo, 5 app integrations, 50 users
- **Custom** — POA, unlimited integrations, bespoke connectors

Live integrations: Microsoft 365, Google Workspace, QuickBooks Online, HubSpot CRM, Mailchimp, Website Analytics. Planned Q2 2026: Xero, Shopify. Custom/bespoke on request.

The go-to-market motion is a 30-minute discovery call → stack assessment → access model design → deployment. Users connect in under two minutes with their existing work account.

## How the plan maps to the product

Externally, the product talks about "app integrations," "skills," and "connectors." Internally, these are upstream MCP servers proxied through shuvdex's `mcp_proxy` adapter, governed by the policy engine, and audited through the telemetry pipeline. The plan below uses internal/technical terminology.

---

## Design principles

1. **Internal-first, multi-tenant by design.** Latitudes is tenant #1. Every abstraction assumes future client tenants.
2. **Gateway, not monolith.** One unified endpoint per client, composed internally from many upstream sources.
3. **Caller identity is explicit.** Every request resolves to tenant → caller → groups → policy bundle. Entra ID or Google Workspace identity from day one.
4. **No token passthrough.** Inbound client auth and outbound upstream auth are completely separated.
5. **Disclosure is intentional.** Only tools that are approved, bound, and allowed for the current tenant/caller are visible.
6. **Governance is the product.** The policy, audit, approval, and change-control layer is what clients buy.
7. **Security ships with features.** MCP-specific mitigations (description pinning, rug pull detection, metadata scanning) deploy alongside federation, not after.
8. **Read-only by default. Write is explicit.** Every connection starts read-only. Write access requires specific approval per role.

---

## Architectural target state

### Shared control plane
Manages: tenants, environments, capability packages, connector definitions, credential bindings, policy bundles, certification states, audit logs, compliance exports, approval workflows, break-glass procedures, deployment orchestration.

### Tenant gateway (data plane)
One endpoint per tenant/environment. Presents a single MCP surface to AI hosts. Computes visible capability set for the current caller. Authorizes each invocation. Dispatches to the correct adapter. Records every interaction. Isolates tenant credentials and upstream sessions.

### Adapter layer
- `module_runtime` — local module execution
- `http_api` — direct HTTP/OpenAPI-backed execution
- `mcp_proxy` — upstream vendor MCP server proxying (the primary adapter for client-facing integrations)

### Governance layer
- Approved vs restricted packages per tenant
- Per-role access (Entra groups / Google Workspace groups → policy tiers)
- Read-only default with explicit write approval
- Approval-required operations for data-mutating tools
- Environment-specific visibility
- Tenant-specific exceptions and overrides

### Security layer
- Tool description hash pinning at approval time
- Rug pull detection (upstream mutation → auto-disable + alert)
- Metadata scanning for hidden prompt injection patterns
- Namespaced tool isolation to prevent cross-server shadowing
- Upstream change detection alerting

---

# Phase 1 — Foundation & Minimum Viable Hardening

**Duration:** 4-5 weeks
**Dependencies:** Existing codebase

## Goal
Containerize. Get identity on Entra/Google from day one. Harden enough that Phase 2 federation work doesn't compound security debt.

## Workstreams

### 1A. Control-plane auth and safer HTTP defaults
- Authenticated access on all admin API routes
- Operator roles: platform admin, package publisher, security reviewer, auditor
- Token issuance/revocation restricted to authorized operators
- Remove wildcard CORS for non-localhost deployments
- MCP HTTP server validates `Origin` header per Nov 2025 MCP spec
- Localhost-only bind by default for non-Tailscale deployments
- Explicit dev mode vs deployed mode distinction

### 1B. Identity provider integration from day one
- Policy engine validates Entra ID JWTs with audience/issuer checks
- Support Google Workspace OIDC tokens as alternate provider (matches product promise of "Entra ID or Google Workspace")
- Identity provider security groups map to shuvdex policy tiers
- Every request resolves to: tenant → caller → groups → policy bundle
- Dev tokens remain available for local development mode only
- Every invocation carries explicit caller identity in audit records

### 1C. Structured audit foundation
- Structured JSON logs for: capability discovery, authorization decisions (allow/deny/reason), tool invocations (caller, tool, target system, outcome, latency), package lifecycle events
- Correlation IDs across control plane → gateway → adapter
- Audit record schema: caller, tenant, environment, capability, package, target system, risk level, action class (read/write), outcome, latency
- Metrics: package load failures, auth failures, invocation failures, execution latency

### 1D. Docker Compose packaging
- Containerize gateway + admin API
- Strip all hardcoded `/home/shuv/` paths — fully environment-driven config
- One `docker-compose.yml` + `.env` per deployment
- Mounted volumes for `.capabilities/` state
- Tailscale sidecar container for mesh networking
- Health check endpoints
- Clean instance from `docker compose up` in under 5 minutes
- Validated on Hetzner VPS

### 1E. Internal operator workflows
- End-to-end: package registration → approval → enablement → disablement → rollback
- Runbooks: adding an OpenAPI source, registering a module package, revoking access, rotating a credential
- Validated with Latitudes team as operators

## Exit criteria
- Admin API requires auth
- MCP gateway validates Origin, binds to localhost by default
- Policy engine validates Entra ID and Google Workspace tokens for Latitudes tenant
- All invocations produce structured audit events with caller identity
- System is containerized and deployable via docker compose on Hetzner
- Internal operators can manage packages without code changes

---

# Phase 2 — Federation Core & MCP Security Layer

**Duration:** 5-6 weeks
**Dependencies:** Phase 1

## Goal
Implement `mcp_proxy` — the adapter that connects shuvdex as an MCP client to upstream vendor servers. This is the adapter behind every "app integration" on the sales page. Ship MCP-specific security mitigations alongside federation because the attack surface opens the moment upstream tools are proxied.

## Workstreams

### 2A. mcp_proxy adapter
- Implement `mcp_proxy` execution path using `@modelcontextprotocol/sdk` client
- First targets, matching the live product integrations:
  - **Microsoft 365** (M365 Graph MCP — email, calendar, files, Teams, directory)
  - **QuickBooks Online** (invoices, vendors, P&L, customers)
  - **HubSpot CRM** (contacts, deals, pipeline, activity)
- Support both stdio (local MCP servers) and Streamable HTTP (remote) upstream transports
- Call `tools/list` on upstream, register capabilities in local registry with namespace prefix
- Proxy `tools/call` through credential store
- Namespace all upstream tools: `m365.search_emails`, `quickbooks.list_invoices`, `hubspot.get_deal`
- Preserve provenance metadata: source, transport, last-synced, trust state
- Enforce read-only default: tools tagged as write-capable require explicit policy approval

### 2B. Upstream registry and health
- Registry per upstream: owner, purpose, auth mode, transport mode, health status, last capability sync, tool count
- Health checks with retry, timeout, and graceful degradation (tool shows as unavailable, gateway stays up)
- Track upstream capability changes between syncs
- Operator view: upstream status dashboard

### 2C. Upstream credential isolation
- Inbound auth (Entra/Google JWT from user) and outbound auth (M365 Graph token, QuickBooks OAuth, HubSpot API key) fully separated
- Credentials bound per upstream connector, resolved from credential store at invocation time
- No token passthrough from inbound request
- Outbound auth adapters: API keys, bearer tokens, OAuth 2.0 client credentials, OAuth 2.0 authorization code (for M365 delegated access)

### 2D. Capability caching and sync
- Cache upstream tool/resource/prompt metadata locally
- Refresh on configurable schedule or manual trigger
- Handle upstream removals, renames, and breaking changes
- Surface diffs to operators when capability sets change

### 2E. MCP security hardening
- **Description hash pinning:** Hash tool name + description + input schema at approval time. If upstream vendor mutates any field, auto-disable the tool and alert operators
- **Metadata scanning:** Scan tool descriptions for prompt injection patterns (`<IMPORTANT>` tags, base64-encoded commands, instructions to read local files, hidden directives). Flag suspicious tools for manual review before approval
- **Namespaced tool isolation:** Enforce unique namespace prefix per upstream source. Prevents cross-server tool shadowing
- **Change detection alerting:** Diff upstream metadata on every refresh, notify operators of any changes. Never silently propagate upstream mutations

## Exit criteria
- shuvdex fronts local modules, HTTP APIs, and at least 3 upstream MCP servers (M365, QuickBooks, HubSpot)
- Invocations route correctly to upstream backends
- Upstream auth is isolated from inbound auth
- All upstream tools are namespaced with provenance
- Write-capable tools are blocked by default unless policy-approved
- Description pinning and change detection are active
- Operators can add and manage upstream sources without code changes

---

# Phase 3 — Multi-Tenancy, Policy Disclosure & Client Dashboard

**Duration:** 5-6 weeks
**Dependencies:** Phase 1, Phase 2

## Goal
Per-client capability surfaces. Different clients see different tool sets based on their subscription tier, role structure, and policy. Ship the client-facing governance dashboard — this is the "AI Access Management — Latitudes Dashboard" shown on the sales page.

## Workstreams

### 3A. Tenant and environment domain model
- Core entities: tenant, environment (prod/staging), gateway deployment, package assignment, credential binding, policy bundle
- Inheritance: base package sets with tenant-specific overrides
- Per-tenant identity provider mapping (Entra tenant ID or Google Workspace domain)
- Tenant-scoped credential bindings — a client's QuickBooks OAuth token is only accessible to their tenant
- Environment-specific visibility
- Latitudes internal MSP is tenant #1, proving the model

### 3B. Policy-driven disclosure engine
- Compute visible capability set at session init based on: tenant, environment, caller identity groups, subscription tier, tool trust state
- Per-package-per-tenant states: approved, restricted, approval-required, disabled
- Tier enforcement:
  - Core ($99): 2 upstream connectors visible
  - Standard ($179): 5 upstream connectors visible
  - Custom: unlimited
- Role-based filtering: finance group sees QuickBooks + Xero tools, marketing group sees Mailchimp + HubSpot tools, leadership sees everything (matches sales page "Role-Appropriate Access" promise)
- Read-only tools auto-approved. Write-capable tools require explicit approval per role

### 3C. Approval workflows
- State machine: `discovered → pending_review → approved → active` (or `rejected`)
- Break-glass with enhanced audit logging
- Approval-required for: any write-capable tool, any tool accessing PII, any custom/bespoke connector
- Notifications to Latitudes operators via webhook (Teams/Slack/email)
- Operator approval via admin API or admin UI

### 3D. Policy templates
- **Core:** Matches $99 tier. 2 integrations, read-only, full audit. Standard group-based access
- **Standard:** Matches $179 tier. 5 integrations, selective write by role, quarterly review
- **Custom:** Matches POA tier. Unlimited integrations, bespoke connectors, custom governance
- Templates encode: allowed upstream set, role-to-tool mappings, read/write permissions, audit retention, review cadence

### 3E. Client governance dashboard
Two views from the same API:

**Latitudes Admin View (MSP operators):**
- Cross-tenant overview
- Package management, upstream health, audit search
- Credential rotation, connector status
- Approval queue across all tenants
- Deployment management

**Client Governance View (tenant-scoped, matches sales page dashboard mockup):**
- User access table: who can connect, what role/tier, what access level
- Connected apps per user: which integrations each person can reach
- Connection audit trail: timestamp, user, query description, target app — last 24 hours / 7 days / 30 days
- Pending approval requests (for write access, new connectors)
- Policy summary: what's enabled, what's restricted

### 3F. Tenant lifecycle operations
- Onboarding flow: create tenant → assign identity provider → select policy template → bind credentials → deploy gateway → generate connection URL
- The connection URL is what users add to their AI assistant (matches sales page "users connect in 2 minutes" promise)
- Offboarding: revoke all credentials, disable gateway, export audit log, archive tenant state

## Exit criteria
- Two logical tenants receive different capability surfaces from the same control plane
- Disclosure varies correctly by tenant, role, and subscription tier
- Write-capable tools are gated by approval workflow
- Credential resolution is tenant-scoped
- Client governance dashboard renders the user access table, connected apps, and audit trail for a real tenant
- Policy templates can be applied to a new tenant without code changes
- A new tenant can be onboarded through the defined flow

---

# Phase 4 — External Auth Hardening & Customer-Ready Deployment

**Duration:** 3-4 weeks
**Dependencies:** Phase 1-3

## Goal
Harden the full OAuth 2.1 MCP authorization flow per the Nov 2025 spec. Formalize session management. Produce tested deployment reference architectures. This is the gate before real client traffic.

## Workstreams

### 4A. MCP OAuth 2.1 auth flow
- Protected Resource Metadata endpoint (RFC 9728) pointing to client's Entra tenant or Google Workspace
- OIDC Discovery for authorization server configuration
- Token audience validation scoped to the specific shuvdex tenant gateway endpoint
- Incremental scope consent via `WWW-Authenticate` challenges for sensitive tool classes (write access, PII access)
- PKCE for public clients (Claude Desktop, Cursor, ChatGPT desktop)
- The user experience: open AI assistant → add shuvdex URL → sign in with work account → done. No separate credentials

### 4B. Session and transport hardening
- `MCP-Session-Id` lifecycle: issuance, validation, expiry, revocation
- Capability change propagation to active sessions (tool disabled mid-session → removed from active session)
- Reconnect with `Last-Event-ID` resumability per Streamable HTTP spec
- Rate limiting per tenant and per user
- Connection quotas (max concurrent sessions per tenant based on tier)
- Abuse protection: request size limits, invocation frequency caps

### 4C. Deployment reference architectures
**Standard Hosted (default):**
- shuvdex on Latitudes-operated Hetzner VPS
- Client connects via Tailscale mesh or public HTTPS with Cloudflare proxy
- TLS termination at edge
- Shared host with container isolation between tenants
- Automated daily backup of `.capabilities/` state
- OTEL telemetry to centralized monitoring

**Dedicated (for Custom tier):**
- Isolated VPS per client
- Full network separation
- Client-specific data residency if required
- Same operational patterns, separate blast radius

### 4D. Security verification suite
- Expand MCP certification harness to cover:
  - Auth failure scenarios (expired token, wrong audience, revoked user)
  - Privilege escalation attempts (user tries to access tools outside their role)
  - Tenant isolation verification (tenant A cannot see tenant B's tools, credentials, or audit)
  - Upstream timeout/failure handling (graceful degradation, not gateway crash)
  - Description mutation detection (upstream changes tool → auto-disable fires)
  - Write-attempt on read-only tool (blocked, logged)
  - Session expiry and reconnect behavior

### 4E. Connection stability and maintenance
- API change monitoring for upstream integrations (M365 Graph, QuickBooks, HubSpot APIs version and change)
- Proactive skill/connector updates when upstream platforms change (matches sales page "We Keep It Running" promise)
- Automated health alerting when an upstream connection degrades
- Maintenance window procedures for connector updates

## Exit criteria
- Remote MCP clients authenticate via Entra/Google through spec-compliant OAuth 2.1 flow
- Users can connect by adding a URL and signing in with their work account
- Sessions are managed with proper lifecycle, expiry, and reconnect
- Standard Hosted and Dedicated deployment architectures are documented and tested
- Security verification suite passes all scenarios
- Platform passes internal security review for client rollout

---

# Phase 5 — Go-to-Market Operations

**Duration:** 4-6 weeks + ongoing
**Dependencies:** Phase 1-4

## Goal
Operationalize the managed service. Repeatable onboarding, support operations, reporting, and the first client pilots.

## Workstreams

### 5A. Customer onboarding playbook
Matches the sales page 4-step process:

1. **Assess stack** (30-minute discovery call): apps, team structure, role-based access model. Deliverable: proposed access model and integration set
2. **Configure and govern**: provision tenant, bind identity provider, wire up chosen apps, set security groups, scope permissions per role, test against live environment
3. **Users connect**: each authorized user adds shuvdex URL to their AI assistant, signs in with work account. Under 2 minutes
4. **Ongoing maintenance**: monitor connections, push skill updates, maintain audit trail, handle upstream API changes

Standard playbooks for:
- M365-heavy shops (most common)
- Google Workspace shops
- Mixed SaaS environments
- Vertical-specific (accounting firms, marketing agencies, professional services)

30/60/90-day success milestones per client.

### 5B. Expanding the connector catalog
Priority order for remaining integrations after Phase 2 targets:
- **Google Workspace** (Gmail, Drive, Calendar, Contacts) — live on sales page
- **Mailchimp** (campaigns, lists, performance) — live on sales page
- **Slack** (messages, channels, search)
- **Website Analytics** (traffic, forms, conversions) — live on sales page
- **Xero** (accounts, invoices, reporting) — Q2 2026 on sales page
- **Shopify** (orders, inventory, customers) — Q2 2026 on sales page
- Bespoke/custom connectors built per Custom tier client requirements

Each new connector follows the same pattern: `mcp_proxy` adapter → namespace → description pin → policy template update → operator runbook.

### 5C. Reporting and billing
- Usage reporting by tenant: tool calls by app, active users, approval events, policy violations
- Billable dimensions: tier (Core/Standard/Custom), connector count, user count
- Governance value reports for renewals and quarterly reviews: what was accessed, by whom, what was blocked, what approvals were processed
- "When someone asks 'what has our AI been doing with our data?' you have a complete, accurate answer" — this report is the renewal tool

### 5D. Reliability and support
- SLA definitions per tier
- Escalation model: automated alerting → Latitudes operator → client notification
- Backup/restore/DR procedures per deployment model
- Tenant migration procedures (Standard Hosted → Dedicated, or vice versa)
- Connector deprecation lifecycle and client communications
- Maintenance windows for upstream API changes

### 5E. First client pilots
- Select 2-3 existing Latitudes clients
- Run discovery call + stack assessment
- Deploy managed gateway with 2-3 integrations matching their Core or Standard tier
- Iterate for 4-6 weeks
- Document: what broke, what was confusing, what the client valued most, what they asked for that we didn't have
- These pilots are the case studies and the feedback loop for everything above

## Exit criteria
- At least one external client running successfully on the platform
- Onboarding is repeatable using the playbook
- Policy templates, reporting, and support are operational
- Connector catalog covers all "live" integrations on the sales page
- Governance value reports are generating for pilot clients

---

# Cross-phase workstreams

These span all phases and are continuous:

**A. Identity and authorization** — Entra/Google integration in Phase 1, per-tenant mapping in Phase 3, full OAuth 2.1 MCP flow in Phase 4.

**B. Audit and observability** — structured events in Phase 1, upstream correlation in Phase 2, tenant-scoped reporting in Phase 3, compliance exports and the client-facing audit trail in Phase 4.

**C. Package lifecycle and certification** — approval workflows start in Phase 2 (description pinning), formalize in Phase 3 (state machine), verify in Phase 4 (security suite).

**D. MCP security posture** — description pinning in Phase 2, approval-gated mutation in Phase 3, verification suite in Phase 4. Continuous monitoring thereafter.

**E. Documentation and runbooks** — if an operator cannot safely perform a task without tribal knowledge, the task is not done.

**F. Internal dogfooding** — Latitudes remains the first real tenant and first real operator at every stage.

---

# Timeline

| Phase | Duration | Cumulative | Key Milestone |
|-------|----------|-----------|---------------|
| Phase 1 — Foundation | 4-5 weeks | Week 5 | Containerized, Entra/Google auth, audit logs |
| Phase 2 — Federation + Security | 5-6 weeks | Week 11 | Live upstream proxying (M365, QuickBooks, HubSpot) |
| Phase 3 — Multi-Tenancy + Dashboard | 5-6 weeks | Week 17 | Per-tenant surfaces, client governance dashboard |
| Phase 4 — External Hardening | 3-4 weeks | Week 21 | Customer-ready OAuth, deployment blueprints |
| Phase 5 — Go-to-Market | 4-6 weeks | Week 27 | First client pilots live |

First client deployment target: **Q3 2026.**

---

# Immediate backlog

If starting today:

1. **Week 1-2:** Docker Compose packaging. Strip hardcoded paths. Auth on admin API. Entra JWT validation for Latitudes tenant
2. **Week 3-4:** Structured audit events. Safer HTTP defaults (Origin validation, localhost bind). Operator workflow validation
3. **Week 5-6:** `mcp_proxy` adapter — M365 Graph MCP as first upstream. Namespace tools. Pin descriptions on first sync
4. **Week 7-8:** QuickBooks and HubSpot upstreams. Upstream registry + health. Credential isolation. Change detection alerting

At week 8: containerized, identity-provider-authed, audited MCP gateway federating M365 + QuickBooks + HubSpot with security hardening. That's the internal demo. That's the proof of concept for the first client pilot.

---

# Strategic risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Microsoft ships native MCP governance in Copilot admin | Medium | High | Be multi-agent from day one (Claude, ChatGPT, Copilot, Cursor). Focus on cross-platform governance and the policy/audit layer Microsoft won't build for non-MS tools |
| MCP spec breaks backward compat | Medium | Medium | Pin to spec version, abstract transport. Protocol is stabilizing under Linux Foundation governance |
| SMBs don't understand the problem yet | High | Medium | Lead with discovery call. Show them what's already happening with their data. The sales page framing ("your team is already using AI tools") is the right wedge |
| Maintenance burden at 10+ tenants | Medium | Medium | Infrastructure-as-code from Phase 1. Automate deployment. Centralized OTEL monitoring. Standard Hosted model shares infrastructure |
| Upstream vendor API changes break connectors | High | Medium | Health monitoring, proactive updates, graceful degradation. "We Keep It Running" is a core service promise — staff for it |
| MCP security incident at a client | Medium | High | Description pinning, audit logging, kill-switch per tool. The gateway IS the mitigation. Incident response runbook for Custom tier |
| Underpricing connector development for Custom tier | Medium | Medium | Track actual hours per bespoke connector. Build pricing model from real data during pilots. POA structure gives flexibility |

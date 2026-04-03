# Shuvdex System Specification

Status: Draft
Version: 0.3
Date: 2026-04-03
Scope: Internal v1 for Latitudes, with a direct path to per-client managed deployment
Protocol basis: MCP specification version 2025-11-25

## 1. Executive summary

Shuvdex is a governed AI connectivity platform built on MCP gateway principles. Internally, it gives Latitudes one controlled endpoint for AI-assisted operations across approved systems. Externally, it becomes a managed service where each client receives a curated MCP endpoint tied to their identity provider, their approved connectors, and their governance rules.

Externally, the product is described in business language: managed AI connectivity, governed AI connectivity, AI access management.

Internally, Shuvdex is an MCP gateway and control plane composed of:

- a control plane for packages, credentials, policy, approvals, and audit
- a per-environment gateway exposing one MCP endpoint
- execution adapters for upstream MCP servers, HTTP APIs, and local modules
- a security layer for MCP-specific threat mitigation

## 2. Product statement

### 2.1 Core product statement

Shuvdex provides one governed endpoint through which AI tools can access business systems under explicit organizational policy.

It exists to answer five business questions:

1. Who can connect AI to which systems?
2. Is that access read-only or write-capable?
3. Which credentials are being used and where are they stored?
4. What did the AI access or do?
5. Who approved the current access model?

### 2.2 Internal v1 statement

Internal v1 is the Latitudes-operated proving ground. It validates the control plane, the gateway runtime, internal connectors, policy enforcement, audit quality, approval workflows, and the operator runbooks required to support customers.

### 2.3 External managed-service statement

For customers, Shuvdex is not sold as protocol infrastructure. It is sold as a managed control layer over AI access to company data.

Customer promise:

- leadership decides access policy
- Latitudes implements and maintains the integration layer
- access follows the customer's identity provider
- all interactions are auditable
- write access is explicit, limited, and reviewable

### 2.4 Commercial context

The service is live at latitudes.io as "Managed AI Connectivity for SMBs." Pricing is set:

- Core — $99/mo, 2 app integrations, 20 users
- Standard — $179/mo, 5 app integrations, 50 users
- Custom — POA, unlimited integrations, bespoke connectors

The go-to-market motion is a 30-minute discovery call, stack assessment, access model design, and deployment. Users connect in under two minutes with their existing work account.

## 3. Goals

### 3.1 Primary goals

- Present one stable endpoint per client environment to AI hosts.
- Aggregate approved capabilities from multiple sources into one governed surface.
- Tie access to the client's identity provider from day one.
- Keep credentials and tokens server-side and client-isolated.
- Default to read-only behavior.
- Require explicit review for writes and higher-risk actions.
- Produce customer-usable audit trails and governance reports.
- Support a repeatable MSP operating model.
- Protect against MCP-specific attack vectors as a visible product feature.

### 3.2 Secondary goals

- Keep customer-facing language simple and non-protocol-centric.
- Support both MCP-native and non-MCP systems.
- Allow Latitudes to add and maintain bespoke connectors.
- Support eventual configuration portability and fleet operations.
- Maintain upstream connector compatibility as vendor APIs change.

## 4. Non-goals

Shuvdex is not intended to:

- replace every vendor system with a custom reimplementation
- expose every possible connector to every user
- rely on one shared multi-tenant runtime as the first customer deployment model
- forward inbound client bearer tokens directly to upstream APIs
- ship unrestricted write access by default
- sell protocol complexity as customer value

## 5. Design principles

1. **Managed by us, governed by you.**
2. **Per-client isolation first.**
3. **One endpoint outward, many sources inward.**
4. **Identity-linked least privilege.** Entra ID or Google Workspace from day one, not retrofitted later.
5. **Read-only by default; write is explicit.**
6. **Capability packages are the unit of governance.**
7. **Security ships with features, not after them.** MCP-specific mitigations deploy alongside federation.
8. **The control plane and data plane are separate concerns.**
9. **MCP is the integration substrate, not the sales language.**
10. **Every decision should be attributable, reviewable, and reversible where possible.**

## 6. Personas and actors

### 6.1 Latitudes platform admin
Owns platform deployment, base policy templates, connector certification, fleet operations, and incident handling.

### 6.2 Latitudes operator / technician
Onboards connectors, binds credentials, handles approvals, reviews audit logs, and supports customer environments.

### 6.3 Customer admin / leadership
Approves which systems and roles may be AI-connected, reviews audit activity, and requests changes.

### 6.4 End user
Uses an AI host that connects to the customer's Shuvdex endpoint. Access is determined by identity, role, group, and policy.

### 6.5 AI host / MCP client
A client such as Claude, ChatGPT, Copilot, Cursor, or another MCP-capable host that connects to the gateway.

### 6.6 Upstream capability source
A vendor MCP server, a REST/OpenAPI service, or a local/custom module execution path.

### 6.7 Auditor / security reviewer
Reviews approvals, changes, audit trails, write permissions, and incident history.

## 7. Protocol layer

### 7.1 Protocol version

The system targets MCP specification version 2025-11-25, the current stable release under the Agentic AI Foundation (Linux Foundation governance).

### 7.2 Wire format

All MCP communication uses JSON-RPC 2.0 messages, UTF-8 encoded.

### 7.3 Transports

The gateway must support two transports:

**stdio** — for local development and tightly controlled host environments. The gateway reads JSON-RPC from stdin and writes to stdout, newline-delimited.

**Streamable HTTP** — for remote client connections. The gateway exposes a single HTTP endpoint supporting POST (for client-to-server messages) and GET (for server-initiated SSE streams). This is the primary transport for customer deployments.

Streamable HTTP requirements:

- the server must validate the `Origin` header on all requests and reject invalid origins with HTTP 403
- when running locally, the server must bind to localhost only
- POST requests may return `application/json` for simple responses or `text/event-stream` for SSE streaming
- the server may send JSON-RPC requests and notifications to the client via SSE before sending the response

### 7.4 Session management

Sessions are negotiated MCP interaction contexts between a client and a gateway.

Required behavior:

- the gateway may assign a session ID via the `MCP-Session-Id` response header during initialization
- clients must include the session ID on all subsequent requests
- the gateway may terminate sessions and must respond with HTTP 404 to expired session IDs
- clients must handle 404 by starting a new session via `InitializeRequest`
- session storage must be abstracted to support in-memory (internal v1), distributed (multi-instance), and future stateless models

Session data model:

- sessionId
- gatewayId
- tenantId
- environmentId
- actor identity (resolved from IdP token)
- protocol version
- negotiated capabilities
- disclosed capability set
- auth context
- creation and expiry timestamps

### 7.5 Capability negotiation

At session initialization, the gateway and client exchange capabilities per the MCP spec. The gateway declares its supported server features (tools, resources, prompts, listChanged notifications). The client declares its supported features (sampling, roots, elicitation). Both parties respect declared capabilities throughout the session.

### 7.6 Resumability

The gateway should support SSE event IDs and `Last-Event-ID`-based reconnection per the Streamable HTTP specification. Event IDs must be globally unique within a session and must encode sufficient information to identify the originating stream.

## 8. Product surfaces

### 8.1 Control plane

The control plane manages:

- tenants
- environments
- gateways
- packages and connectors
- capabilities
- credentials and bindings
- policy bundles and templates
- approval workflows
- audit records and reports
- deployment metadata
- connector health and sync state
- upstream registries

### 8.2 Gateway / data plane

The gateway exposes one MCP endpoint for a specific tenant/environment and:

- negotiates the MCP session
- authenticates and authorizes the caller via IdP token validation
- computes the visible capability set based on tenant, environment, caller groups, subscription tier, tool trust state, risk level, and approval status
- registers only permitted tools, resources, and prompts for the session
- enforces policy on every invocation, including read/write gating
- resolves the correct execution adapter and brokers credentials
- normalizes outputs and errors
- records runtime audit events with correlation IDs
- shields upstream systems from direct client access

The gateway is not the source of truth for package management, credential administration, or tenant lifecycle. Those belong to the control plane.

### 8.3 UI surfaces

**MSP admin portal** — used by Latitudes operators:

- cross-tenant overview and deployment management
- connector onboarding and package management
- credential rotation and binding management
- approval queue across all tenants
- upstream health dashboard
- audit search and incident investigation
- drift and change detection alerts

**Client governance dashboard** — used by customer leadership, tenant-scoped:

- user access table: who can connect, what role/tier, what access level
- connected apps per user: which integrations each person can reach
- connection audit trail: timestamp, user, query description, target app (filterable by 24h / 7d / 30d)
- pending approval requests
- policy summary: what is enabled, what is restricted, whether write is active anywhere
- governance posture overview

These are two views of the same API, scoped by caller role.

## 9. Core data model

### 9.1 Tenant

- tenantId
- name
- status (active, suspended, archived)
- subscription tier (core, standard, custom)
- identity provider type and configuration (Entra tenant ID or Google Workspace domain)
- owner metadata
- data residency notes
- creation and modification timestamps

### 9.2 Environment

- environmentId
- tenantId
- name (e.g. production, staging)
- gateway configuration reference
- credential namespace
- policy bundle assignment

### 9.3 Gateway

- gatewayId
- tenantId
- environmentId
- endpoint URL
- transport configuration (stdio or Streamable HTTP)
- auth mode
- enabled packages
- health status
- deployment metadata (container ID, host, version)

### 9.4 Capability package

- packageId
- version
- source type (mcp_proxy, http_api, module_runtime)
- namespace
- maintainer (Latitudes or customer-specific)
- certification state
- enabled state
- contained capabilities
- upstream source reference (for mcp_proxy packages)
- description hash (pinned at approval time)
- last sync timestamp

### 9.5 Capability

- capabilityId
- packageId
- name (namespaced: `m365.search_emails`, `quickbooks.list_invoices`)
- kind (tool, resource, prompt)
- description
- input/output schema
- risk level (low, medium, high, restricted)
- read/write/admin classification
- provenance (local, imported, proxied)
- approval status
- enabled state
- visibility rules
- description hash

### 9.6 Execution binding

- executorType (mcp_proxy, http_api, module_runtime)
- target (upstream URL, module entrypoint, HTTP endpoint)
- timeoutMs
- retryPolicy (none, safe-only)
- streaming flag
- credential binding reference
- correlation metadata

### 9.7 Credential binding

- bindingId
- tenantId
- environmentId
- credentialId (reference to encrypted secret)
- credential type (API key, OAuth client credentials, OAuth authorization code, bearer token, service account)
- allowed packages
- allowed capabilities
- scopes
- rotation metadata (last rotated, rotation interval, next rotation)
- creation and modification timestamps

### 9.8 Policy bundle

- policyId
- name
- scope (tenant, environment, gateway)
- subscription tier mapping
- connector allowlist (max count by tier)
- role-to-package mappings
- read/write rules per capability class
- approval requirements by risk level
- break-glass rules
- rate limits (per-tenant, per-user, per-capability)

### 9.9 Audit event

- eventId
- timestamp
- tenantId
- environmentId
- actor (caller identity from IdP)
- actor groups/roles
- action (tool_call, resource_read, prompt_get, package_approve, credential_rotate, policy_change, etc.)
- target type and target id
- package and capability reference
- source system (upstream target)
- action class (read, write, admin)
- decision (allow, deny, approval_required, break_glass)
- decision reason
- correlation id / session id
- outcome (success, error, timeout)
- latency
- redacted request metadata
- redacted response metadata

## 10. Identity and access model

### 10.1 Identity providers

Supported from day one:

1. Microsoft Entra ID — JWT validation with audience/issuer checks, security group mapping
2. Google Workspace — OIDC token validation, group mapping

The architecture must permit additional providers later.

### 10.2 Access resolution

Every request must resolve to:

- tenant (from gateway binding or token audience)
- environment (from gateway binding)
- caller identity (from IdP token subject)
- caller groups (from IdP token group claims)
- policy bundle (from tenant + environment assignment)
- effective permissions (from policy bundle + group mappings)

### 10.3 Progressive disclosure

The visible capability set for a session is computed at initialization using:

- tenant assignment
- environment assignment
- caller identity and groups
- subscription tier (determines maximum connector count)
- package approval state per tenant
- capability certification state
- risk level
- read/write classification
- current approval state
- gateway feature flags

Only capabilities that pass all filters are registered with the MCP client for the session.

### 10.4 Access revocation

When the user's identity-provider account is disabled or group membership changes, Shuvdex must revoke or alter effective access without requiring a separate manual process. For active sessions, the gateway should either invalidate the session or send capability change notifications where the transport supports it.

### 10.5 Authorization evaluation order

For every invocation:

1. Is the caller authenticated for this gateway?
2. Is the caller mapped to the target tenant/environment?
3. Is the package assigned to this gateway?
4. Is the capability visible to this caller?
5. Does policy allow this capability and action?
6. Does the risk level or action class require approval?
7. Is the required credential binding allowed for this caller and capability?
8. Is the upstream target healthy and permitted?

## 11. Capability model

### 11.1 Capability sources

- `mcp_proxy` — upstream vendor MCP server proxying (primary adapter for client-facing integrations)
- `http_api` — direct HTTP/OpenAPI-backed execution
- `module_runtime` — custom or local module execution

### 11.2 Capability naming

All capabilities must be namespaced to prevent collisions and preserve provenance:

`<package_namespace>.<capability_name>`

Examples: `m365.search_emails`, `quickbooks.list_invoices`, `hubspot.get_deal`, `mailchimp.campaign_stats`

For upstream MCP proxying, Shuvdex must preserve source identity while guaranteeing local uniqueness.

### 11.3 Read-only by default

Where a connector exposes both retrieval and mutation operations, capabilities must be classified as read or write independently. Read capabilities may be auto-approved based on policy. Write capabilities always require explicit approval per role.

### 11.4 Capability caching and sync

For `mcp_proxy` sources:

- upstream tool/resource/prompt metadata must be cached locally
- refresh on configurable schedule or manual trigger
- upstream removals, renames, and schema changes must be detected and surfaced to operators
- changes must never silently propagate to clients

## 12. Adapter execution model

### 12.1 Common execution contract

Every adapter must support:

- input validation against the capability's declared schema
- configurable timeout (default per adapter type, overridable per capability)
- retry policy (none for unsafe operations, configurable for safe read-only operations)
- cancellation support where the upstream permits it
- structured error normalization (upstream errors mapped to a consistent error model)
- correlation IDs linking the invocation to session, tenant, and audit trail
- audit hooks (pre-invocation policy check, post-invocation result recording)
- telemetry hooks (latency, outcome, upstream target identity)

### 12.2 mcp_proxy adapter

The primary adapter for client-facing integrations. Shuvdex acts as an MCP client to upstream vendor servers.

Responsibilities:

- connect to upstream MCP servers via stdio or Streamable HTTP
- call `tools/list` to discover upstream capabilities
- map upstream tools into local package definitions with namespace prefix
- proxy `tools/call` through the credential store
- selectively expose only approved upstream capabilities
- preserve provenance metadata (source, transport, last-synced, trust state)
- isolate upstream auth from inbound Shuvdex auth
- manage upstream health and reconnect behavior

Per-upstream registry fields:

- upstream ID
- owner and purpose
- transport mode (stdio or Streamable HTTP)
- auth mode (API key, OAuth, bearer token)
- health status
- last capability sync timestamp
- tool count
- change history

### 12.3 http_api adapter

For REST/OpenAPI-backed capabilities where the vendor does not offer a suitable MCP server.

Requirements:

- request templating from structured input (path, query, header, body injection)
- security requirement awareness from OpenAPI spec
- response normalization and redaction
- upstream retry only when operation semantics are safe (GET, not POST)

### 12.4 module_runtime adapter

For custom logic, data normalization, or bespoke integrations.

Requirements:

- deterministic mapping from capability ID to module entrypoint
- resource limits where practical
- package version pinning

## 13. Connector strategy

### 13.1 BYOS principle

The product promise is to connect the apps the client already runs on, not to force a predefined stack.

### 13.2 Implementation priority

Preferred strategy by source quality:

1. use upstream MCP through `mcp_proxy` when the vendor MCP is sufficient
2. use `http_api` when the vendor has a strong API but no strong MCP server
3. use `module_runtime` for custom logic, normalization, or bespoke systems

### 13.3 Connector roadmap

Live integrations:

- Microsoft 365 (email, calendar, files, Teams, directory)
- Google Workspace (Gmail, Drive, Calendar, contacts)
- QuickBooks Online (invoices, vendors, P&L, customers)
- HubSpot CRM (contacts, deals, pipeline, activity)
- Mailchimp (campaigns, lists, performance)
- Website Analytics (traffic, forms, conversions)

Planned Q2 2026:

- Xero (accounts, invoices, reporting)
- Shopify (orders, inventory, customers)

On request:

- Slack, Zendesk, Dropbox, Jira, Asana, Calendly, Monday.com, FreshBooks, Stripe, Salesforce
- customer-specific line-of-business APIs

### 13.4 Connector maintenance

Each connector is a maintained asset. Latitudes monitors upstream API changes, pushes skill updates proactively, and ensures connection stability. This is a core service promise, not a best-effort commitment.

## 14. Approval and governance model

### 14.1 Approval objectives

The governance layer ensures:

- connectors are not automatically exposed on discovery
- write paths are never silently enabled
- upstream description or schema drift triggers re-review
- leadership retains policy oversight
- Latitudes retains operational accountability

### 14.2 Approval states

Minimum states:

- discovered
- pending_review
- approved
- active
- restricted
- rejected
- deprecated
- disabled

### 14.3 Approval units

Approval may apply at any of these levels:

- connector package (approve QuickBooks connector for this tenant)
- individual capability (approve `quickbooks.create_invoice` as a write tool)
- write permission subset (approve write for finance group only)
- credential scope set (approve M365 Graph with calendar + mail scopes, not files)
- environment-specific deployment (approve for production but not staging)

### 14.4 Break-glass procedures

For emergency situations where an approved tool must be used outside normal policy bounds:

- break-glass invocations must be available when configured
- break-glass use must produce enhanced audit records including justification
- break-glass usage must trigger operator notification
- post-incident review must be required

### 14.5 Policy templates

Pre-built policy bundles for repeatable deployment:

- **Core template** — matches $99 tier: 2 connectors, read-only, full audit, standard group-based access
- **Standard template** — matches $179 tier: 5 connectors, selective write by role, quarterly review cadence
- **Custom template** — matches POA tier: unlimited connectors, bespoke connector support, custom governance rules

Templates encode: allowed upstream count, role-to-package mappings, read/write permissions by role, audit retention period, review cadence.

## 15. Credential broker

### 15.1 Responsibilities

The credential broker handles:

- encrypted storage and retrieval of client credentials
- tenant-scoped credential isolation (client A's QuickBooks token is never accessible to client B)
- binding credentials to specific packages and capabilities
- resolving outbound tokens for upstream systems at invocation time
- rotation tracking and alerting
- redaction of secrets from logs and model-visible outputs

### 15.2 Supported credential types

- static API keys
- OAuth 2.0 client credentials
- OAuth 2.0 authorization code tokens (for delegated access, e.g. M365 Graph on behalf of user)
- bearer tokens
- service account credentials
- custom header or cookie material where required

### 15.3 Credential usage rules

- credentials are never returned to the AI host or included in tool outputs
- credentials are resolved just-in-time during execution
- credentials may be scoped to specific capabilities within a package
- credential access is itself an auditable event
- rotation status must be visible to operators

## 16. Audit and reporting model

### 16.1 Runtime audit fields

Every tool invocation, resource read, and prompt retrieval must capture:

- eventId
- timestamp
- tenantId and environmentId
- actor (caller identity from IdP)
- actor groups/roles
- connector/package used
- capability invoked
- source system accessed
- action class (read, write, admin)
- policy decision (allow, deny, approval_required, break_glass)
- decision reason
- correlation id and session id
- outcome (success, error, timeout)
- latency
- redacted request metadata
- redacted response metadata

### 16.2 Administrative audit fields

All administrative changes must capture:

- who approved or changed something
- what changed (with previous and new state)
- justification where relevant
- effective time

### 16.3 Reporting surfaces

- **Customer-facing audit trail** — filterable by user, app, time range, action class. This is the dashboard the client reviews. When someone asks "what has our AI been doing with our data?" this is the answer.
- **Operator incident investigation** — full detail, cross-tenant search for MSP admin.
- **Governance value reports** — periodic summaries showing: what was accessed, by whom, what was blocked, what approvals were processed, what write requests were denied. This is the renewal tool.
- **Compliance exports** — structured export for external auditors or compliance review.
- **Change history** — approval decisions, connector drift events, policy changes over time.

### 16.4 Observability

- OTEL-compatible telemetry for request rate, latency by adapter and capability, error rate, upstream health, timeout/retry counts, session counts
- health endpoints for gateway and control plane
- upstream health monitoring with alerting on degradation
- correlation IDs traceable across gateway → adapter → upstream

## 17. Security model

### 17.1 Trust boundaries

Shuvdex sits between the AI host and the client's real systems. It is the trust enforcement point for: identity verification, capability disclosure, approval state, credential brokering, audit production, and kill-switch behavior.

### 17.2 Token and credential separation

Inbound auth to Shuvdex (Entra/Google JWT from the AI client) and outbound auth to upstream systems (M365 Graph token, QuickBooks OAuth, HubSpot API key) are separate concerns. Shuvdex must never forward an inbound token to an upstream API. Upstream access uses separate, purpose-scoped credentials resolved from the credential store.

### 17.3 MCP-specific security mitigations

These are not optional hardening steps. They are core product features that differentiate the managed gateway from unmanaged MCP usage.

**Description hash pinning** — when an upstream tool is approved, the gateway hashes the tool name, description, and input schema. If the upstream vendor mutates any field on a subsequent sync, the tool is automatically disabled and operators are alerted. This mitigates rug pull attacks where a tool changes behavior after initial review.

**Metadata scanning** — tool descriptions received from upstream MCP servers are scanned for known prompt injection patterns: `<IMPORTANT>` tags, base64-encoded commands, instructions to read local files or exfiltrate data, hidden directives after excessive whitespace. Suspicious tools are flagged for manual review before approval.

**Namespaced tool isolation** — every upstream source has a unique namespace prefix. Tools from different sources cannot shadow each other. This prevents cross-server tool shadowing attacks where a malicious server registers a tool name that intercepts calls intended for a trusted server.

**Change detection alerting** — on every capability refresh, the gateway diffs upstream metadata against the pinned state. Any changes are surfaced to operators. Changes are never silently propagated to clients.

**Kill switches** — any connector or individual tool can be immediately disabled by an operator. Disablement takes effect on the next session initialization and may terminate active sessions for critical security events.

### 17.4 Network posture

Early production posture:

- private or controlled network access via Tailscale mesh or WireGuard
- no permissive cross-origin defaults
- `Origin` header validation on all Streamable HTTP requests
- localhost-only bind by default for non-mesh deployments
- per-client isolation of secrets, runtime state, and network endpoints
- TLS termination at a trusted boundary

### 17.5 Rate limiting and abuse controls

- per-tenant rate limits on tool invocations
- per-user rate limits within a tenant
- per-capability concurrency limits where needed
- connection quotas (max concurrent sessions per tenant, tiered by subscription)
- request size limits and invocation frequency caps

## 18. Deployment model

### 18.1 Early production deployment model

One Shuvdex gateway instance per client, deployed as Docker Compose on Latitudes-operated infrastructure.

Standard Hosted deployment:

- Shuvdex gateway + admin API containers
- environment-driven configuration via `.env` per client
- mounted volumes for `.capabilities/` state
- Tailscale sidecar container for mesh networking (or HTTPS with Cloudflare proxy)
- TLS termination at edge
- automated daily backup of capability and policy state
- OTEL telemetry to centralized monitoring
- hosted on Hetzner VPS (shared host with container isolation between clients)

Dedicated deployment (for Custom tier):

- isolated VPS per client
- full network separation
- client-specific data residency if required
- same operational patterns, separate blast radius

### 18.2 Control-plane topology

A shared control-plane service may exist for fleet management, but customer-facing runtime state must remain strongly isolated. Client gateways run as separate container instances, not as tenants within a shared process.

### 18.3 Internal v1 topology

Latitudes runs internal v1 as a single environment on the same infrastructure pattern used for client instances. Same Docker Compose layout, same abstractions.

### 18.4 Deployment lifecycle

- `docker compose up` must produce a clean, functional instance in under 5 minutes
- all configuration is environment-driven; no hardcoded paths
- health check endpoints for gateway and admin API
- clean shutdown with session termination

## 19. UX requirements

### 19.1 Customer onboarding flow

Matches the published 4-step process:

1. Assess the customer's stack and roles (30-minute discovery call)
2. Design the access model, provision tenant, bind identity provider, wire up apps, scope permissions per role, test
3. Each authorized user adds one URL to their AI assistant and signs in with their work account (under 2 minutes)
4. Latitudes monitors connections, pushes connector updates, maintains audit trail, handles upstream API changes

### 19.2 End-user UX target

- one endpoint URL
- sign-in with existing work identity (Entra or Google Workspace)
- immediately visible approved tools for the user's role
- minimal setup burden
- no connector credentials managed locally
- PKCE-compatible flow for public clients (Claude Desktop, Cursor, ChatGPT desktop)

### 19.3 Governance UX target

Leadership can answer without technical help:

- which apps are AI-connected
- who has access to them
- whether write is enabled anywhere
- what the AI has accessed recently
- what requests are pending approval

## 20. MCP OAuth 2.1 authorization

For customer-facing remote HTTP deployments, the gateway must support the MCP HTTP authorization pattern:

- Protected Resource Metadata endpoint (RFC 9728) pointing to the client's Entra tenant or Google Workspace
- OIDC Discovery for authorization server configuration
- token audience validation scoped to the specific shuvdex tenant gateway endpoint
- incremental scope consent via `WWW-Authenticate` challenges for sensitive tool classes (write access, PII access)
- PKCE for public clients
- correct 401/403 behavior per the MCP spec

The user experience is: open AI assistant, add shuvdex URL, sign in with work account, done.

## 21. Tenant lifecycle

### 21.1 Onboarding

1. create tenant record with identity provider mapping and subscription tier
2. select policy template (Core, Standard, or Custom)
3. bind credentials for approved upstream connectors
4. deploy gateway instance (Docker Compose on Latitudes infrastructure)
5. generate connection URL
6. test against live environment
7. distribute connection URL to authorized users

### 21.2 Offboarding

1. revoke all credential bindings
2. disable gateway
3. export audit log for retention
4. archive tenant state
5. destroy container and secrets

## 22. Service packaging

Service packaging is not system architecture, but the architecture must support these commercial shapes without hard-coding pricing:

- assessment-first engagement (Tier 1 discovery audit)
- bounded connector count for core tiers (enforced by policy template, not code)
- broader role-based governance for mid tiers
- bespoke connector and policy work for premium/custom tiers
- governance value reports as renewal tools

## 23. Implementation priorities

From a systems perspective, the critical path is:

1. harden internal runtime and control plane, integrate Entra/Google identity from day one
2. containerize for repeatable per-client deployment
3. implement `mcp_proxy` with security mitigations (description pinning, metadata scanning, change detection)
4. add approval workflows and read/write governance
5. build tenant model with policy-driven disclosure tied to subscription tiers
6. ship client governance dashboard
7. align remote auth with MCP OAuth 2.1 expectations
8. build policy template library
9. operationalize onboarding, reporting, and support

## 24. Final architectural position

The stable long-term position is:

- one shared control plane where useful
- one curated gateway endpoint per client environment
- multiple governed capability sources behind that endpoint
- MCP-specific security mitigations as visible product features
- Latitudes as operator and trust anchor
- the client as policy owner

Externally, that is managed AI connectivity.
Internally, that is Shuvdex.

## 25. Reference basis

This specification is grounded in:

- MCP specification version 2025-11-25 (architecture, lifecycle, transports, authorization, server primitives, security guidance)
- MCP security guidance for proxy servers, token passthrough, session safety, and SSRF risks
- OWASP MCP Top 10 (tool poisoning, token mismanagement, excessive privileges, rug pulls)
- the Latitudes Managed AI Connectivity product page and pricing at latitudes.io

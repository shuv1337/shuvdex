# Shuvdex Clean System Specification

Status: Draft
Version: 0.1
Date: 2026-04-03
Scope: Internal v1 with a direct path to managed per-client deployment

## 1. Executive Summary

Shuvdex is a governed capability gateway for AI hosts that speak MCP and for capability sources that do not. In v1, Shuvdex is deployed internally for the MSP itself as a single governed endpoint and control plane. The long-term product is a shared control plane that can publish one curated MCP endpoint per tenant and environment, backed by package-based capability governance, credential brokering, policy enforcement, audit trails, and execution adapters.

This specification treats Shuvdex as a platform with two primary surfaces:

1. A control plane for managing tenants, environments, packages, credentials, policy, audit, approvals, and source ingestion.
2. A data plane gateway that exposes a single MCP endpoint to an AI host while brokering execution across local modules, HTTP APIs, and upstream MCP servers.

The product thesis is not "one MCP server to rule them all" in the literal sense. The durable design is "one governed endpoint per tenant or environment, backed by one shared control plane and many upstream capability sources".

## 2. Product Definition

### 2.1 Product Statement

Shuvdex provides a single governed MCP endpoint for a given tenant and environment. Behind that endpoint, it:

- discovers and registers approved capabilities
- enforces tenant-aware policy and least privilege access
- brokers outbound credentials and upstream authentication
- normalizes execution across modules, APIs, and upstream MCP servers
- records audit and operational telemetry
- supports progressive disclosure of tools, resources, and prompts

### 2.2 Internal v1 Product Statement

Internal v1 is a private deployment for the MSP itself. It is the proving ground for:

- the control plane
- the capability package model
- policy and audit
- OpenAPI-backed tools
- local module-backed tools
- the first production-grade upstream MCP proxying path

### 2.3 External Product Statement

External rollout is a managed service for customers. Each customer receives one curated MCP endpoint per environment, with only the connectors, packages, credentials, and policies relevant to their business.

## 3. Goals

### 3.1 Primary Goals

- Present one stable MCP endpoint per environment to AI hosts.
- Centralize capability discovery, governance, routing, and credential custody.
- Support multiple capability source types: module runtime, HTTP/OpenAPI, and upstream MCP.
- Enforce policy using tenant, role, scope, capability, and risk information.
- Keep credentials server-side and never expose raw secrets to AI hosts.
- Produce audit-quality records for every administrative and runtime action.
- Support certification and lifecycle management of capability packages.
- Start internal-first without blocking the path to per-client managed deployments.

### 3.2 Secondary Goals

- Allow curated progressive disclosure to reduce context bloat.
- Make it easy to onboard new vendor APIs or MCP servers.
- Support phased adoption of formal MCP HTTP authorization.
- Preserve compatibility with current skill and OpenAPI ingestion work.
- Remain useful even when vendors do not offer MCP natively.

## 4. Non-Goals

Shuvdex is not intended to:

- replace every vendor MCP server with custom equivalents
- act as an unrestricted universal super-server with no policy boundary
- distribute identical skill repos to every host machine
- use per-host git sync as the core product model
- forward inbound MCP bearer tokens directly to upstream APIs
- depend on a single capability source type for commercial viability

## 5. Design Principles

1. Control plane and data plane are separate concerns.
2. The tenant boundary is a first-class security boundary.
3. Capability packages are the unit of governance.
4. Policy is enforced at request time, not just at configuration time.
5. Credentials are brokered server-side and scoped to the target system.
6. Upstream systems stay focused; the gateway provides unification.
7. High-risk capabilities require stronger controls than low-risk capabilities.
8. Internal v1 must not create architectural dead ends for customer rollout.
9. The gateway should prefer composition over custom rewrites of upstream behavior.
10. Every action should be attributable, auditable, and reversible where possible.

## 6. Personas and Actors

### 6.1 Platform Admin
Owns the Shuvdex deployment, gateway topology, authentication integration, base policy templates, and package certification process.

### 6.2 MSP Operator
Uses the control plane to onboard capabilities, bind credentials, review audit logs, and manage customer environments.

### 6.3 Customer Admin
Approves which capabilities are available to their organization, reviews policy, and manages customer-specific credentials and approvals.

### 6.4 AI Host / MCP Client
Connects to the gateway over MCP, discovers tools/resources/prompts, and invokes approved capabilities.

### 6.5 Upstream Capability Source
A local module, HTTP API, OpenAPI-derived tool set, or upstream MCP server that Shuvdex brokers.

### 6.6 Auditor / Security Reviewer
Inspects approvals, credential usage, policy changes, and runtime events.

## 7. Scope of Supported Capability Sources

### 7.1 module_runtime
Local or packaged code executed within the Shuvdex runtime boundary.

### 7.2 http_api
Direct execution against an HTTP endpoint, typically compiled from OpenAPI or declared via structured bindings.

### 7.3 mcp_proxy
Federation adapter that connects Shuvdex to one or more upstream MCP servers and republishes selected capabilities under local governance.

### 7.4 builtin
Reserved for future platform-native capability types where direct implementation is preferable to external adapters.

## 8. High-Level Architecture

```text
+----------------------+          +-----------------------------------+
| AI Host / MCP Client | <------> | Tenant Gateway / MCP Endpoint     |
+----------------------+          | - session handling                |
                                  | - authn/authz                     |
                                  | - progressive disclosure          |
                                  | - adapter routing                 |
                                  +-----------------+-----------------+
                                                    |
                     +------------------------------+------------------------------+
                     |                              |                              |
                     v                              v                              v
          +------------------+           +------------------+           +------------------+
          | module_runtime   |           | http_api         |           | mcp_proxy        |
          | local execution  |           | REST/OpenAPI     |           | upstream MCP     |
          +------------------+           +------------------+           +------------------+
                     \                              |                              /
                      \                             |                             /
                       +----------------------------+----------------------------+
                                                    |
                                                    v
                                  +-----------------------------------+
                                  | Shared Control Plane              |
                                  | - tenants / environments          |
                                  | - packages / sources             |
                                  | - credentials / bindings         |
                                  | - policies / approvals           |
                                  | - certification / audit          |
                                  | - web UI / admin API             |
                                  +-----------------------------------+
```

## 9. Core Concepts and Data Model

### 9.1 Tenant
A customer or internal business unit with isolated policy, credentials, assignments, and audit records.

Required fields:

- tenantId
- name
- status
- owner metadata
- auth integration reference
- data residency / compliance metadata

### 9.2 Environment
A deployment scope within a tenant, such as internal, staging, or production.

Required fields:

- environmentId
- tenantId
- name
- type
- gateway configuration reference
- credential namespace
- policy bundle assignment

### 9.3 Gateway
A deployable MCP endpoint instance bound to a tenant/environment or to the internal MSP environment.

Required fields:

- gatewayId
- tenantId
- environmentId
- endpoint URL
- transport config
- auth mode
- enabled packages
- health status

### 9.4 Capability Package
The unit of discovery, governance, assignment, and lifecycle management.

Required fields:

- packageId
- version
- source type
- namespace
- maintainer metadata
- certification state
- enabled state
- dependency list
- contained capabilities

### 9.5 Capability
A tool, resource, prompt, connector, or module entry within a package.

Required fields:

- capabilityId
- packageId
- name
- kind
- description
- input/output schema where applicable
- risk level
- visibility
- execution binding
- provenance
- certification state
- tags

### 9.6 Execution Binding
Links a capability to a concrete executor.

Required fields:

- executorType
- target
- timeoutMs
- retryCount
- streaming flag
- credential binding reference when needed
- execution metadata

### 9.7 Credential Binding
Associates a tenant/environment/package with one or more secrets or upstream auth clients.

Required fields:

- bindingId
- tenantId
- environmentId
- credentialId
- allowed packages
- allowed capabilities
- scopes / claims
- rotation metadata

### 9.8 Policy Bundle
A reusable set of access and risk rules.

Required fields:

- policyId
- scope target (tenant, environment, gateway)
- role mappings
- capability allow / deny rules
- risk rules
- approval requirements
- break-glass rules

### 9.9 Session
A negotiated MCP interaction context between a client and a gateway.

Required fields:

- sessionId
- gatewayId
- actor identity
- protocol version
- negotiated capabilities
- disclosed capability set
- auth context
- creation and expiry timestamps

### 9.10 Audit Event
A tamper-evident record of an administrative or runtime action.

Required fields:

- eventId
- timestamp
- tenantId
- environmentId
- actor
- action
- target type and target id
- decision result
- correlation id / session id
- redacted request metadata
- redacted response metadata

## 10. Capability Package Model

### 10.1 Package Types

Shuvdex supports packages compiled or imported from:

- skills
- OpenAPI sources
- explicit local manifests
- imported archives
- upstream MCP projections

### 10.2 Package Lifecycle States

- draft
- indexed
- reviewed
- approved
- restricted
- deprecated
- removed

### 10.3 Capability Certification States

Each capability should carry an explicit certification state, independent of package approval:

- unknown
- reviewed
- approved
- restricted
- deprecated

### 10.4 Capability Risk Classes

At minimum, Shuvdex will support four risk bands:

- low: read-only, reversible, low sensitivity
- medium: non-destructive mutation or moderate data sensitivity
- high: destructive, financially material, or broad external side effects
- restricted: only executable with explicit approval or break-glass procedure

### 10.5 Naming and Namespacing

Capabilities exposed through the gateway must be namespaced in a collision-safe way. The default naming scheme should be:

`<package_namespace>.<capability_name>`

For upstream MCP proxying, Shuvdex should preserve source identity while still guaranteeing local uniqueness.

## 11. Tenant and Deployment Model

### 11.1 Internal v1

- one internal tenant
- one or more internal environments
- shared control plane
- one internal gateway endpoint
- private network exposure only

### 11.2 Managed Customer Rollout

- one tenant per customer
- one or more environments per tenant
- either a dedicated gateway per tenant/environment or a pooled gateway architecture with strong runtime isolation
- shared control plane across customers

### 11.3 Isolation Requirements

Tenant isolation must apply to:

- capability assignments
- credentials
- audit records
- policy evaluation
- approval state
- runtime session context
- caching keyed by tenant and environment

### 11.4 Recommended Topology

Recommended default topology:

- pooled control plane
- isolated per-tenant or per-environment gateways
- customer credentials stored in tenant-scoped namespaces
- package assignments computed centrally but enforced locally

## 12. Gateway Responsibilities

The data plane gateway is responsible for:

- exposing the MCP endpoint
- negotiating protocol version and session capabilities
- authenticating the caller
- deriving runtime claims from caller and environment context
- computing the visible capability set for the session
- registering only permitted tools/resources/prompts
- enforcing policy on every call
- resolving the correct execution adapter
- brokering credentials for outbound calls
- normalizing outputs and errors
- producing runtime audit and telemetry

The gateway is not the source of truth for package management, credential administration, or tenant lifecycle. Those belong to the control plane.

## 13. Session and Disclosure Model

### 13.1 Session Initialization

At session initialization the gateway must:

1. validate transport and caller identity
2. negotiate MCP protocol version
3. load tenant/environment/gateway context
4. compute runtime claims
5. compute the visible capability graph
6. publish only the allowed tools, resources, and prompts for that session

### 13.2 Progressive Disclosure

Progressive disclosure is computed server-side. The visible capability set depends on:

- tenant assignment
- environment assignment
- caller identity and roles
- capability certification state
- risk class
- host or client tags where used
- current approval state
- gateway feature flags

### 13.3 Mid-Session Changes

If package assignments or policy change during an active session, the gateway may:

- require reconnect for deterministic behavior
- send capability change notifications where supported
- invalidate the session immediately for critical security changes

### 13.4 Session State Strategy

The current transport model should support stateful sessions, but the implementation must avoid hard-coding assumptions that prevent future transport evolution. Session storage should be abstracted so the gateway can support:

- in-memory local sessions for internal v1
- distributed session stores for multi-instance deployments
- future stateless or hybrid transport models

## 14. Authentication and Authorization

### 14.1 Internal v1 Authentication

Internal v1 should assume:

- private network or VPN exposure
- TLS termination at a trusted proxy
- SSO or identity-aware proxy in front of admin APIs
- gateway requests mapped to a caller identity derived from the request context

Static default claims must not be the effective identity model for remote usage.

### 14.2 External MCP HTTP Authentication

For customer-facing remote HTTP deployments, the gateway must support the current MCP HTTP authorization pattern, including:

- protected resource metadata
- authorization server discovery
- audience-aware token validation
- correct 401/403 behavior
- PKCE-compatible flows for clients where applicable
- support for multiple auth servers where required

### 14.3 Authorization Evaluation Order

For every request, authorization is evaluated in this order:

1. Is the caller authenticated for this gateway?
2. Is the caller mapped to the target tenant/environment?
3. Is the package assigned to this gateway?
4. Is the capability visible to this caller?
5. Does policy allow this capability and action?
6. Does the current risk class require approval?
7. Is the required credential binding allowed for this caller and capability?
8. Is the upstream target currently healthy and permitted?

### 14.4 Role Model

Minimum role model:

- platform_admin
- tenant_admin
- operator
- auditor
- automation_service
- end_user_session

### 14.5 Approval and Break-Glass

High-risk capabilities may require one of the following:

- pre-approved policy grant
- interactive user approval
- admin approval token
- break-glass override with additional audit requirements

### 14.6 Token Handling Rule

Inbound MCP access tokens are only for accessing Shuvdex itself. They must never be forwarded unchanged to upstream APIs or upstream MCP servers. Upstream access must use separate credentials or tokens intended for the upstream resource.

## 15. Credential Broker

### 15.1 Responsibilities

The credential broker is responsible for:

- secure storage and retrieval of customer credentials
- tenant-scoped credential isolation
- binding credentials to packages and capabilities
- minting or retrieving outbound tokens for upstream systems
- rotation support
- redaction of secrets from logs and model-visible outputs

### 15.2 Supported Credential Types

- static API keys
- OAuth client credentials
- OAuth delegated access tokens
- service account credentials
- custom header or cookie material where required

### 15.3 Credential Usage Rules

- credentials are never returned to the AI host
- credentials are resolved just-in-time during execution
- credentials may be capability-scoped and tenant-scoped
- credential access itself is an auditable event

## 16. Adapter Execution Model

### 16.1 Common Execution Contract

Every adapter must support:

- input validation
- timeout handling
- retry policy where safe
- cancellation support where possible
- structured error normalization
- correlation ids
- audit hooks
- telemetry hooks

### 16.2 module_runtime Adapter

Used for local package-backed execution within the gateway trust boundary.

Requirements:

- sandboxing strategy defined by deployment
- package version pinning
- resource limits where practical
- deterministic mapping from capability id to module entrypoint

### 16.3 http_api Adapter

Used for OpenAPI-compiled or explicitly declared HTTP capabilities.

Requirements:

- request templating from structured input
- header/query/path/body injection rules
- security requirement awareness
- response normalization and redaction
- upstream retry only when semantics are safe

### 16.4 mcp_proxy Adapter

This is the key federation adapter for customer rollout.

Responsibilities:

- connect to upstream MCP servers as a client
- discover upstream tools/resources/prompts
- map them into local package namespaces
- selectively expose only approved upstream capabilities
- preserve source provenance
- isolate upstream auth from inbound Shuvdex auth
- cache upstream capability metadata
- manage upstream health and reconnect behavior

Minimum features:

- upstream registry with auth configuration
- namespace mapping and collision handling
- per-upstream allowlist / denylist
- per-upstream credential binding
- health checks and staleness handling
- audit records that include both local and upstream target identity

## 17. Control Plane Specification

### 17.1 Responsibilities

The control plane owns:

- tenants and environments
- package registry and source ingestion
- package assignment to gateways
- credential management and bindings
- policy templates and grants
- approvals and certification workflows
- token and integration configuration
- audit search and export
- operator UI and APIs

### 17.2 Core Control Plane Resources

Recommended resource model:

- /tenants
- /environments
- /gateways
- /packages
- /capabilities
- /sources/openapi
- /sources/mcp
- /credentials
- /credential-bindings
- /policies
- /approvals
- /tokens
- /audit
- /certifications
- /health

### 17.3 Package Assignment Model

Packages are assigned at the gateway or environment level. Assignment does not automatically imply universal visibility. Actual runtime disclosure is still filtered by caller identity, policy, and risk.

### 17.4 Compatibility Views

Temporary compatibility endpoints may exist for UI continuity, but the canonical model should be based on packages, capabilities, tenants, and gateways rather than legacy "tools" abstractions.

## 18. Governance and Certification

### 18.1 Governance Objectives

Governance ensures that customer-facing AI capabilities are:

- known
- reviewed
- attributable
- bounded by policy
- operationally supportable

### 18.2 Certification Workflow

Suggested workflow:

1. ingest capability source
2. index or compile package
3. run automated validation
4. review provenance and risk
5. assign certification state
6. assign to internal or customer gateway
7. monitor usage and incidents
8. deprecate or revoke when needed

### 18.3 Required Governance Metadata

At package and capability level, capture:

- source type and location
- maintainer / owner
- certification state
- risk level
- data sensitivity notes
- upstream dependency list
- change history

## 19. Audit, Telemetry, and Observability

### 19.1 Mandatory Audit Events

Audit events must exist for:

- tenant and environment changes
- package ingest, update, approval, deprecation, removal
- policy changes
- credential create, rotate, bind, revoke, use
- session initialization and termination
- capability list disclosure
- tool invocation
- resource reads
- prompt retrieval
- upstream auth attempts
- approval grants and denials
- break-glass use

### 19.2 Telemetry Requirements

Operational telemetry should capture:

- request rate
- latency by adapter and capability
- error rate
- upstream dependency health
- timeout and retry counts
- cache hit rates
- session counts
- package disclosure counts

### 19.3 Correlation Requirements

Every runtime action should be traceable across:

- gateway request id
- session id
- tenant id
- environment id
- actor id
- package id
- capability id
- adapter target
- upstream request id where available

## 20. Security Requirements

### 20.1 Network Exposure

Defaults should be conservative:

- do not expose remote HTTP endpoints publicly by default
- bind to localhost by default for local installs where possible
- require explicit configuration for broad network exposure
- terminate TLS at a trusted boundary

### 20.2 Browser Security

Remote HTTP mode must not rely on wildcard browser access. CORS and origin validation must be explicit and environment-specific.

### 20.3 Secret Handling

- no secrets in model-visible content
- no secrets in plain logs
- redact credential-bearing headers and bodies
- isolate tenant secrets in storage and runtime

### 20.4 Input and Output Safety

- validate every tool input against schema
- normalize and bound output sizes
- reject malformed upstream responses where needed
- treat upstream tool metadata as untrusted until certified

### 20.5 Supply Chain and Package Trust

- record package provenance
- pin package versions where possible
- support review and deprecation workflows
- restrict high-risk imported packages until reviewed

### 20.6 Rate Limiting and Abuse Controls

The gateway should support:

- per-tenant rate limits
- per-capability concurrency limits
- approval throttles for risky actions
- circuit breakers for unhealthy upstream systems

## 21. Reliability and Scaling

### 21.1 Internal v1 Reliability Target

Internal v1 prioritizes correctness, auditability, and operator trust over maximum scale.

### 21.2 Customer Rollout Reliability Target

Customer deployments must support:

- multiple gateway instances per environment where needed
- distributed or externalized session state when stateful routing is required
- health-aware routing across upstream dependencies
- graceful degradation when a subset of capabilities are unavailable

### 21.3 Caching

Cache layers may be used for:

- package metadata
- capability disclosure sets
- upstream MCP capability catalogs
- OpenAPI compilation outputs

Caches must be tenant-aware and invalidated on policy or package changes.

### 21.4 Timeout and Retry Policy

Default behavior:

- fail fast on unsafe retries
- allow retries only for explicitly safe operations
- differentiate network retries from semantic retries
- surface timeout metadata in audit and telemetry

## 22. Discovery and Metadata Roadmap

Shuvdex should be designed to support richer machine-readable server metadata over time, including:

- gateway identity metadata
- capability catalog metadata
- package-level discovery
- better pre-connection discovery for clients and registries

This should be additive and should not block current session-based capability negotiation.

## 23. Current Repo Alignment

The current repository already aligns well with the target architecture in several areas:

- separate MCP gateway and control plane surfaces
- package-centric capability registry
- policy engine with tokens, ACL checks, and audit
- credential store
- OpenAPI ingestion and HTTP execution
- module-backed execution
- skill indexing and importing

The most important gaps between current implementation and this spec are:

1. true tenant and environment modeling
2. production-grade caller identity derivation at runtime
3. hardened remote HTTP auth and browser security
4. full mcp_proxy implementation
5. tenant-aware package assignment and disclosure
6. approval workflows for high-risk operations
7. external-grade auth flows for customer-facing gateways

## 24. Required Implementation Delta

### 24.1 Must-Have Before Internal v1 Is Considered Stable

- authenticated admin surface
- caller-derived runtime claims
- tenant/environment abstractions, even if only one internal tenant exists initially
- explicit package assignment model
- improved audit completeness
- remote HTTP hardening

### 24.2 Must-Have Before Customer Rollout

- mcp_proxy adapter
- tenant-isolated credential binding
- per-tenant gateway model
- approval and break-glass workflows
- external-facing MCP HTTP auth compliance
- policy templates and customer self-service administration surface

## 25. Recommended API and Runtime Contracts

### 25.1 Gateway Contract

The gateway must expose:

- MCP stdio mode for local development or tightly controlled hosts
- MCP Streamable HTTP mode for remote clients
- health and readiness endpoints
- optional metadata endpoints for future discovery

### 25.2 Control Plane Contract

The control plane must expose authenticated APIs for:

- CRUD on tenants, environments, gateways, packages, credentials, and policies
- package assignment and certification workflows
- approvals
- audit retrieval and export
- runtime health inspection

## 26. Acceptance Criteria

The platform is considered compliant with this specification when:

1. An AI host can connect to one gateway endpoint and see only the capabilities approved for its tenant, environment, and caller identity.
2. The gateway can execute capabilities through module_runtime and http_api under policy and audit.
3. The gateway can proxy at least one upstream MCP server through mcp_proxy under local governance.
4. Inbound access to Shuvdex is isolated from outbound access to upstream systems.
5. Credentials remain server-side and are never disclosed to the AI host.
6. Every administrative and runtime action is auditable with tenant, actor, and capability context.
7. High-risk capabilities can be gated by approval rules.
8. The internal deployment model can be promoted to a per-client deployment model without redesigning the core platform.

## 27. Phased Rollout Guidance

### Phase A: Internal Foundation

Use the MSP itself as the first tenant. Harden auth, policy, audit, package assignment, and credential handling.

### Phase B: Federation

Implement mcp_proxy and normalize at least one upstream MCP source into the Shuvdex package model.

### Phase C: Multi-Tenant Enablement

Introduce tenant, environment, and per-customer package and credential isolation.

### Phase D: Customer-Facing Auth and Governance

Add customer-facing auth flows, approvals, certification workflows, and operator tooling.

### Phase E: Managed Service Productization

Package the platform as a repeatable MSP offering with templates, onboarding flows, reporting, and support operations.

## 28. Strategic Positioning

Shuvdex should be described externally as a governed AI capability gateway, not merely as an MCP server. MCP is the primary interface standard, but the product value is control, security, consolidation, and managed operations across fragmented capability sources.

## 29. Final Decision

The target architecture is:

- shared control plane
- one governed gateway endpoint per tenant/environment
- package-based capability governance
- adapter-based execution across module_runtime, http_api, and mcp_proxy
- strong tenant isolation, credential brokering, policy enforcement, and audit

This architecture preserves the internal-first path while directly supporting a managed per-client service model.

## 30. Reference Basis

This specification is grounded in:

- the current MCP protocol version marker `2025-11-25`
- MCP architecture, lifecycle, transport, authorization, and server primitive guidance
- MCP security guidance for proxy servers, token passthrough, session safety, and SSRF risks
- the current public shuvdex repository README and planning direction around centralized capability packages, policy, OpenAPI ingestion, execution providers, and certification

# Plan: OpenAPI Capability Source

## Review Outcome

This plan is directionally strong and worth implementing, but the original version had several important gaps that would make v1 hard to ship safely:

1. **No durable source record** — refresh, patch, and diffing need more than package YAML + credentials.
2. **Flattened tool args are ambiguous** — OpenAPI allows the same parameter name in different locations; a flat arg bag loses location semantics.
3. **Auth support was underspecified** — API keys can live in headers, query params, or cookies, and server selection matters for real specs.
4. **Policy gating was overclaimed** — the current policy engine can gate by package, capability, tags, scopes, and risk, but not by `sideEffectLevel` alone.
5. **Refresh semantics were incomplete** — local overrides, disabled tools, and removed operations need preservation rules.
6. **Package composition metadata was deferred too aggressively** — even if prompt serving is still evolving, `linkedPackages` should be modeled as a first-class registry concept now so package relationships are explicit and durable.
7. **Credential testing needs to be source-aware** — a generic “test credential” route is not meaningful without a target or probe.

This revision incorporates strong recommendations to close those gaps while staying aligned with the current codebase.

## Revised Summary

Add OpenAPI spec ingestion as a first-class capability source in shuvdex. Given an OpenAPI spec URL, a selected server/base URL, an auth configuration, and an operation filter, shuvdex parses the spec, generates tool capabilities for each included operation, and executes them via direct HTTP with proper parameter serialization and credential injection.

This replaces the repeated per-skill REST wrapper/code-mode scaffold pattern with a centralized pipeline that turns an OpenAPI spec + source config into MCP-surfaced tools. Domain knowledge remains in skill-sourced resource/prompt capabilities and composes alongside the generated OpenAPI tool package.

## Motivation

**~34 of 142 skills (24%) are REST API wrappers.** Of those:

- 6 use code mode: Discord, Wix, JotForm, Cloudflare, Gitea, Make.com
- ~28 use helper scripts wrapping curl/requests
- ~14 have publicly available OpenAPI specs

The code-mode pattern copies a sandbox runner, broker, policy layer, output envelope, REST adapter, and config per skill. The only unique content per skill is usually auth wiring + a spec URL. The repeated wrapper logic belongs in shuvdex itself.

## Current State

| Component | File | Current Behavior |
|---|---|---|
| Package source types | `packages/capability-registry/src/schema.ts` | `PackageSource.type`: `"builtin" \| "skill" \| "manifest" \| "connector" \| "generated" \| "imported_archive"`. No `"openapi"` variant. |
| Executor types | `packages/capability-registry/src/schema.ts` | `ExecutorType`: `"builtin" \| "mcp_proxy" \| "http_api" \| "module_runtime"`. `http_api` is implemented; `mcp_proxy` remains future-facing. |
| Execution routing | `packages/execution-providers/src/live.ts` | Only `module_runtime` executes. All other executor types return an error stub. |
| Execution binding | `packages/capability-registry/src/schema.ts` | `ExecutionBinding` has no HTTP binding metadata. |
| Policy engine | `packages/policy-engine/src/live.ts` | Authorization uses package allow/deny, capability allow/deny, scopes, host tags, client tags, visibility, and risk level. It does **not** gate on `tool.sideEffectLevel`. |
| MCP prompt surface | `apps/mcp-server/src/server.ts` | Prompts are served as messages only. There is no current prompt-to-tool linking mechanism beyond existing prompt metadata fields. |
| API runtime composition | `apps/api/src/index.ts` | Wires registry, policy engine, skill importer, and skill indexer only. No OpenAPI source service or credential store. |
| MCP runtime composition | `apps/mcp-server/src/runtime.ts` | Wires registry, policy engine, skill indexer, and execution providers only. No OpenAPI source service or credential store. |
| Credential management | None | No credential store exists. Secrets are assumed to live in env vars or skill-local scripts. |
| Registry persistence | `packages/capability-registry/src/live.ts` | Persists package YAML only. There is no separate persisted source metadata record for generated OpenAPI packages. |
| Platform docs | `README.md`, `PLAN.md` | `http_api` is a planned provider, but there is no implementation path yet. |

## Goals

1. Register an OpenAPI source and automatically generate tool capabilities from its operations.
2. Execute those tools via direct HTTP with correct OpenAPI serialization for path, query, header, cookie, and request body fields.
3. Persist a **stable OpenAPI source record** so inspect, register, refresh, patch, and diff all operate from durable source metadata.
4. Store credentials securely and separately from capability definitions.
5. Support source-aware auth scheme mapping for bearer, basic, API key, custom headers, and OAuth2 client credentials.
6. Support curated import (filters, allowlists, or full import) so large specs stay manageable.
7. Integrate with the **existing** policy engine by generating meaningful subject scopes and risk defaults that can be enforced immediately.
8. Preserve manual overrides across refresh where safe (enabled state, certification, annotations, selected metadata).
9. Emit telemetry and audit signals for every OpenAPI-backed execution without leaking secrets.
10. Compose OpenAPI-sourced tools with skill-sourced prompts/resources in the same overall agent environment.

## Non-Goals

- GraphQL source ingestion.
- Remote MCP source wrapping (`mcp_proxy` remains separate).
- Full OAuth browser flows (`authorization_code`, device code) in v1.
- Replacing all helper-script skills immediately.
- Composite orchestration tools generated from multiple operations.
- Full multipart file upload support in v1 unless a target source requires it and is explicitly validated.
- Rich prompt-driven tool orchestration semantics beyond current MCP support; however, package relationship metadata itself is in scope via `linkedPackages`.

## Strong Recommendations Adopted in This Revision

### 1. Persist a first-class OpenAPI source record
Package YAML alone is insufficient for refresh/patch workflows. Add a separate persisted `OpenApiSourceRecord` keyed by `sourceId`.

### 2. Use a canonical nested tool input envelope
Generated tool inputs should preserve parameter location explicitly:

```json
{
  "path": { "repo": "my-repo" },
  "query": { "page": 1 },
  "headers": { "x-trace-id": "abc" },
  "cookies": {},
  "body": { "title": "Bug report" }
}
```

This avoids collisions, preserves serialization semantics, and is deterministic.

### 3. Make policy gating real in v1
The current engine already enforces `subjectScopes` and `riskLevel`. Generated capabilities should set those fields so read/write/admin separation works **without** changing the policy engine first.

### 4. Make credential testing source-aware
Credential validation should be tied to a source and an operation/probe, not a generic credential CRUD endpoint with no target.

### 5. Preserve local overrides on refresh
Refresh must not blindly overwrite operator changes like enabled state, annotations, or certification metadata.

### 6. Make `linkedPackages` first-class now
Even if prompt serving is still minimal, package relationships should be captured in the registry and package schema immediately. That gives us durable composition metadata for prompts, UI discovery, future policy affordances, import/export, and migration workflows.

### 7. Treat telemetry as day-zero work
HTTP execution must emit structured logs and traces and redact secrets from logs, audit, and execution payloads.

## Architecture

### New Packages

```text
packages/
  openapi-source/        # source records, spec parsing, operation extraction, package generation
  http-executor/         # HTTP request construction, parameter serialization, execution
  credential-store/      # encrypted credential storage and resolution
```

### Persisted State Layout

```text
.capabilities/
  packages/                    # existing capability package YAMLs
  policy/                      # existing policy/audit state
  credentials/                 # encrypted credential blobs
  sources/
    openapi/
      <sourceId>.json          # source metadata for inspect/register/refresh/patch
```

### Package Responsibilities

**`@shuvdex/openapi-source`**
- Fetch and parse OpenAPI 3.0/3.1 specs (JSON and YAML)
- Resolve `$ref`s
- Persist and load `OpenApiSourceRecord`
- Inspect a spec without persisting packages
- Compile operations into a `CapabilityPackage`
- Derive stable tool IDs and detect collisions
- Build JSON Schema input/output shapes
- Compute generated scopes, risk defaults, and provenance
- Refresh an existing source and merge preserved metadata
- Produce structured diff results on refresh

**`@shuvdex/http-executor`**
- Build HTTP requests from `httpBinding`
- Serialize parameters by location/style/explode rules
- Encode supported request bodies
- Resolve and inject auth material from the credential store
- Execute HTTP calls with timeout/retry/telemetry
- Normalize and sanitize responses to `ExecutionResult`
- Redact sensitive response headers (`set-cookie`, auth-related headers)

**`@shuvdex/credential-store`**
- Store credentials keyed by stable `credentialId`
- Encrypt at rest with a local key
- Resolve runtime auth material for execution
- Support API key, bearer, basic, custom headers, OAuth2 client credentials
- Never expose raw secret values via API/MCP/audit/telemetry

## Data Model

### `OpenApiSourceRecord`

```typescript
export interface OpenApiSourceRecord {
  readonly sourceId: string;
  readonly packageId: string;
  readonly title: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly specUrl: string;
  readonly selectedServerUrl: string;
  readonly specChecksum?: string;
  readonly specEtag?: string;
  readonly specLastModified?: string;
  readonly credentialId?: string;
  readonly operationFilter?: OperationFilter;
  readonly defaultTimeoutMs?: number;
  readonly defaultRiskLevel?: "low" | "medium" | "high";
  readonly importedOperationCount?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastInspectedAt?: string;
  readonly lastSyncedAt?: string;
}
```

**Why this matters:** refresh, patch, and source listing should operate on a durable source record rather than reverse-engineering configuration from generated packages.

## Detailed Design

### 1. Schema Changes

#### `PackageSource` — add `"openapi"` and stable source metadata

```typescript
export const PackageSource = Schema.Struct({
  type: Schema.Literal(
    "builtin",
    "skill",
    "manifest",
    "connector",
    "generated",
    "imported_archive",
    "openapi",
  ),
  path: Schema.optional(Schema.String),
  skillName: Schema.optional(Schema.String),
  archiveName: Schema.optional(Schema.String),
  importedAt: Schema.optional(Schema.String),
  checksum: Schema.optional(Schema.String),
  importMode: Schema.optional(Schema.String),

  // OpenAPI-specific metadata
  sourceId: Schema.optional(Schema.String),
  specUrl: Schema.optional(Schema.String),
  selectedServerUrl: Schema.optional(Schema.String),
  specChecksum: Schema.optional(Schema.String),
  credentialId: Schema.optional(Schema.String),
  lastSyncedAt: Schema.optional(Schema.String),
  operationCount: Schema.optional(Schema.Number),
});
```

#### `ExecutionBinding` — add `httpBinding`

```typescript
export const HttpParameterBinding = Schema.Struct({
  name: Schema.String,
  in: Schema.Literal("path", "query", "header", "cookie"),
  required: Schema.optional(Schema.Boolean),
  style: Schema.optional(Schema.String),
  explode: Schema.optional(Schema.Boolean),
  allowReserved: Schema.optional(Schema.Boolean),
  schema: Schema.optional(JsonSchema),
});

export const HttpRequestBodyBinding = Schema.Struct({
  required: Schema.optional(Schema.Boolean),
  contentType: Schema.String,
  schema: Schema.optional(JsonSchema),
});

export const HttpSecurityRequirement = Schema.Struct({
  schemeId: Schema.String,
  scopes: Schema.optional(Schema.Array(Schema.String)),
});

export const HttpBinding = Schema.Struct({
  method: Schema.Literal("get", "post", "put", "patch", "delete", "head", "options"),
  baseUrl: Schema.String,
  pathTemplate: Schema.String,
  parameters: Schema.optional(Schema.Array(HttpParameterBinding)),
  requestBody: Schema.optional(HttpRequestBodyBinding),
  responseSchema: Schema.optional(JsonSchema),
  securityRequirements: Schema.optional(Schema.Array(HttpSecurityRequirement)),
});

export const ExecutionBinding = Schema.Struct({
  executorType: ExecutorType,
  target: Schema.optional(Schema.String),
  timeoutMs: Schema.optional(Schema.Number),
  retryCount: Schema.optional(Schema.Number),
  streaming: Schema.optional(Schema.Boolean),
  httpBinding: Schema.optional(HttpBinding),
});
```

#### `CapabilityDefinition` — add provenance + certification

```typescript
export const Provenance = Schema.Struct({
  sourceFile: Schema.optional(Schema.String),
  sourceSection: Schema.optional(Schema.String),
  generatedFrom: Schema.optional(Schema.String),
  derivedBy: Schema.optional(Schema.Literal("compiler", "openapi", "import", "manual")),
});

export const CertificationStatus = Schema.Struct({
  status: Schema.Literal("untested", "passing", "failing", "stale"),
  lastTestedAt: Schema.optional(Schema.String),
  testedHosts: Schema.optional(Schema.Array(Schema.String)),
  notes: Schema.optional(Schema.String),
});
```

Add both as optional fields on `CapabilityDefinition`.

#### `CapabilityPackage` — add first-class `linkedPackages`

```typescript
export const PackageLink = Schema.Struct({
  packageId: Schema.NonEmptyString,
  relation: Schema.Literal("composes_with", "depends_on", "documents", "augments"),
  reason: Schema.optional(Schema.String),
  capabilityIds: Schema.optional(Schema.Array(Schema.String)),
});

// Add to CapabilityPackage:
//   linkedPackages: Schema.optional(Schema.Array(PackageLink))
```

`linkedPackages` should ship in phase 1 as durable package metadata even if prompt serving initially treats it as advisory only.

### 2. OpenAPI Source Package (`@shuvdex/openapi-source`)

#### Service Interface

```typescript
export interface OpenApiSourceConfig {
  readonly sourceId?: string;
  readonly specUrl: string;
  readonly title: string;
  readonly description?: string;
  readonly tags?: string[];
  readonly packageIdOverride?: string;
  readonly selectedServerUrl: string;
  readonly credentialId?: string;
  readonly operationFilter?: OperationFilter;
  readonly defaultTimeoutMs?: number;
  readonly defaultRiskLevel?: "low" | "medium" | "high";
}

export interface OperationFilter {
  readonly includeTags?: string[];
  readonly excludeTags?: string[];
  readonly includeOperationIds?: string[];
  readonly excludeOperationIds?: string[];
  readonly includePathPrefixes?: string[];
  readonly excludePathPrefixes?: string[];
  readonly includeMethodsOnly?: string[];
}
```

#### Recommended Parser Choice

Use **`@apidevtools/swagger-parser`** or `@readme/openapi-parser` after a quick spike against 2-3 real target specs (Gitea, Discord, Cloudflare). The deciding criteria should be:

- OpenAPI 3.1 support
- `$ref` correctness
- memory usage on large specs
- maintenance quality

**Recommendation:** do a short parser bake-off before coding the compiler around one library.

#### Inspect Output

Inspection should return:

- available servers
- security schemes
- total operation count
- filtered operation count
- per-operation inclusion status
- warnings (unsupported content types, missing operationIds, ambiguous schemas)
- checksum/etag if available

#### Canonical Tool Input Contract

Generated tool input schemas should use location buckets, not a flat object.

```json
{
  "type": "object",
  "properties": {
    "path": { "type": "object", "properties": { "owner": { "type": "string" } } },
    "query": { "type": "object", "properties": { "page": { "type": "number" } } },
    "headers": { "type": "object", "properties": { "x-request-id": { "type": "string" } } },
    "cookies": { "type": "object", "properties": {} },
    "body": { "type": "object", "properties": { "title": { "type": "string" } } }
  }
}
```

Rules:
- Only include buckets that have at least one field.
- Reserve auth headers/cookies/query params for the credential store; user-provided args must not override injected auth material by default.
- If a spec defines duplicate names in multiple locations, the schema remains unambiguous.

#### Generated Scopes and Risk Defaults

Use the current policy engine instead of inventing new authorization semantics in v1.

For each generated capability:
- `tool.sideEffectLevel` still reflects HTTP intent (`read` / `write` / `admin`)
- `riskLevel` defaults:
  - GET/HEAD → `low`
  - POST/PUT/PATCH → `medium`
  - DELETE → `high`
- `subjectScopes` include package-specific scopes such as:
  - `${packageId}.read`
  - `${packageId}.write`
  - `${packageId}.admin`

This lets existing tokens and policies gate write/admin calls **today**.

#### Tool Naming Strategy

1. Use `operationId` if present and sane.
2. Otherwise derive from first tag + method + non-version path segments.
3. Normalize to camelCase with dots between package/group/leaf.
4. Resolve collisions by adding version segment, then HTTP method, then hash suffix.
5. Persist names deterministically so refresh does not churn IDs unnecessarily.

#### Package Assembly

```typescript
function assemblePackage(record: OpenApiSourceRecord, operations: ExtractedOperation[]): CapabilityPackage {
  return {
    id: record.packageId,
    version: "1.0.0",
    title: record.title,
    description: record.description ?? `OpenAPI tools for ${record.title}`,
    builtIn: false,
    enabled: true,
    tags: record.tags,
    source: {
      type: "openapi",
      sourceId: record.sourceId,
      specUrl: record.specUrl,
      selectedServerUrl: record.selectedServerUrl,
      specChecksum: record.specChecksum,
      credentialId: record.credentialId,
      lastSyncedAt: record.lastSyncedAt,
      operationCount: operations.length,
    },
    capabilities: operations.map(opToCapability),
    createdAt: new Date().toISOString(),
  };
}
```

### 3. HTTP Executor (`@shuvdex/http-executor`)

#### Execution Flow

1. Load `httpBinding`.
2. Resolve credential material via `credentialId`/`sourceId`.
3. Build URL from selected server + path template.
4. Serialize `query` bucket according to parameter styles.
5. Serialize `headers` and `cookies` buckets.
6. Serialize `body` for supported content types.
7. Inject auth material **after** user args so auth cannot be clobbered.
8. Execute with timeout + retry policy.
9. Parse and normalize response.
10. Sanitize response headers and error output.
11. Emit telemetry spans and structured execution logs.

#### Response Normalization

Return:

```typescript
{
  payload: {
    data?: unknown,
    error?: unknown,
    status: number,
    headers: Record<string, string>,
    truncated?: boolean,
  },
  isError: boolean,
}
```

Recommendations:
- redact sensitive response headers (`set-cookie`, `authorization`, etc.)
- cap stored/returned response size to avoid blowing up MCP payloads
- include status always
- preserve parsed JSON when possible; fall back to text for non-JSON

#### Supported Request Bodies in v1

- `application/json`
- `application/x-www-form-urlencoded`
- basic `multipart/form-data` only if a concrete target spec needs it and there is a clear argument contract

If multipart upload is not implemented in phase 1, surface it clearly during inspect as an unsupported operation warning.

### 4. Credential Store (`@shuvdex/credential-store`)

#### Storage Model

```typescript
export type CredentialScheme =
  | { readonly type: "api_key"; readonly in: "header" | "query" | "cookie"; readonly name: string; readonly value: string }
  | { readonly type: "bearer"; readonly token: string }
  | { readonly type: "basic"; readonly username: string; readonly password: string }
  | { readonly type: "custom_headers"; readonly headers: Record<string, string> }
  | { readonly type: "oauth2_client_credentials"; readonly tokenUrl: string; readonly clientId: string; readonly clientSecret: string; readonly scopes?: string[] };
```

#### Encryption at Rest

- Store encrypted blobs under `.capabilities/credentials/`
- Use AES-256-GCM with a local key at `.capabilities/.credential-key`
- Key permissions `0600`
- Never write raw credentials to logs, API responses, audit events, telemetry spans, or package YAML

#### Credential Resolution

Resolution should output:

```typescript
export interface AuthMaterial {
  readonly headers?: Record<string, string>;
  readonly queryParams?: Record<string, string>;
  readonly cookies?: Record<string, string>;
}
```

OAuth2 client credentials should cache short-lived access tokens in memory with expiry-aware refresh.

### 5. API Routes

#### New Router: `/api/sources/openapi`

```typescript
POST   /inspect              // dry-run parse + filter + warnings + available servers + auth schemes
POST   /                     // create source record + credential + generated package
GET    /                     // list source records
GET    /:sourceId            // source details + latest package summary
PATCH  /:sourceId            // update title/tags/filter/server/timeout/risk defaults
POST   /:sourceId/refresh    // re-fetch spec, diff, preserve overrides, update package
POST   /:sourceId/test-auth  // source-aware auth/probe validation
DELETE /:sourceId            // delete source record, package, optional credential
```

#### New Router: `/api/credentials`

```typescript
GET    /                     // list redacted credential records
POST   /                     // create or update credential record
DELETE /:credentialId        // delete credential record
```

**Strong recommendation:** do **not** ship a generic `POST /api/credentials/:id/test` unless it accepts an explicit probe target. Prefer source-aware testing under `/api/sources/openapi/:sourceId/test-auth`.

### 6. Refresh Semantics

Refresh must be deterministic and preserve safe operator intent.

#### Preserve across refresh

For matching capability IDs:
- `enabled`
- `annotations`
- `certification`
- manually adjusted `riskLevel` if explicitly overridden
- manually adjusted `subjectScopes` if explicitly overridden

#### Recompute on refresh

- input/output schema
- `httpBinding`
- provenance metadata
- generated description/title if not manually overridden
- source checksum / sync metadata

#### Removed operations

Do **not** hard-delete immediately. Instead:
- mark generated capability as `enabled: false`
- set `certification.status = "stale"`
- annotate with a warning such as `operation removed from latest spec`
- include the removal in refresh diff output

This avoids silent breakage for policies and clients that still reference the old capability ID.

### 7. Execution Provider Integration

Update `packages/execution-providers/src/live.ts` to route `http_api` execution through `@shuvdex/http-executor`.

Both runtime compositions must be updated:

- `apps/api/src/index.ts`
- `apps/mcp-server/src/runtime.ts`

The implementation should use Effect layers rather than ad-hoc optional params where possible.

### 8. Telemetry and Audit

This work must ship with telemetry from day zero.

#### Minimum telemetry contract

For every OpenAPI execution emit:
- `sourceId`
- `packageId`
- `capabilityId`
- `executorType = "http_api"`
- HTTP method
- route template (not the fully secret-expanded URL)
- target host
- response status
- duration
- retry count
- error class / timeout / parse failure cause

#### Redaction rules

Never record:
- auth headers
- bearer tokens
- query-string API keys
- cookie values
- raw request bodies marked sensitive

#### Audit expectations

The existing audit trail should at least record:
- subject
- capability id
- package id
- executor type
- allow/deny
- reason

If richer per-call audit fields are needed (status, sourceId, method), add them explicitly rather than assuming current audit shape already captures them.

### 9. Composition with Skill Instructions

`linkedPackages` should be a first-class feature in phase 1.

Even if MCP prompt serving is still evolving, the registry and package model should express package relationships now. That gives us durable composition metadata for:
- prompt/tool association
- UI discovery and package navigation
- future policy affordances
- import/export fidelity
- migration workflows from skill-local wrappers to generated OpenAPI packages

#### Proposed semantics

A skill package can declare links like:

```yaml
linkedPackages:
  - packageId: openapi.discord
    relation: composes_with
    reason: "Use these generated Discord API tools alongside the Discord skill instructions"
```

An OpenAPI package can also link back to a companion skill package:

```yaml
linkedPackages:
  - packageId: skill.discord
    relation: documents
    reason: "Companion workflow guidance and domain instructions"
```

#### Phase-1 behavior

In phase 1, `linkedPackages` is advisory metadata that is:
- persisted in `CapabilityPackage`
- returned from registry/API reads
- available to future MCP prompt/resource handling
- available to the web UI for package relationship display

#### Follow-on behavior

As prompt serving grows, it can consume `linkedPackages` to:
- suggest relevant tool allowlists
- surface companion packages automatically
- guide disclosure order between prompts, resources, and tools

So the linkage schema ships now; richer runtime behavior can follow incrementally.

## Implementation Tasks

### Phase 1: Schema + Source Record + Credential Store

- [x] **1.1** Add `"openapi"` to `PackageSource.type`
- [x] **1.2** Add OpenAPI-specific source metadata fields to `PackageSource`
- [x] **1.3** Add `HttpBinding` schema and `httpBinding` field to `ExecutionBinding`
- [x] **1.4** Add `Provenance` schema + optional field to `CapabilityDefinition`
- [x] **1.5** Add `CertificationStatus` schema + optional field to `CapabilityDefinition`
- [x] **1.6** Add `PackageLink` schema + `linkedPackages` field to `CapabilityPackage`
- [x] **1.7** Create `packages/openapi-source/` package scaffold with `OpenApiSourceRecord` persistence under `.capabilities/sources/openapi/`
- [x] **1.8** Create `packages/credential-store/` package scaffold
- [x] **1.9** Implement encrypted file-based credential storage
- [x] **1.10** Implement credential resolution for `api_key`, `bearer`, `basic`, `custom_headers`, and `oauth2_client_credentials`
- [x] **1.11** Add `/api/credentials` CRUD routes (redacted responses only)
- [x] **1.12** Add tests for credential encrypt/decrypt and auth material resolution
- [x] **1.13** Verify backward-compatible loading of existing package YAMLs

### Phase 2: Inspect + Compile OpenAPI Sources

- [x] **2.1** Spike parser choice against 2-3 real specs and select the parser
- [x] **2.2** Implement spec fetching with checksum + optional ETag / Last-Modified capture
- [x] **2.3** Implement source record create/load/update/delete
- [x] **2.4** Implement operation extraction: parameters, requestBody, responses, security, servers
- [x] **2.5** Implement canonical nested input schema generation (`path/query/headers/cookies/body`)
- [x] **2.6** Implement tool naming and deterministic collision handling
- [x] **2.7** Implement operation filtering (tag, operationId, path prefix, method)
- [x] **2.8** Implement generated `riskLevel`, `sideEffectLevel`, and `subjectScopes`
- [x] **2.9** Implement `inspect()` with warnings, available servers, and auth scheme summary
- [x] **2.10** Implement `compile()` to create/update a generated capability package
- [x] **2.11** Populate `linkedPackages` during compile/register when a companion skill package is known or supplied
- [x] **2.12** Add `/api/sources/openapi` routes for inspect/create/list/get/patch/delete
- [x] **2.13** Add tests using at least one real fixture spec (Gitea recommended)

### Phase 3: HTTP Executor

- [x] **3.1** Create `packages/http-executor/` package scaffold
- [x] **3.2** Implement path substitution with URI encoding
- [x] **3.3** Implement query serialization (`form`, `spaceDelimited`, `pipeDelimited`, `deepObject`)
- [x] **3.4** Implement header and cookie serialization
- [x] **3.5** Implement request body serialization for JSON and form-encoded bodies
- [x] **3.6** Inject credentials from credential store with auth override protection
- [x] **3.7** Implement response parsing + normalization
- [x] **3.8** Redact sensitive response headers and cap payload size
- [x] **3.9** Implement timeout handling and targeted retries
- [x] **3.10** Emit telemetry spans/logs for HTTP execution
- [x] **3.11** Route `http_api` in `packages/execution-providers/src/live.ts`
- [x] **3.12** Wire credential store into API and MCP runtime layer composition
- [x] **3.13** Add tests with a mock HTTP server for serialization, auth injection, retries, and error handling

### Phase 4: Refresh + Diff + Policy Validation

- [x] **4.1** Implement refresh using persisted source records
- [x] **4.2** Preserve `enabled`, `annotations`, and `certification` across refresh for matching capability IDs
- [x] **4.3** Mark removed operations disabled + stale rather than deleting them immediately
- [x] **4.4** Return structured refresh diffs (added / changed / removed / unchanged)
- [x] **4.5** Validate generated `subjectScopes` against existing token + policy behavior
- [x] **4.6** Add source-aware auth probe route (`POST /api/sources/openapi/:sourceId/test-auth`)
- [x] **4.7** Verify audit and telemetry capture for successful and failed HTTP calls

### Phase 5: End-to-End Validation + Migration Trial

- [x] **5.1** Register Gitea’s OpenAPI spec against a real Gitea instance
- [x] **5.2** Verify generated tools appear in MCP `tools/list`
- [x] **5.3** Execute a read call and verify URL/serialization/auth/response
- [x] **5.3a** Certify the first authenticated read target (`dnsfilter-current-user` via `GET /v1/current_user`)
- [ ] **5.4** Execute a write call and verify policy + scope gating
- [x] **5.5** Refresh after a spec change and verify stable IDs + preserved overrides
- [ ] **5.6** Validate credential rotation behavior
- [ ] **5.7** Trial one migration target from an existing REST wrapper skill
- [ ] **5.8** Document registration and migration workflows in repo docs / AGENTS-facing docs as appropriate

## Test Plan

### Schema + Persistence
- Existing package YAMLs still load after schema expansion.
- New optional fields do not break current registry behavior.
- `linkedPackages` round-trips through registry persistence and API responses.
- Source records persist and reload correctly.

### OpenAPI Inspection + Compilation
- Valid OpenAPI 3.0 and 3.1 specs parse successfully.
- Invalid/unreachable specs return structured warnings/errors.
- Server selection is explicit and persisted.
- Filtered imports produce deterministic operation sets.
- Tool IDs remain stable across repeated compile from the same spec.
- Duplicate parameter names across locations remain unambiguous because of nested input buckets.

### HTTP Executor
- Path/query/header/cookie serialization matches OpenAPI rules.
- JSON and form-encoded bodies serialize correctly.
- Injected auth cannot be overridden accidentally by user args.
- Timeouts and retryable failures produce structured errors.
- Sensitive headers are redacted from result payloads.
- Large responses are truncated or capped safely.

### Credential Store
- Credential blobs are encrypted at rest.
- Resolution supports header/query/cookie API keys.
- OAuth2 client-credentials token caching refreshes correctly.
- Redacted list endpoints never expose secret values.

### Policy Integration
- Generated `subjectScopes` are enforced by the existing policy engine.
- Read-only tokens can call read endpoints but not write/admin endpoints when scopes differ.
- Risk defaults interact correctly with existing `maxRiskLevel` policies.

### Refresh
- Matching capabilities preserve enabled state, annotations, and certification.
- Removed operations become disabled + stale.
- Refresh diff output correctly reports adds/changes/removals.

### Telemetry + Audit
- Every HTTP execution emits method/status/duration telemetry without secret leakage.
- Audit events record allow/deny and executor type for calls.
- Failed auth and timeout paths are observable.

### Package Composition
- `linkedPackages` persists on both generated OpenAPI packages and companion skill packages.
- API package reads include relationship metadata intact.
- Refresh preserves `linkedPackages` unless explicitly recomputed or patched.

## Assumptions and Defaults

- OpenAPI 3.0 and 3.1 are supported in v1.
- Swagger 2.0 is out of scope unless the chosen parser can upgrade it safely and predictably.
- The initial credential store is local encrypted file storage.
- OAuth2 browser flows are deferred; only client credentials are supported in v1.
- Generated tool input uses nested buckets, not a flat parameter object.
- OpenAPI tool packages execute centrally from the shuvdex host.
- `linkedPackages` is first-class package metadata in v1; richer prompt/runtime behaviors over that metadata may roll out incrementally.

## File Map

```text
packages/
  capability-registry/
    src/schema.ts              ← schema changes, including `linkedPackages`
  credential-store/
    src/
      types.ts
      errors.ts
      crypto.ts
      live.ts
      index.ts
    tests/
  openapi-source/
    src/
      types.ts                 ← OpenApiSourceConfig, OpenApiSourceRecord, inspect/compile types
      errors.ts
      storage.ts               ← source record persistence
      parser.ts                ← fetching + parsing + checksum/etag
      extractor.ts             ← operations, params, bodies, security, servers
      naming.ts                ← deterministic tool IDs
      compiler.ts              ← package assembly + refresh merge logic
      live.ts
      index.ts
    tests/
  http-executor/
    src/
      types.ts
      url.ts
      serialization.ts
      execute.ts
      sanitize.ts
      index.ts
    tests/
  execution-providers/
    src/live.ts                ← route http_api to executor
apps/
  api/
    src/index.ts               ← wire source + credential layers
    src/routes/
      openapi-sources.ts
      credentials.ts
  mcp-server/
    src/runtime.ts             ← wire credential store + executor layer
```

## Approval Status

**READY TO IMPLEMENT WITH THESE REVISIONS**

The feature is a strong fit for shuvdex, but the implementation should follow the revised plan above rather than the original draft. The most important changes are: **persist source records, use nested input buckets, enforce policy via generated scopes, preserve overrides on refresh, and make telemetry/redaction first-class.**

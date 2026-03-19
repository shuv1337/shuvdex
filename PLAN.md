# codex-fleet Capability Gateway Plan

**Summary**

Build `codex-fleet` into the single client-facing MCP server for fleet capabilities, with full replacement as the end state for local skills and local MCP servers. The server becomes the control plane for discovery, policy, auth, and routing; a thin per-host runner remains only for capabilities that must execute locally such as shell, filesystem, browser, and device control. Skill authoring follows a hybrid transition: existing `SKILL.md` remains supported, but the system introduces structured capability manifests and compiles both into one registry-backed catalog with progressive disclosure.

**Implementation Changes**

**1. Replace “tool registry” with a capability registry**
- Introduce a new canonical `CapabilityDefinition` model that subsumes the current flat `ToolDefinition`.
- Support capability kinds: `tool`, `resource`, `prompt`, `module`, and `connector`.
- Add first-class fields for `id`, `version`, `kind`, `title`, `description`, `tags`, `riskLevel`, `subjectScopes`, `hostTags`, `clientTags`, `executorRef`, `sourceRef`, `dependsOn`, `annotations`, `enabled`, and `visibility`.
- Split schema by kind:
  - `tool`: input schema, output schema, side-effect level, execution timeout, streaming support.
  - `resource`: URI template, MIME type, template params, cacheability, summary metadata.
  - `prompt`: prompt arguments, attached resource refs, tool allowlist, preferred disclosure order.
  - `module`: code-mode style programmable executor surface with declared operations and guards.
  - `connector`: wrapped upstream capability source such as remote MCP server or REST/OpenAPI source.
- Replace built-in seed YAMLs with built-in capability packages that can expose multiple tools/resources/prompts under one package id.

**2. Add a skill compiler instead of skill sync as the primary abstraction**
- Introduce a `skill-indexer` package that scans the skills repo and compiles each skill into a capability package.
- Transitional source model:
  - If a skill has only `SKILL.md`, derive a minimal package from markdown and detected references.
  - If a skill also has a manifest such as `capability.yaml`, merge manifest fields over markdown-derived defaults.
  - New structured features live in the manifest; markdown remains valid and can still be the user-facing body.
- Compile each skill into:
  - a summary `resource` for discovery,
  - one or more detailed `resource` documents for instructions, examples, references, and assets,
  - a `prompt` that tells the client how to “apply” the skill,
  - optional generated `tool` or `module` entries when the skill declares executable operations.
- Preserve progressive disclosure:
  - `tools/list`, `resources/list`, and `prompts/list` return only compact metadata.
  - Full skill instructions, long examples, and references are exposed only via `resources/read`.
  - Large referenced files are surfaced as separate resources, not injected into catalog listings.

**3. Make the MCP server the public gateway, not just a fleet tool shim**
- Replace the hardcoded MCP registration path with dynamic registration from the capability registry.
- Expand server capabilities beyond `tools` to include `resources` and `prompts`.
- Implement server-side filtering before advertisement so each client only sees allowed capabilities.
- Add support for capability change notifications so clients can refresh when host policy, package versions, or registry entries change.
- Keep the existing REST API as an internal/admin surface for UI and automation, but make MCP the main consumption surface for agents.
- Split server behavior into:
  - public gateway handlers for MCP primitives,
  - admin API handlers for registry/policy/host management,
  - execution adapters that resolve an invocation to the correct provider.

**4. Introduce policy and token-based ACLs**
- Add a `policy-engine` package and a small auth service inside codex-fleet.
- Fleet-issued tokens are the default auth mechanism in v1.
- Token claims should include at minimum:
  - `subjectType` such as `host`, `install`, `user`, or `service`,
  - `subjectId`,
  - `hostTags`,
  - `clientTags`,
  - `scopes`,
  - `allowedPackages` and `deniedPackages`,
  - expiry, issuer, and key id.
- Policy evaluation happens on:
  - `tools/list`,
  - `resources/list`,
  - `prompts/list`,
  - every `callTool`,
  - every `resources/read`,
  - every prompt fetch or expansion.
- Default deny for undisclosed capabilities. A capability must match both subject scopes and tag rules to be listed or executed.
- Add audit records for every capability listing and invocation decision, including allow/deny reason and resolved executor.

**5. Add pluggable execution providers**
- Introduce an `execution-providers` layer with a standard executor contract:
  - resolve capability,
  - validate input,
  - authorize subject,
  - execute,
  - stream or return result,
  - record audit and telemetry.
- Required providers:
  - `builtin`: current fleet operations and future native codex-fleet actions.
  - `host_runner`: thin per-host runner for local shell/fs/browser/device capabilities.
  - `mcp_proxy`: wraps existing external or local MCP servers behind the gateway.
  - `http_api`: direct REST/OpenAPI-backed tools.
  - `module_runtime`: code-mode style programmable execution for long-tail workflows.
- Host runner contract:
  - one lightweight authenticated process per host,
  - outbound registration or polling against codex-fleet,
  - receives capability jobs only for capabilities bound to that host,
  - supports stdout/stderr/log streaming and structured result envelopes,
  - exposes minimal local operations rather than the full current skill repo model.
- Route local-only operations through the host runner, not through file replication.

**6. Reframe existing host and skill behavior**
- Remove repo-sync and activation workflows from the primary architecture instead of preserving them as built-in capabilities.
- Keep host management only where it supports policy, routing, or future host-runner execution, not file replication.
- Replace the current `/api/skills` directory scan with compiled package inventory from the skill indexer.
- Update the admin UI to show packages, prompts, resources, ACL exposure, and execution provider routing rather than flat fleet operations.

**Important Public Interfaces**

**Capability registry types**
- `CapabilityPackage`: package id, version, source metadata, tags, capabilities, assets, dependencies.
- `CapabilityDefinition`: common base fields plus kind-specific payload.
- `CapabilitySubjectPolicy`: allow/deny rules over scopes, tags, package ids, capability ids, and risk levels.
- `ExecutionBinding`: executor type, target host or connector id, timeout, retry policy, streaming mode.
- `CompiledSkillArtifact`: result of indexing a skill repo entry into resources/prompts/tools/modules.

**Gateway/admin APIs**
- MCP public surface:
  - `tools/list`, `tools/call`
  - `resources/list`, `resources/templates/list`, `resources/read`
  - `prompts/list`, `prompts/get`
- Admin REST surface:
  - package inventory and compile status,
  - token issuance and revocation,
  - subject policy CRUD,
  - connector registration,
  - host runner status,
  - audit/event queries.
- Host runner protocol:
  - runner registration heartbeat,
  - capability claim/lease,
  - execution result streaming,
  - cancellation and timeout handling.

**Data and rollout policy**
- Skill repo stays readable during migration.
- Structured manifests are optional at first and become recommended for any skill needing ACLs, generated tools, or provider bindings.
- No repo-tracked skill file replication is required in the end state.
- Existing local MCP servers are wrapped as connectors first, then retired capability-by-capability after parity is confirmed.

**Phased Delivery**

**Phase 1: Registry and compile pipeline**
- Create the new capability schemas and registry storage.
- Add the skill indexer and compile current skills into packages with summary resources and prompts.
- Expose package inventory through admin REST only at this stage.

**Phase 2: MCP gateway expansion**
- Teach the MCP server to serve dynamic tools, resources, and prompts from the registry.
- Implement progressive disclosure and capability filtering.
- Keep execution limited to read-only compiled skill resources and explicitly registered capability providers until the policy layer is stable.

**Phase 3: Auth and policy**
- Add token issuance, claim parsing, policy evaluation, and audit logging.
- Filter listings and execution by subject claims and tags.
- Add connector definitions for wrapped upstream MCP servers.

**Phase 4: Host runner and replacement migration**
- Stand up the thin host runner protocol and provider.
- Move local-only capabilities from file-backed skills or local MCP servers to runner-backed execution.
- Convert selected high-value skills into full compiled packages with prompt/resource/tool parity.
- Remove replicated skill-file workflows from normal operation.

**Test Plan**

**Registry and compiler**
- Compile markdown-only skills into valid packages with summary resource and prompt.
- Compile hybrid markdown + manifest skills with manifest precedence where declared.
- Reject malformed manifests with actionable validation errors.
- Preserve stable ids and versions across re-index runs when content is unchanged.

**Policy and auth**
- Token with matching scopes and tags sees only allowed capabilities.
- Token with insufficient scopes cannot list or invoke hidden capabilities.
- Deny rules override allow rules.
- Revoked or expired token fails listing and invocation.
- Resource reads and prompt fetches are filtered with the same policy as tool calls.

**Gateway behavior**
- `tools/list`, `resources/list`, and `prompts/list` return compact metadata only.
- `resources/read` returns full skill bodies, examples, and referenced assets on demand.
- Dynamic registry changes trigger client-visible refresh behavior.
- Wrapped connector capabilities appear identical to centrally defined ones from the client’s perspective.

**Execution**
- Built-in provider executes existing fleet capabilities correctly.
- Host runner provider routes only host-bound local capabilities.
- Cancelled or timed-out executions produce structured terminal states.
- Streaming and non-streaming results are both handled without leaking provider internals.
- Audit trail records subject, capability id, executor, outcome, and denial reason.

**Migration**
- Existing skills without manifests remain discoverable.
- Existing local MCP servers can be wrapped without changing the client-facing codex-fleet endpoint.
- A migrated capability can replace a local MCP capability without changing its visible id or policy envelope.
- Skill sync is not required for capabilities served fully via gateway + host runner.

**Assumptions and Defaults**

- End state is full replacement of local skills and local MCP servers from the client’s point of view.
- `codex-fleet` remains the only client-configured MCP endpoint.
- Fleet-issued bearer tokens are the default v1 auth model; OAuth-style remote MCP auth is deferred unless later needed for third-party distribution.
- A thin host runner is mandatory for local shell/fs/browser/device access and is the only per-host runtime kept in the target architecture.
- Skill authoring follows a hybrid transition: `SKILL.md` remains supported, but structured manifests are added for new ACL, routing, and execution metadata.
- REST admin endpoints remain in scope as internal control-plane surfaces for UI and automation, even though MCP is the public agent-facing surface.
- File replication is removed from the target architecture rather than preserved as a compatibility layer.

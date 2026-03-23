# Review: executor lessons and patterns for shuvdex

> Purpose: capture the most important ideas, lessons, and reusable patterns from `~/repos/executor` and translate them into concrete architectural options for `shuvdex`.
>
> This is a review and strategy document. It does **not** implement changes.

## Scope reviewed

Primary docs:
- `/home/shuv/repos/executor/ARCHITECTURE.md`
- `/home/shuv/repos/executor/README.md`

Key implementation files reviewed:
- `/home/shuv/repos/executor/packages/platform/server/src/index.ts`
- `/home/shuv/repos/executor/packages/platform/sdk/src/executor.ts`
- `/home/shuv/repos/executor/packages/platform/sdk/src/contracts.ts`
- `/home/shuv/repos/executor/packages/platform/sdk/src/operations.ts`
- `/home/shuv/repos/executor/packages/platform/sdk-file/src/executor-state-store.ts`
- `/home/shuv/repos/executor/packages/platform/sdk-file/src/source-artifacts.ts`
- `/home/shuv/repos/executor/packages/kernel/core/src/discovery.ts`
- `/home/shuv/repos/executor/packages/kernel/ir/src/catalog.ts`
- `/home/shuv/repos/executor/packages/sources/mcp/src/catalog.ts`
- `/home/shuv/repos/executor/packages/sources/openapi/src/catalog.ts`
- `/home/shuv/repos/executor/packages/sources/graphql/src/catalog.ts`
- `/home/shuv/repos/executor/packages/sources/mcp/src/elicitation-bridge.ts`
- `/home/shuv/repos/executor/packages/hosts/mcp/src/paused-result.ts`

Shuvdex context referenced during comparison:
- `README.md`
- `AGENTS.md`
- `apps/mcp-server/src/server.ts`
- `apps/mcp-server/src/runtime.ts`
- `apps/mcp-server/src/http.ts`
- `packages/capability-registry/src/schema.ts`
- `packages/skill-importer/src/live.ts`
- `packages/execution-providers/src/module-runtime.ts`
- `PLAN-real-capability-testing.md`
- `RUNBOOK-remote-mcp-e2e.md`

---

## Executive summary

`executor` has evolved into something much more substantial than a CLI around tools. Architecturally, it is a **control plane for agent tool use**. It normalizes multiple external source types into a shared internal model, persists those normalized artifacts durably, exposes them through one shared runtime, and supports human-in-the-loop interactions as first-class execution outcomes.

The most valuable lesson for `shuvdex` is **not** “copy executor.” The most valuable lesson is to identify which of executor’s architectural patterns solve problems that `shuvdex` is about to run into as it moves from a deterministic fixture to real capabilities.

The strongest patterns worth applying to `shuvdex` are:

1. **shared runtime across API/MCP/UI**
2. **provenance- and diagnostics-rich catalog metadata**
3. **first-class interaction / pause / resume model**
4. **adapter-based source normalization**
5. **durable artifact and certification storage**
6. **discovery as part of the execution model, not just setup**

My recommendation is to adopt these ideas **selectively and incrementally**. `shuvdex` should stay focused on being a centralized capability gateway, not drift into becoming a general-purpose local code-execution product. But executor shows several design moves that could make `shuvdex` materially stronger.

---

## What executor is, in architectural terms

## One-line model

From `ARCHITECTURE.md`, the best summary is:

> executor is a local daemonized control plane that turns connected sources into a workspace tool catalog and runs TypeScript against that catalog, pausing for user interaction when needed.

That one sentence encodes several big ideas:

- connected systems are treated as **sources**
- sources get transformed into a **catalog**
- execution runs against the catalog, not raw endpoints
- interaction is a first-class execution outcome
- all of this lives inside one shared runtime

## Major components in executor

### 1. Single local server/runtime
File:
- `/home/shuv/repos/executor/packages/platform/server/src/index.ts`

The server hosts:
- HTTP API
- MCP handler
- static web UI assets

All those surfaces share the same runtime and state.

### 2. Platform SDK as business logic center
Files:
- `/home/shuv/repos/executor/packages/platform/sdk/src/executor.ts`
- `/home/shuv/repos/executor/packages/platform/sdk/src/contracts.ts`
- `/home/shuv/repos/executor/packages/platform/sdk/src/operations.ts`

This layer owns:
- installation bootstrap
- source management
- auth workflows
- secret management
- execution management
- policy-aware tool invocation

### 3. Durable local persistence
Files:
- `/home/shuv/repos/executor/packages/platform/sdk-file/src/executor-state-store.ts`
- `/home/shuv/repos/executor/packages/platform/sdk-file/src/source-artifacts.ts`

Executor persists:
- auth artifacts
- auth sessions
- secret material
- execution records
- interaction records
- source artifacts
- source documents

### 4. Source adapters and catalog builders
Files:
- `/home/shuv/repos/executor/packages/sources/mcp/src/catalog.ts`
- `/home/shuv/repos/executor/packages/sources/openapi/src/catalog.ts`
- `/home/shuv/repos/executor/packages/sources/graphql/src/catalog.ts`

Each source type maps to a common normalized model.

### 5. Rich internal catalog / IR
File:
- `/home/shuv/repos/executor/packages/kernel/ir/src/catalog.ts`

Executor’s internal catalog is far richer than a flat tool list. It preserves:
- documents
- scopes
- symbols
- capabilities
- executables
- response sets
- diagnostics
- provenance

### 6. Human interaction bridge
Files:
- `/home/shuv/repos/executor/packages/sources/mcp/src/elicitation-bridge.ts`
- `/home/shuv/repos/executor/packages/hosts/mcp/src/paused-result.ts`

Executor treats approval, form input, OAuth/browser flows, and resume behavior as structured runtime behavior.

---

## The most important executor ideas

## 1. One shared runtime for every surface

### What executor does
Executor routes CLI, browser UI, and MCP traffic into one runtime hosted by one process.

File:
- `/home/shuv/repos/executor/packages/platform/server/src/index.ts`

This means all surfaces see the same:
- source state
- secret state
- catalog
- execution history
- interaction state

### Why this is strong
It avoids a common failure mode where:
- API becomes the “real” system
- UI has special rules
- MCP exposes a different mental model

Executor instead makes all surfaces consumers of one center of gravity.

### Relevance to shuvdex
`shuvdex` already has multiple surfaces:
- API
- web UI
- MCP server

But right now the repo still feels closer to “multiple surfaces over shared files” than “one coherent runtime consumed by multiple surfaces.”

### Concrete shuvdex opportunity
Move toward an explicit runtime/service layer that owns:
- package loading
- policy evaluation
- MCP exposure decisions
- execution dispatch
- capability metadata projection
- interaction state
- certification metadata

Then API, UI, and MCP become thin projections over that layer.

### Recommendation
**Adopt, incrementally.**

Not necessarily as a full rewrite, but as a guiding architecture principle.

---

## 2. Normalize many source kinds into one internal model

### What executor does
Executor has source-specific logic, but source-specific logic does not become product-wide chaos.

Files:
- `/home/shuv/repos/executor/packages/sources/mcp/src/catalog.ts`
- `/home/shuv/repos/executor/packages/sources/openapi/src/catalog.ts`
- `/home/shuv/repos/executor/packages/sources/graphql/src/catalog.ts`

Each adapter transforms its source into a shared catalog model with common semantics.

### Why this is strong
It avoids building separate “MCP mode,” “OpenAPI mode,” and “GraphQL mode” product silos.

### Relevance to shuvdex
Today `shuvdex` is primarily:
- skill import + capability registry + execution provider + MCP exposure

That is good and appropriately narrow.

But if `shuvdex` succeeds, it may eventually need to ingest more than just skill archives/directories:
- local skill trees
- imported `.zip` / `.skill`
- OpenAPI sources
- remote MCP sources
- maybe hosted capability registries

Executor suggests the right future move:

> source-specific ingestion, common internal capability model

### Concrete shuvdex opportunity
Define a future abstraction such as:
- `CapabilitySourceAdapter`

Possible adapter families:
- skill directory adapter
- imported archive adapter
- remote MCP adapter
- OpenAPI adapter
- GraphQL adapter
- generated/internal adapter

### Recommendation
**Defer implementation, adopt the abstraction mindset now.**

For now, use this as a design filter when extending import/capability logic.

---

## 3. Rich IR / catalog semantics beat flat tool lists

### What executor does
Executor’s internal model stores much more than “tool name + schema.”

File:
- `/home/shuv/repos/executor/packages/kernel/ir/src/catalog.ts`

Its catalog carries:
- provenance
- diagnostics
- scopes
- executable bindings
- response structures
- auth semantics
- interaction semantics
- synthetic/generated markers

### Why this is strong
This supports:
- debugging
- inspection UI
- auditability
- high-quality search/discovery
- reliable runtime mapping
- better testing/certification

### Relevance to shuvdex
Shuvdex’s current model is intentionally simpler.

File:
- `packages/capability-registry/src/schema.ts`

Current strengths:
- clear capability package abstraction
- executor binding
- tool/resource/prompt/module/connector kinds
- basic source metadata
- annotations map

Current limits relative to executor:
- limited provenance depth
- limited diagnostic/warning representation
- no strong synthetic/generated distinction
- no explicit execution-interaction semantics
- no rich response/projection model

### Concrete shuvdex opportunity
Without adopting executor’s full IR, add a lighter-weight next layer:

#### Potential package-level additions
- `diagnostics`
- `certification`
- `importWarnings`
- `generatedFrom`
- `sourceArtifacts`

#### Potential capability-level additions
- `provenance`
- `diagnostics`
- `interaction`
- `safety`
- `certification`

### Recommendation
**Adopt a lightweight version soon.**

This is probably one of the highest-leverage lessons from executor.

---

## 4. Provenance-first design

### What executor does
Executor preserves where things came from.

File:
- `/home/shuv/repos/executor/packages/kernel/ir/src/catalog.ts`

The system can relate a capability or symbol back to:
- source document
- generated fragment
- merged/derived result
- original provider data

### Why this is strong
This is not just academically nice. It makes real workflows better:
- debugging imports
- understanding generated tools
- explaining behavior in UI
- identifying which part of a source caused a warning
- future automated refactors or repairs

### Relevance to shuvdex
This is highly relevant to:
- skill import review
- capability testing
- future UI inspection
- future multi-source ingestion

### Concrete shuvdex opportunity
For imported skills, preserve provenance such as:
- imported archive filename
- source root path inside extracted import
- source file(s) that produced each capability
- whether capability was explicit in manifest or generated from markdown/default logic
- warnings attached to exact file/section

This could initially live in:
- `annotations`
- or a new structured provenance field

### Recommendation
**Adopt soon, likely before broad capability certification.**

---

## 5. Interaction is a first-class runtime outcome

### What executor does
Executor treats user interaction as a normal part of tool execution, not just an error.

Files:
- `/home/shuv/repos/executor/packages/sources/mcp/src/elicitation-bridge.ts`
- `/home/shuv/repos/executor/packages/hosts/mcp/src/paused-result.ts`

Patterns supported:
- approval / deny
- structured form elicitation
- URL/browser-based flow
- resumable execution after interaction

### Why this is strong
Real capabilities often need:
- auth bootstrap
- approval
- confirmations for side effects
- resumable long-running flows

If those are not first-class, systems end up with awkward ad-hoc side channels.

### Relevance to shuvdex
This is probably the biggest strategic lesson from executor.

As `shuvdex` starts validating real capabilities, it will increasingly hit capabilities that need:
- secrets configured securely
- browser/OAuth flow
- approval for write/admin operations
- pause/resume after external completion

### Concrete shuvdex opportunity
Eventually define a structured execution result family like:
- `completed`
- `failed`
- `waiting_for_interaction`
- `paused`
- `resumable`

Possible interaction payload types:
- approval prompt
- form schema
- URL to open
- secret requirement descriptor
- resume token / execution id

### Recommendation
**Design now, implement when first real capability demands it.**

This should be treated as near-future architecture, not a speculative luxury.

---

## 6. Durable execution and artifact state

### What executor does
Executor persists not just final state, but runtime artifacts and source artifacts.

Files:
- `/home/shuv/repos/executor/packages/platform/sdk-file/src/executor-state-store.ts`
- `/home/shuv/repos/executor/packages/platform/sdk-file/src/source-artifacts.ts`

### Why this is strong
It enables:
- reinspection
- recovery
- stable testing
- historical debugging
- pause/resume without in-memory fragility

### Relevance to shuvdex
This maps directly to the capability certification work already planned in:
- `PLAN-real-capability-testing.md`

Shuvdex is about to need durable storage for:
- certification results
- imported artifacts
- test evidence
- environment assumptions
- execution logs

### Concrete shuvdex opportunity
Introduce a durable artifact model for capabilities and certifications, for example:
- imported asset bundle metadata
- import warnings snapshot
- certification artifacts by capability/host/date
- test transcript references
- runtime validation output

### Recommendation
**Adopt as part of the testing/certification program.**

This is a practical next step, not just architecture polish.

---

## 7. Discovery is part of execution, not just setup

### What executor does
Executor treats discovery and description as built-in primitives for tool use.

File:
- `/home/shuv/repos/executor/packages/kernel/core/src/discovery.ts`

The intended workflow is:
1. discover tools by intent
2. inspect or describe a tool
3. call it

### Why this is strong
That is much more ergonomic once catalogs grow.

### Relevance to shuvdex
Shuvdex’s current MCP surface mainly depends on `tools/list` + client knowledge.
That works today while the catalog is small.

But as real capabilities expand, `tools/list` alone becomes less useful.

### Concrete shuvdex opportunity
Consider future helper surfaces such as:
- capability search API
- MCP discovery helper tools
- capability describe endpoints/tools
- search by tags/effect/risk/certification status

This would help both:
- human operators
- agents using a large capability set

### Recommendation
**Medium priority.**

Great idea, but not necessarily required before first-wave capability certification.

---

## 8. Semantic richness around auth / safety / interaction

### What executor does
When cataloging source capabilities, executor carries more semantics than just schema.

Files:
- `/home/shuv/repos/executor/packages/sources/mcp/src/catalog.ts`
- `/home/shuv/repos/executor/packages/sources/openapi/src/catalog.ts`
- `/home/shuv/repos/executor/packages/sources/graphql/src/catalog.ts`

Examples of encoded semantics:
- auth requirements
- effect / safety / destructiveness
- interaction hints
- resume support
- protocol/display metadata

### Relevance to shuvdex
Shuvdex already has some semantic metadata:
- `riskLevel`
- `sideEffectLevel`
- `subjectScopes`
- `visibility`

But executor suggests a stronger direction.

### Concrete shuvdex opportunity
Potential future fields:
- `requiresApproval`
- `mayElicit`
- `resumeSupported`
- `authKind`
- `idempotent`
- `destructive`
- `streaming`
- `longRunning`
- `expectedArtifacts`
- `testedHosts`

### Recommendation
**Adopt selectively.**

Add only what serves real policy/testing/runtime needs.

---

## Where executor does not map cleanly to shuvdex

## 1. Executor is execution-environment centric

Executor’s center is:
- run typed code against a tool catalog

Shuvdex’s center is:
- serve centralized capability packages and execution paths over MCP/API/UI

That means some executor ideas are more relevant than others.

### Most relevant
- shared runtime
- source normalization
- provenance and diagnostics
- interaction model
- durable artifacts

### Less immediately relevant
- full local TS execution product model
- QuickJS / SES / Deno runtime strategy
- local installation bootstrap model as-is

## 2. Executor is local-first; shuvdex is already more centralized

Executor assumes one local daemon and local state as the product center.

Shuvdex is already trending toward:
- centralized remote MCP endpoint
- shared capability store
- multiple clients/hosts

So the lesson is not “copy local-first deployment.”
The lesson is:

> centralize runtime logic the way executor centralizes local runtime logic

## 3. Executor’s IR may be too heavy for shuvdex right now

Executor’s IR is powerful, but adopting it wholesale would likely be too much too soon for shuvdex.

The risk would be:
- slowing down real capability work
- overengineering before certification needs are fully understood

Recommendation:
- borrow concepts, not the full IR implementation

---

## Specific ideas worth applying to shuvdex now

## Immediate candidates

### A. Add provenance and diagnostics to imported packages
Why:
- helps real capability testing immediately
- helps operator debugging
- aligns well with current importer work

Possible targets:
- `packages/capability-registry/src/schema.ts`
- `packages/skill-importer/src/live.ts`
- `apps/api/src/routes/packages.ts`
- UI inspection surfaces later

### B. Introduce certification metadata as a first-class concept
Why:
- directly supports the testing roadmap in `PLAN-real-capability-testing.md`
- creates durable operator truth

Potential metadata:
- import status
- MCP surfacing status
- live execution status
- OpenCode E2E status
- tested hosts
- last validated timestamp
- known caveats

### C. Define interaction result shapes before they are urgently needed
Why:
- several real capabilities will eventually need approval/auth/URL flow
- better to define now than patch later

Potential targets:
- execution result schema/type definitions
- MCP/admin API response semantics
- future web UI interaction handling

### D. Strengthen runtime-center architecture
Why:
- keeps API/MCP/UI aligned as the product grows

Potential targets:
- central service layer for capability/runtime state
- reduce duplicated projection logic between surfaces

---

## Medium-term ideas worth exploring

### E. Capability source adapters
Potential future adapter types:
- skill directory
- skill archive
- remote MCP source
- OpenAPI source
- GraphQL source
- generated/internal source

### F. Capability discovery helpers
Potential outputs:
- API search endpoint
- MCP helper tools for search/describe
- web UI capability explorer built on same logic

### G. Artifact store for certification evidence
Potential contents:
- run summaries
- JSONL transcripts
- import evidence
- execution outputs
- URL/artifact verification results
- host-specific notes

### H. Lightweight catalog IR roadmap
Not a full executor-style IR yet, but a roadmap for:
- provenance
- diagnostics
- execution semantics
- response metadata
- source artifact linkage

---

## Proposed shuvdex roadmap inspired by executor

## Phase 1 — strengthen metadata and certification

- [ ] extend capability/package metadata with provenance and diagnostics
- [ ] create `CAPABILITY-CERTIFICATION.md`
- [ ] store structured certification status and artifacts
- [ ] expose certification/provenance via API where useful

## Phase 2 — define runtime interaction model

- [ ] design execution outcomes that include `waiting_for_interaction`
- [ ] define approval/form/url interaction payloads
- [ ] decide where resume identifiers live
- [ ] map interaction handling across API/MCP/UI

## Phase 3 — improve shared runtime architecture

- [ ] identify all current runtime/business-logic seams across API/MCP/UI
- [ ] consolidate common capability/runtime projection logic
- [ ] move toward one explicit runtime center for all surfaces

## Phase 4 — broaden source model carefully

- [ ] define `CapabilitySourceAdapter` abstraction
- [ ] keep skill archive/directory path first
- [ ] consider additional source kinds later

## Phase 5 — evaluate whether a richer internal catalog is needed

- [ ] revisit after first-wave certification results
- [ ] decide whether current package schema is sufficient
- [ ] only then consider a stronger IR/catalog layer

---

## Recommended decisions

## Decision 1: Should shuvdex adopt executor wholesale?

Recommendation:
- **No.**

Why:
- shuvdex is a centralized capability gateway, not primarily a local agent runtime
- executor’s full architecture would be too heavy to transplant directly

## Decision 2: Should shuvdex adopt executor’s patterns selectively?

Recommendation:
- **Yes, strongly.**

Priority order:
1. provenance + diagnostics
2. certification metadata/artifacts
3. interaction model
4. shared runtime architecture
5. source adapter abstraction
6. discovery helpers

## Decision 3: Should shuvdex define an interaction model before it fully needs one?

Recommendation:
- **Yes.**

Why:
- several real capabilities will likely demand it soon
- interaction is structurally easier to design early than retrofit later

## Decision 4: Should shuvdex build a full IR now?

Recommendation:
- **No, not yet.**

Why:
- take the lessons, not the full complexity
- first learn what the real capability-certification program actually needs

---

## Concrete proposals for follow-up work

## Proposal A — small schema extension pass

Write a plan for extending `CapabilityPackage` / `CapabilityDefinition` with:
- provenance
- diagnostics
- certification metadata
- interaction metadata (at least placeholders)

Potential future plan file:
- `PLAN-capability-provenance-and-certification.md`

## Proposal B — interaction design review

Write a focused design doc for:
- approval/form/url interaction states
- resumable execution contracts
- how MCP/API/UI should surface interaction-needed responses

Potential future plan file:
- `PLAN-capability-interaction-model.md`

## Proposal C — runtime architecture review for shuvdex

Write a design review for how current API/MCP/UI share or duplicate runtime logic, and what to consolidate.

Potential future plan file:
- `PLAN-shared-runtime-for-api-mcp-ui.md`

## Proposal D — certification artifact model

Write a design doc for where real capability test artifacts and certification records should live and how they should be represented.

Potential future plan file:
- `PLAN-capability-certification-artifacts.md`

---

## Questions for detailed review

These are the questions I would use in the next discussion/review pass:

1. What is the minimum provenance model that materially improves shuvdex right now?
2. Should certification state live inside package metadata, alongside it, or in a separate artifact store?
3. What interaction shapes are required for the first real-world capabilities we expect to support?
4. Where does current shuvdex runtime logic already drift between API, MCP, and UI?
5. Which executor-like source abstractions are worth designing now, even if we do not implement them yet?
6. At what point does a lightweight internal catalog stop being enough and a richer IR become justified?

---

## Bottom line

Executor demonstrates a more mature answer to a question shuvdex is just now approaching:

> What does it look like when connected capabilities become a real product surface rather than a collection of imported tools?

The answer in executor is:
- shared runtime
- normalized catalogs
- durable state
- provenance
- interaction-aware execution
- multi-surface consistency

Shuvdex should not become executor. But it should absolutely learn from executor’s trajectory.

The highest-value next move is to use these lessons to sharpen the next stage of shuvdex’s own architecture:
- make capabilities more inspectable
- make certification more durable
- make interaction a first-class design concern
- make API/MCP/UI converge more tightly on one runtime center

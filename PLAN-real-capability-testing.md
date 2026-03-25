# PLAN: Real capability testing for shuvdex

> Goal: move from proving the **remote MCP transport** works to proving that **real imported skills**, **real MCP tools**, **compiled OpenAPI capabilities**, and **real-world capability execution** work end-to-end through `shuvdex`.

## Status snapshot

This plan is no longer speculative only. Some of the foundation work has now landed.

### Already proven now

- [x] Remote Streamable HTTP MCP server works on `shuvdev`
- [x] Imported `module_runtime` tools can be surfaced and executed through the server
- [x] A real imported skill (`youtube-transcript`) can be imported and executed end-to-end in automated tests
- [x] `http_api` execution is wired through the runtime using the credential store
- [x] OpenAPI source inspection / compile / refresh / auth-probe routes exist
- [x] A real public OpenAPI source (Gitea) was inspected, compiled, and executed successfully against `https://gitea.com/api/v1/version`
- [x] MCP HTTP test coverage is stable again (`apps/mcp-server/test/http.test.ts`)
- [x] Remote MCP service on `shuvdev` was rebuilt and restarted after MCP-server changes

### Still not yet proven

- [ ] Clean-room OpenCode E2E for real capabilities beyond the synthetic echo fixture
- [ ] A durable certification ledger file that operators can update incrementally
- [ ] A repeatable multi-capability certification harness
- [x] Real authenticated OpenAPI certification against a credentialed target (`dnsfilter-current-user` on `shuvdev`)
- [ ] Artifact-producing capability certification (`upload`, dashboard/report generation, etc.)
- [ ] Host-matrix certification across both `shuvdev` and `shuvbot`

---

## Summary

`shuvdex` now has enough infrastructure to serve as a centralized remote MCP gateway for two real executor paths:

- `module_runtime`
- `http_api`

What remains missing is broad confidence in **real capabilities**.

We have now proven more than transport:

- real imported skill execution via `youtube-transcript`
- real compiled OpenAPI execution via Gitea `GET /version`
- credential-store-driven HTTP execution plumbing

But we have **not yet certified** a realistic set of capabilities through a durable, repeatable program.

This plan defines that certification program and updates it to reflect the current repo state.

---

## Current known-good baseline

### Infrastructure already proven

- Remote MCP server works on `shuvdev`
  - `http://shuvdev:3848/mcp`
  - `http://127.0.0.1:3848/health` validated after restart
- User systemd unit exists and is installed
  - repo copy: `systemd/shuvdex-mcp.service`
  - installed unit: `~/.config/systemd/user/shuvdex-mcp.service`
- Clean-room OpenCode test exists for deterministic fixture
  - script: `scripts/run-remote-mcp-e2e.sh`
  - runbook: `RUNBOOK-remote-mcp-e2e.md`
- Deterministic seeded fixture exists
  - source: `examples/module-runtime-skill-template/`
  - seeder: `scripts/seed-module-runtime-template.mjs`
  - surfaced tool name: `shuvdex_skill_module_runtime_template_echo`

### Real capability paths already proven

#### Real imported skill
- `youtube-transcript`
  - import + surface + execution proven in:
    - `apps/mcp-server/test/imported-module-runtime.e2e.test.ts`

#### Real OpenAPI capability
- Gitea public spec
  - inspect / compile proven via:
    - `packages/openapi-source/src/live.ts`
    - `apps/api/test/openapi-routes.test.ts`
  - real execution proven against:
    - `https://gitea.com/api/v1/version`
  - helper script:
    - `scripts/gitea-openapi-trial.mjs`

### Relevant implementation files

#### Remote MCP server
- `apps/mcp-server/src/http.ts`
- `apps/mcp-server/src/runtime.ts`
- `apps/mcp-server/src/server.ts`
- `apps/mcp-server/test/http.test.ts`
- `apps/mcp-server/test/imported-module-runtime.e2e.test.ts`
- `apps/mcp-server/test/protocol.test.ts`
- `apps/mcp-server/test/shuvdex-integration.test.ts`
- `apps/mcp-server/test/stdio.test.ts`

#### Registry / import / execution
- `packages/capability-registry/src/schema.ts`
- `packages/skill-importer/src/live.ts`
- `packages/skill-importer/src/types.ts`
- `packages/skill-importer/test/importer.test.ts`
- `packages/execution-providers/src/module-runtime.ts`
- `packages/execution-providers/src/live.ts`
- `packages/execution-providers/test/providers.test.ts`
- `packages/http-executor/src/live.ts`
- `packages/http-executor/test/http-executor.test.ts`

#### OpenAPI / credentials
- `packages/credential-store/src/live.ts`
- `packages/openapi-source/src/live.ts`
- `apps/api/src/routes/credentials.ts`
- `apps/api/src/routes/openapi-sources.ts`
- `apps/api/test/openapi-routes.test.ts`
- `scripts/gitea-openapi-trial.mjs`

#### Operational notes
- `AGENTS.md`
- `README.md`
- `RUNBOOK-remote-mcp-e2e.md`
- `PLAN-openapi-capability-source.md`

---

## Problem statement

The current test coverage is still weighted toward:

- importer mechanics
- MCP protocol mechanics
- one synthetic echo tool
- one real imported skill
- one real public OpenAPI read capability

That is strong progress, but still insufficient.

We now need to answer these broader questions repeatedly and durably:

1. **Does shuvdex import real skills faithfully?**
2. **Does shuvdex expose imported and generated capabilities correctly through MCP?**
3. **Do those capabilities perform real useful work end-to-end?**
4. **Can operators repeat that certification process without bespoke debugging each time?**

---

## Testing philosophy

The testing program should continue to work like a **capability certification ladder**.

Each skill/capability graduates through progressively more realistic layers.

### Tier 1 — Import contract
Validate import and compilation correctness.

### Tier 2 — MCP surface contract
Validate what the remote server exposes.

### Tier 3 — Live execution contract
Validate actual behavior through the implemented executor path.

### Tier 4 — Real client E2E
Validate discovery and use from isolated OpenCode.

### Tier 5 — Host/runtime matrix
Validate the same capability set on `shuvdev` and later `shuvbot`.

The output should be a durable **capability certification ledger**, not just ad-hoc logs.

---

## Constraints and realities from the current codebase

### 1. Two executor paths matter now: `module_runtime` and `http_api`

Current executor types in schema:
- `builtin`
- `builtin`
- `mcp_proxy`
- `http_api`
- `module_runtime`

Practical reality now:
- `module_runtime` is implemented and proven
- `http_api` is implemented and proven for real execution
- the remaining executor types are still not where certification effort should concentrate first

**Implication:** first-wave certification should cover both:
- real imported `module_runtime` skills
- real generated `http_api` capabilities

Relevant files:
- `packages/capability-registry/src/schema.ts`
- `packages/execution-providers/src/module-runtime.ts`
- `packages/http-executor/src/live.ts`
- `packages/openapi-source/src/live.ts`

### 2. Not every skill is currently tool-ready for shuvdex

Skills already close to certification:
- `/home/shuv/repos/shuvbot-skills/youtube-transcript/`
- `/home/shuv/repos/shuvbot-skills/crawl/`

OpenAPI capabilities already close to certification:
- Gitea public API via downloaded OpenAPI spec

High-value skills that still look conversion-first:
- `/home/shuv/repos/shuvbot-skills/upload/`
- `/home/shuv/repos/shuvbot-skills/model-usage/`
- `/home/shuv/repos/shuvbot-skills/ccusage/`

**Implication:** the first batch should still distinguish:
- **certify now**
- **convert then certify**

### 3. Real-world testing must preserve clean-room discipline

Rules that still remain mandatory:
- do not run clean-room tests from repo root
- isolate OpenCode with temp XDG dirs
- pin a known-good model/provider combination
- test against the centralized remote MCP endpoint, not a local ad-hoc spawn, for client E2E

Relevant files:
- `PLAN-opencode-clean-real-world-test.md`
- `scripts/run-remote-mcp-e2e.sh`
- `AGENTS.md`

### 4. Telemetry and artifacts are part of done

Per project guidance, testing and new flows should emit enough telemetry and artifacts to answer:
- what happened?
- what package/tool was under test?
- which host/client/runtime was used?
- how long did it take?
- what failed and why?

**Implication:** every new certification harness should save structured artifacts and produce useful logs/spans where practical.

Relevant files:
- `packages/telemetry/src/index.ts`
- `packages/telemetry/src/live.ts`
- `packages/telemetry/src/span.ts`

---

## High-level goals

- [ ] Create a durable capability certification workflow for real skills and generated OpenAPI capabilities
- [x] Define a prioritized first-wave capability matrix
- [x] Prove at least one real imported skill path end-to-end in automated tests
- [x] Prove at least one real compiled OpenAPI path end-to-end in automated tests plus a real network call
- [ ] Add repeatable test harnesses for import, MCP surfacing, live execution, and OpenCode E2E
- [ ] Certify the first set of real capabilities on `shuvdev`
- [ ] Record capability status in a machine-readable or markdown ledger
- [ ] Expand the matrix later to `shuvbot` and additional executors

---

## Non-goals for this plan

- Implementing every executor type
- Certifying every skill in the broader skill universe immediately
- Reworking the full web UI in the same effort
- Building a production-grade marketplace or package registry in the same effort
- Replacing existing low-level tests; this plan complements them

---

## Proposed capability certification model

Each tested capability should have a certification record containing:

- source skill path or spec source
- import source type (`.md`, `.zip`, `.skill`, local fixture, OpenAPI spec)
- package id
- surfaced MCP capability ids/tool names
- executor type
- required binaries
- required credentials/env
- expected side effects
- happy-path result
- negative-path result
- real-client E2E status
- validated host(s)
- validated date
- known caveats

### Suggested status values

- `planned`
- `import-passing`
- `mcp-passing`
- `live-passing`
- `e2e-passing`
- `blocked`
- `needs-conversion`
- `skipped`

### Proposed artifact locations

- plan / ledger docs in repo root, e.g.:
  - `PLAN-real-capability-testing.md`
  - `CAPABILITY-CERTIFICATION.md`
- generated run artifacts under temp roots or `.run/`, for example:
  - `/tmp/shuvdex-capability-tests/...`
  - `.run/capability-tests/...`

---

## Updated first-wave matrix

## Wave 1A — certify ready-now `module_runtime` skills

### Candidate 1: `youtube-transcript`

Source:
- `/home/shuv/repos/shuvbot-skills/youtube-transcript/SKILL.md`
- `/home/shuv/repos/shuvbot-skills/youtube-transcript/capability.yaml`
- `/home/shuv/repos/shuvbot-skills/youtube-transcript/transcript.mcp.mjs`
- `/home/shuv/repos/shuvbot-skills/youtube-transcript/transcript.js`
- `/home/shuv/repos/shuvbot-skills/youtube-transcript/package.json`

Current status:
- import/surface/live execution already proven in automated tests
- OpenCode clean-room E2E still pending

Expected surfaced tool:
- `skill.youtube_transcript.fetch_transcript`

Likely prerequisites:
- network access
- a known video with transcript available

Next certification target:
- clean-room OpenCode E2E through the live remote MCP server

### Candidate 2: `crawl`

Source:
- `/home/shuv/repos/shuvbot-skills/crawl/SKILL.md`
- `/home/shuv/repos/shuvbot-skills/crawl/capability.yaml`
- `/home/shuv/repos/shuvbot-skills/crawl/crawl.mcp.mjs`
- `/home/shuv/repos/shuvbot-skills/crawl/crawl.sh`

Why first-wave:
- explicit `capability.yaml`
- explicit `module_runtime` targets
- multiple real tool operations
- real-world external API behavior

Expected surfaced tools:
- `skill.crawl.start`
- `skill.crawl.status`

Likely prerequisites:
- Cloudflare credentials
- network access

Happy-path examples:
- start a crawl job against a small public docs site
- inspect status/results successfully

Negative-path examples:
- invalid URL
- missing credentials
- invalid action

Certification target:
- import → MCP surface → live execution → OpenCode clean-room E2E

## Wave 1B — certify ready-now generated `http_api` capabilities

### Candidate 3: Gitea public OpenAPI (`GET /version` first)

Source:
- downloaded spec: `https://docs.gitea.com/redocusaurus/plugin-redoc-1.yaml`
- helper script: `scripts/gitea-openapi-trial.mjs`

Current status:
- inspect passing
- compile passing
- live execution passing against real Gitea
- no credential required for `/version`
- OpenCode clean-room E2E still pending

Expected surfaced tool:
- compiled capability for `GET /version`
  - currently observed as `openapi.gitea.api.getVersion`

Next certification target:
- remote MCP surfacing and client E2E
- then expand to a tiny authenticated Gitea read endpoint using credentials

### Candidate 4: authenticated OpenAPI target (TBD)

Possible targets:
- authenticated Gitea endpoint
- Cloudflare
- another small read-only spec-backed capability set

Why this matters:
- proves credential-store-driven `http_api` execution beyond public unauthenticated reads
- validates `test-auth`, credential rotation, and auth failure handling

Status target:
- planned

## Wave 1C — convert high-value script skills, then certify

### Candidate 5: `upload`

Source:
- `/home/shuv/repos/shuvbot-skills/upload/SKILL.md`
- `/home/shuv/repos/shuvbot-skills/upload/upload.sh`
- `/home/shuv/repos/shuvbot-skills/upload/upload-html.sh`

Current state:
- high-value real-world capability
- shell workflow today
- not yet clearly manifest-backed as a shuvdex-native tool

Desired certification outcomes:
- upload file through shuvdex-exposed tool
- return stable URL
- verify resulting URL is reachable
- optionally validate HTML upload artifact behavior

Status target:
- `needs-conversion`

### Candidate 6: `model-usage`

Source:
- `/home/shuv/repos/shuvbot-skills/model-usage/SKILL.md`
- `/home/shuv/repos/shuvbot-skills/model-usage/scripts/model_usage.py`
- `/home/shuv/repos/shuvbot-skills/model-usage/references/codexbar-cli.md`

Current state:
- valuable structured read capability
- likely depends on local `codexbar`
- appears script/instruction driven today

Desired certification outcomes:
- expose a stable MCP tool
- return structured model usage summary
- validate against deterministic fixture or live local data

Status target:
- `needs-conversion`

### Candidate 7: `ccusage`

Source:
- `/home/shuv/repos/shuvbot-skills/ccusage/SKILL.md`
- `/home/shuv/repos/shuvbot-skills/ccusage/ccusage.sh`
- `/home/shuv/repos/shuvbot-skills/ccusage/dashboard.sh`
- `/home/shuv/repos/shuvbot-skills/ccusage/dashboard.html`
- `/home/shuv/repos/shuvbot-skills/ccusage/scripts/...`

Current state:
- high-value real-world capability
- multi-host and shell-heavy
- more complex than `model-usage`

Desired certification outcomes:
- certify a read-only summary tool first
- later certify dashboard/artifact generation

Status target:
- `needs-conversion`

---

## Proposed wave order

### Milestone 1 — complete certification of one real `module_runtime` skill
- [ ] `youtube-transcript` clean-room OpenCode E2E

### Milestone 2 — certify one second real capability family
- [ ] `crawl`
- [ ] Gitea remote MCP surfacing + client E2E

### Milestone 3 — prove authenticated OpenAPI certification
- [ ] choose one authenticated spec-backed target
- [ ] validate credentials, `test-auth`, and a real authenticated read call
- [ ] validate credential rotation behavior

### Milestone 4 — convert and certify one artifact-producing skill
- [ ] `upload`

### Milestone 5 — convert and certify structured analytics skills
- [ ] `model-usage`
- [ ] `ccusage`

### Milestone 6 — expand to more complex skills and hosts
- [ ] additional module-runtime skills
- [ ] `shuvbot` host validation
- [ ] API/UI visibility verification

---

## Test layers in detail

## Layer A — Import contract tests

Purpose:
- prove a real skill or spec imports/compiles into a correct package shape

For each target:
- [ ] import archive, directory fixture, or compile spec into managed storage
- [ ] assert expected package id
- [ ] assert expected source metadata
- [ ] assert expected capability count and ids
- [ ] assert expected assets/resources/prompts are preserved when applicable
- [ ] assert warnings are sensible and not unexpectedly severe

Validation examples:
- `youtube-transcript` imports `skill.youtube_transcript`
- `crawl` imports `skill.crawl`
- Gitea spec compiles `openapi.gitea.api`

## Layer B — MCP surface tests

Purpose:
- prove the remote server exposes imported/generated capabilities correctly

For each certified package:
- [ ] seed/import/compile the package into a test store
- [ ] start MCP server against that store
- [ ] run `tools/list`
- [ ] run `resources/list` when applicable
- [ ] run `prompts/list` when applicable
- [ ] assert stable IDs/titles/descriptions are visible

Validation examples:
- `skill.youtube_transcript.fetch_transcript` visible
- `skill.crawl.start` and `skill.crawl.status` visible
- `openapi.gitea.api.getVersion` visible when the compiled package is loaded into MCP runtime

## Layer C — Live execution tests

Purpose:
- prove actual runtime execution works through shuvdex

For each capability:
- [ ] invoke via `ExecutionProviders` and/or the full MCP server
- [ ] assert structured result shape
- [ ] assert expected real side effect or artifact
- [ ] assert errors are structured and non-hallucinated
- [ ] assert timeout/failure behavior is useful

Validation examples:
- `youtube-transcript` returns transcript text and entries
- `crawl.start` returns job metadata
- `crawl.status` returns current state or results
- Gitea `/version` returns server version JSON
- authenticated OpenAPI target returns real data with credential injection
- `upload` returns a reachable URL

## Layer D — Clean-room OpenCode E2E

Purpose:
- prove the tool is actually usable from a real client

For each certified capability:
- [ ] seed/import/compile the package into the live remote server
- [ ] run isolated OpenCode discovery prompt
- [ ] run isolated OpenCode tool-use prompt
- [ ] capture JSONL artifacts
- [ ] assert final answer reflects real tool output, not hallucination

Validation examples:
- OpenCode discovers the exact surfaced tool name
- OpenCode successfully invokes the tool with deterministic arguments
- final output includes the actual structured result

## Layer E — Host/runtime matrix

Purpose:
- prove portability across deployment hosts

Matrix dimensions:
- host: `shuvdev`, later `shuvbot`
- execution mode: direct MCP probe, automated test, clean-room OpenCode

For each certified capability:
- [ ] validate on `shuvdev`
- [ ] later validate on `shuvbot`
- [ ] record env/credential differences

---

## Proposed deliverables

- [x] Updated plan doc (this file)
- [ ] Certification ledger doc, e.g. `CAPABILITY-CERTIFICATION.md`
- [ ] Test harness scripts for repeatable capability certification
- [x] Automated tests covering real imported skill execution (`youtube-transcript`)
- [x] Automated tests covering OpenAPI route and HTTP executor behavior
- [x] Helper script for Gitea OpenAPI real-world trial
- [ ] First-wave certification results with durable artifact paths
- [ ] Updated operational docs / AGENTS notes as new lessons are learned

---

## Detailed task breakdown

## Phase 1 — define and persist the certification inventory

- [x] Define a first-wave inventory in this plan
  - `youtube-transcript`
  - `crawl`
  - `Gitea OpenAPI`
  - authenticated OpenAPI target (TBD)
  - `upload`
  - `model-usage`
  - `ccusage`
- [x] Separate ready-now vs needs-conversion candidates
- [ ] Create a durable ledger file with current statuses

Suggested output file:
- `CAPABILITY-CERTIFICATION.md`

## Phase 2 — strengthen importer coverage with real skills/specs

- [ ] Add importer-focused tests for `youtube-transcript`
- [ ] Add importer-focused tests for `crawl`
- [ ] Add compile-focused tests for real OpenAPI specs beyond the current route coverage
- [ ] Verify expected package ids, capability ids, and source metadata

Relevant files:
- `packages/skill-importer/test/importer.test.ts`
- `packages/openapi-source/src/live.ts`
- `apps/api/test/openapi-routes.test.ts`

## Phase 3 — strengthen MCP surface coverage for real capabilities

- [ ] Add MCP surface test for `youtube-transcript` through the live remote server shape, not only in-memory local tests
- [ ] Add MCP surface test for `crawl`
- [ ] Add MCP surface test for compiled Gitea capability package
- [ ] Verify surfaced capability names are client-friendly and stable enough for prompting

Relevant files:
- `apps/mcp-server/src/server.ts`
- `apps/mcp-server/test/imported-module-runtime.e2e.test.ts`
- `apps/mcp-server/test/http.test.ts`
- new file likely needed, e.g. `apps/mcp-server/test/real-capability-surface.test.ts`

## Phase 4 — strengthen live execution coverage

- [x] Real imported-skill execution test exists for `youtube-transcript`
- [x] Real public OpenAPI execution exists for Gitea `/version`
- [ ] Add deterministic live execution coverage for `crawl`
- [ ] Add authenticated OpenAPI live execution coverage
- [ ] Add negative-path tests for each certified capability
- [ ] Add artifact assertions for artifact-producing capabilities

Relevant files:
- `packages/execution-providers/test/providers.test.ts`
- `apps/mcp-server/test/imported-module-runtime.e2e.test.ts`
- `scripts/gitea-openapi-trial.mjs`

## Phase 5 — extend the clean-room E2E harness from one fixture to many capabilities

- [ ] Refactor `scripts/run-remote-mcp-e2e.sh` so it can run named target capabilities, not just the echo fixture
- [ ] Parameterize:
  - package/skill/spec target under test
  - discovery prompt
  - invocation prompt
  - validation expectations
- [ ] Save artifacts under capability-specific directories
- [ ] Make summary output explicit about pass/fail

Relevant files:
- `scripts/run-remote-mcp-e2e.sh`
- `RUNBOOK-remote-mcp-e2e.md`
- `AGENTS.md`

## Phase 6 — finish Wave 1A on `shuvdev`

### `youtube-transcript`
- [x] import and execution proven in automated tests
- [ ] verify remote `tools/list` through the deployed MCP server with the real package loaded
- [ ] run clean-room OpenCode E2E
- [ ] record certification result in ledger

### `crawl`
- [ ] import the skill package
- [ ] verify `tools/list`
- [ ] execute a tiny crawl against a safe public target
- [ ] verify structured response
- [ ] run clean-room OpenCode E2E
- [ ] record certification result

## Phase 7 — finish Wave 1B for OpenAPI

### Gitea public read capability
- [x] inspect + compile + real live execution for `/version`
- [ ] verify MCP surfacing through the deployed server
- [ ] run clean-room OpenCode E2E
- [ ] record certification result

### authenticated OpenAPI target
- [ ] choose target
- [ ] register credentials in store
- [ ] verify `test-auth`
- [ ] run real authenticated read call
- [ ] validate credential rotation behavior
- [ ] record certification result

## Phase 8 — convert then certify Wave 1C skills

### `upload`
- [ ] decide package/tool shape
- [ ] add manifest/runtime entrypoint
- [ ] test upload side effect and returned URL
- [ ] certify through the full ladder

### `model-usage`
- [ ] decide whether to certify against live `codexbar` or deterministic fixture first
- [ ] add manifest/runtime entrypoint
- [ ] validate structured per-model output
- [ ] certify through the full ladder

### `ccusage`
- [ ] choose minimum first certification scope
- [ ] likely start with summary generation, not full dashboard sophistication
- [ ] add manifest/runtime entrypoint(s)
- [ ] validate produced summary/artifact
- [ ] certify through the full ladder

## Phase 9 — expand to `shuvbot`

- [ ] install/verify equivalent remote service shape on `shuvbot`
- [ ] rerun certified capability set
- [ ] capture host-specific differences
- [ ] update docs and AGENTS notes

---

## Suggested certification ledger structure

Create a file like `CAPABILITY-CERTIFICATION.md` with a table such as:

| Capability | Package ID | Executor | Readiness | Import | MCP | Live | OpenCode E2E | Host(s) | Notes |
|---|---|---|---|---|---|---|---|---|---|
| youtube-transcript | skill.youtube_transcript | module_runtime | ready-now | ✅ | ✅ local | ✅ | ☐ | shuvdev | remote clean-room still pending |
| crawl | skill.crawl | module_runtime | ready-now | ☐ | ☐ | ☐ | ☐ | — | likely needs Cloudflare creds |
| gitea-version | openapi.gitea.api | http_api | ready-now | ✅ compile | ☐ remote | ✅ | ☐ | shuvdev | public unauthenticated read proven |
| dnsfilter-current-user | openapi.dnsfilter.api | http_api | ready-now | ✅ compile | ✅ | ✅ | ✅ | shuvdev | first authenticated OpenAPI target now certified on `shuvdev`; next follow-ons are auth failure behavior and credential rotation |
| upload | TBD | module_runtime? | needs-conversion | ☐ | ☐ | ☐ | ☐ | — | shell skill today |
| model-usage | TBD | module_runtime? | needs-conversion | ☐ | ☐ | ☐ | ☐ | — | depends on codexbar |
| ccusage | TBD | module_runtime? | needs-conversion | ☐ | ☐ | ☐ | ☐ | — | multi-host complexity |

---

## Validation criteria for this plan document

This planning effort is complete when:

- [x] a clear first-wave capability list exists
- [x] each capability family has pass/fail criteria by test layer
- [x] target files for future implementation are identified
- [x] readiness versus conversion-first candidates are separated
- [x] operational constraints from the existing clean-room and systemd setup are captured
- [x] the plan reflects the current reality that both `module_runtime` and `http_api` are now real certification targets
- [x] the plan reflects already-landed proof points (`youtube-transcript`, Gitea `/version`, stable MCP HTTP test)

---

## Success criteria for the implementation that follows this plan

The broader testing initiative will be considered successful when all of the following are true:

- [ ] at least two real existing capabilities are certified end-to-end without custom handholding
- [ ] at least one artifact-producing real-world capability is certified end-to-end
- [ ] OpenCode clean-room E2E works for more than the synthetic echo fixture
- [ ] a durable certification ledger exists and can be updated incrementally
- [ ] future agents/operators can repeat the certification flow using documented scripts/runbooks
- [x] at least one authenticated OpenAPI capability is certified with real credentials (`dnsfilter-current-user`)

---

## Key decisions captured in this plan

- Prioritize **depth over breadth**: certify a small first batch thoroughly before expanding
- Treat both **`module_runtime`** and **`http_api`** as first-class certification paths now
- Separate **ready-now** capabilities from **needs-conversion** capabilities
- Keep **clean-room OpenCode E2E** as a mandatory layer, not an optional extra
- Treat **artifacts and telemetry** as required test outputs, not nice-to-haves
- Use `shuvdev` as the first certification host and expand to `shuvbot` later
- Use Gitea public read calls as the first lightweight OpenAPI proving ground before moving to authenticated targets

---

## Open questions to resolve during execution

- [ ] What is the best durable location for certification artifacts: `/tmp`, `.run/`, or both?
- [ ] Should the certification ledger remain markdown, or should there also be a JSON representation for automation?
- [ ] Which authenticated OpenAPI target should be first: Gitea authenticated read, Cloudflare, or another spec-backed service?
- [ ] Should high-value script skills be converted one at a time, or should a common conversion scaffold be created first?
- [ ] How much negative-path coverage should be mandatory for initial certification?
- [ ] When should API/UI-driven certification join the matrix, versus keeping the first phase CLI/MCP/OpenCode focused?

# PLAN: Real capability testing for shuvdex

> Goal: move from proving the **remote MCP transport** works to proving that **real imported skills**, **real MCP tools**, and **real-world capability execution** work end-to-end through `shuvdex`.
>
> This plan is for execution later. It does **not** implement the test framework yet.

## Summary

`shuvdex` now has enough infrastructure to serve as a centralized remote MCP gateway:

- imported packages persist in the registry
- `module_runtime` tool execution works
- the remote Streamable HTTP MCP server works
- OpenCode clean-room discovery and invocation works for a deterministic fixture
- the server is deployed on `shuvdev` as a user systemd service

What is still missing is confidence in **real capabilities**.

Today we have mostly proven the transport and one deterministic echo tool. We have **not yet certified** that realistic imported skills:

- compile correctly into packages
- surface correct MCP tools/resources/prompts
- execute correctly through `module_runtime`
- behave correctly under real dependencies/credentials/network conditions
- work end-to-end from a real OpenCode client in clean-room mode

This plan defines a repeatable capability-certification program.

---

## Current known-good baseline

### Infrastructure already proven

- Remote MCP server works on `shuvdev`
  - `http://shuvdev:3848/mcp`
  - `http://shuvdev:3848/health`
- User systemd unit exists and is installed
  - repo copy: `systemd/shuvdex-mcp.service`
  - installed unit: `~/.config/systemd/user/shuvdex-mcp.service`
- Clean-room OpenCode test exists
  - script: `scripts/run-remote-mcp-e2e.sh`
  - runbook: `RUNBOOK-remote-mcp-e2e.md`
- Deterministic seeded fixture exists
  - source: `examples/module-runtime-skill-template/`
  - seeder: `scripts/seed-module-runtime-template.mjs`
  - surfaced tool name: `shuvdex_skill_module_runtime_template_echo`

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
- `packages/execution-providers/test/providers.test.ts`

#### API surfaces
- `apps/api/src/routes/packages.ts`
- `apps/api/src/routes/skills.ts`
- `apps/api/src/routes/tools.ts`

#### Operational notes
- `AGENTS.md`
- `README.md`
- `RUNBOOK-remote-mcp-e2e.md`

---

## Problem statement

The current test coverage is heavily weighted toward:

- importer mechanics
- MCP protocol mechanics
- one synthetic echo tool

That is necessary but insufficient.

We now need to validate three harder questions:

1. **Does shuvdex import real skills faithfully?**
2. **Does shuvdex expose those imported capabilities correctly through MCP?**
3. **Do those capabilities perform real useful work end-to-end?**

---

## Testing philosophy

The testing program should work like a **capability certification ladder**.

Each skill/capability graduates through progressively more realistic layers:

### Tier 1 — Import contract
Validate import and compilation correctness.

### Tier 2 — MCP surface contract
Validate what the remote server exposes.

### Tier 3 — Live execution contract
Validate actual tool behavior through `module_runtime` or other supported executors.

### Tier 4 — Real client E2E
Validate discovery and use from isolated OpenCode.

### Tier 5 — Host/runtime matrix
Validate the same capability set on `shuvdev` and later `shuvbot`.

The output should be a durable **capability certification ledger**, not just ad-hoc test logs.

---

## Constraints and realities from the current codebase

### 1. `module_runtime` is the only fully implemented executor

Current executor types in schema:
- `builtin`
- `host_runner`
- `mcp_proxy`
- `http_api`
- `module_runtime`

Practical reality from current code and repo status:
- `module_runtime` is the implemented real executor path
- the others are not yet the right place to invest deep certification effort

**Implication:** first-wave real capability testing should heavily prioritize skills that can run via `module_runtime`.

Relevant files:
- `packages/capability-registry/src/schema.ts`
- `packages/execution-providers/src/module-runtime.ts`

### 2. Not every skill is currently tool-ready for shuvdex

Some real-world skills already look close to capability import and runtime testing:
- `/home/shuv/repos/shuvbot-skills/crawl/`
- `/home/shuv/repos/shuvbot-skills/youtube-transcript/`

Some others are currently instruction/script skills but not yet clearly packaged as manifest-backed MCP tools:
- `/home/shuv/repos/shuvbot-skills/upload/`
- `/home/shuv/repos/shuvbot-skills/model-usage/`
- `/home/shuv/repos/shuvbot-skills/ccusage/`

**Implication:** the first batch should distinguish:
- **certify now**: already-structured tool skills
- **convert then certify**: high-value instruction/script skills

### 3. Real-world testing must preserve clean-room discipline

The earlier OpenCode work established several rules that remain mandatory:
- do not run clean-room tests from the repo root
- isolate OpenCode with temp XDG dirs
- pin a known-good model/provider combination
- test against the centralized remote MCP endpoint, not a local ad-hoc spawn

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

**Implication:** every new test harness or certification script should save structured artifacts and, where possible, produce span/log evidence.

Relevant files:
- `packages/telemetry/src/index.ts`
- `packages/telemetry/src/live.ts`
- `packages/telemetry/src/span.ts`

---

## High-level goals

- [ ] Create a durable capability certification workflow for real skills
- [ ] Define a prioritized first-wave capability matrix
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

- source skill path
- import source type (`.md`, `.zip`, `.skill`, local fixture)
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

## Proposed first-wave matrix

## Wave 1A — certify existing module-runtime-ready skills first

These appear best suited for immediate certification because they already have explicit capability manifests or runtime entrypoints.

### Candidate 1: `crawl`

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

### Candidate 2: `youtube-transcript`

Source:
- `/home/shuv/repos/shuvbot-skills/youtube-transcript/SKILL.md`
- `/home/shuv/repos/shuvbot-skills/youtube-transcript/capability.yaml`
- `/home/shuv/repos/shuvbot-skills/youtube-transcript/transcript.mcp.mjs`
- `/home/shuv/repos/shuvbot-skills/youtube-transcript/transcript.js`
- `/home/shuv/repos/shuvbot-skills/youtube-transcript/package.json`

Why first-wave:
- explicit `capability.yaml`
- explicit `module_runtime` tool
- output is easy to validate structurally
- likely read-only behavior

Expected surfaced tool:
- `skill.youtube_transcript.fetch_transcript`

Likely prerequisites:
- network access
- a known video with transcript available

Happy-path examples:
- fetch transcript for a known YouTube video
- assert non-empty `text`, `entries`, and `entryCount`

Negative-path examples:
- invalid video id/url
- video with no transcript

Certification target:
- import → MCP surface → live execution → OpenCode clean-room E2E

## Wave 1B — convert high-value script skills, then certify

These are valuable real-world skills, but they appear to need packaging/runtime alignment before they can be certified as shuvdex-native capabilities.

### Candidate 3: `upload`

Source:
- `/home/shuv/repos/shuvbot-skills/upload/SKILL.md`
- `/home/shuv/repos/shuvbot-skills/upload/upload.sh`
- `/home/shuv/repos/shuvbot-skills/upload/upload-html.sh`

Current state:
- very useful real-world capability
- currently documented as shell workflow
- not obviously shipped as manifest-backed runtime tool yet

Desired certification outcomes:
- upload file through shuvdex-exposed tool
- return stable URL
- verify resulting URL is reachable
- for HTML upload, optionally assert OG companion image output

Status target:
- `needs-conversion` first, then certify

### Candidate 4: `model-usage`

Source:
- `/home/shuv/repos/shuvbot-skills/model-usage/SKILL.md`
- `/home/shuv/repos/shuvbot-skills/model-usage/scripts/model_usage.py`
- `/home/shuv/repos/shuvbot-skills/model-usage/references/codexbar-cli.md`

Current state:
- high-value structured read capability
- likely depends on local `codexbar`
- currently appears script/instruction driven rather than fully manifest-backed

Desired certification outcomes:
- expose a stable MCP tool with arguments for provider/mode/format
- return structured model usage summary
- validate against live local cost data or a deterministic fixture input file

Status target:
- `needs-conversion` first, then certify

### Candidate 5: `ccusage`

Source:
- `/home/shuv/repos/shuvbot-skills/ccusage/SKILL.md`
- `/home/shuv/repos/shuvbot-skills/ccusage/ccusage.sh`
- `/home/shuv/repos/shuvbot-skills/ccusage/dashboard.sh`
- `/home/shuv/repos/shuvbot-skills/ccusage/dashboard.html`
- `/home/shuv/repos/shuvbot-skills/ccusage/scripts/...`

Current state:
- very high-value real-world capability
- multi-host and shell-heavy
- more operationally complex than `model-usage`

Desired certification outcomes:
- at minimum certify a read-only summary tool
- eventually certify dashboard generation as an artifact-producing tool
- validate output structure and artifact generation

Status target:
- `needs-conversion` first, then certify

---

## Proposed wave order

### Milestone 1 — certify two already-toolish skills
- [ ] `crawl`
- [ ] `youtube-transcript`

### Milestone 2 — convert and certify one high-value artifact skill
- [ ] `upload`

### Milestone 3 — convert and certify structured analytics skills
- [ ] `model-usage`
- [ ] `ccusage`

### Milestone 4 — expand to more complex skills and hosts
- [ ] additional module-runtime skills
- [ ] `shuvbot` host validation
- [ ] API/UI visibility verification

---

## Test layers in detail

## Layer A — Import contract tests

Purpose:
- prove a real skill imports into a correct package shape

For each target skill:
- [ ] import archive or directory fixture into managed storage
- [ ] assert expected package id
- [ ] assert expected source metadata
- [ ] assert expected capability count and ids
- [ ] assert expected assets/resources/prompts are preserved
- [ ] assert warnings are sensible and not unexpectedly severe

Likely implementation locations:
- `packages/skill-importer/test/importer.test.ts`
- new fixtures under `packages/skill-importer/test/fixtures/` or equivalent

Validation examples:
- `crawl` imports `skill.crawl` and exposes two tool capabilities
- `youtube-transcript` imports `skill.youtube_transcript` and exposes `fetch_transcript`

## Layer B — MCP surface tests

Purpose:
- prove the remote server exposes imported capabilities correctly

For each certified package:
- [ ] import/seed the package into a test store
- [ ] start MCP server against that store
- [ ] run `tools/list`
- [ ] run `resources/list` when applicable
- [ ] run `prompts/list` when applicable
- [ ] assert stable IDs/titles/descriptions are visible

Likely implementation locations:
- `apps/mcp-server/test/imported-module-runtime.e2e.test.ts`
- new targeted tests such as:
  - `apps/mcp-server/test/real-skill-surface.test.ts`

Validation examples:
- `skill.crawl.start` and `skill.crawl.status` visible
- `skill.youtube_transcript.fetch_transcript` visible

## Layer C — Live execution tests

Purpose:
- prove actual runtime execution works through shuvdex

For each capability:
- [ ] invoke via `ExecutionProviders` and/or the full MCP server
- [ ] assert structured result shape
- [ ] assert expected real side effect or artifact
- [ ] assert errors are structured and non-hallucinated
- [ ] assert timeout/failure behavior is useful

Likely implementation locations:
- `packages/execution-providers/test/providers.test.ts`
- `apps/mcp-server/test/imported-module-runtime.e2e.test.ts`
- additional real-capability fixtures/tests

Validation examples:
- `youtube-transcript` returns transcript text and entries
- `crawl.start` returns job metadata
- `crawl.status` returns current state or results
- `upload` returns a URL that can be fetched

## Layer D — Clean-room OpenCode E2E

Purpose:
- prove the tool is actually usable from a real client

For each certified capability:
- [ ] seed/import the package into the live remote server
- [ ] run isolated OpenCode discovery prompt
- [ ] run isolated OpenCode tool-use prompt
- [ ] capture JSONL artifacts
- [ ] assert final answer reflects real tool output, not hallucination

Likely implementation locations:
- extend `scripts/run-remote-mcp-e2e.sh`
- or add capability-targeted variants, for example:
  - `scripts/run-capability-certification.sh`
  - `scripts/run-opencode-capability-e2e.sh`

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

- [ ] Plan doc (this file)
- [ ] Certification ledger doc, e.g. `CAPABILITY-CERTIFICATION.md`
- [ ] Test harness scripts for repeatable capability certification
- [ ] New automated tests for importer + MCP + execution layers
- [ ] First-wave certification results with artifact paths
- [ ] Updated operational docs / AGENTS notes as new lessons are learned

---

## Detailed task breakdown

## Phase 1 — define the certification inventory

- [ ] Create a first-wave capability inventory with statuses:
  - `crawl`
  - `youtube-transcript`
  - `upload`
  - `model-usage`
  - `ccusage`
- [ ] For each skill, record:
  - source files
  - manifest presence
  - runtime entrypoint presence
  - binary/env dependencies
  - likely executor type
  - whether it is ready to certify now or needs conversion first
- [ ] Create a durable ledger file for this inventory

Suggested output file:
- `CAPABILITY-CERTIFICATION.md`

## Phase 2 — strengthen importer coverage with real skills

- [ ] Add importer tests for real skills, starting with:
  - `crawl`
  - `youtube-transcript`
- [ ] Verify expected package ids, capability ids, and assets
- [ ] Add assertions for warnings and package source metadata
- [ ] Add fixture handling for archives versus direct directory import as needed

Relevant files:
- `packages/skill-importer/test/importer.test.ts`
- `packages/skill-importer/src/live.ts`
- `packages/skill-importer/src/types.ts`

## Phase 3 — strengthen MCP surface coverage for imported real skills

- [ ] Add remote/local MCP tests that seed/import real skills and assert `tools/list`
- [ ] Add resource/prompt checks where relevant
- [ ] Verify surfaced capability names match expectations closely enough for client prompting
- [ ] Add failure-path assertions for denied or misconfigured capabilities where practical

Relevant files:
- `apps/mcp-server/src/server.ts`
- `apps/mcp-server/test/imported-module-runtime.e2e.test.ts`
- `apps/mcp-server/test/http.test.ts`

## Phase 4 — strengthen live execution coverage

- [ ] Add execution tests for real capabilities with deterministic assertions
- [ ] Create safe fixtures for external dependencies where possible
- [ ] For network-backed tools, choose tiny read-only test cases
- [ ] For artifact-producing tools, validate the artifact exists and is structurally correct
- [ ] Add negative-path tests for each certified capability

Relevant files:
- `packages/execution-providers/src/module-runtime.ts`
- `packages/execution-providers/test/providers.test.ts`

## Phase 5 — extend the clean-room E2E harness from one fixture to many capabilities

- [ ] Refactor `scripts/run-remote-mcp-e2e.sh` so it can run against named target capabilities, not just the echo fixture
- [ ] Parameterize:
  - package/skill under test
  - discovery prompt
  - invocation prompt
  - validation expectations
- [ ] Save artifacts under capability-specific directories
- [ ] Make the summary output explicit about pass/fail

Relevant files:
- `scripts/run-remote-mcp-e2e.sh`
- `RUNBOOK-remote-mcp-e2e.md`
- `AGENTS.md`

## Phase 6 — certify Wave 1A skills on shuvdev

### `crawl`
- [ ] import the skill package
- [ ] verify `tools/list`
- [ ] execute a tiny crawl against a safe public target
- [ ] verify structured response
- [ ] run clean-room OpenCode E2E
- [ ] record certification results

### `youtube-transcript`
- [ ] import the skill package
- [ ] verify `tools/list`
- [ ] fetch transcript for a known public video
- [ ] verify structured response
- [ ] run clean-room OpenCode E2E
- [ ] record certification results

## Phase 7 — convert then certify Wave 1B skills

### `upload`
- [ ] decide the package/tool shape
- [ ] add manifest/runtime entrypoint
- [ ] test upload side effect and returned URL
- [ ] certify via the same ladder

### `model-usage`
- [ ] decide whether to certify against live `codexbar` or deterministic JSON fixture first
- [ ] add manifest/runtime entrypoint
- [ ] validate structured per-model output
- [ ] certify via the same ladder

### `ccusage`
- [ ] choose minimum first certification scope
- [ ] likely start with summary generation, not full dashboard sophistication
- [ ] add manifest/runtime entrypoint(s)
- [ ] validate produced summary/artifact
- [ ] certify via the same ladder

## Phase 8 — expand to `shuvbot`

- [ ] install/verify the same remote service shape or equivalent on `shuvbot`
- [ ] rerun the certified capability set
- [ ] capture host-specific differences
- [ ] update docs and AGENTS notes

---

## Suggested certification ledger structure

Create a file like `CAPABILITY-CERTIFICATION.md` with a table such as:

| Skill | Package ID | Tool IDs | Readiness | Import | MCP | Live | OpenCode E2E | Host(s) | Notes |
|---|---|---|---|---|---|---|---|---|---|
| crawl | skill.crawl | skill.crawl.start, skill.crawl.status | ready-now | ☐ | ☐ | ☐ | ☐ | shuvdev | needs Cloudflare creds |
| youtube-transcript | skill.youtube_transcript | skill.youtube_transcript.fetch_transcript | ready-now | ☐ | ☐ | ☐ | ☐ | shuvdev | needs known transcript video |
| upload | TBD | TBD | needs-conversion | ☐ | ☐ | ☐ | ☐ | — | shell skill today |
| model-usage | TBD | TBD | needs-conversion | ☐ | ☐ | ☐ | ☐ | — | depends on codexbar |
| ccusage | TBD | TBD | needs-conversion | ☐ | ☐ | ☐ | ☐ | — | multi-host complexity |

---

## Validation criteria for this plan

This planning effort is complete when:

- [ ] a clear first-wave skill list exists
- [ ] each skill has pass/fail criteria by test layer
- [ ] target files for future implementation are identified
- [ ] readiness versus conversion-first candidates are separated
- [ ] operational constraints from the existing clean-room and systemd setup are captured

---

## Success criteria for the implementation that follows this plan

The broader testing initiative will be considered successful when all of the following are true:

- [ ] at least two real existing skills are certified end-to-end without custom handholding
- [ ] at least one artifact-producing real-world capability is certified end-to-end
- [ ] OpenCode clean-room E2E works for more than the synthetic echo fixture
- [ ] a durable certification ledger exists and can be updated incrementally
- [ ] future agents/operators can repeat the certification flow using documented scripts/runbooks

---

## Key decisions captured in this plan

- Prioritize **depth over breadth**: certify a small first batch thoroughly before expanding
- Start with **module_runtime-capable** skills because that is the implemented executor path today
- Separate **ready-now** skills from **needs-conversion** skills
- Keep **clean-room OpenCode E2E** as a mandatory layer, not an optional extra
- Treat **artifacts and telemetry** as required test outputs, not nice-to-haves
- Use `shuvdev` as the first certification host and expand to `shuvbot` later

---

## Open questions to resolve during execution

- [ ] What is the best durable location for certification artifacts: `/tmp`, `.run/`, or both?
- [ ] Should the certification ledger remain markdown, or should there also be a JSON representation for automation?
- [ ] Should high-value script skills be converted one at a time, or should a common conversion scaffold be created first?
- [ ] How much negative-path coverage should be mandatory for initial certification?
- [ ] When should API/UI-driven certification join the matrix, versus keeping the first phase CLI/MCP/OpenCode focused?

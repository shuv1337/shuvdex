# PLAN: Real-world external client clean-room testing (OpenCode-first)

> Goal: validate `shuvdex` from a **real external client** in a **clean-room environment** against the **deployed remote MCP server** on `shuvdev`, with durable artifacts and minimal inherited local noise.
>
> This plan keeps **OpenCode as the primary lane**, because that is the most developed scripted clean-room flow today, but it now explicitly allows **other providers and even other external clients** when they are more stable or operationally useful.

---

## Why this plan exists

The repo no longer needs a plan focused only on “can OpenCode connect at all?”

That has already been proven for a deterministic fixture.

What we now need is a plan for **real external testing**:

- real remote MCP endpoint on `shuvdev`
- real external client behavior
- real imported skills and real generated OpenAPI capabilities
- clean-room isolation
- repeatable artifacts
- explicit client/provider selection rules

This is the outside-in test layer that sits above unit, integration, and in-memory MCP tests.

---

## Current status

### Already proven

- [x] Clean-room OpenCode environment can be isolated using temp XDG dirs
- [x] OpenCode can connect to the remote MCP endpoint on `shuvdev`
- [x] Deterministic module-runtime fixture can be discovered from the real client
- [x] Deterministic module-runtime fixture can be invoked successfully from the real client
- [x] tmux-supervised artifacts can be captured
- [x] the repeatable remote MCP workflow exists in:
  - `scripts/run-remote-mcp-e2e.sh`
  - `RUNBOOK-remote-mcp-e2e.md`

### Also proven elsewhere in the repo

- [x] real imported skill execution works for `youtube-transcript`
- [x] real compiled `http_api` execution works for Gitea `GET /version`
- [x] remote MCP server on `shuvdev` can be rebuilt/restarted and passes `/health`
- [x] `apps/mcp-server/test/http.test.ts` is stable again

### Not yet proven externally end-to-end

- [ ] OpenCode clean-room E2E for `youtube-transcript`
- [ ] OpenCode clean-room E2E for a real compiled OpenAPI capability
- [x] authenticated external-client test for a credentialed `http_api` capability (`dnsfilter-current-user`)
- [ ] client/provider fallback workflow when OpenCode’s chosen provider is unstable
- [ ] durable multi-capability artifact organization and ledger linkage

---

## Problem statement

The original clean-room plan successfully proved the transport and one deterministic echo tool, but it is too narrow for the next phase.

The real questions now are:

1. Can a **real external client** discover and use **real capabilities** through remote `shuvdex`?
2. Can we run those tests in a **clean-room**, with confidence that MCP servers, rules, skills, and project context are not leaking in?
3. If one provider/client path is flaky, do we have a **documented fallback lane** instead of stalling?
4. Can future agents/operators reproduce the test and compare results over time?

---

## Scope of this plan

This plan now covers **external client testing**, not just OpenCode-specific smoke checks.

### Primary lane
- OpenCode clean-room against the deployed remote MCP server

### Secondary lanes
- OpenCode clean-room with a different provider/model combination if that is more stable
- Codex CLI / Codex Desktop as an alternate external client if OpenCode itself becomes the bottleneck

### Optional later lane
- Claude Code or other MCP-capable client, only if needed for cross-client confidence

This file keeps its old path for continuity, but operationally it is now **OpenCode-first, not OpenCode-only**.

---

## Current known-good baseline

### Remote server under test

- Host: `shuvdev`
- MCP URL: `http://shuvdev:3848/mcp`
- Health URL: `http://shuvdev:3848/health`
- Local health validation after restart also works via:
  - `http://127.0.0.1:3848/health`

### Deterministic external-client proof already completed

- fixture source:
  - `examples/module-runtime-skill-template/`
- seeder:
  - `scripts/seed-module-runtime-template.mjs`
- surfaced tool name observed in OpenCode:
  - `shuvdex_skill_module_runtime_template_echo`
- one-command workflow:
  - `scripts/run-remote-mcp-e2e.sh`
- operator instructions:
  - `RUNBOOK-remote-mcp-e2e.md`

### Relevant repo files

#### Remote MCP server
- `apps/mcp-server/src/http.ts`
- `apps/mcp-server/src/runtime.ts`
- `apps/mcp-server/src/server.ts`
- `apps/mcp-server/test/http.test.ts`
- `apps/mcp-server/test/imported-module-runtime.e2e.test.ts`
- `apps/mcp-server/test/protocol.test.ts`
- `apps/mcp-server/test/shuvdex-integration.test.ts`

#### External-client harness and docs
- `scripts/run-remote-mcp-e2e.sh`
- `RUNBOOK-remote-mcp-e2e.md`
- `AGENTS.md`

#### Real capability targets already available
- `apps/mcp-server/test/imported-module-runtime.e2e.test.ts`
- `scripts/gitea-openapi-trial.mjs`
- `packages/openapi-source/src/live.ts`
- `packages/http-executor/src/live.ts`

---

## Client and provider strategy

## Default strategy

Use **OpenCode** as the first external client because:

- the clean-room isolation is already understood
- the tmux + artifact flow already exists
- the remote MCP script already works
- it is the fastest path to repeatable external proofs

### Current known-good default inside OpenCode

- `model: opencode/gpt-5-nano`
- `small_model: opencode/gpt-5-nano`
- `enabled_providers: ["opencode"]`

This remains the default until a better option proves itself in this environment.

## Allowable alternatives

If the default OpenCode/provider path is the unstable part, this plan explicitly allows switching.

### Preferred fallback order

1. **OpenCode with another explicitly pinned provider/model**
   - only if already authenticated and known-good in this environment
   - must be recorded in artifacts
2. **Codex CLI / Codex Desktop** as the external client
   - especially attractive because the repo already contains Codex integration coverage
3. **Claude Code or another MCP-capable client**
   - only if needed for cross-client confidence or if both OpenCode and Codex are blocked

## Decision rule

A provider/client path should be switched when the instability is clearly in the client/provider layer rather than `shuvdex` itself.

Examples:
- model/provider bootstrap fails before MCP use
- provider auth flow is broken in isolation
- MCP works but the client runtime crashes before or after tool selection

When switching lanes, the result should be documented as:
- client used
- provider/model used
- why the default lane was bypassed

---

## Clean-room requirements

These remain mandatory regardless of client/provider.

### 1. Do not run from the repo root

Running from `/home/shuv/repos/shuvdex` risks pulling in:
- `opencode.jsonc`
- `CONTEXT.md`
- any upward-traversed local rules/context files

So the external client should run from a temp workspace outside the repo.

### 2. Isolate runtime state via temp XDG dirs

For OpenCode, continue using temp values for:
- `XDG_CONFIG_HOME`
- `XDG_DATA_HOME`
- `XDG_CACHE_HOME`
- `XDG_STATE_HOME`
- `OPENCODE_TEST_HOME`

Equivalent isolation should be used for other clients where possible.

### 3. Disable Claude compatibility when using OpenCode

Keep using:
- `OPENCODE_DISABLE_CLAUDE_CODE=1`
- `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=1`
- `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1`

### 4. Test the deployed remote MCP server, not a client-spawned local one

The authoritative external flow now targets the remote Streamable HTTP MCP server on `shuvdev`.

### 5. Capture artifacts for every run

Minimum artifacts:
- client config snapshot or provider summary
- `mcp list` output if available
- discovery output
- invocation output
- tmux transcript if tmux is used
- remote health snapshot
- explicit pass/fail summary

---

## Test objectives

## Primary objective

Confirm that a clean external client can:

1. start with no inherited MCP or rule noise
2. connect to the deployed `shuvdex` MCP endpoint
3. discover the intended tools/resources/prompts
4. invoke at least one real capability successfully
5. produce evidence we can inspect afterward

## Secondary objective

Confirm the isolation approach is actually clean:

- no user/global MCP server leakage
- no repo-local config leakage
- no hidden skill/rule compatibility fallback leakage
- no provider ambiguity in the artifacts

## Tertiary objective

Confirm we have a practical fallback if the default OpenCode/provider lane is unstable.

---

## Capability targets for real external testing

## Phase A — deterministic fixture (already done)

### Target
- `shuvdex_skill_module_runtime_template_echo`

### Status
- [x] discovery proven
- [x] invocation proven
- [x] tmux artifact capture proven

### Purpose
- validate the clean-room harness itself

## Phase B — first real imported skill

### Target
- `youtube-transcript`

### External test goals
- [ ] remote server exposes the imported tool in a way the external client can discover
- [ ] client can call the tool with deterministic arguments
- [ ] returned structure is clearly real, not hallucinated
- [ ] artifacts show exact surfaced tool name

### Suggested prompt shape
- discovery: ask for tools from `shuvdex` only
- invocation: request transcript for a known public video with transcript available

## Phase C — first real compiled OpenAPI capability

### Target
- Gitea public `GET /version`

### External test goals
- [ ] the compiled capability package is present in the remote server runtime
- [ ] client discovers the compiled tool
- [ ] client invokes it successfully
- [ ] result includes real Gitea version data

### Why this target
- already proven internally
- no credentials required for the first read call
- deterministic enough for external-client validation

## Phase D — first authenticated OpenAPI capability

### Target
- authenticated read endpoint on a suitable spec-backed service (TBD)

### External test goals
- [ ] remote package compiled and loaded
- [ ] credentials are stored in `shuvdex` credential store
- [ ] `test-auth` passes
- [ ] external client invocation succeeds
- [ ] negative-path auth failure is also understandable

## Phase E — artifact-producing capability

### Target
- likely `upload` after conversion

### External test goals
- [ ] client triggers a real side effect
- [ ] returned artifact URL/path is validated
- [ ] artifact summary is captured in the run ledger

---

## Client-mode matrix

## Mode 1 — non-interactive scripted run

Purpose:
- deterministic smoke/evidence
- easy artifact capture
- easiest to repeat

Use for:
- first proof of each capability
- regression checks

Status:
- [x] already working for deterministic fixture via OpenCode
- [ ] parameterize for real targets

## Mode 2 — interactive tmux session

Purpose:
- closest operator workflow
- useful for confirming discovery UX and tool naming

Use for:
- final external-client certification step after non-interactive proof

Status:
- [x] already working for deterministic fixture
- [ ] still needs extension to real targets

## Mode 3 — alternate client fallback

Purpose:
- de-risk OpenCode-specific failures
- prove `shuvdex` is client-agnostic enough for real use

Candidates:
- Codex CLI / Codex Desktop first
- Claude Code later if needed

Status:
- [ ] planned only

---

## Test cases

## Test case 1 — isolation sanity check

- [x] For OpenCode, `opencode mcp list` shows only `shuvdex`
- [ ] Equivalent client-config sanity check is documented for fallback clients
- [ ] record current working directory in transcript
- [ ] record provider/model/client in summary artifact

## Test case 2 — server discovery

- [x] OpenCode can connect to the remote MCP endpoint
- [ ] codify fallback-client discovery steps if OpenCode is bypassed
- [ ] assert no inherited MCP config noise is present

## Test case 3 — tool discovery through prompting

- [x] deterministic echo tool is visible
- [ ] `youtube-transcript` tool discovery
- [ ] Gitea compiled tool discovery
- [ ] record exact surfaced tool names for each client

## Test case 4 — deterministic success invocation

- [x] deterministic echo invocation proven
- [ ] `youtube-transcript` invocation via external client
- [ ] Gitea `/version` invocation via external client

## Test case 5 — negative control

- [ ] deterministic fixture missing-arg failure via external client
- [ ] one negative-path test for a real capability
- [ ] authenticated failure-path test for credentialed `http_api`

## Test case 6 — resource/prompt discovery where applicable

- [ ] check whether imported/generated packages surface resources/prompts
- [ ] ensure they are coming from `shuvdex`, not local project context

---

## Implementation order

## Phase 1 — preserve the working deterministic harness

- [x] clean-room OpenCode script exists
- [x] deterministic seeding exists
- [x] tmux evidence capture exists
- [ ] document provider/client fallback rules in artifacts and summary output

## Phase 2 — parameterize the harness for named real targets

- [ ] extend `scripts/run-remote-mcp-e2e.sh` to accept named test target(s)
- [ ] allow selecting discovery prompt and invocation prompt per target
- [ ] record client/provider/model in `summary.json`
- [ ] keep deterministic echo as the baseline smoke test

## Phase 3 — add first real imported-skill external run

- [ ] load/import `youtube-transcript` into the remote runtime
- [ ] add a target-specific invocation prompt
- [ ] save target-specific artifacts
- [ ] define pass/fail assertions

## Phase 4 — add first real OpenAPI external run

- [ ] load compiled Gitea package into remote runtime
- [ ] expose the compiled read tool to the external client
- [ ] add deterministic prompt for version lookup
- [ ] save artifacts and summarize result

## Phase 5 — add authenticated external run

- [ ] choose authenticated OpenAPI target
- [ ] register credentials in `shuvdex`
- [ ] validate `test-auth`
- [ ] run client-side read call
- [ ] add negative auth-path validation

## Phase 6 — add fallback lane

- [ ] document Codex-based external-client procedure
- [ ] decide minimum fallback artifact set
- [ ] run one capability through the fallback lane

---

## Provider/client selection policy

For every real external test run, record:

- client name
- provider name
- model name
- why this combination was selected
- whether it is the default or a fallback

### Current policy

#### Preferred default
- client: OpenCode
- provider: `opencode`
- model: `opencode/gpt-5-nano`

#### Use a different provider within OpenCode when:
- OpenCode itself is working
- the provider/model is already authenticated
- the alternate provider is more reliable than `opencode` in that environment
- the exact choice is recorded in artifacts

#### Use Codex as the client when:
- OpenCode client behavior is the source of instability
- we still want a real external-client test against remote `shuvdex`
- we want a second-client proof after OpenCode succeeds

---

## Artifacts

## Current artifact root
- `/tmp/shuvdex-opencode-clean/artifacts/`

## Required artifact types for future real-target runs
- `health.json`
- client MCP/server listing output
- discovery transcript/output
- invocation transcript/output
- tmux transcript if tmux is used
- summary metadata with:
  - target capability
  - client
  - provider
  - model
  - remote MCP URL
  - pass/fail result

## Future improvement

- [ ] move from one flat artifact directory to target-specific subdirectories, e.g.:
  - `artifacts/echo/`
  - `artifacts/youtube-transcript/`
  - `artifacts/gitea-version/`

---

## Risks and failure modes

### 1. Provider auth not available in clean-room env

Mitigation:
- prefer env-based auth where available
- allow provider-specific auth if it does not contaminate MCP/rules isolation
- record exactly how auth was obtained

### 2. OpenCode provider path is unstable again

Mitigation:
- explicitly pin provider/model
- if still unstable, switch to alternate provider or Codex client
- do not waste time debugging unrelated client internals before confirming `shuvdex` behavior with another client

### 3. Tool naming mismatch in the client

Mitigation:
- always make discovery its own explicit test step before invocation
- record exact surfaced names per client

### 4. Real target not loaded in remote runtime

Mitigation:
- seed/import/compile the target before the external run
- verify via MCP list or equivalent before prompting the client

### 5. Repo-local context leakage

Mitigation:
- enforce temp workspace cwd
- record `pwd` at run start
- keep clean-room XDG dirs

---

## Concrete updates needed before the next external push

- [ ] update `scripts/run-remote-mcp-e2e.sh` to support named targets beyond echo
- [ ] update `RUNBOOK-remote-mcp-e2e.md` to mention provider/client fallback lanes
- [ ] create a target definition for `youtube-transcript`
- [ ] create a target definition for Gitea `/version`
- [x] decide the first authenticated OpenAPI target (`dnsfilter-current-user`)
- [ ] decide whether fallback-client execution belongs in this same script or a second script

---

## Recommendation

For the next real external-testing wave, use this order:

1. **Keep OpenCode + `opencode/gpt-5-nano` as the default smoke lane**
   - fastest path, already proven
2. **Extend the current harness to real targets**
   - first `youtube-transcript`
   - then Gitea `/version`
3. **If OpenCode/provider instability returns, do not block on it**
   - switch to another explicit provider inside OpenCode if that is enough
   - otherwise use Codex as the alternate external client
4. **Only after those succeed, move to authenticated `http_api` and artifact-producing tools**
   - first authenticated `http_api` target: `dnsfilter-current-user`

This keeps the working baseline intact while making room for more practical external testing instead of overcommitting to OpenCode-only assumptions.

---

## Success criteria for the next execution phase

This plan will be considered successfully acted on when all of these are true:

- [ ] deterministic echo remains repeatable
- [ ] one real imported skill passes external-client testing
- [ ] one real generated OpenAPI capability passes external-client testing
- [ ] artifacts clearly record client/provider/model used
- [ ] a fallback path exists if OpenCode/provider behavior blocks progress
- [ ] the results can be linked into the broader capability certification ledger

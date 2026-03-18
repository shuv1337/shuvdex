# Plan: align codex-fleet web contracts with the current API and verify in one browser pass

## Plan review status

**NEEDS REVISION**

This revised plan replaces the earlier draft with codebase-aligned decisions from the current repo state. The main changes are:

- treat the existing API routes as the starting point instead of assuming thin remaps will solve every UI issue
- preserve host-level skill errors instead of collapsing everything into booleans
- force an explicit decision on the unsupported `Sync All` UI action
- use validation commands that match the workspace scripts that actually exist today

---

## Objective

Fix the currently confirmed web-app failures in the default local setup and add targeted regression coverage:

- Web: `http://localhost:5173`
- API: `http://localhost:3847`

This plan covers implementation sequencing, acceptance criteria, and validation. It does **not** implement the fixes.

---

## Confirmed findings

### Browser-confirmed failures

| Area | Symptom | Current evidence | Code-aligned cause |
|---|---|---|---|
| Tools page | `/tools` blank-screens | `ToolCard` reads `tool.schema.params.length` | API returns `schema` as `Record<string, ToolParam>` and has no `id` |
| Skills page | `/skills` blank-screens | `skills.flatMap is not a function` | Web expects `SkillActivation[]`; `GET /api/skills` returns discovery payload `{ repoPath, count, skills }` |
| Dashboard drift | `Check Drift` returns `Not found` | client issues `GET /api/fleet/drift` | API exposes `POST /api/fleet/drift` |
| Hosts ping | `Check status` returns `404` | client hits `GET /api/hosts/:name/ping` | no ping route exists in `apps/api/src/routes/hosts.ts` |

### Code-inspection mismatches

| Area | Current mismatch | Files |
|---|---|---|
| Tool toggles and edits | web uses `id` and `PUT /api/tools/:id/enabled`; API uses `name` and `POST /api/tools/:name/enable|disable` | `apps/web/src/api/client.ts`, `apps/web/src/hooks/useTools.ts`, `apps/api/src/routes/tools.ts` |
| Host create | web sends a flat host body; API expects `{ name, config }` | `apps/web/src/api/client.ts`, `apps/api/src/routes/hosts.ts` |
| Skills write routes | web posts to `/api/skills/*`; API exposes `/api/fleet/activate`, `/api/fleet/deactivate`, `/api/fleet/sync`, `/api/fleet/pull` | `apps/web/src/api/client.ts`, `apps/api/src/routes/fleet.ts` |
| Skills local repo source | API defaults `LOCAL_REPO_PATH` to `process.cwd()` | `apps/api/src/index.ts` |
| SkillOps state flow | page sets state during render and reads stale drift state after `await loadDrift()` | `apps/web/src/pages/SkillOps.tsx`, `apps/web/src/hooks/useSkills.ts` |

### Additional review findings that change the plan

1. `Sync All` is not compatible with the current API.
   `POST /api/fleet/sync` requires a single `skill` in the body, so the current plan cannot just repoint the existing `Sync All` button to that route. This needs a product and API decision.

2. Skill activation cannot safely be modeled as `boolean` only.
   `SkillOps.getSkillStatus()` is tested to propagate connection failures instead of silently returning inactive, so a matrix shaped as `Record<string, boolean>` would hide real host errors.

3. A skills matrix endpoint is not a small route tweak.
   The current `skillsRouter()` is filesystem-only and has no runtime access. A real matrix response requires host config, active-dir knowledge, and `SkillOps`.

4. The earlier validation section assumed scripts that do not currently exist in every package.
   `apps/web/package.json` has no `test` script today, so the plan must treat web tests as new work instead of a guaranteed command.

---

## Recommended decisions

### Decision 1: keep backend write semantics as the source of truth

Adapt the web client to the routes that already exist for:

- tool enable and disable
- host create payloads
- fleet activate, deactivate, pull, and drift

Do not add compatibility routes unless they materially reduce UI complexity.

### Decision 2: add only the backend capabilities the UI genuinely lacks

Add server support for:

- `GET /api/hosts/:name/ping`
- a skills matrix read contract that includes activation state and host-level failures

### Decision 3: normalize raw API payloads at the web client boundary

Add explicit mapping functions in `apps/web/src/api/client.ts` or a sibling helper module so React components consume stable UI-facing shapes instead of raw route payloads.

### Decision 4: treat `Sync All` as an explicit scope decision

Recommended for this pass:

- keep `Pull All`
- keep `Check Drift`
- keep per-cell activate and deactivate
- disable or remove `Sync All` until a batch-sync contract is designed

Alternative:

- add a new backend batch route such as `POST /api/fleet/sync-all`
- define its behavior, error model, and blast radius explicitly before implementation

This plan assumes the recommended option unless product intent changes.

### Decision 5: preserve skill-status errors in the UI contract

Do not map remote failures to `false`.

Preferred UI-facing shape:

```ts
type UISkillHostState =
  | { state: "active" }
  | { state: "inactive" }
  | { state: "error"; error: string };

interface UISkillRow {
  skill: string;
  hosts: Record<string, UISkillHostState>;
}
```

If the current grid UI stays boolean-looking, error cells should still render distinctly and remain inspectable.

### Decision 6: fix `LOCAL_REPO_PATH` defaults in the API without changing unrelated surfaces

For this plan, the target is the web/API app. Update `apps/api/src/index.ts` so the API uses the local skills repo by default, while preserving the `LOCAL_REPO_PATH` override.

---

## Desired end state

After implementation:

- `/tools`, `/skills`, `/hosts`, and `/` render without blank-page crashes
- tools render from normalized API data and use working toggle/edit/delete identifiers
- dashboard drift uses the real route and renders normalized drift results
- hosts can be created with the correct payload shape
- hosts support a working ping action
- skills render from a real activation matrix that preserves host-level failures
- per-cell skill activation and deactivation work
- the unsupported `Sync All` action is either removed, disabled, or replaced by an explicitly designed batch contract
- targeted tests cover the new contract boundary and added API routes
- one final browser smoke session confirms the previously failing flows

---

## Relevant code references

### Frontend

- `apps/web/src/api/client.ts`
- `apps/web/src/hooks/useTools.ts`
- `apps/web/src/hooks/useHosts.ts`
- `apps/web/src/hooks/useSkills.ts`
- `apps/web/src/pages/Dashboard.tsx`
- `apps/web/src/pages/HostManager.tsx`
- `apps/web/src/pages/SkillOps.tsx`
- `apps/web/src/pages/ToolManager.tsx`
- `apps/web/src/components/ToolCard.tsx`
- `apps/web/src/components/SkillMatrix.tsx`

### API

- `apps/api/src/index.ts`
- `apps/api/src/routes/tools.ts`
- `apps/api/src/routes/hosts.ts`
- `apps/api/src/routes/skills.ts`
- `apps/api/src/routes/fleet.ts`
- `apps/api/src/lib/config-writer.js`

### Shared contracts and behaviors

- `packages/tool-registry/src/schema.ts`
- `packages/tool-registry/src/types.ts`
- `packages/skill-ops/src/types.ts`
- `packages/skill-ops/src/live.ts`
- `packages/skill-ops/test/skill-ops.test.ts`

### Existing test infrastructure

- `apps/api/vitest.config.ts`
- `tests/e2e/vitest.config.ts`
- `tests/e2e/parity.test.ts`
- `tests/e2e/sync-workflow.test.ts`

---

## Work plan

## Phase 1 - define the web contract boundary

- [ ] Add explicit raw-to-UI mappers for:
  - [ ] tool definitions
  - [ ] drift reports
  - [ ] host-create request payloads
  - [ ] skills matrix responses
- [ ] Replace direct component assumptions about backend payload structure
- [ ] Guard pages against malformed responses so they fail as controlled UI states instead of render-time crashes
- [ ] Decide whether the normalized types live in `apps/web/src/api/client.ts` or a dedicated `apps/web/src/api/contracts.ts`

### Acceptance criteria

- `ToolCard` no longer depends on raw `schema.params`
- `SkillOps` and `SkillMatrix` no longer assume `skills` is already an array of boolean maps
- drift rendering uses a normalized UI shape, not the raw `SkillOps` report shape

---

## Phase 2 - fix Tools page end-to-end

### Current constraint

The tool registry returns `ToolDefinition` records with `name` and `schema: Record<string, ToolParam>`. The web layer currently treats tools as if they have `id` and `schema.params[]`.

### Tasks

- [ ] Normalize tool payloads from API shape into UI shape
- [ ] Choose one canonical identifier in the web layer:
  - [ ] preferred: keep `name` as the canonical identifier everywhere
  - [ ] acceptable: retain `id` in UI only as `id = name`
- [ ] Update enable and disable calls to use:
  - [ ] `POST /api/tools/:name/enable`
  - [ ] `POST /api/tools/:name/disable`
- [ ] Update edit and delete flows to use the canonical identifier consistently
- [ ] Confirm built-in tools remain non-editable and non-deletable in the UI

### Files likely to change

- `apps/web/src/api/client.ts`
- `apps/web/src/hooks/useTools.ts`
- `apps/web/src/pages/ToolManager.tsx`
- `apps/web/src/components/ToolCard.tsx`

### Acceptance criteria

- `/tools` no longer blank-screens
- parameter counts render correctly for built-in tools
- toggles hit working endpoints and update visible state
- custom tool create, edit, and delete flows still work

---

## Phase 3 - fix Skills page with a real matrix contract

### Current constraint

`GET /api/skills` is currently a local discovery endpoint only. A usable matrix requires:

- local skill discovery
- configured hosts from `fleet.yaml`
- remote activation checks via `SkillOps`
- a way to represent unreachable hosts separately from inactive ones

### Route decision

Preferred:

- replace `GET /api/skills` with a UI-oriented matrix response because the current web app is the only known consumer in this repo

Alternative:

- keep `GET /api/skills` as discovery and add `GET /api/skills/matrix`

Either option is valid, but the decision must be made before implementation because it affects route tests and client wiring.

### Tasks

- [ ] Build a skills read path that combines local skill list, configured hosts, and per-host activation checks
- [ ] Change the matrix contract to preserve errors per host instead of flattening to booleans
- [ ] Update the web client to call the chosen read endpoint
- [ ] Update write calls to:
  - [ ] `POST /api/fleet/activate`
  - [ ] `POST /api/fleet/deactivate`
  - [ ] `POST /api/fleet/pull`
- [ ] Remove, disable, or redesign `Sync All`
- [ ] Fix `SkillOps` drift handling:
  - [ ] stop setting state during render
  - [ ] make `loadDrift()` return the fetched report or consume the hook state through an effect
  - [ ] avoid stale `driftReport` reads after awaiting the action
- [ ] Fix API startup so `LOCAL_REPO_PATH` defaults to the local skills repo instead of `process.cwd()`
- [ ] Keep `LOCAL_REPO_PATH` override support for non-standard setups

### Implementation note

If the matrix route lives in `apps/api/src/routes/skills.ts`, that router will need more than `localRepoPath`; it will need access to runtime-backed services and current host config. Moving the matrix route under `fleetRouter()` is also acceptable if that simplifies wiring.

### Files likely to change

- `apps/api/src/index.ts`
- `apps/api/src/routes/skills.ts`
- `apps/api/src/routes/fleet.ts`
- `apps/web/src/api/client.ts`
- `apps/web/src/hooks/useSkills.ts`
- `apps/web/src/pages/SkillOps.tsx`
- `apps/web/src/components/SkillMatrix.tsx`

### Acceptance criteria

- `/skills` renders a populated matrix or a controlled empty state, never a blank page
- per-host activation errors remain visible as errors, not silent inactive cells
- per-cell activate and deactivate work for a safe test skill
- `Pull All` and `Check Drift` work from the page
- `Sync All` is no longer a broken action

---

## Phase 4 - fix Dashboard drift and Hosts ping

### Dashboard drift

- [ ] Update the web client to use `POST /api/fleet/drift`
- [ ] Normalize the backend drift payload into the UI drift shape
- [ ] Preserve host metadata needed by both `Dashboard.tsx` and `SkillOps.tsx`
- [ ] Verify drift action errors only represent real failures

### Hosts ping

- [ ] Add `GET /api/hosts/:name/ping` to `apps/api/src/routes/hosts.ts`
- [ ] Load the host from config and perform a safe connectivity check
- [ ] Return a stable response shape such as `{ status, latencyMs? }`
- [ ] Return `404` for unknown hosts
- [ ] Surface unreachable hosts as an error result instead of crashing the UI
- [ ] Confirm `useHosts()` and `HostManager.tsx` update visible ping state correctly

### Host create payload

- [ ] Update `createHost()` to send:

```json
{ "name": "...", "config": { ...hostConfigFields } }
```

- [ ] Reconfirm edit and delete flows after the create-path fix

### Files likely to change

- `apps/web/src/api/client.ts`
- `apps/web/src/pages/Dashboard.tsx`
- `apps/web/src/hooks/useHosts.ts`
- `apps/api/src/routes/hosts.ts`

### Acceptance criteria

- Dashboard `Check Drift` no longer 404s
- Hosts `Check status` no longer 404s
- Add Host submit succeeds with valid input
- Edit and Delete Host continue to work

---

## Phase 5 - add regression coverage

## 5A. Web contract tests

- [ ] Add a minimal test setup for `apps/web`
  - [ ] `apps/web/vitest.config.ts`
  - [ ] `apps/web/package.json` test script
- [ ] Add tests for:
  - [ ] tool normalization
  - [ ] drift normalization
  - [ ] skills matrix normalization, including host error cases
  - [ ] host create payload shaping

### Suggested test files

- `apps/web/test/api-contracts.test.ts`
- `apps/web/test/skill-matrix-mappers.test.ts`

## 5B. API route tests

- [ ] Add route tests for:
  - [ ] `GET /api/hosts/:name/ping`
  - [ ] the chosen skills matrix read endpoint
  - [ ] `POST /api/fleet/drift`
- [ ] Add route coverage for any new batch-sync endpoint only if that path is chosen

### Suggested test files

- `apps/api/test/hosts-ping.test.ts`
- `apps/api/test/skills-matrix.test.ts`
- `apps/api/test/fleet-drift-route.test.ts`

## 5C. Existing integration coverage

- [ ] Run the existing E2E workspace tests to ensure CLI and MCP behavior did not regress
- [ ] Add one non-destructive integration test for the corrected web-facing API contract only if current coverage leaves the route untested

### Acceptance criteria

- web mappers are covered by automated tests
- new or changed API routes are covered
- existing E2E tests still pass

---

## Phase 6 - manual confirmation in one browser session

Re-run the browser QA in a single controlled session.

### Manual smoke checklist

- [ ] Dashboard loads without console errors
- [ ] Dashboard `Refresh` updates timestamp
- [ ] Dashboard `Check Drift` succeeds and renders a drift summary
- [ ] Dashboard `Pull All` completes without route-contract failures
- [ ] Tools page renders tool cards instead of a blank screen
- [ ] Toggle a tool and confirm visible state updates
- [ ] Create a temporary custom tool, edit it, then delete it
- [ ] Hosts page renders the table
- [ ] `Check status` updates host ping state
- [ ] Add a temporary host, edit it, then delete it
- [ ] Skills page renders a matrix or controlled empty state
- [ ] Skills page `Check Drift` renders after completion
- [ ] Activate and deactivate a safe known skill on one test host, then restore original state
- [ ] No tested route causes a blank page

### Suggested screenshots

- `.qa-screenshots-fixed/dashboard.png`
- `.qa-screenshots-fixed/tools.png`
- `.qa-screenshots-fixed/hosts.png`
- `.qa-screenshots-fixed/skills.png`
- `.qa-screenshots-fixed/drift-report.png`

---

## Proposed execution order

1. Normalize the web contract boundary first.
2. Fix Tools, Dashboard drift, and Host create because those are straightforward contract mismatches.
3. Implement Hosts ping because the UI already has a concrete action for it.
4. Make the skills route decision and implement the matrix read path.
5. Remove, disable, or redesign `Sync All`.
6. Add regression coverage.
7. Run one browser session for final confirmation.

This order keeps the highest-confidence fixes moving while holding the one ambiguous product/API question in a visible, explicit slot.

---

## Validation commands

Use commands that match the current workspace scripts:

```bash
# repo-wide typecheck and build
npm run typecheck
npm run build

# package-specific validation
npm --workspace @codex-fleet/api test
npm --workspace @codex-fleet/api build
npm --workspace @codex-fleet/web build

# web tests only after adding them in this work
npm --workspace @codex-fleet/web test

# existing e2e workspace
npm --workspace @codex-fleet/e2e test
```

### Useful spot checks

```bash
curl -sS http://localhost:3847/api/tools | python -m json.tool
curl -sS http://localhost:3847/api/skills | python -m json.tool
curl -sS -X POST http://localhost:3847/api/fleet/drift \
  -H 'content-type: application/json' \
  -d '{}' | python -m json.tool
curl -sS http://localhost:3847/api/hosts/shuvtest/ping | python -m json.tool
```

---

## Risks and precautions

- [ ] Avoid destructive skill changes on real hosts except for a known safe test skill and only with cleanup
- [ ] Avoid leaving temporary hosts or tools behind after validation
- [ ] Preserve telemetry behavior for any new route or runtime-backed read path
- [ ] Do not silently convert remote skill-status failures into inactive UI state
- [ ] Keep the final browser confirmation to one controlled session

---

## Definition of done

This work is done when all of the following are true:

- [ ] `/`, `/tools`, `/hosts`, and `/skills` render without blank-page failures
- [ ] dashboard drift works through the real backend route
- [ ] hosts ping works
- [ ] Add Host submit works
- [ ] tools CRUD and toggle flows are aligned with the API contract
- [ ] skills page reads and writes are aligned with the chosen contract
- [ ] host-level skill errors remain visible instead of being flattened away
- [ ] `LOCAL_REPO_PATH` defaults to the actual local skills repo or the app fails loudly with clear configuration guidance
- [ ] automated tests cover the new contract boundary and added routes
- [ ] one final single-session browser QA pass confirms the original failures are fixed

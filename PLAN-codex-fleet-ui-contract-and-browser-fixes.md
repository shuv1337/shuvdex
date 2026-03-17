# Plan: fix codex-fleet UI/API contract issues and confirm via browser QA

## Objective

Resolve the confirmed codex-fleet app functionality issues found during browser testing, add regression coverage, and re-run a controlled browser smoke pass to confirm the app works end-to-end on the default local setup:

- Web: `http://localhost:5173`
- API: `http://localhost:3847`

This plan covers **resolution**, **test coverage**, and **manual confirmation**. It does **not** implement the fixes.

---

## Browser-tested findings to fix

### Confirmed in the browser

| Area | Symptom | Evidence | Likely cause |
|---|---|---|---|
| Tools page | `/tools` renders a blank page | Rodney + browser error: `Cannot read properties of undefined (reading 'length')` in `src/components/ToolCard.tsx:108` | Frontend expects `tool.schema.params[]`; backend returns a schema object map and no `id` |
| Skills page | `/skills` renders a blank page | Rodney + browser error: `skills.flatMap is not a function` in `src/pages/SkillOps.tsx:295` | Frontend expects `SkillActivation[]`; backend returns `{ repoPath, count, skills }` |
| Dashboard drift action | `Check Drift` shows `Not found` | Browser-captured request: `GET /api/fleet/drift` → `404` | Client uses `GET`; server exposes `POST /api/fleet/drift`; response shape also differs |
| Hosts ping action | `Check status` on Hosts page does nothing useful | Browser-captured request: `GET /api/hosts/shuvtest/ping` → `404` | Frontend expects a ping route that does not exist |

### Confirmed by code inspection (not yet exercised successfully in browser because pages fail earlier)

| Area | Issue | Files |
|---|---|---|
| Tool toggles / edits | Frontend uses `id` and `PUT /api/tools/:id/enabled`; backend uses tool `name` and `POST /api/tools/:name/enable` / `disable` | `apps/web/src/api/client.ts`, `apps/api/src/routes/tools.ts` |
| Add Host submit | Frontend sends a flat host object; backend expects `{ name, config }` | `apps/web/src/api/client.ts`, `apps/api/src/routes/hosts.ts` |
| Skills writes | Frontend posts to `/api/skills/activate`, `/deactivate`, `/sync`; backend implements these under `/api/fleet/*` | `apps/web/src/api/client.ts`, `apps/api/src/routes/fleet.ts` |
| Skills repo source | API currently uses local repo path that defaults to `process.cwd()`, which in this app is the `codex-fleet` repo, not the skills repo | `apps/api/src/index.ts`, `apps/api/src/routes/skills.ts` |
| SkillOps drift state | `handleCheckDrift()` sets local state from stale `driftReport`, and the page sets state during render | `apps/web/src/pages/SkillOps.tsx` |

Artifacts already captured:

- `.qa-screenshots/dashboard.png`
- `.qa-screenshots/dashboard-actions.png`
- `.qa-screenshots/tools.png`
- `.qa-screenshots/hosts.png`
- `.qa-screenshots/skills.png`
- `.qa-screenshots/hosts-add-modal.png`
- `.qa-screenshots/hosts-add-empty-submit.png`
- `.qa-screenshots/hosts-check-status.png`
- `.qa-screenshots/hosts-edit-modal.png`

---

## Root-cause summary

The app currently has a **contract mismatch** between the web client and the API layer:

1. **Tools contract mismatch**
   - Backend tool registry returns `ToolDefinition` objects with:
     - `name`
     - `schema: Record<string, ToolParam>`
     - no `id`
   - Frontend expects:
     - `id`
     - `schema.params: ToolParam[]`

2. **Skills contract mismatch**
   - Frontend expects a skill activation matrix (`SkillActivation[]`) keyed by host
   - API returns a local filesystem discovery payload (`{ repoPath, count, skills }`)

3. **HTTP method / route mismatches**
   - Drift: client uses `GET`, server uses `POST`
   - Host ping: client calls missing route
   - Skills writes: client hits `/api/skills/*`, server exposes `/api/fleet/*`
   - Tools enable/disable: client uses `PUT /enabled`, server exposes `POST /enable|disable`

4. **Configuration mismatch**
   - Skills listing currently points at the wrong local directory by default (`codex-fleet` repo root instead of local skills repo)

The recommended fix is to **make the frontend consume the backend’s real contract intentionally**, while adding the few API routes the UI genuinely needs.

---

## Desired end state

After implementation:

- `/tools` renders normally and supports viewing, toggling, creating, editing, and deleting tools
- `/skills` renders a real skill activation matrix for configured hosts
- Dashboard `Check Drift` works and renders a drift report
- Hosts `Check status` works and updates per-host ping state
- Add/Edit/Delete Host flows work correctly
- No page goes blank due to uncaught render-time shape assumptions
- A small regression suite prevents these contract mismatches from reappearing
- A final single-session browser smoke test confirms all previously broken flows now work

---

## Implementation strategy

### Decision 1: Use backend route semantics as the source of truth where they already exist

Prefer adapting the frontend client to the API that already exists for:

- fleet pull / activate / deactivate / sync / drift
- tool enable / disable
- host create payload shape

This minimizes backend churn and keeps the API aligned with existing server behavior.

### Decision 2: Add backend routes only where the UI needs functionality that does not exist

Add server support for:

- `GET /api/hosts/:name/ping`
- a skills read endpoint that returns a real activation matrix usable by the Skills page

### Decision 3: Normalize API responses at the client boundary

Add explicit client-side mapping functions so React components consume stable UI shapes instead of raw backend payloads.

This reduces future blank-screen regressions.

### Decision 4: Fix local skills repo defaults

Ensure the API reads from the local skills repository by default (or loudly requires configuration), rather than silently using the `codex-fleet` repo root.

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

### Shared/package contracts

- `packages/tool-registry/src/schema.ts`
- `packages/tool-registry/src/types.ts`
- `packages/skill-ops/src/types.ts`
- `packages/skill-ops/src/live.ts`
- `packages/core/src/*`

### Existing test infrastructure

- `apps/api/vitest.config.ts`
- `tests/e2e/vitest.config.ts`
- `tests/e2e/parity.test.ts`
- `tests/e2e/sync-workflow.test.ts`

---

## Work plan

## Phase 1 — lock down the intended UI contracts

- [ ] Define the canonical UI-facing shapes in `apps/web/src/api/client.ts` (or extracted helper module) for:
  - [ ] `UITool`
  - [ ] `UISkillActivation`
  - [ ] `UIDriftReport`
  - [ ] `UIHostPingResult`
- [ ] Add pure mapping helpers that convert backend responses into UI shapes:
  - [ ] tool registry response → `UITool`
  - [ ] fleet drift response → `UIDriftReport`
  - [ ] skills activation matrix response → `UISkillActivation[]`
- [ ] Remove direct component assumptions about raw backend payloads where possible
- [ ] Add defensive guards so malformed data produces inline errors/empty states instead of full blank-page crashes

### Acceptance criteria

- Components no longer directly assume `schema.params` or `skills.flatMap(...)` without validated data
- Shape mismatches surface as controlled UI errors rather than runtime render crashes

---

## Phase 2 — fix Tools page end-to-end

### Problem to solve

Current backend tool payload looks like:

```json
{
  "name": "fleet_status",
  "description": "...",
  "enabled": true,
  "builtIn": true,
  "category": "fleet",
  "schema": {
    "hosts": { "type": "array", "optional": true }
  }
}
```

Current frontend expects:

```ts
{
  id: string;
  schema: { params: ToolParam[] };
}
```

### Tasks

- [ ] Update the web client to map backend tool definitions into the UI tool shape
  - [ ] decide whether `id` should be removed from the frontend model entirely, or mapped from `name`
  - [ ] convert `schema: Record<string, ToolParam>` into `schema.params: ToolParam[]`
- [ ] Update tool enable/disable calls in `apps/web/src/api/client.ts`
  - [ ] replace `PUT /api/tools/:id/enabled` with backend-compatible `POST /api/tools/:name/enable` and `POST /api/tools/:name/disable`
- [ ] Update tool edit/delete code paths to use the canonical identifier (`name`, or mapped `id=name` consistently)
- [ ] Re-test ToolManager page behaviors:
  - [ ] render list
  - [ ] open detail panel
  - [ ] toggle enabled state
  - [ ] create custom tool
  - [ ] edit custom tool
  - [ ] delete custom tool
- [ ] Ensure built-in tools remain protected from edit/delete in the UI

### Files likely to change

- `apps/web/src/api/client.ts`
- `apps/web/src/hooks/useTools.ts`
- `apps/web/src/pages/ToolManager.tsx`
- `apps/web/src/components/ToolCard.tsx`
- optionally `apps/api/src/routes/tools.ts` only if a thin compatibility route is preferred instead of client adaptation

### Acceptance criteria

- `/tools` no longer blank-screens
- Built-in tools render correct parameter counts
- Toggle requests hit working endpoints and visually update state
- Create/edit/delete custom tool flows work

---

## Phase 3 — fix Skills page end-to-end

### Problem to solve

The Skills page expects an activation matrix, but the API returns a local directory scan. In addition, write operations are posted to the wrong route family, and the API currently points at the wrong local repo path by default.

### Tasks

- [ ] Decide the canonical read contract for the Skills page:
  - [ ] preferred: make `GET /api/skills` return `SkillActivation[]`
  - [ ] alternative: add a dedicated endpoint such as `GET /api/skills/matrix` and update the client
- [ ] Implement backend generation of a skill activation matrix by combining:
  - [ ] local skill list from the local skills repo
  - [ ] configured hosts from `fleet.yaml`
  - [ ] per-host activation status via `SkillOps.getSkillStatus(...)`
- [ ] Normalize matrix rows to the current frontend shape:

```ts
{
  skill: string;
  hosts: Record<string, boolean>;
}
```

- [ ] Update frontend write calls to use existing fleet routes:
  - [ ] activate → `POST /api/fleet/activate`
  - [ ] deactivate → `POST /api/fleet/deactivate`
  - [ ] sync → `POST /api/fleet/sync`
  - [ ] pull may continue to use `POST /api/fleet/pull`
- [ ] Fix drift loading in the Skills page:
  - [ ] remove state-setting during render
  - [ ] avoid stale `driftReport` reads after `await loadDrift()`
  - [ ] use a proper effect or return the report from the hook action
- [ ] Decide what to do with the old discovery payload:
  - [ ] remove/replace it if unused
  - [ ] or move it to another route such as `/api/skills/discovered`

### Local repo path tasks

- [ ] Change API startup/config so the local skills repo default points to the actual local skills repository (likely `~/repos/shuvbot-skills`) instead of `process.cwd()`
- [ ] Keep `LOCAL_REPO_PATH` override support for non-standard setups
- [ ] Update any startup docs/scripts so local dev uses the right repo without manual intervention

### Files likely to change

- `apps/api/src/index.ts`
- `apps/api/src/routes/skills.ts`
- `apps/api/src/routes/fleet.ts`
- `apps/web/src/api/client.ts`
- `apps/web/src/hooks/useSkills.ts`
- `apps/web/src/pages/SkillOps.tsx`
- `apps/web/src/components/SkillMatrix.tsx`

### Acceptance criteria

- `/skills` renders a populated matrix or a valid empty state (never a blank page)
- Bulk actions (Pull All, Sync All, Check Drift) work against real endpoints
- Per-cell activate/deactivate works for a safe test skill
- Drift report renders after the action completes

---

## Phase 4 — fix Dashboard drift and Hosts ping flows

### Dashboard drift

- [ ] Update `fetchDriftReport()` in `apps/web/src/api/client.ts` to use `POST /api/fleet/drift`
- [ ] Normalize backend drift payload to the UI drift shape
  - backend currently returns fields like `referenceSha`, `host`, `sha`, `in_sync`
  - UI expects `referenceHead`, `name`, `head`, `in-sync` / `drifted` / `error`
- [ ] Verify dashboard drift panel renders correctly after normalization
- [ ] Confirm action errors are only shown for real failures, not contract mismatches

### Hosts ping

- [ ] Add `GET /api/hosts/:name/ping` to `apps/api/src/routes/hosts.ts`
  - [ ] load the host from config
  - [ ] execute a safe connectivity check (`echo ok` or equivalent via `SshExecutor`)
  - [ ] return a stable response shape: `{ status, latencyMs? }`
  - [ ] return `404` for unknown hosts
  - [ ] return `error` status for unreachable hosts without crashing the UI
- [ ] Ensure HostManager action buttons update visible ping state correctly

### Host create payload

- [ ] Update `createHost()` in `apps/web/src/api/client.ts` to send the backend-expected shape:

```json
{ "name": "...", "config": { ...hostConfigFields } }
```

- [ ] Reconfirm edit/delete flows after the create-path fix

### Files likely to change

- `apps/web/src/api/client.ts`
- `apps/web/src/pages/Dashboard.tsx`
- `apps/web/src/hooks/useHosts.ts`
- `apps/api/src/routes/hosts.ts`
- possibly `apps/api/src/routes/fleet.ts` if drift response normalization is moved server-side

### Acceptance criteria

- Dashboard `Check Drift` no longer 404s
- Hosts `Check status` no longer 404s
- Add Host submit succeeds with valid input
- Edit/Delete Host continue to work

---

## Phase 5 — add regression coverage

## 5A. Frontend contract tests (recommended)

Add lightweight web tests for pure data mapping logic so UI regressions are caught before manual QA.

- [ ] Add a minimal test setup for `apps/web` if needed
  - [ ] `apps/web/vitest.config.ts`
  - [ ] `apps/web/package.json` test script
- [ ] Add pure tests for:
  - [ ] tool response normalization
  - [ ] drift response normalization
  - [ ] skills matrix normalization
  - [ ] host create payload shaping

### Suggested test file(s)

- `apps/web/test/api-client-mappers.test.ts`
- `apps/web/test/api-client-contracts.test.ts`

## 5B. API route tests

- [ ] Add route tests under `apps/api/test/**/*.test.ts` for:
  - [ ] `GET /api/hosts/:name/ping`
  - [ ] skills matrix read endpoint
  - [ ] `POST /api/fleet/drift` response shape
  - [ ] tools list route shape expectations if server-side normalization is added

### Suggested test file(s)

- `apps/api/test/hosts-ping.test.ts`
- `apps/api/test/skills-matrix.test.ts`
- `apps/api/test/fleet-drift-route.test.ts`

## 5C. Existing end-to-end suite

- [ ] Run the existing repo E2E suites to ensure nothing regressed in the CLI/MCP layers:

```bash
npm --workspace tests/e2e test
```

- [ ] If needed, add one new non-destructive E2E/API-level test that covers the corrected route contract(s)

### Acceptance criteria

- Contract transforms are covered by automated tests
- Newly added API routes are covered
- Existing E2E suites still pass

---

## Phase 6 — manual confirmation in a single browser session

Re-run the browser QA using **one single session only**.

### Manual smoke checklist

- [ ] Dashboard loads without errors
- [ ] Dashboard `Refresh` updates timestamp
- [ ] Dashboard `Check Drift` succeeds and renders a drift report
- [ ] Dashboard `Pull All` completes without route/contract errors
- [ ] Tools page renders tool cards instead of a blank screen
- [ ] Toggle a built-in tool off/on (or confirm built-ins are intentionally immutable, depending on product intent)
- [ ] Create a temporary custom tool, edit it, then delete it
- [ ] Hosts page renders table
- [ ] `Check status` updates host ping state
- [ ] Add a temporary host entry, edit it, then delete it
- [ ] Skills page renders the activation matrix or valid empty state
- [ ] Run `Check Drift` from Skills page
- [ ] For a safe known skill (for example `adapt`, already used in existing E2E tests), activate and deactivate on one test host, then return the system to its original state
- [ ] No route causes a blank page
- [ ] No console/runtime errors occur during the tested flows

### Suggested browser confirmation artifacts

Save fresh screenshots after fixes to replace/compare against the failing set:

- `.qa-screenshots-fixed/dashboard.png`
- `.qa-screenshots-fixed/tools.png`
- `.qa-screenshots-fixed/hosts.png`
- `.qa-screenshots-fixed/skills.png`
- `.qa-screenshots-fixed/drift-report.png`

---

## Proposed execution order

1. **Fix client/API contract mismatches first**
   - tools, hosts create, drift route, skills write routes
2. **Implement missing backend capabilities**
   - host ping
   - skills activation-matrix read path
3. **Fix repo path defaults**
   - so skills data is sourced from the correct repository
4. **Stabilize UI state handling**
   - especially Skills page drift state logic
5. **Add regression tests**
6. **Run one browser session for final confirmation**

This order keeps debugging linear: first remove obvious contract errors, then add missing data, then validate behavior.

---

## Validation commands

Use these as the execution checklist once implementation begins:

```bash
# typecheck / build
npm run typecheck
npm --workspace @codex-fleet/web build
npm --workspace @codex-fleet/api build

# api tests
npm --workspace @codex-fleet/api test

# web tests (if added)
npm --workspace @codex-fleet/web test

# existing e2e suite
npm --workspace tests/e2e test
```

### Useful spot checks

```bash
curl -sS http://localhost:3847/api/tools | python -m json.tool
curl -sS http://localhost:3847/api/skills | python -m json.tool
curl -sS -X POST http://localhost:3847/api/fleet/drift -H 'content-type: application/json' -d '{}' | python -m json.tool
curl -sS http://localhost:3847/api/hosts/shuvtest/ping | python -m json.tool
```

---

## Risks and precautions

- [ ] **Avoid destructive skill changes on real hosts** except for a known safe test skill and only with cleanup
- [ ] **Avoid leaving temporary hosts/tools behind** after validation
- [ ] **Preserve telemetry behavior** for new routes and major operations per project standard
- [ ] **Do not open multiple browser sessions/windows** during confirmation; keep to one controlled session

---

## Definition of done

This work is done when all of the following are true:

- [ ] `/tools`, `/hosts`, `/skills`, and `/` all render without blank-page failures
- [ ] Dashboard drift works
- [ ] Hosts ping works
- [ ] Add Host submit works
- [ ] Tools CRUD/toggle flows are aligned with the API contract
- [ ] Skills page reads/writes are aligned with the API contract
- [ ] Correct local skills repo path is used by default (or required explicitly and documented)
- [ ] Automated tests cover the new contract/route behavior
- [ ] A final single-session browser QA pass confirms the original issues are fixed

---

## Notes for implementation

If scope needs to be reduced, prioritize in this order:

1. Fix blank pages (`/tools`, `/skills`)
2. Fix broken buttons (`Check Drift`, `Check status`)
3. Fix create/toggle/write flows
4. Add regression tests
5. Tighten config defaults/docs

If scope can expand slightly, consider extracting shared DTO/normalization types into a small internal package so the API/client contract is explicit and versionable.

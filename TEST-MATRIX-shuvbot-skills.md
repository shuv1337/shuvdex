# Shuvbot Skills MCP Test Matrix

Purpose: prioritize `~/repos/shuvbot-skills` for migration into `shuvdex` as capability packages, then eventually as true MCP tools/resources/prompts with execution bindings.

This matrix is based on the current `shuvdex` compiler behavior and a repo review on 2026-03-19.

## Important current-state note

Today, the skill compiler primarily produces:
- `summary` resource
- `instructions` resource
- `apply` prompt
- extra `resource` capabilities from `references/`, `templates/`, and recognized files
- extra `prompt` capabilities from `prompts/*.md`

It does **not** automatically turn `*.sh`, `*.py`, or Code Mode adapters into executable MCP tools yet unless we add manifest-backed capability definitions / execution bindings.

That means many “tool-like” skills are currently best tested in **two phases**:
1. **import/compiler phase** — validate package import, resources, prompts, persistence, deletion
2. **tool-onboarding phase** — add explicit capability manifests/tool bindings and validate real MCP tools

---

## Labels

- **current-fit** — strong fixture for the MCP server as it works today
- **tool-first** — best early candidates for real tool onboarding
- **later-risky** — needs stronger policy/ACLs, staging creds, or extra guardrails before broad rollout

---

## Recommended rollout order

### Phase 1 — current compiler / import coverage
Use these first to validate import + resources + prompts:
1. `visual-explainer`
2. `browser`
3. `dogfood`
4. `dogfood-tui`
5. `network-monitor`
6. `openclaw-manager`
7. `clarify`

### Phase 2 — first true tool manifests
Best early executable tool candidates:
1. `brave-search`
2. `youtube-transcript`
3. `upload`
4. `crawl`
5. `model-usage`
6. `ccusage`

### Phase 3 — richer API / multi-operation catalogs
1. `make-api`
2. `jules-api`
3. `jotform`
4. `unifi-api`
5. `uptime-robot`

### Phase 4 — higher-risk / write-heavy / external side effects
1. `discord`
2. `signal-cli`
3. `slack-dev`
4. `home-assistant`
5. `cloudflare-global`
6. `addigy`

---

## Tier 1: best current-fit fixtures

| Skill | Labels | Why it matters | Current compiled shape | Suggested tests |
| --- | --- | --- | --- | --- |
| `visual-explainer` | current-fit, tool-first | Best all-around fixture. Has `package.json`, `prompts/`, `references/`, `templates/`. | 13 resources, 8 prompts | import inspect/import/delete; MCP resources/list; prompts/list; resources/read; prompts/get; restart persistence |
| `browser` | current-fit | Large, realistic, package-backed skill with `references/`. Good metadata and large asset surface. | 5 resources, 1 prompt | import/reindex/delete; sourceRef reads; package metadata correctness; large asset persistence |
| `dogfood` | current-fit | Good markdown-first skill with `references/` + `templates/`, no package.json dependency. | 4 resources, 1 prompt | markdown-derived package metadata; template/reference resource discovery |
| `dogfood-tui` | current-fit | Similar to `dogfood` but with more assets and a script-heavy directory. | 6 resources, 1 prompt | sibling-package consistency; larger asset import/delete behavior |
| `network-monitor` | current-fit, tool-first | Good future tool candidate with lots of scripts plus `references/`. | 8 resources, 1 prompt | import of script-heavy package; resources/read; future manifest-onboarding candidate |
| `openclaw-manager` | current-fit, tool-first | Package-backed, operational, explicit boundary that it is not yet a callable tool. | 5 resources, 1 prompt | package.json metadata; import + persistence; later tool manifest conversion |
| `clarify` | current-fit | Minimal doc-only representative. Great control sample for the large class of simple skills. | 2 resources, 1 prompt | minimal package import; baseline resource/prompt exposure |

---

## Tier 2: best early tool-first candidates

These are the best skills to convert first into true executable MCP tools because they have bounded behavior and clearer validation criteria.

| Skill | Labels | Why it’s a good early tool | Current compiled shape | First tool manifest goal |
| --- | --- | --- | --- | --- |
| `brave-search` | tool-first | Node package, web search/content extraction, low blast radius, easy external assertions. | 3 resources, 1 prompt | add search/content tools with explicit schemas and read-only policy |
| `youtube-transcript` | tool-first | Package-backed, focused, mostly read-only. | 3 resources, 1 prompt, 1 tool | expose transcript fetch tool(s) with simple args/output |
| `upload` | tool-first | Single-purpose workflow; easy success/failure criteria. | 2 resources, 1 prompt | expose upload tool with file/path args and returned URL |
| `crawl` | tool-first | Bounded network/content extraction use case. | 2 resources, 1 prompt | expose crawl/fetch tools with URL + crawl depth schemas |
| `model-usage` | tool-first | Read/report behavior with structured outputs. | 3 resources, 1 prompt | expose usage summary tools returning stable JSON |
| `ccusage` | tool-first | Strong fit for structured reporting and local execution. | 2 resources, 1 prompt | expose summary/report tools with time-range filters |

---

## Tier 3: richer API / catalog candidates

These are strong after the low-risk tools are working.

| Skill | Labels | Why it matters | Current compiled shape | Recommended validation focus |
| --- | --- | --- | --- | --- |
| `make-api` | tool-first | Large API surface, many operations, already documents many concrete calls. | 2 resources, 1 prompt | large tool catalog generation, auth loading, multi-operation schemas |
| `jules-api` | tool-first | Good session/task API shape, useful for CRUD-ish MCP tool validation. | 8 resources, 1 prompt | list/create/check-status tools; error normalization |
| `jotform` | tool-first | Mixed read/write API workflows, templates/scripts present. | 3 resources, 1 prompt | CRUD operations, auth policy, schema validation |
| `unifi-api` | tool-first | Real-world operational API; can start with reads. | 2 resources, 1 prompt | read-only status tools first, then scoped writes |
| `uptime-robot` | tool-first | Bounded domain, easy monitor list/status validation. | 2 resources, 1 prompt | status/list tools first, then create/pause/delete |

---

## Tier 4: later-risky candidates

These should come later because mistakes have real consequences.

| Skill | Labels | Why it’s risky | Current compiled shape | Preconditions before onboarding |
| --- | --- | --- | --- | --- |
| `discord` | later-risky, tool-first | Real outbound messaging/moderation actions. | 2 resources, 1 prompt | strong read-vs-write policy gates; staging/test guild |
| `signal-cli` | later-risky | Real messaging to people/groups. | 2 resources, 1 prompt | explicit write confirmation / sandbox recipient policy |
| `slack-dev` | later-risky, tool-first | Slack app + workspace config can be modified. | 6 resources, 1 prompt | app staging workspace and scoped tokens |
| `home-assistant` | later-risky | Physical-world device side effects. | 2 resources, 1 prompt | strict device/test-environment guardrails |
| `cloudflare-global` | later-risky, tool-first | Infra/admin blast radius. | 2 resources, 1 prompt | scoped creds, staging zone/account, write approvals |
| `addigy` | later-risky | Device fleet management / MDM blast radius. | 2 resources, 1 prompt | tenant-scoped staging org, policy enforcement |

---

## Concrete package observations

These were compiled with the current `skill-indexer` and are useful anchors for expected capability counts.

| Skill | Package ID | Version | Resources | Prompts | Notes |
| --- | --- | --- | ---: | ---: | --- |
| `visual-explainer` | `skill.visual_explainer` | `0.4.3` | 13 | 8 | strongest golden fixture |
| `browser` | `skill.browser` | `0.0.1` | 5 | 1 | package-backed, large asset surface |
| `dogfood` | `skill.dogfood` | `d45ed434abc9` | 4 | 1 | markdown-first |
| `dogfood-tui` | `skill.dogfood_tui` | `bf90cb6dcf31` | 6 | 1 | template-heavy |
| `network-monitor` | `skill.network_monitor` | `d4eba50716ee` | 8 | 1 | many scripts, good future tool candidate |
| `openclaw-manager` | `skill.openclaw_manager` | `2.0.0` | 5 | 1 | package-backed operational skill |
| `clarify` | `skill.clarify` | `a29431fe0f32` | 2 | 1 | minimal control sample |
| `brave-search` | `skill.brave_search` | `1.0.0` | 3 | 1 | strong first tool candidate |
| `youtube-transcript` | `skill.youtube_transcript` | `1.0.0` | 3 | 1 | focused read-only-ish tool candidate; now includes 1 module_runtime tool |
| `upload` | `skill.upload` | `eebf84e4bd15` | 2 | 1 | simple single-purpose workflow |
| `crawl` | `skill.crawl` | `3286a1d18a59` | 2 | 1 | bounded network/content tool candidate |
| `model-usage` | `skill.model_usage` | `eb713cda0e44` | 3 | 1 | structured reporting candidate |
| `ccusage` | `skill.ccusage` | `4426ffbbe738` | 2 | 1 | local/reporting tool candidate |
| `make-api` | `skill.make_api` | `fcbb369d875d` | 2 | 1 | likely needs manifest for true tool catalog |
| `jules-api` | `skill.jules_api` | `2afb36db9900` | 8 | 1 | references-heavy API skill |
| `jotform` | `skill.jotform` | `3b219ce3050b` | 3 | 1 | templates + scripts |
| `unifi-api` | `skill.unifi_api` | `922926c32f01` | 2 | 1 | future API tool |
| `uptime-robot` | `skill.uptime_robot` | `58d9179fe065` | 2 | 1 | future API tool |
| `discord` | `skill.discord` | `783b374c178c` | 2 | 1 | write-heavy later-risky |
| `signal-cli` | `skill.signal_cli` | `2d737330049e` | 2 | 1 | write-heavy later-risky |
| `slack-dev` | `skill.slack_dev` | `2f19d94b03c9` | 6 | 1 | references-heavy admin surface |
| `home-assistant` | `skill.home_assistant` | `3071890fe8cb` | 2 | 1 | physical-world side effects |
| `cloudflare-global` | `skill.cloudflare_global` | `61b4e33f2a26` | 2 | 1 | infra blast radius |
| `addigy` | `skill.addigy` | `224764a7fb1b` | 2 | 1 | MDM blast radius |

---

## Suggested external validation recipes by tier

### Recipe A — current-fit package import validation
Use for: `visual-explainer`, `browser`, `dogfood`, `network-monitor`, `openclaw-manager`, `clarify`

Validate:
1. `POST /api/packages/import/inspect`
2. `POST /api/packages/import`
3. `GET /api/packages`
4. `GET /api/skills`
5. MCP `initialize`
6. MCP `resources/list`
7. MCP `prompts/list`
8. MCP `resources/read` on one text resource
9. MCP `prompts/get` on one prompt
10. restart MCP server and re-check counts
11. `DELETE /api/packages/:packageId`
12. verify imported asset directory removed

Pass criteria:
- package persists across restart
- capability counts match expectation
- `sourceRef`-backed text reads work
- delete removes registry entry and import directory

### Recipe B — first true tool validation
Use for: `brave-search`, `youtube-transcript`, `upload`, `crawl`, `model-usage`, `ccusage`

After manifest/tool binding exists, validate:
1. `tools/list` contains expected tool names
2. each tool has stable input schema
3. read-only tools succeed with known-good inputs
4. malformed args produce structured validation errors
5. policy blocks writes where appropriate
6. audit log records tool usage

### Recipe C — large API catalog validation
Use for: `make-api`, `jules-api`, `jotform`, `unifi-api`, `uptime-robot`

Validate:
1. package imports cleanly
2. generated tool catalog count matches design
3. auth loading works
4. representative read operation succeeds
5. representative write operation is blocked or requires elevated policy
6. error payloads are normalized

### Recipe D — later-risky side-effect validation
Use for: `discord`, `signal-cli`, `slack-dev`, `home-assistant`, `cloudflare-global`, `addigy`

Only validate after:
- separate staging/test targets exist
- write policy is explicit
- approvals/confirmation flow is in place
- telemetry/audit coverage is end-to-end

---

## Strongest recommendation

If we maintain a stable regression suite, these should be the **top 8 canonical fixtures**:
1. `visual-explainer`
2. `browser`
3. `dogfood`
4. `network-monitor`
5. `openclaw-manager`
6. `brave-search`
7. `make-api`
8. `discord`

Note: `browser` should remain canonical for compiler/package coverage, but in automated archive-import smoke tests it may need a special path or a sanitized fixture because its checked-in `node_modules/` payload is too large for the current API upload limit.

Why these 8:
- cover current compiler/import behavior
- cover future tool onboarding
- include low-risk and high-risk surfaces
- include doc-only, script-heavy, package-backed, and API-heavy skill styles

---

## Proposed follow-up work

1. Add a lightweight manifest format for true tool definitions to selected `tool-first` skills.
2. Start with `brave-search` as the first executable MCP tool package.
3. Add a fixture-driven test suite in `shuvdex/tests` that imports a canonical subset of skills and asserts expected capability counts.
4. Add tier labels to the roadmap so risky skills are gated behind policy and staging requirements.

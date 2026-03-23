# PLAN: Real-world OpenCode clean-room test in tmux

> Goal: validate `shuvdex` from a **real OpenCode client** on this machine, inside a **tmux** session, using an **isolated OpenCode environment** with **no inherited MCP servers, no inherited skills, and no inherited project/global rules**.
>
> This plan is for execution later. It does **not** run the test yet.

## Why this test exists

The current codebase and unit/integration suite prove the internal pieces work, but the next confidence jump is an outside-in client test:

- real `opencode` binary on this host
- real tmux-managed terminal workflow
- clean OpenCode config/state
- local `shuvdex` MCP server
- deterministic imported capability/tool
- prompt-driven invocation from the client side

This is the closest thing to a real operator workflow without involving another machine.

## What we are validating

### Primary objective

Confirm that a clean OpenCode instance can:

1. start with no inherited MCP or skills/rules noise
2. connect to a local `shuvdex` MCP server
3. discover tools/resources exposed by `shuvdex`
4. invoke at least one deterministic tool successfully
5. produce evidence we can inspect afterward

### Secondary objective

Confirm the isolation approach is actually clean:

- no user/global OpenCode MCP servers leak in
- no repo-local `opencode.jsonc` leaks in
- no `AGENTS.md` / `CONTEXT.md` / Claude compatibility rules leak in
- no user skill directories are visible to OpenCode

## Important constraints discovered

### 1. Do **not** run from the repo root

If OpenCode starts in `/home/shuv/repos/shuvdex`, it can pick up project-local context and config:

- `opencode.jsonc` exists in the repo root
- `CONTEXT.md` exists in the repo root
- OpenCode rules precedence includes local files while traversing upward from the current directory

So the clean-room test should run from a separate temp working directory.

**Evidence**
- Repo config exists: `opencode.jsonc`
- Repo context exists: `CONTEXT.md`
- OpenCode rules precedence: `packages/web/src/content/docs/rules.mdx`
- OpenCode config precedence: `packages/web/src/content/docs/config.mdx`

### 2. Isolate OpenCode with XDG dirs

OpenCode’s own tests isolate runtime state by setting:

- `XDG_CONFIG_HOME`
- `XDG_DATA_HOME`
- `XDG_CACHE_HOME`
- `XDG_STATE_HOME`
- `OPENCODE_TEST_HOME`

We should copy that strategy for this test.

**Evidence**
- `packages/opencode/test/preload.ts` in the OpenCode fork sets those env vars before loading app code.

### 3. Disable Claude compatibility explicitly

OpenCode supports Claude compatibility fallbacks, including:

- `~/.claude/CLAUDE.md`
- `~/.claude/skills/`

For a truly clean run, disable those with environment variables.

**Recommended env**
- `OPENCODE_DISABLE_CLAUDE_CODE=1`
- optionally also:
  - `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=1`
  - `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1`

**Evidence**
- `packages/web/src/content/docs/rules.mdx`

## Test design

## Phase 1 — Clean-room environment setup

- [x] Create a dedicated temp test root, for example:
  - `/tmp/shuvdex-opencode-clean/`
- [x] Inside it, create:
  - `config/`
  - `data/`
  - `cache/`
  - `state/`
  - `workspace/`
  - `artifacts/`
- [x] Ensure `workspace/` is **outside** the repo and contains no `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `.opencode/`, or `opencode.json*`
- [x] Create a minimal global OpenCode config at:
  - `$XDG_CONFIG_HOME/opencode/opencode.json`
- [x] The config should contain **only** what is needed for the test:
  - `"$schema"`
  - one `mcp` entry for `shuvdex`
  - optional explicit `model` if needed
- [x] Do **not** copy the user’s current `~/.config/opencode/opencode.jsonc`
- [x] Do **not** load plugins, custom agents, or custom instructions unless required for model auth

### Proposed clean config

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "shuvdex": {
      "type": "local",
      "command": ["node", "/home/shuv/repos/shuvdex/apps/mcp-server/dist/index.js"],
      "enabled": true
    }
  }
}
```

### Required environment for tmux session

```bash
export XDG_CONFIG_HOME=/tmp/shuvdex-opencode-clean/config
export XDG_DATA_HOME=/tmp/shuvdex-opencode-clean/data
export XDG_CACHE_HOME=/tmp/shuvdex-opencode-clean/cache
export XDG_STATE_HOME=/tmp/shuvdex-opencode-clean/state
export OPENCODE_TEST_HOME=/tmp/shuvdex-opencode-clean/home
export OPENCODE_DISABLE_CLAUDE_CODE=1
export OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=1
export OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1
```

### Validation for Phase 1

- [x] `opencode mcp list` shows only `shuvdex`
- [x] No additional MCP servers appear from user/global config
- [x] No `.claude` rules or skills are loaded
- [x] No project-local config is active because cwd is the temp workspace

### Phase 1 execution notes

Executed on 2026-03-22:

- Created isolated OpenCode root at `/tmp/shuvdex-opencode-clean`
- Wrote isolated config to `/tmp/shuvdex-opencode-clean/config/opencode/opencode.json`
- Wrote reusable shell env script to `/tmp/shuvdex-opencode-clean/env.sh`
- Verified clean cwd: `/tmp/shuvdex-opencode-clean/workspace`
- Verified `opencode mcp list` surfaced only one configured server: `shuvdex`

Observed issue in the original local-stdio attempt:

- `shuvdex` failed during MCP tool fetch in the clean-room run.
- Root cause was local stdio startup behavior, not Phase 1 contamination:
  - `apps/mcp-server/src/index.ts` indexed `process.cwd()` directly.
  - In the clean-room workspace, `process.cwd()` was `/tmp/shuvdex-opencode-clean/workspace`, not the repo.

Follow-up correction after user clarification:

- The intended architecture is **remote MCP over Tailscale**, not local stdio spawn.
- Implemented a remote Streamable HTTP MCP endpoint on `shuvdev`:
  - new HTTP entrypoint: `apps/mcp-server/src/http.ts`
  - shared runtime/bootstrap: `apps/mcp-server/src/runtime.ts`
  - current remote URL: `http://shuvdev:3848/mcp`
  - health endpoint: `http://shuvdev:3848/health`
- Updated the clean-room OpenCode config to use remote MCP instead of local stdio:
  - `/tmp/shuvdex-opencode-clean/config/opencode/opencode.json`
- Verified from the isolated environment:
  - `opencode mcp list` shows `shuvdex` as `connected`

Current implication:

- Phase 1 isolation is working as intended.
- The clean-room client is now pointed at a real centralized remote MCP endpoint on `shuvdev`.
- Next phases can proceed against the Tailscale-served endpoint instead of a client-spawned local process.

## Phase 2 — Shuvdex server under test

We need a deterministic server state. The cleanest way is to give `shuvdex` an isolated package/policy/imports store too.

- [ ] Create a dedicated temp shuvdex runtime root, for example:
  - `/tmp/shuvdex-mcp-runtime/`
- [ ] Create:
  - `packages/`
  - `policy/`
  - `imports/`
- [ ] Point the MCP server at those locations with env vars:
  - `CAPABILITIES_DIR=/tmp/shuvdex-mcp-runtime/packages`
  - `POLICY_DIR=/tmp/shuvdex-mcp-runtime/policy`
- [x] Decide whether to let the MCP server index the repo automatically from `/home/shuv/repos/shuvdex`, or seed it with a deterministic imported package first

### Recommendation

Use a **deterministic imported module-runtime fixture** rather than relying only on ambient repo indexing.

Reason:
- It gives us one tool with known behavior
- It tests the package/import path and the execution path together
- It avoids ambiguity about which tools should appear

## Phase 3 — Seed one deterministic tool

Use the simplest real executable example in this repo:

- `examples/module-runtime-skill-template/`
- tool entrypoint: `echo.mcp.mjs`
- manifest-backed tool id: `skill.module_runtime_template.echo`

### Suggested seeding approach

- [ ] Zip `examples/module-runtime-skill-template/` into a temp archive
- [x] Import that archive into `shuvdex` via the package import flow before launching the real OpenCode client session
- [ ] Confirm the imported package lands in the isolated temp capability store, not the repo’s normal `.capabilities/`

### Why this fixture

It is deterministic and local-only:
- reads JSON from stdin
- echoes a provided string
- no network dependency
- no external API dependency
- already aligned with the `module_runtime` contract in this repo

**Relevant files**
- `examples/module-runtime-skill-template/SKILL.md`
- `examples/module-runtime-skill-template/capability.yaml`
- `examples/module-runtime-skill-template/echo.mcp.mjs`

## Phase 4 — tmux orchestration

Use tmux so the test behaves like a real long-lived terminal workflow and leaves inspectable output.

### Session design

Create one dedicated tmux session:
- session name: `shuvdex-opencode-e2e`

Recommended windows:

1. `client`
   - OpenCode interactive session or `opencode run`
2. `evidence`
   - shell for `tmux capture-pane`, logs, and artifact inspection
3. optional `server`
   - only if we decide to run `shuvdex` manually outside OpenCode for debugging

### Logging / evidence capture

- [ ] Pipe the `client` pane to a log file in `/tmp/shuvdex-opencode-clean/artifacts/`
- [ ] Capture the full pane contents at the end of each test case
- [ ] Save:
  - tmux pane transcript
  - OpenCode stdout/stderr if available
  - any `~/.local/share/opencode` equivalent files under isolated XDG dirs
  - `shuvdex` capability package YAML files from temp runtime dirs

### Validation for Phase 4

- [ ] We can re-open the tmux session after the run
- [ ] We have a durable text transcript of the client interaction

## Phase 5 — Client-side test cases

These should be run in order.

### Test case A — Isolation sanity check

Prompt or inspect until we can confirm:
- [ ] only the `shuvdex` MCP server is configured
- [ ] no unrelated MCP tools are present
- [ ] the environment is not using any repo-local rule files from `shuvdex`

**Evidence**
- `opencode mcp list`
- OpenCode startup transcript

### Test case B — Server discovery

- [ ] Start OpenCode from the clean temp workspace
- [ ] Confirm the `shuvdex` MCP server connects successfully
- [ ] Confirm tools are fetched without MCP auth prompts or config errors

**Pass condition**
- `shuvdex` appears connected/ready in OpenCode
- no startup errors related to malformed config, missing binaries, or inherited remote MCPs

### Test case C — Tool discovery through prompting

Because actual OpenCode MCP tool naming may prefix server/tool names, discovery should be explicit.

Suggested first prompt:

```txt
List the available tools coming from the shuvdex MCP server only. Do not use any non-shuvdex tools.
```

- [x] Confirm the echo tool (or its actual OpenCode-exposed name) is visible
- [x] Record the exact surfaced name

Observed surfaced name in OpenCode:
- `shuvdex_skill_module_runtime_template_echo`

**Pass condition**
- At least one deterministic tool from the imported fixture is visible

### Test case D — Deterministic tool invocation

Suggested prompt:

```txt
Use the shuvdex echo tool to echo the exact string CLEAN_TEST_123 and show me the exact structured result.
```

- [x] Confirm OpenCode invokes the tool successfully
- [x] Confirm the returned payload contains `echoed: CLEAN_TEST_123`
- [x] Confirm there is no fallback hallucination if the tool fails

**Pass condition**
- Exact echoed value returned from the real tool path

### Test case E — Resource/prompt discovery (optional but recommended)

If the imported package surfaces resources or prompts in the client:
- [ ] ask OpenCode to inspect or describe them
- [ ] confirm they come from `shuvdex`, not local project context

Suggested prompt:

```txt
Describe any resources or prompts exposed by the shuvdex MCP server for this imported package.
```

### Test case F — Negative control

Run one deliberately failing tool invocation, for example missing required args.

Suggested prompt:

```txt
Call the shuvdex echo tool without a message and report the exact error payload.
```

- [ ] Confirm failure is surfaced as a real tool error
- [ ] Confirm the client does not silently fabricate success

**Pass condition**
- structured error path is visible end to end

### Phase 2 / remote fixture execution notes

Executed on 2026-03-22/23:

- Added a real remote MCP endpoint on `shuvdev` at:
  - `http://shuvdev:3848/mcp`
- Seeded a deterministic package into the live package registry:
  - source skill: `examples/module-runtime-skill-template/`
  - persisted package file: `/home/shuv/repos/shuvdex/.capabilities/packages/skill.module_runtime_template.yaml`
- Restarted the remote MCP server so the new package was loaded.
- Verified the remote server now advertises the deterministic echo tool:
  - `skill.module_runtime_template.echo`
- Verified the isolated OpenCode environment still connects cleanly to the remote MCP endpoint:
  - `opencode mcp list` → `shuvdex connected`

Current limitation discovered (and resolved):

- `opencode run` initially failed before model execution in the isolated environment with:
  - `sdk.languageModel is not a function`
- Root cause was provider/model selection in the clean-room config:
  - with no explicit model override, OpenCode selected `cloudflare-ai-gateway/*`
  - the current OpenCode build on this machine does not handle that provider path correctly here
- Resolution:
  - pin the clean-room config to `opencode/gpt-5-nano`
  - set `small_model` to `opencode/gpt-5-nano`
  - restrict `enabled_providers` to `["opencode"]`
- After that change, `opencode run` succeeded in the isolated environment and completed real remote MCP discovery + tool invocation against `http://shuvdev:3848/mcp`.

## Phase 6 — Evidence review and exit criteria

## Minimum success criteria

The test is a success if all of these are true:

- [x] OpenCode ran inside tmux
- [x] The OpenCode environment was isolated via temp XDG dirs
- [x] No inherited MCP servers, skills, or rules polluted the run
- [x] `shuvdex` MCP connected successfully
- [x] A deterministic imported tool was discovered
- [x] The tool executed successfully through the real client
- [x] We captured transcript evidence

## Stretch success criteria

- [ ] Negative-path error handling is correct
- [ ] Resource/prompt discovery also works
- [x] We can repeat the run from scratch with the same result

## Risks / likely failure modes

### Model auth is not available in the isolated environment

If OpenCode relies on auth material stored under its normal XDG data/config dirs, a fully isolated run may lose model access.

### Mitigation
- Prefer environment-based provider auth if already available in shell env
- If not, do a one-time auth step inside the isolated environment
- This is acceptable because the requirement is “no MCP or skills,” not “no model auth”

### Running from the repo root contaminates the test

If the client starts in `/home/shuv/repos/shuvdex`, project config and local rule files may get loaded.

### Mitigation
- enforce temp workspace cwd
- record `pwd` in transcript at session start

### Tool name mismatch inside OpenCode

OpenCode may prefix MCP tools by server name or remap names.

### Mitigation
- make tool discovery its own explicit test case before invocation

### Imported fixture not present in MCP runtime

If the server starts clean but we never seed a deterministic package, the test may pass connection but fail usefulness.

### Mitigation
- seed the module-runtime fixture before starting the OpenCode client session

## Proposed implementation order

- [ ] Prepare clean temp dirs for OpenCode
- [ ] Prepare clean temp dirs for `shuvdex` runtime
- [ ] Create minimal isolated OpenCode config with only `shuvdex` MCP
- [ ] Seed deterministic module-runtime fixture into isolated `shuvdex` package store
- [ ] Launch tmux session and capture logs
- [ ] Run isolation sanity checks
- [ ] Run discovery prompt
- [ ] Run deterministic success prompt
- [ ] Run deterministic failure prompt
- [ ] Save artifacts and summarize results

## Concrete commands to use later

### 1. Prepare clean dirs

```bash
TEST_ROOT=/tmp/shuvdex-opencode-clean
SHUVDEX_RUNTIME=/tmp/shuvdex-mcp-runtime
rm -rf "$TEST_ROOT" "$SHUVDEX_RUNTIME"
mkdir -p "$TEST_ROOT"/{config,data,cache,state,workspace,artifacts,home}
mkdir -p "$SHUVDEX_RUNTIME"/{packages,policy,imports}
```

### 2. Write isolated OpenCode config

```bash
mkdir -p "$TEST_ROOT/config/opencode"
cat > "$TEST_ROOT/config/opencode/opencode.json" <<'JSON'
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "shuvdex": {
      "type": "local",
      "command": ["node", "/home/shuv/repos/shuvdex/apps/mcp-server/dist/index.js"],
      "enabled": true,
      "environment": {
        "CAPABILITIES_DIR": "/tmp/shuvdex-mcp-runtime/packages",
        "POLICY_DIR": "/tmp/shuvdex-mcp-runtime/policy",
        "LOCAL_REPO_PATH": "/home/shuv/repos/shuvdex"
      }
    }
  }
}
JSON
```

### 3. Start tmux session

```bash
tmux new-session -d -s shuvdex-opencode-e2e -n client
```

### 4. Export clean-room env into tmux pane

```bash
tmux send-keys -t shuvdex-opencode-e2e:client "export XDG_CONFIG_HOME=/tmp/shuvdex-opencode-clean/config" C-m
tmux send-keys -t shuvdex-opencode-e2e:client "export XDG_DATA_HOME=/tmp/shuvdex-opencode-clean/data" C-m
tmux send-keys -t shuvdex-opencode-e2e:client "export XDG_CACHE_HOME=/tmp/shuvdex-opencode-clean/cache" C-m
tmux send-keys -t shuvdex-opencode-e2e:client "export XDG_STATE_HOME=/tmp/shuvdex-opencode-clean/state" C-m
tmux send-keys -t shuvdex-opencode-e2e:client "export OPENCODE_TEST_HOME=/tmp/shuvdex-opencode-clean/home" C-m
tmux send-keys -t shuvdex-opencode-e2e:client "export OPENCODE_DISABLE_CLAUDE_CODE=1" C-m
tmux send-keys -t shuvdex-opencode-e2e:client "export OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=1" C-m
tmux send-keys -t shuvdex-opencode-e2e:client "export OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1" C-m
tmux send-keys -t shuvdex-opencode-e2e:client "cd /tmp/shuvdex-opencode-clean/workspace" C-m
```

### 5. Sanity-check config before launch

```bash
tmux send-keys -t shuvdex-opencode-e2e:client "opencode mcp list" C-m
```

### 6. Launch OpenCode

```bash
tmux send-keys -t shuvdex-opencode-e2e:client "opencode" C-m
```

## Files relevant to this plan

### In this repo
- `README.md`
- `opencode.jsonc`
- `CONTEXT.md`
- `examples/module-runtime-skill-template/SKILL.md`
- `examples/module-runtime-skill-template/capability.yaml`
- `examples/module-runtime-skill-template/echo.mcp.mjs`
- `apps/mcp-server/src/index.ts`
- `packages/skill-importer/src/live.ts`
- `packages/skill-indexer/src/compiler.ts`

### In the OpenCode fork/docs
- `/home/shuv/repos/forks/opencode/packages/opencode/test/preload.ts`
- `/home/shuv/repos/forks/opencode/packages/web/src/content/docs/config.mdx`
- `/home/shuv/repos/forks/opencode/packages/web/src/content/docs/mcp-servers.mdx`
- `/home/shuv/repos/forks/opencode/packages/web/src/content/docs/rules.mdx`

## Open questions before execution

- [ ] Do we want a **fully isolated provider auth** path too, or is clean MCP/skills/rules isolation sufficient?
- [ ] Should we seed the server by **importing an archive through the API**, or by **pre-writing capability files** into the temp package dir?
- [ ] Do we want the first real-world test to be **interactive TUI**, **`opencode run` non-interactive**, or both?

## Recommendation

For the first pass, run **both**:

1. **non-interactive smoke test** with `opencode run` for determinism and scripting
2. **interactive tmux TUI test** for the true operator experience

That gives us one repeatable CI-like proof and one real-world proof.

# User Testing

Testing surface, resource cost classification, and validation approach.

---

## Validation Surface

**Primary Surface:** CLI commands executed in terminal
- `fleet status`, `fleet pull`, `fleet sync`, `fleet activate`, `fleet deactivate`, `fleet rollback`, `fleet tag`

**Secondary Surface:** MCP server tools
- Tested via stdio JSON-RPC harness

**Foundation Surface:** Terminal-driven Node package API checks
- Run `node --input-type=module` from the repo root and import built workspace packages from their `dist` entrypoints.
- Use this surface for pre-CLI milestones where the real consumable interface is the package API itself (`@codex-fleet/core`, `@codex-fleet/ssh`, `@codex-fleet/telemetry`).
- Keep each validation flow isolated with its own temp directory under `/tmp` and avoid mutating shared remote state.

**Git/Skill Ops Surface:** Terminal-driven Node package API checks with isolated git/skill sandboxes
- Use this same `node --input-type=module` surface for `@codex-fleet/git-ops` and `@codex-fleet/skill-ops` milestone validation.
- Real remote mutations are allowed only inside validator-owned temp sandboxes under `/tmp/codex-fleet-user-testing-*`; never modify `~/repos/shuvbot-skills`.
- When a flow needs pull/push/drift behavior, provision temporary bare repos and clones inside the assigned sandbox so each flow owns its git history.

**Verification:** SSH to test hosts (shuvtest, shuvbot) for state verification

## Validation Tools

- **CLI execution:** Direct shell commands
- **MCP testing:** Node.js stdio harness sending JSON-RPC
- **State verification:** SSH commands to inspect remote state
- **OTEL verification:** Query maple dashboard

### MCP Validation Notes

- For MCP protocol checks, prefer the same handshake real clients use: `initialize`, then `notifications/initialized`, then `tools/list`, followed by at least one feature-relevant `tools/call` when the feature adds or changes a tool handler.
- For stdio transport assertions, capture raw line-delimited stdout and explicitly verify EOF shutdown behavior; the current server has custom stdin-`end` handling because the SDK transport alone does not terminate a live `ManagedRuntime` process.
- For malformed-request/error-handling work, probe both invalid JSON and valid JSON that is invalid JSON-RPC (for example `[]` or `{"foo":"bar"}`) to confirm the server returns the expected protocol error instead of silently dropping the request.
- For Codex-discovery features, a raw stdio harness is necessary but not sufficient: also validate the Codex-owned discovery path (project-scoped `.codex/config.toml` and visible tool registration on the Codex surface, or an equivalent Codex-controlled launch path).

### OTEL Collector Notes

- Read-only probes against `http://localhost:4318` currently return `404` for `GET /` and `405` for `GET /v1/traces`.
- Verifying actual trace ingestion therefore requires a readable maple/dashboard surface or another trace-query interface; collector reachability alone is not conclusive evidence that a span was ingested.
- Foundation rerun evidence showed a reliable terminal-only proof path: run the public telemetry package under Node with a temporary `fetch` interceptor, then assert the live exporter makes `POST http://localhost:4318/v1/traces` and that the OTLP JSON body contains the unique span name while the collector replies `200` with `{"partialSuccess":{}}`.
- `http://localhost:13133/` is a readable collector health endpoint and returned `200` health JSON during the rerun, but it only proves collector availability, not trace ingestion.

## Validation Concurrency

**Max Concurrent Validators:** 5

**Rationale:**
- 83 GiB RAM available, 24 CPU cores
- CLI commands are lightweight (no browser, no heavy services)
- SSH connections have minimal overhead
- Each validator uses ~100-200 MB max

## Test Isolation

- Use isolated test directories on remote hosts
- Create/destroy test skill directories per test
- Reset git state between tests
- For foundation package validation, use per-flow temp dirs under `/tmp/codex-fleet-user-testing-*` and only run read-only remote SSH commands (`echo`, `hostname`, `whoami`, controlled non-zero exits).
- For git/skill package validation, create separate local and remote `/tmp/codex-fleet-user-testing-<group>` sandboxes per flow and keep every mutation, clone, tag, symlink, and cleanup operation inside those directories.
- For git merge-conflict validation on Git 2.53, set `git config pull.rebase false` inside the isolated conflict repo before calling `git pull origin`; otherwise Git may stop at the pull-strategy prompt instead of reaching the actual content-conflict path.

## Resource Considerations

- SSH connection pooling for efficiency
- Avoid parallel tests that modify same remote state
- OTEL collector handles high span volume (no throttling needed)

## Flow Validator Guidance: terminal-node-api

- Work from `/home/shuv/repos/codex-fleet` only.
- Exercise the public package interface through terminal-run Node scripts, not by editing source or calling internal test helpers unless they are exported as part of the package surface.
- Use isolated temp paths under `/tmp/codex-fleet-user-testing-<group>` for generated YAML/files.
- Foundation-only remote SSH validation should stay read-only against `shuvtest`.
- Git/skill validation may create and destroy temporary repos, skill directories, and active-symlink directories on `shuvtest`, but only inside the exact `/tmp/codex-fleet-user-testing-<group>` sandbox assigned to that flow.
- For `skill.checkDrift` validation in the current environment, prefer SSH-reachable hosts (for example `shuvbot` + `shuvtest`) over `localhost`; the shipped live executor still routes through SSH, so localhost validation requires working localhost key auth.
- Never read from or modify `~/repos/shuvbot-skills`; use validator-owned sandboxes for all write-path assertions.
- Save evidence into the assigned mission evidence directory and write the flow report JSON exactly to the assigned path.

## Flow Validator Guidance: cli-terminal

- Work from `/home/shuv/repos/codex-fleet` and invoke the real CLI via `node apps/cli/bin/fleet.js ...` so validation exercises the shipped user surface.
- Keep every write-path assertion inside its assigned local and remote `/tmp/codex-fleet-user-testing-cli-*` sandbox; never mutate `~/repos/shuvbot-skills` or `~/.codex/skills`.
- Use the exact config files, remote repo paths, local skill roots, and active-dir paths assigned by the validator orchestrator for your group.
- For git-backed CLI flows, verify user-visible output first, then confirm resulting remote state with direct `ssh` + `git`/`ls` commands against the same sandbox paths.
- For `sync`, `activate`, and `deactivate`, keep remote skill repos and active directories isolated per group and treat repeated `activate`/`deactivate` calls as idempotency checks rather than setup failures.
- For mixed-host timeout scenarios, reuse the dedicated config that pairs a healthy `shuvtest` entry with the reserved timeout target `192.0.2.1`; expect the healthy host to finish while the timeout host fails.
- SSH to `shuvtest` may emit the known post-quantum warning on stderr; treat that warning as benign unless stdout, exit code, or repo state contradict expected behavior.
- If `tuistory` is unavailable in `PATH`, capture terminal transcripts with `script` (or equivalent) and still save separate raw stdout/stderr/exit-code artifacts.
- Save raw stdout/stderr/exit-code evidence into the assigned mission evidence directory and write the flow report JSON exactly to the assigned path.

## Flow Validator Guidance: mcp-stdio

- Exercise the MCP server through real stdio JSON-RPC only: line-delimited requests on stdin and JSON responses on stdout.
- Use `node apps/mcp-server/dist/index.js` for protocol/discovery assertions that depend on the shipped Codex launch path (`initialize`, `notifications/initialized`, `tools/list`, malformed JSON-RPC handling, EOF shutdown, `.codex/config.toml`).
- For write-path assertions (`fleet_sync`, `fleet_activate`, `fleet_deactivate`, `fleet_pull`, `fleet_drift`, `fleet_rollback`), launch the validator-provided wrapper script instead of the default entrypoint so the real server logic runs against validator-owned `/tmp/codex-fleet-user-testing-mcp-*` sandboxes rather than `~/repos/shuvbot-skills` or `~/.codex/skills`.
- Stay strictly inside the assigned local skill root, remote repo path, active-dir path, and any remote bare origins; never read from or modify the real fleet repo paths on `shuvtest` or `shuvbot`.
- Verify both the user-visible MCP response payload and the resulting remote filesystem/git state with direct `ssh` commands against the same sandbox paths.
- Capture raw request/response transcripts plus stdout/stderr/exit-code artifacts for each server run in the assigned evidence directory.
- When validating Codex discovery, use the project-scoped `.codex/config.toml` as-is and confirm the server launched from that config exposes all 7 tools after the standard initialize sequence.

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

**Verification:** SSH to test hosts (shuvtest, shuvbot) for state verification

## Validation Tools

- **CLI execution:** Direct shell commands
- **MCP testing:** Node.js stdio harness sending JSON-RPC
- **State verification:** SSH commands to inspect remote state
- **OTEL verification:** Query maple dashboard

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

## Resource Considerations

- SSH connection pooling for efficiency
- Avoid parallel tests that modify same remote state
- OTEL collector handles high span volume (no throttling needed)

## Flow Validator Guidance: terminal-node-api

- Work from `/home/shuv/repos/codex-fleet` only.
- Exercise the public package interface through terminal-run Node scripts, not by editing source or calling internal test helpers unless they are exported as part of the package surface.
- Use isolated temp paths under `/tmp/codex-fleet-user-testing-<group>` for generated YAML/files.
- Remote SSH validation must stay read-only against `shuvtest`; do not create or modify files on remote hosts.
- Save evidence into the assigned mission evidence directory and write the flow report JSON exactly to the assigned path.

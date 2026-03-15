# User Testing

Testing surface, resource cost classification, and validation approach.

---

## Validation Surface

**Primary Surface:** CLI commands executed in terminal
- `fleet status`, `fleet pull`, `fleet sync`, `fleet activate`, `fleet deactivate`, `fleet rollback`, `fleet tag`

**Secondary Surface:** MCP server tools
- Tested via stdio JSON-RPC harness

**Verification:** SSH to test hosts (shuvtest, shuvbot) for state verification

## Validation Tools

- **CLI execution:** Direct shell commands
- **MCP testing:** Node.js stdio harness sending JSON-RPC
- **State verification:** SSH commands to inspect remote state
- **OTEL verification:** Query maple dashboard

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

## Resource Considerations

- SSH connection pooling for efficiency
- Avoid parallel tests that modify same remote state
- OTEL collector handles high span volume (no throttling needed)

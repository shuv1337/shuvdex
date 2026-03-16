# Architecture

Architectural decisions and patterns for the fleet-skills system.


### MCP Server Notes

- `apps/mcp-server/src/index.ts` resolves `fleet.yaml` and the default `localRepoPath` from `process.cwd()`, so launch the MCP server from the repo root (or an equivalent working directory that contains the intended `fleet.yaml`).
- Live MCP tool handlers bridge from async SDK callbacks into Effect programs via `ServerConfig.runtime` plus `Runtime.runPromise(runtime)(program)`; the simplified `Effect.runPromise(...)` pattern is not sufficient once the server is running with injected live layers.
- `@modelcontextprotocol/sdk`'s `StdioServerTransport` does not by itself shut the process down on stdin EOF when a live `ManagedRuntime` is still keeping the Node event loop active. The current server handles `process.stdin.on("end")` explicitly to close the server and dispose the runtime.
---

## Overview

Fleet Skills is a CLI and MCP server for centralized skill management across multiple Codex app-server instances via SSH.

## Core Patterns

### Effect-TS Service Architecture

All modules follow Effect service patterns:
- `Context.Tag<Service>` for dependency injection
- `Layer<Service>` for live/test implementations
- `Effect<A, E, R>` for all async/fallible operations
- `Schema` is imported from `effect` in the current codebase (not `@effect/schema`)

### Error Handling

Current packages use `Data.TaggedError` subclasses for structured typed errors:
```typescript
class ConnectionFailed extends Data.TaggedError("ConnectionFailed")<{
  host: string;
  cause: unknown;
}> {}

class CommandFailed extends Data.TaggedError("CommandFailed")<{
  host: string;
  exitCode: number;
  stderr: string;
}> {}
```

### Git CLI Validation Notes

- When changing git command construction for shell-safety, do not rely only on mocked SSH command-string assertions.
- Also verify the actual git CLI semantics in an isolated temporary repo; small argument-shape changes such as inserting `--` can change a ref checkout into pathspec mode.

### OTEL Instrumentation

All operations create spans via `@effect/opentelemetry`:
- Root span for CLI command / MCP tool
- Child spans for SSH connections, git operations
- Attributes: host, operation, exitCode, durationMs
- Custom tracer implementations must be installed with `Layer.setTracer(...)` so `Effect.withSpan` emits spans in tests and live layers

## Package Dependencies

```
apps/cli          -> packages/core, ssh, git-ops, skill-ops, telemetry
apps/mcp-server   -> packages/core, ssh, git-ops, skill-ops, telemetry
packages/ssh      -> packages/core, telemetry
packages/git-ops  -> packages/core, ssh, telemetry
packages/skill-ops -> packages/core, ssh, git-ops, telemetry
packages/telemetry -> @effect/opentelemetry
packages/core     -> effect (Schema) (no internal deps)
```

## CLI Notes

- The current CLI uses the hand-rolled parser in `apps/cli/src/cli.ts`; the workspace does not include `commander.js` or `yargs`.

## Test Double Notes

- `SshExecutorTest` returns queued `_tag: "result"` values verbatim, even when `exitCode !== 0`.
- Tests that need higher layers to observe `CommandFailed`, `ConnectionFailed`, or other SSH-layer failures must queue `_tag: "error"` with the explicit typed error instead of relying on a non-zero `CommandResult`.

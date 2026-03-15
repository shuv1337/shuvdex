# Architecture

Architectural decisions and patterns for the fleet-skills system.

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

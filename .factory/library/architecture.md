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

### Error Handling

Use `Data.TaggedEnum` for structured errors:
```typescript
type SshError = Data.TaggedEnum<{
  ConnectionFailed: { host: string; cause: unknown }
  CommandFailed: { host: string; exitCode: number; stderr: string }
  Timeout: { host: string; durationMs: number }
}>
```

### OTEL Instrumentation

All operations create spans via `@effect/opentelemetry`:
- Root span for CLI command / MCP tool
- Child spans for SSH connections, git operations
- Attributes: host, operation, exitCode, durationMs

## Package Dependencies

```
apps/cli          -> packages/core, ssh, git-ops, skill-ops, telemetry
apps/mcp-server   -> packages/core, ssh, git-ops, skill-ops, telemetry
packages/ssh      -> packages/core, telemetry
packages/git-ops  -> packages/core, ssh, telemetry
packages/skill-ops -> packages/core, ssh, git-ops, telemetry
packages/telemetry -> @effect/opentelemetry
packages/core     -> @effect/schema (no internal deps)
```

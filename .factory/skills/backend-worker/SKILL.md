---
name: backend-worker
description: Builds core infrastructure, services, and packages with Effect-TS
---

# Backend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features in:
- `packages/core` - Shared types, schemas, config
- `packages/ssh` - SSH executor service
- `packages/git-ops` - Git operations on remote hosts
- `packages/skill-ops` - Skill sync, activation, drift detection
- `packages/telemetry` - OTEL instrumentation setup

## Work Procedure

### 1. Understand the Feature

Read the feature description, preconditions, and expectedBehavior carefully. Identify:
- Which package(s) to modify
- What services/types need to be created
- What existing services this depends on

### 2. Write Tests First (TDD)

Create test file in `packages/<name>/test/` BEFORE implementation:

```typescript
import { it, describe } from "@effect/vitest"
import { Effect } from "effect"

describe("FeatureName", () => {
  it.effect("should do X when Y", () =>
    Effect.gen(function* () {
      // Arrange
      // Act
      const result = yield* SomeService.doSomething()
      // Assert
      expect(result).toEqual(expected)
    })
  )
})
```

Run tests to confirm they FAIL (red):
```bash
npm test -- --filter <package>
```

### 3. Implement the Feature

Create/modify source files to make tests pass:

1. **Define types** in `src/types.ts` using Effect Schema
2. **Create service** with `Context.Tag` and implementation
3. **Create layers** for dependency injection (Live + Test)
4. **Add OTEL spans** for all operations via `@effect/opentelemetry`

### 4. Verify Tests Pass (green)

```bash
npm test -- --filter <package>
```

All tests must pass. Fix any failures before proceeding.

### 5. Run Validators

```bash
npm run typecheck
npm run lint
```

Fix any issues.

### 6. Manual Verification

For SSH-related features:
```bash
# Test SSH connection
ssh shuvtest "echo 'connected'"

# Test git operations
ssh shuvtest "cd ~/repos/shuvbot-skills && git status"
```

Record exact commands and observations in handoff.

## Example Handoff

```json
{
  "salientSummary": "Implemented SSH executor service with Effect wrapping, connection timeout handling, and OTEL spans. Tests cover command execution, output capture, and timeout scenarios. Manually verified SSH to shuvtest works.",
  "whatWasImplemented": "SshExecutor service in packages/ssh with executeCommand(), Context.Tag for DI, SshExecutorLive layer using node ssh2, OTEL span creation for all SSH operations, structured error types (ConnectionFailed, CommandFailed, Timeout)",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "npm test -- --filter @shuvdex/ssh", "exitCode": 0, "observation": "12 tests passed covering execute, timeout, error cases" },
      { "command": "npm run typecheck", "exitCode": 0, "observation": "No type errors" },
      { "command": "ssh shuvtest 'hostname'", "exitCode": 0, "observation": "Returns 'shuvtest' confirming SSH works" }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      {
        "file": "packages/ssh/test/executor.test.ts",
        "cases": [
          { "name": "executes command on remote host", "verifies": "VAL-INFRA-006" },
          { "name": "captures stdout, stderr, exitCode", "verifies": "VAL-INFRA-007" },
          { "name": "times out on unreachable host", "verifies": "VAL-INFRA-008" },
          { "name": "detects non-zero exit as failure", "verifies": "VAL-INFRA-010" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature depends on a package that doesn't exist yet
- SSH host (shuvtest/shuvbot) is unreachable
- OTEL collector (localhost:4318) is not running
- Requirements are ambiguous about error handling behavior

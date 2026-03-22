---
name: cli-worker
description: Builds the fleet CLI tool with commands for fleet management
---

# CLI Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features in `apps/cli`:
- CLI command implementations (status, pull, sync, activate, deactivate, rollback, tag)
- CLI argument parsing and validation
- Output formatting (text and JSON modes)
- Error handling and exit codes

## Work Procedure

### 1. Understand the Command

Read the feature description to understand:
- What arguments/options the command accepts
- What services it needs to call
- Expected output format (text, JSON)
- Exit codes for success, failure, partial success

### 2. Write Tests First (TDD)

Create test file in `apps/cli/test/` BEFORE implementation:

```typescript
import { it, describe } from "@effect/vitest"
import { Effect } from "effect"

describe("fleet <command>", () => {
  it.effect("should return success when all hosts respond", () =>
    Effect.gen(function* () {
      const result = yield* runCommand(["status"])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("shuvtest")
    })
  )

  it.effect("should return partial failure code when some hosts fail", () =>
    Effect.gen(function* () {
      const result = yield* runCommand(["status"], { mockFailHost: "shuvbot" })
      expect(result.exitCode).toBe(2)
      expect(result.stdout).toContain("[FAIL] shuvbot")
    })
  )
})
```

Run tests to confirm they FAIL (red):
```bash
npm test -- --filter @shuvdex/cli
```

### 3. Implement the Command

1. **Add command parser** using commander.js or yargs
2. **Call underlying services** from packages (git-ops, skill-ops, ssh)
3. **Format output** according to --json flag
4. **Set exit code** appropriately (0=success, 1=error, 2=partial)
5. **Add help text** with usage examples

### 4. Verify Tests Pass (green)

```bash
npm test -- --filter @shuvdex/cli
```

### 5. Run Validators

```bash
npm run typecheck
npm run lint
```

### 6. Manual Verification (REQUIRED)

Test the actual CLI command against real hosts:

```bash
# Build the CLI
npm run build

# Test the command
./apps/cli/bin/fleet status
./apps/cli/bin/fleet pull shuvtest
./apps/cli/bin/fleet --help
```

Record exact commands, output, and exit codes in handoff.

## Example Handoff

```json
{
  "salientSummary": "Implemented `fleet status` command showing all configured hosts with connection status. Supports --json output. Returns exit 0 if all hosts online, exit 2 for partial failure. Manually tested against shuvtest and shuvbot.",
  "whatWasImplemented": "fleet status command in apps/cli: connects to all hosts via SSH, displays table with hostname/status columns, --json flag outputs machine-parseable JSON, exit codes 0/1/2 for success/error/partial",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "npm test -- --filter @shuvdex/cli", "exitCode": 0, "observation": "8 tests passed for status command" },
      { "command": "npm run build", "exitCode": 0, "observation": "CLI built successfully" },
      { "command": "./apps/cli/bin/fleet status", "exitCode": 0, "observation": "Shows shuvtest [OK], shuvbot [OK]" },
      { "command": "./apps/cli/bin/fleet status --json", "exitCode": 0, "observation": "Valid JSON with hosts array" },
      { "command": "./apps/cli/bin/fleet --help", "exitCode": 0, "observation": "Lists all subcommands with descriptions" }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      {
        "file": "apps/cli/test/status.test.ts",
        "cases": [
          { "name": "displays all configured hosts", "verifies": "VAL-CLI-001" },
          { "name": "handles unreachable hosts gracefully", "verifies": "VAL-CLI-002" },
          { "name": "outputs valid JSON with --json flag", "verifies": "VAL-CLI-020" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Required service package (git-ops, skill-ops) doesn't exist yet
- SSH hosts unreachable for manual testing
- Unclear requirements about output format or exit codes
- CLI framework choice conflicts with existing patterns

---
name: mcp-worker
description: Builds the MCP server exposing fleet tools to Codex Desktop
---

# MCP Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features in `apps/mcp-server`:
- MCP server initialization and protocol handling
- Tool definitions (fleet_status, fleet_sync, fleet_activate, etc.)
- JSON-RPC message handling over stdio
- Tool execution with structured responses

## Work Procedure

### 1. Understand the Tool

Read the feature description to understand:
- Tool name and inputSchema
- What services it calls
- Response format (content array structure)
- Error handling (isError flag, error messages)

### 2. Write Tests First (TDD)

Create test file in `apps/mcp-server/test/` BEFORE implementation:

```typescript
import { it, describe } from "@effect/vitest"
import { Effect } from "effect"

describe("MCP fleet_status tool", () => {
  it.effect("returns host status for all configured hosts", () =>
    Effect.gen(function* () {
      const response = yield* callTool("fleet_status", {})
      expect(response.isError).toBe(false)
      expect(response.content).toHaveLength(1)
      expect(response.content[0].text).toContain("shuvtest")
    })
  )

  it.effect("returns isError:true when all hosts fail", () =>
    Effect.gen(function* () {
      const response = yield* callTool("fleet_status", {}, { allHostsFail: true })
      expect(response.isError).toBe(true)
    })
  )
})
```

Run tests to confirm they FAIL (red):
```bash
npm test -- --filter @codex-fleet/mcp-server
```

### 3. Implement the Tool

1. **Define tool in tools registry** with name, description, inputSchema
2. **Implement handler** that calls underlying services
3. **Format response** as MCP CallToolResult with content array
4. **Handle errors** by returning isError:true with descriptive content

Use `@modelcontextprotocol/sdk`:
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

server.tool("fleet_status", schema, async (args) => {
  const result = await Effect.runPromise(statusService.getStatus())
  return { content: [{ type: "text", text: JSON.stringify(result) }] }
})
```

### 4. Verify Tests Pass (green)

```bash
npm test -- --filter @codex-fleet/mcp-server
```

### 5. Run Validators

```bash
npm run typecheck
npm run lint
```

### 6. Manual Verification (REQUIRED)

Test the MCP server via stdio:

```bash
# Build the server
npm run build

# Test initialization
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node apps/mcp-server/dist/index.js

# Test tools/list
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node apps/mcp-server/dist/index.js
```

Record exact commands and responses in handoff.

## Example Handoff

```json
{
  "salientSummary": "Implemented fleet_status MCP tool returning structured host status. Tested MCP initialization handshake and tools/list response. Manual verification shows proper JSON-RPC over stdio.",
  "whatWasImplemented": "fleet_status tool in apps/mcp-server: calls StatusService.getFleetStatus(), returns content array with per-host status JSON, sets isError:true when no hosts reachable, proper MCP protocol response format",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "npm test -- --filter @codex-fleet/mcp-server", "exitCode": 0, "observation": "6 tests passed for fleet_status tool" },
      { "command": "npm run build", "exitCode": 0, "observation": "MCP server built successfully" },
      { "command": "echo '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\"...}' | node apps/mcp-server/dist/index.js", "exitCode": 0, "observation": "Returns valid InitializeResult with protocolVersion and capabilities" }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      {
        "file": "apps/mcp-server/test/fleet-status.test.ts",
        "cases": [
          { "name": "returns status for all hosts", "verifies": "VAL-MCP-003" },
          { "name": "sets isError:true when all fail", "verifies": "VAL-MCP-010" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- MCP SDK has breaking changes from expected API
- Required services (git-ops, skill-ops) don't exist yet
- stdio transport has unexpected buffering issues
- Protocol compliance unclear for edge cases

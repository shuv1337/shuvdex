/**
 * MCP Error Handling Tests
 *
 * Tests for:
 * - VAL-MCP-010: Tool errors return isError:true with actionable content
 * - VAL-MCP-011: Malformed request handling (JSON-RPC error codes)
 * - VAL-MCP-014: Sequential request consistency
 */
import { describe, expect, it, afterEach } from "vitest";
import { Effect, Layer, Ref, Runtime } from "effect";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  SshExecutorTest,
  MockSshResponses,
  CommandFailed,
} from "@codex-fleet/ssh";
import type { MockResponse } from "@codex-fleet/ssh";
import { GitOpsLive } from "@codex-fleet/git-ops";
import { SkillOpsLive } from "@codex-fleet/skill-ops";
import { TelemetryTest } from "@codex-fleet/telemetry";
import { HostRegistry } from "@codex-fleet/core";
import { createServer } from "../src/server.js";
import type { ServerServices } from "../src/server.js";
import { spawn } from "node:child_process";
import { resolve as resolvePath, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Build a test layer providing all services needed by the MCP server.
 */
const makeTestLayer = () =>
  Layer.mergeAll(SshExecutorTest, TelemetryTest).pipe(
    (base) => Layer.provideMerge(GitOpsLive, base),
    (base) => Layer.provideMerge(SkillOpsLive, base),
  );

/**
 * Create a registry with two test hosts.
 */
const testRegistry = HostRegistry.fromRecord({
  shuvtest: {
    hostname: "shuvtest",
    connectionType: "ssh",
    port: 22,
    timeout: 10,
  },
  shuvbot: {
    hostname: "shuvbot",
    connectionType: "ssh",
    port: 22,
    timeout: 10,
  },
});

const REPO_PATH = "~/repos/shuvbot-skills";

// ---------------------------------------------------------------------------
// VAL-MCP-010: Error Response Format
// ---------------------------------------------------------------------------

describe("VAL-MCP-010: Tool errors return isError:true with descriptive content", () => {
  let client: Client;
  let cleanup: (() => Promise<void>) | undefined;

  const setup = async (responses: Array<MockResponse>) => {
    const program = Effect.gen(function* () {
      const mockRef = yield* MockSshResponses;
      yield* Ref.set(mockRef, responses);
      const runtime = yield* Effect.runtime<ServerServices>();
      return runtime;
    }).pipe(Effect.provide(makeTestLayer()));

    const runtime = await Effect.runPromise(program);
    const server = createServer({
      registry: testRegistry,
      repoPath: REPO_PATH,
      runtime,
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: "test-client", version: "0.0.1" });
    await client.connect(clientTransport);

    cleanup = async () => {
      await client.close();
      await server.close();
    };
  };

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("fleet_status returns isError:true with actionable content when all hosts fail", async () => {
    await setup([
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvtest",
          command: "echo ok",
          exitCode: 255,
          stdout: "",
          stderr: "Connection refused",
        }),
      },
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvbot",
          command: "echo ok",
          exitCode: 255,
          stdout: "",
          stderr: "Connection refused",
        }),
      },
    ]);

    const result = await client.callTool({
      name: "fleet_status",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);

    const text = (
      result.content as Array<{ type: string; text: string }>
    )[0].text;
    expect(text).toBeTruthy();
    // The error content should be actionable (parseable JSON with error details)
    const parsed = JSON.parse(text);
    expect(parsed.hosts).toBeDefined();
    expect(
      parsed.hosts.every((h: { status: string }) => h.status === "error"),
    ).toBe(true);
  });

  it("fleet_status returns isError:true with error message for no matching hosts", async () => {
    await setup([]);

    const result = await client.callTool({
      name: "fleet_status",
      arguments: { hosts: ["nonexistent"] },
    });

    expect(result.isError).toBe(true);
    const text = (
      result.content as Array<{ type: string; text: string }>
    )[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.error).toContain("No matching hosts");
  });

  it("fleet_sync returns isError:true with error details when all hosts fail", async () => {
    // All SSH calls fail
    await setup([
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvtest",
          command: "scp",
          exitCode: 1,
          stdout: "",
          stderr: "Permission denied",
        }),
      },
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvbot",
          command: "scp",
          exitCode: 1,
          stdout: "",
          stderr: "Permission denied",
        }),
      },
    ]);

    const result = await client.callTool({
      name: "fleet_sync",
      arguments: { skill: "test-skill" },
    });

    expect(result.isError).toBe(true);
    const text = (
      result.content as Array<{ type: string; text: string }>
    )[0].text;
    expect(text).toBeTruthy();
    const parsed = JSON.parse(text);
    expect(parsed.skill).toBe("test-skill");
  });

  it("fleet_activate returns isError:true with per-host failure details", async () => {
    await setup([
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvtest",
          command: "ln -sf",
          exitCode: 1,
          stdout: "",
          stderr: "Permission denied",
        }),
      },
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvbot",
          command: "ln -sf",
          exitCode: 1,
          stdout: "",
          stderr: "Permission denied",
        }),
      },
    ]);

    const result = await client.callTool({
      name: "fleet_activate",
      arguments: { skill: "test-skill" },
    });

    expect(result.isError).toBe(true);
    const text = (
      result.content as Array<{ type: string; text: string }>
    )[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.skill).toBe("test-skill");
    expect(parsed.results).toBeDefined();
  });

  it("fleet_pull returns isError:true when all hosts fail to pull", async () => {
    await setup([
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvtest",
          command: "git pull",
          exitCode: 1,
          stdout: "",
          stderr: "fatal: not a git repository",
        }),
      },
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvbot",
          command: "git pull",
          exitCode: 1,
          stdout: "",
          stderr: "fatal: not a git repository",
        }),
      },
    ]);

    const result = await client.callTool({
      name: "fleet_pull",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const text = (
      result.content as Array<{ type: string; text: string }>
    )[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.results).toBeDefined();
  });

  it("fleet_rollback returns isError:true when ref is invalid on all hosts", async () => {
    await setup([
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvtest",
          command: "git checkout",
          exitCode: 1,
          stdout: "",
          stderr: "error: pathspec 'invalid-ref' did not match any file(s)",
        }),
      },
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvbot",
          command: "git checkout",
          exitCode: 1,
          stdout: "",
          stderr: "error: pathspec 'invalid-ref' did not match any file(s)",
        }),
      },
    ]);

    const result = await client.callTool({
      name: "fleet_rollback",
      arguments: { ref: "invalid-ref" },
    });

    expect(result.isError).toBe(true);
    const text = (
      result.content as Array<{ type: string; text: string }>
    )[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.ref).toBe("invalid-ref");
    expect(parsed.results).toBeDefined();
  });

  it("error content includes enough detail to be actionable", async () => {
    await setup([
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvtest",
          command: "echo ok",
          exitCode: 255,
          stdout: "",
          stderr: "ssh: connect to host shuvtest port 22: Connection refused",
        }),
      },
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvbot",
          command: "echo ok",
          exitCode: 255,
          stdout: "",
          stderr: "ssh: connect to host shuvbot port 22: No route to host",
        }),
      },
    ]);

    const result = await client.callTool({
      name: "fleet_status",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const text = (
      result.content as Array<{ type: string; text: string }>
    )[0].text;
    const parsed = JSON.parse(text);

    // Each host should have its own error detail
    for (const host of parsed.hosts) {
      expect(host.status).toBe("error");
      expect(host.error).toBeTruthy();
      expect(host.name).toBeTruthy();
      expect(host.hostname).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// VAL-MCP-011: Malformed Request Handling
// ---------------------------------------------------------------------------

describe("VAL-MCP-011: Malformed request handling", () => {
  it("unknown method returns -32601 MethodNotFound", async () => {
    const server = createServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "0.0.1" });
    await client.connect(clientTransport);

    try {
      await client.request(
        { method: "nonexistent/method", params: {} },
        // Schema that would parse any result
        {} as never,
      );
      // Should not reach here
      expect.unreachable("Should have thrown");
    } catch (e: unknown) {
      const error = e as { code?: number; message?: string };
      expect(error.code).toBe(-32601);
      expect(error.message).toContain("Method not found");
    }

    await client.close();
    await server.close();
  });

  it("server continues processing after unknown method error", async () => {
    const server = createServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "0.0.1" });
    await client.connect(clientTransport);

    // First: send unknown method (should error)
    try {
      await client.request(
        { method: "nonexistent/method", params: {} },
        {} as never,
      );
    } catch {
      // Expected
    }

    // Second: send valid tools/list (should succeed)
    const toolsResponse = await client.listTools();
    expect(toolsResponse.tools).toHaveLength(7);

    await client.close();
    await server.close();
  });
});

// ---------------------------------------------------------------------------
// VAL-MCP-011 (stdio): Malformed JSON via stdio transport
// ---------------------------------------------------------------------------

const __dir = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolvePath(__dir, "../dist/index.js");

describe("VAL-MCP-011: Malformed JSON over stdio", () => {
  function spawnServer(
    input: string,
    timeoutMs = 5000,
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    return new Promise((resolve, reject) => {
      const child = spawn("node", [SERVER_ENTRY], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("Server did not exit within timeout"));
      }, timeoutMs);

      child.stdout!.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr!.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.stdin!.write(input);
      child.stdin!.end();
    });
  }

  it("malformed JSON returns -32700 parse error response", async () => {
    // Send invalid JSON
    const { stdout } = await spawnServer("this is not json\n");

    const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const response = JSON.parse(lines[0]);
    expect(response.jsonrpc).toBe("2.0");
    expect(response.error).toBeDefined();
    expect(response.error.code).toBe(-32700);
    expect(response.error.message).toBeTruthy();
    expect(response.id).toBeNull();
  });

  it("server continues after malformed JSON", async () => {
    // Send malformed JSON followed by valid initialize
    const messages = [
      "this is not json",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.1" },
        },
      }),
    ];

    const { stdout } = await spawnServer(messages.join("\n") + "\n");

    const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);

    // First response should be the parse error
    const errorResponse = JSON.parse(lines[0]);
    expect(errorResponse.error).toBeDefined();
    expect(errorResponse.error.code).toBe(-32700);

    // Second response should be the valid initialize response
    const initResponse = JSON.parse(lines[1]);
    expect(initResponse.id).toBe(1);
    expect(initResponse.result).toBeDefined();
    expect(initResponse.result.serverInfo.name).toBe("codex-fleet");
  });

  it("incomplete JSON object returns -32700 parse error", async () => {
    const { stdout } = await spawnServer('{"jsonrpc":"2.0","id":1\n');

    const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const response = JSON.parse(lines[0]);
    expect(response.error).toBeDefined();
    expect(response.error.code).toBe(-32700);
  });

  it("unknown method returns -32601 over stdio", async () => {
    const messages = [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.1" },
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "nonexistent/method",
        params: {},
      }),
    ];

    const { stdout } = await spawnServer(messages.join("\n") + "\n");

    const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
    // Find the response to id 2
    const unknownMethodResponse = lines
      .map((l) => JSON.parse(l))
      .find((msg: Record<string, unknown>) => msg.id === 2);

    expect(unknownMethodResponse).toBeDefined();
    expect(unknownMethodResponse.error).toBeDefined();
    expect(unknownMethodResponse.error.code).toBe(-32601);
    expect(unknownMethodResponse.error.message).toContain("Method not found");
  });
});

// ---------------------------------------------------------------------------
// VAL-MCP-014: Sequential Request Consistency
// ---------------------------------------------------------------------------

describe("VAL-MCP-014: Sequential requests maintain state consistency", () => {
  let client: Client;
  let cleanup: (() => Promise<void>) | undefined;

  const setup = async (responses: Array<MockResponse>) => {
    const program = Effect.gen(function* () {
      const mockRef = yield* MockSshResponses;
      yield* Ref.set(mockRef, responses);
      const runtime = yield* Effect.runtime<ServerServices>();
      return runtime;
    }).pipe(Effect.provide(makeTestLayer()));

    const runtime = await Effect.runPromise(program);
    const server = createServer({
      registry: testRegistry,
      repoPath: REPO_PATH,
      runtime,
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: "test-client", version: "0.0.1" });
    await client.connect(clientTransport);

    cleanup = async () => {
      await client.close();
      await server.close();
    };
  };

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("sequential tools/list then callTool returns consistent results", async () => {
    // Mock: connectivity check + git state for status
    await setup([
      // shuvtest echo ok
      { _tag: "result", value: { stdout: "ok\n", stderr: "", exitCode: 0 } },
      // shuvtest getHead
      {
        _tag: "result",
        value: {
          stdout: "abc1234567890abcdef1234567890abcdef1234\n",
          stderr: "",
          exitCode: 0,
        },
      },
      // shuvtest getBranch
      { _tag: "result", value: { stdout: "main\n", stderr: "", exitCode: 0 } },
      // shuvtest isDirty
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
      // shuvbot echo ok
      { _tag: "result", value: { stdout: "ok\n", stderr: "", exitCode: 0 } },
      // shuvbot getHead
      {
        _tag: "result",
        value: {
          stdout: "abc1234567890abcdef1234567890abcdef1234\n",
          stderr: "",
          exitCode: 0,
        },
      },
      // shuvbot getBranch
      { _tag: "result", value: { stdout: "main\n", stderr: "", exitCode: 0 } },
      // shuvbot isDirty
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
    ]);

    // Request 1: tools/list
    const toolsList = await client.listTools();
    expect(toolsList.tools).toHaveLength(7);

    // Request 2: callTool (uses one of the listed tools)
    const statusResult = await client.callTool({
      name: "fleet_status",
      arguments: {},
    });
    expect(statusResult.isError).not.toBe(true);

    const parsed = JSON.parse(
      (statusResult.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(parsed.hosts).toHaveLength(2);
  });

  it("sequential tool calls process in order with state causality", async () => {
    // Mock: first fleet_status (success), then fleet_pull (success)
    // The responses are consumed sequentially by the mock SSH executor.
    await setup([
      // --- fleet_status responses ---
      // shuvtest echo ok
      { _tag: "result", value: { stdout: "ok\n", stderr: "", exitCode: 0 } },
      // shuvtest getHead (before pull)
      {
        _tag: "result",
        value: {
          stdout: "aaa1111111111111111111111111111111111111\n",
          stderr: "",
          exitCode: 0,
        },
      },
      // shuvtest getBranch
      { _tag: "result", value: { stdout: "main\n", stderr: "", exitCode: 0 } },
      // shuvtest isDirty
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
      // shuvbot echo ok
      { _tag: "result", value: { stdout: "ok\n", stderr: "", exitCode: 0 } },
      // shuvbot getHead (before pull)
      {
        _tag: "result",
        value: {
          stdout: "aaa1111111111111111111111111111111111111\n",
          stderr: "",
          exitCode: 0,
        },
      },
      // shuvbot getBranch
      { _tag: "result", value: { stdout: "main\n", stderr: "", exitCode: 0 } },
      // shuvbot isDirty
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },

      // --- fleet_pull responses ---
      // shuvtest git pull
      {
        _tag: "result",
        value: {
          stdout: "Updating aaa1111..bbb2222\nFast-forward\n",
          stderr: "",
          exitCode: 0,
        },
      },
      // shuvtest getHead (after pull)
      {
        _tag: "result",
        value: {
          stdout: "bbb2222222222222222222222222222222222222\n",
          stderr: "",
          exitCode: 0,
        },
      },
      // shuvbot git pull
      {
        _tag: "result",
        value: {
          stdout: "Updating aaa1111..bbb2222\nFast-forward\n",
          stderr: "",
          exitCode: 0,
        },
      },
      // shuvbot getHead (after pull)
      {
        _tag: "result",
        value: {
          stdout: "bbb2222222222222222222222222222222222222\n",
          stderr: "",
          exitCode: 0,
        },
      },
    ]);

    // Request 1: fleet_status (initial state)
    const statusResult = await client.callTool({
      name: "fleet_status",
      arguments: {},
    });
    expect(statusResult.isError).not.toBe(true);
    const statusParsed = JSON.parse(
      (statusResult.content as Array<{ type: string; text: string }>)[0].text,
    );
    const initialHead = statusParsed.hosts[0].head;
    expect(initialHead).toBe("aaa1111111111111111111111111111111111111");

    // Request 2: fleet_pull (causes state change)
    const pullResult = await client.callTool({
      name: "fleet_pull",
      arguments: {},
    });
    expect(pullResult.isError).not.toBe(true);
    const pullParsed = JSON.parse(
      (pullResult.content as Array<{ type: string; text: string }>)[0].text,
    );

    // After pull, HEAD should be the new commit
    const postPullHead = pullParsed.results[0].head;
    expect(postPullHead).toBe("bbb2222222222222222222222222222222222222");

    // The pull response should show the state changed
    expect(postPullHead).not.toBe(initialHead);
  });

  it("error in one request does not affect subsequent requests", async () => {
    await setup([
      // --- fleet_rollback with invalid ref (all hosts fail) ---
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvtest",
          command: "git checkout invalid-ref",
          exitCode: 1,
          stdout: "",
          stderr: "error: pathspec did not match",
        }),
      },
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvbot",
          command: "git checkout invalid-ref",
          exitCode: 1,
          stdout: "",
          stderr: "error: pathspec did not match",
        }),
      },

      // --- fleet_status responses (should still work after rollback failure) ---
      // shuvtest echo ok
      { _tag: "result", value: { stdout: "ok\n", stderr: "", exitCode: 0 } },
      // shuvtest getHead
      {
        _tag: "result",
        value: {
          stdout: "abc1234567890abcdef1234567890abcdef1234\n",
          stderr: "",
          exitCode: 0,
        },
      },
      // shuvtest getBranch
      { _tag: "result", value: { stdout: "main\n", stderr: "", exitCode: 0 } },
      // shuvtest isDirty
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
      // shuvbot echo ok
      { _tag: "result", value: { stdout: "ok\n", stderr: "", exitCode: 0 } },
      // shuvbot getHead
      {
        _tag: "result",
        value: {
          stdout: "def4567890abcdef1234567890abcdef12345678\n",
          stderr: "",
          exitCode: 0,
        },
      },
      // shuvbot getBranch
      { _tag: "result", value: { stdout: "main\n", stderr: "", exitCode: 0 } },
      // shuvbot isDirty
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
    ]);

    // Request 1: fleet_rollback with invalid ref (should error)
    const rollbackResult = await client.callTool({
      name: "fleet_rollback",
      arguments: { ref: "invalid-ref" },
    });
    expect(rollbackResult.isError).toBe(true);

    // Request 2: fleet_status (should succeed despite previous error)
    const statusResult = await client.callTool({
      name: "fleet_status",
      arguments: {},
    });
    expect(statusResult.isError).not.toBe(true);

    const parsed = JSON.parse(
      (statusResult.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(parsed.hosts).toHaveLength(2);
    expect(parsed.hosts[0].status).toBe("online");
  });
});

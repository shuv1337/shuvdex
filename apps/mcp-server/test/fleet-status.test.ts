/**
 * MCP fleet_status Tool Tests
 *
 * Tests for VAL-MCP-003: fleet_status returns structured host status
 * with connectivity and skill repository state.
 *
 * Also tests VAL-MCP-010: error response format (isError:true with
 * actionable content when all hosts fail).
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

describe("MCP fleet_status tool", () => {
  let client: Client;
  let cleanup: (() => Promise<void>) | undefined;

  /**
   * Set up a fresh MCP server and client for each test, backed by mock SSH.
   * Returns a promise (run inside Effect context) that creates the MCP
   * client/server pair with the given mock responses.
   */
  const setup = async (responses: Array<MockResponse>) => {
    const program = Effect.gen(function* () {
      const mockRef = yield* MockSshResponses;
      yield* Ref.set(mockRef, responses);

      const runtime = yield* Effect.runtime<ServerServices>();
      return runtime;
    }).pipe(Effect.provide(makeTestLayer()));

    const runtime = await Effect.runPromise(program);

    const server = createServer({ registry: testRegistry, repoPath: REPO_PATH, runtime });
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

  it("returns host status for all configured hosts", async () => {
    // Mock: each host gets `echo ok` for connectivity, then getHead, getBranch, isDirty
    // shuvtest: echo ok -> getHead -> getBranch -> isDirty
    // shuvbot:  echo ok -> getHead -> getBranch -> isDirty
    await setup([
      // shuvtest echo ok
      { _tag: "result", value: { stdout: "ok\n", stderr: "", exitCode: 0 } },
      // shuvtest getHead
      { _tag: "result", value: { stdout: "abc1234567890abcdef1234567890abcdef1234\n", stderr: "", exitCode: 0 } },
      // shuvtest getBranch
      { _tag: "result", value: { stdout: "main\n", stderr: "", exitCode: 0 } },
      // shuvtest isDirty
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
      // shuvbot echo ok
      { _tag: "result", value: { stdout: "ok\n", stderr: "", exitCode: 0 } },
      // shuvbot getHead
      { _tag: "result", value: { stdout: "def4567890abcdef1234567890abcdef12345678\n", stderr: "", exitCode: 0 } },
      // shuvbot getBranch
      { _tag: "result", value: { stdout: "main\n", stderr: "", exitCode: 0 } },
      // shuvbot isDirty
      { _tag: "result", value: { stdout: " M somefile.txt\n", stderr: "", exitCode: 0 } },
    ]);

    const result = await client.callTool({ name: "fleet_status", arguments: {} });

    expect(result.isError).not.toBe(true);
    expect(result.content).toHaveLength(1);

    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.hosts).toHaveLength(2);

    // First host - shuvtest
    const host1 = parsed.hosts.find((h: { name: string }) => h.name === "shuvtest");
    expect(host1).toBeDefined();
    expect(host1.status).toBe("online");
    expect(host1.head).toBe("abc1234567890abcdef1234567890abcdef1234");
    expect(host1.branch).toBe("main");
    expect(host1.dirty).toBe(false);

    // Second host - shuvbot
    const host2 = parsed.hosts.find((h: { name: string }) => h.name === "shuvbot");
    expect(host2).toBeDefined();
    expect(host2.status).toBe("online");
    expect(host2.head).toBe("def4567890abcdef1234567890abcdef12345678");
    expect(host2.branch).toBe("main");
    expect(host2.dirty).toBe(true);
  });

  it("handles unreachable host gracefully", async () => {
    await setup([
      // shuvtest echo ok
      { _tag: "result", value: { stdout: "ok\n", stderr: "", exitCode: 0 } },
      // shuvtest getHead
      { _tag: "result", value: { stdout: "abc1234567890abcdef1234567890abcdef1234\n", stderr: "", exitCode: 0 } },
      // shuvtest getBranch
      { _tag: "result", value: { stdout: "main\n", stderr: "", exitCode: 0 } },
      // shuvtest isDirty
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
      // shuvbot echo ok -> CommandFailed
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvbot",
          command: "echo ok",
          exitCode: 255,
          stdout: "",
          stderr: "ssh: connect to host shuvbot port 22: Connection refused",
        }),
      },
    ]);

    const result = await client.callTool({ name: "fleet_status", arguments: {} });

    expect(result.isError).not.toBe(true);
    expect(result.content).toHaveLength(1);

    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.hosts).toHaveLength(2);

    const host1 = parsed.hosts.find((h: { name: string }) => h.name === "shuvtest");
    expect(host1.status).toBe("online");

    const host2 = parsed.hosts.find((h: { name: string }) => h.name === "shuvbot");
    expect(host2.status).toBe("error");
    expect(host2.error).toBeDefined();
  });

  it("returns isError:true when all hosts fail", async () => {
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

    const result = await client.callTool({ name: "fleet_status", arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);

    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.hosts).toHaveLength(2);
    expect(parsed.hosts.every((h: { status: string }) => h.status === "error")).toBe(true);
  });

  it("filters by host names when hosts parameter provided", async () => {
    await setup([
      // shuvtest echo ok
      { _tag: "result", value: { stdout: "ok\n", stderr: "", exitCode: 0 } },
      // shuvtest getHead
      { _tag: "result", value: { stdout: "abc1234567890abcdef1234567890abcdef1234\n", stderr: "", exitCode: 0 } },
      // shuvtest getBranch
      { _tag: "result", value: { stdout: "main\n", stderr: "", exitCode: 0 } },
      // shuvtest isDirty
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
    ]);

    const result = await client.callTool({
      name: "fleet_status",
      arguments: { hosts: ["shuvtest"] },
    });

    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.hosts).toHaveLength(1);
    expect(parsed.hosts[0].name).toBe("shuvtest");
  });

  it("has valid inputSchema with optional hosts parameter", async () => {
    await setup([]);

    const toolsList = await client.listTools();
    const statusTool = toolsList.tools.find((t) => t.name === "fleet_status");
    expect(statusTool).toBeDefined();
    expect(statusTool!.inputSchema.type).toBe("object");
    // hosts is optional
    const required = (statusTool!.inputSchema as Record<string, unknown>).required as string[] | undefined;
    expect(!required || required.length === 0).toBe(true);
  });
});

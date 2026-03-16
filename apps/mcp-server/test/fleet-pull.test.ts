/**
 * MCP fleet_pull Tool Tests
 *
 * Tests for VAL-MCP-007: fleet_pull fetches latest with outcome
 * per host and new HEAD commit.
 */
import { describe, expect, it, afterEach } from "vitest";
import { Effect, Layer, Ref } from "effect";
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

describe("MCP fleet_pull tool", () => {
  let client: Client;
  let cleanup: (() => Promise<void>) | undefined;

  /**
   * Set up a fresh MCP server and client for each test, backed by mock SSH.
   */
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

  it("returns per-host outcome with HEAD after pull", async () => {
    // Mock for pull on shuvtest:
    // 1. cd <repo> && git pull origin => "Already up to date."
    // 2. cd <repo> && git rev-parse HEAD => sha
    // Mock for pull on shuvbot:
    // 3. cd <repo> && git pull origin => "Updating abc..def\n Fast-forward\n file.txt | 1 +\n 1 file changed"
    // 4. cd <repo> && git rev-parse HEAD => sha
    await setup([
      // shuvtest pull
      { _tag: "result", value: { stdout: "Already up to date.\n", stderr: "", exitCode: 0 } },
      // shuvtest getHead
      { _tag: "result", value: { stdout: "abc1234567890abcdef1234567890abcdef1234\n", stderr: "", exitCode: 0 } },
      // shuvbot pull
      { _tag: "result", value: { stdout: "Updating abc..def\n Fast-forward\n file.txt | 1 +\n 1 file changed\n", stderr: "", exitCode: 0 } },
      // shuvbot getHead
      { _tag: "result", value: { stdout: "def4567890abcdef1234567890abcdef12345678\n", stderr: "", exitCode: 0 } },
    ]);

    const result = await client.callTool({
      name: "fleet_pull",
      arguments: {},
    });

    expect(result.isError).not.toBe(true);
    expect(result.content).toHaveLength(1);

    const parsed = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(parsed.results).toHaveLength(2);

    // First host - shuvtest (already up to date)
    const host1 = parsed.results.find(
      (r: { name: string }) => r.name === "shuvtest",
    );
    expect(host1).toBeDefined();
    expect(host1.status).toBe("ok");
    expect(host1.updated).toBe(false);
    expect(host1.summary).toContain("Already up to date");
    expect(host1.head).toBe("abc1234567890abcdef1234567890abcdef1234");

    // Second host - shuvbot (updated)
    const host2 = parsed.results.find(
      (r: { name: string }) => r.name === "shuvbot",
    );
    expect(host2).toBeDefined();
    expect(host2.status).toBe("ok");
    expect(host2.updated).toBe(true);
    expect(host2.head).toBe("def4567890abcdef1234567890abcdef12345678");
  });

  it("marks host as failed when post-pull HEAD verification fails", async () => {
    // shuvtest: pull succeeds but getHead fails
    // shuvbot: pull succeeds and getHead succeeds
    await setup([
      // shuvtest pull (success)
      { _tag: "result", value: { stdout: "Already up to date.\n", stderr: "", exitCode: 0 } },
      // shuvtest getHead (fails)
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvtest",
          command: "git rev-parse HEAD",
          exitCode: 128,
          stdout: "",
          stderr: "fatal: not a git repository",
        }),
      },
      // shuvbot pull (success)
      { _tag: "result", value: { stdout: "Already up to date.\n", stderr: "", exitCode: 0 } },
      // shuvbot getHead (success)
      { _tag: "result", value: { stdout: "def4567890abcdef1234567890abcdef12345678\n", stderr: "", exitCode: 0 } },
    ]);

    const result = await client.callTool({
      name: "fleet_pull",
      arguments: {},
    });

    // Not all failed (shuvbot succeeded), so isError should not be true
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(parsed.results).toHaveLength(2);

    // shuvtest: failed due to HEAD verification
    const host1 = parsed.results.find(
      (r: { name: string }) => r.name === "shuvtest",
    );
    expect(host1).toBeDefined();
    expect(host1.status).toBe("fail");
    expect(host1.error).toContain("HEAD verification failed");

    // shuvbot: succeeded
    const host2 = parsed.results.find(
      (r: { name: string }) => r.name === "shuvbot",
    );
    expect(host2).toBeDefined();
    expect(host2.status).toBe("ok");
    expect(host2.head).toBe("def4567890abcdef1234567890abcdef12345678");
  });

  it("returns isError:true when all hosts fail HEAD verification after pull", async () => {
    await setup([
      // shuvtest pull (success)
      { _tag: "result", value: { stdout: "Already up to date.\n", stderr: "", exitCode: 0 } },
      // shuvtest getHead (fails)
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvtest",
          command: "git rev-parse HEAD",
          exitCode: 128,
          stdout: "",
          stderr: "fatal: not a git repository",
        }),
      },
      // shuvbot pull (success)
      { _tag: "result", value: { stdout: "Already up to date.\n", stderr: "", exitCode: 0 } },
      // shuvbot getHead (fails)
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvbot",
          command: "git rev-parse HEAD",
          exitCode: 128,
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
    const parsed = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(parsed.results).toHaveLength(2);
    for (const hostResult of parsed.results) {
      expect(hostResult.status).toBe("fail");
      expect(hostResult.error).toContain("HEAD verification failed");
    }
  });

  it("handles pull failure gracefully per host", async () => {
    // shuvtest succeeds, shuvbot fails
    await setup([
      // shuvtest pull
      { _tag: "result", value: { stdout: "Already up to date.\n", stderr: "", exitCode: 0 } },
      // shuvtest getHead
      { _tag: "result", value: { stdout: "abc1234567890abcdef1234567890abcdef1234\n", stderr: "", exitCode: 0 } },
      // shuvbot pull fails
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvbot",
          command: "git pull origin",
          exitCode: 128,
          stdout: "",
          stderr: "fatal: not a git repository",
        }),
      },
    ]);

    const result = await client.callTool({
      name: "fleet_pull",
      arguments: {},
    });

    // Not all failed, so isError should not be true
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(parsed.results).toHaveLength(2);

    const host1 = parsed.results.find(
      (r: { name: string }) => r.name === "shuvtest",
    );
    expect(host1.status).toBe("ok");

    const host2 = parsed.results.find(
      (r: { name: string }) => r.name === "shuvbot",
    );
    expect(host2.status).toBe("fail");
    expect(host2.error).toBeDefined();
  });

  it("returns isError:true when all hosts fail", async () => {
    await setup([
      // shuvtest fails
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvtest",
          command: "git pull origin",
          exitCode: 128,
          stdout: "",
          stderr: "Connection refused",
        }),
      },
      // shuvbot fails
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvbot",
          command: "git pull origin",
          exitCode: 128,
          stdout: "",
          stderr: "Connection refused",
        }),
      },
    ]);

    const result = await client.callTool({
      name: "fleet_pull",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(parsed.results).toHaveLength(2);
    for (const hostResult of parsed.results) {
      expect(hostResult.status).toBe("fail");
      expect(hostResult.error).toBeDefined();
    }
  });

  it("filters by host names when hosts parameter provided", async () => {
    await setup([
      // Only shuvbot
      { _tag: "result", value: { stdout: "Already up to date.\n", stderr: "", exitCode: 0 } },
      { _tag: "result", value: { stdout: "abc1234567890abcdef1234567890abcdef1234\n", stderr: "", exitCode: 0 } },
    ]);

    const result = await client.callTool({
      name: "fleet_pull",
      arguments: { hosts: ["shuvbot"] },
    });

    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].name).toBe("shuvbot");
  });

  it("has valid inputSchema with optional hosts parameter", async () => {
    await setup([]);

    const toolsList = await client.listTools();
    const pullTool = toolsList.tools.find((t) => t.name === "fleet_pull");
    expect(pullTool).toBeDefined();
    expect(pullTool!.inputSchema.type).toBe("object");
    // hosts is optional
    const required = (pullTool!.inputSchema as Record<string, unknown>)
      .required as string[] | undefined;
    expect(!required || required.length === 0).toBe(true);
  });
});

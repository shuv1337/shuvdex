/**
 * MCP fleet_deactivate Tool Tests
 *
 * Tests for VAL-MCP-006: fleet_deactivate removes symlink without
 * deleting source skill, verifies repo intact via HEAD check.
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
const ACTIVE_DIR = "~/.codex/skills";

describe("MCP fleet_deactivate tool", () => {
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
      activeDir: ACTIVE_DIR,
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

  it("deactivates skill and verifies repo intact per host", async () => {
    // Mock for deactivateSkill on shuvtest:
    // 1. test -L ... && echo "exists" || echo "absent" => "exists"
    // 2. rm symlinkPath
    // Then getHead for repo-intact verification:
    // 3. git rev-parse HEAD => sha
    // Same for shuvbot:
    // 4-6: same pattern
    await setup([
      // shuvtest deactivate
      { _tag: "result", value: { stdout: "exists\n", stderr: "", exitCode: 0 } },
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
      // shuvtest getHead
      { _tag: "result", value: { stdout: "abc1234567890abcdef1234567890abcdef1234\n", stderr: "", exitCode: 0 } },
      // shuvbot deactivate
      { _tag: "result", value: { stdout: "exists\n", stderr: "", exitCode: 0 } },
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
      // shuvbot getHead
      { _tag: "result", value: { stdout: "def4567890abcdef1234567890abcdef12345678\n", stderr: "", exitCode: 0 } },
    ]);

    const result = await client.callTool({
      name: "fleet_deactivate",
      arguments: { skill: "my-skill" },
    });

    expect(result.isError).not.toBe(true);
    expect(result.content).toHaveLength(1);

    const parsed = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(parsed.skill).toBe("my-skill");
    expect(parsed.results).toHaveLength(2);

    // Verify first host
    const host1 = parsed.results.find(
      (r: { name: string }) => r.name === "shuvtest",
    );
    expect(host1).toBeDefined();
    expect(host1.status).toBe("ok");
    expect(host1.alreadyInState).toBe(false);
    expect(host1.skillStatus).toBe("inactive");
    expect(host1.repoIntact).toBe(true);
    expect(host1.head).toBe("abc1234567890abcdef1234567890abcdef1234");

    // Verify second host
    const host2 = parsed.results.find(
      (r: { name: string }) => r.name === "shuvbot",
    );
    expect(host2).toBeDefined();
    expect(host2.status).toBe("ok");
    expect(host2.repoIntact).toBe(true);
    expect(host2.head).toBe("def4567890abcdef1234567890abcdef12345678");
  });

  it("reports already inactive when skill is not active (idempotent)", async () => {
    // Mock: skill is already inactive
    // 1. test -L => "absent"
    // 2. getHead for repo-intact check
    // Same for shuvbot
    await setup([
      // shuvtest: already inactive
      { _tag: "result", value: { stdout: "absent\n", stderr: "", exitCode: 0 } },
      // shuvtest: getHead
      { _tag: "result", value: { stdout: "abc1234567890abcdef1234567890abcdef1234\n", stderr: "", exitCode: 0 } },
      // shuvbot: already inactive
      { _tag: "result", value: { stdout: "absent\n", stderr: "", exitCode: 0 } },
      // shuvbot: getHead
      { _tag: "result", value: { stdout: "def4567890abcdef1234567890abcdef12345678\n", stderr: "", exitCode: 0 } },
    ]);

    const result = await client.callTool({
      name: "fleet_deactivate",
      arguments: { skill: "my-skill" },
    });

    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(parsed.results).toHaveLength(2);
    for (const hostResult of parsed.results) {
      expect(hostResult.status).toBe("ok");
      expect(hostResult.alreadyInState).toBe(true);
      expect(hostResult.skillStatus).toBe("inactive");
      expect(hostResult.repoIntact).toBe(true);
    }
  });

  it("marks host as failed when post-deactivation HEAD verification fails", async () => {
    // shuvtest: deactivation succeeds but getHead fails
    // shuvbot: deactivation succeeds and getHead succeeds
    await setup([
      // shuvtest deactivate (success)
      { _tag: "result", value: { stdout: "exists\n", stderr: "", exitCode: 0 } },
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
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
      // shuvbot deactivate (success)
      { _tag: "result", value: { stdout: "exists\n", stderr: "", exitCode: 0 } },
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
      // shuvbot getHead (success)
      { _tag: "result", value: { stdout: "def4567890abcdef1234567890abcdef12345678\n", stderr: "", exitCode: 0 } },
    ]);

    const result = await client.callTool({
      name: "fleet_deactivate",
      arguments: { skill: "my-skill" },
    });

    // Not all failed (shuvbot succeeded), so isError should not be true
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(parsed.results).toHaveLength(2);

    // shuvtest: failed due to HEAD verification failure
    const host1 = parsed.results.find(
      (r: { name: string }) => r.name === "shuvtest",
    );
    expect(host1).toBeDefined();
    expect(host1.status).toBe("fail");
    expect(host1.repoIntact).toBe(false);
    expect(host1.error).toContain("HEAD verification failed");

    // shuvbot: succeeded
    const host2 = parsed.results.find(
      (r: { name: string }) => r.name === "shuvbot",
    );
    expect(host2).toBeDefined();
    expect(host2.status).toBe("ok");
    expect(host2.repoIntact).toBe(true);
    expect(host2.head).toBe("def4567890abcdef1234567890abcdef12345678");
  });

  it("returns isError:true when all hosts fail HEAD verification after deactivation", async () => {
    // Both hosts: deactivation succeeds but getHead fails
    await setup([
      // shuvtest deactivate (success)
      { _tag: "result", value: { stdout: "exists\n", stderr: "", exitCode: 0 } },
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
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
      // shuvbot deactivate (success)
      { _tag: "result", value: { stdout: "exists\n", stderr: "", exitCode: 0 } },
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
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
      name: "fleet_deactivate",
      arguments: { skill: "my-skill" },
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

  it("returns isError:true when all hosts fail", async () => {
    await setup([
      // shuvtest: fails
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvtest",
          command: "test -L",
          exitCode: 255,
          stdout: "",
          stderr: "Connection refused",
        }),
      },
      // shuvbot: fails
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvbot",
          command: "test -L",
          exitCode: 255,
          stdout: "",
          stderr: "Connection refused",
        }),
      },
    ]);

    const result = await client.callTool({
      name: "fleet_deactivate",
      arguments: { skill: "my-skill" },
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
      // Only shuvtest
      { _tag: "result", value: { stdout: "exists\n", stderr: "", exitCode: 0 } },
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
      { _tag: "result", value: { stdout: "abc1234567890abcdef1234567890abcdef1234\n", stderr: "", exitCode: 0 } },
    ]);

    const result = await client.callTool({
      name: "fleet_deactivate",
      arguments: { skill: "my-skill", hosts: ["shuvtest"] },
    });

    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].name).toBe("shuvtest");
  });

  it("has valid inputSchema with required skill parameter", async () => {
    await setup([]);

    const toolsList = await client.listTools();
    const deactivateTool = toolsList.tools.find(
      (t) => t.name === "fleet_deactivate",
    );
    expect(deactivateTool).toBeDefined();
    expect(deactivateTool!.inputSchema.type).toBe("object");
    const required = (deactivateTool!.inputSchema as Record<string, unknown>)
      .required as string[];
    expect(required).toContain("skill");
  });
});

/**
 * MCP fleet_activate Tool Tests
 *
 * Tests for VAL-MCP-005: fleet_activate creates skill symlink
 * with path details per host.
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

describe("MCP fleet_activate tool", () => {
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

  it("activates skill and reports symlink paths per host", async () => {
    // Mock responses for activateSkill on shuvtest:
    // 1. checkSymlink: test -L && test -e => "inactive"
    // 2. mkdir -p activeDir
    // 3. test -L && rm || true (remove existing)
    // 4. ln -s (create symlink)
    // Then same for shuvbot:
    // 5-8: same pattern
    await setup([
      // shuvtest
      { _tag: "result", value: { stdout: "inactive\n", stderr: "", exitCode: 0 } },
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
      // shuvbot
      { _tag: "result", value: { stdout: "inactive\n", stderr: "", exitCode: 0 } },
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
    ]);

    const result = await client.callTool({
      name: "fleet_activate",
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
    expect(host1.skillStatus).toBe("active");
    expect(host1.symlinkPath).toBe(`${ACTIVE_DIR}/my-skill`);
    expect(host1.targetPath).toBe(`${REPO_PATH}/my-skill`);

    // Verify second host
    const host2 = parsed.results.find(
      (r: { name: string }) => r.name === "shuvbot",
    );
    expect(host2).toBeDefined();
    expect(host2.status).toBe("ok");
    expect(host2.symlinkPath).toBe(`${ACTIVE_DIR}/my-skill`);
    expect(host2.targetPath).toBe(`${REPO_PATH}/my-skill`);
  });

  it("reports already active when skill is already active (idempotent)", async () => {
    // Mock: skill is already active with correct target
    // 1. checkSymlink => "active"
    // 2. readSymlinkTarget => correct path
    // Same for shuvbot:
    await setup([
      // shuvtest
      { _tag: "result", value: { stdout: "active\n", stderr: "", exitCode: 0 } },
      { _tag: "result", value: { stdout: "~/repos/shuvbot-skills/my-skill\n", stderr: "", exitCode: 0 } },
      // shuvbot
      { _tag: "result", value: { stdout: "active\n", stderr: "", exitCode: 0 } },
      { _tag: "result", value: { stdout: "~/repos/shuvbot-skills/my-skill\n", stderr: "", exitCode: 0 } },
    ]);

    const result = await client.callTool({
      name: "fleet_activate",
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
      expect(hostResult.skillStatus).toBe("active");
    }
  });

  it("returns isError:true when all hosts fail", async () => {
    await setup([
      // shuvtest: checkSymlink fails
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
      // shuvbot: checkSymlink fails
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
      name: "fleet_activate",
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
      // Only shuvtest: activate
      { _tag: "result", value: { stdout: "inactive\n", stderr: "", exitCode: 0 } },
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
      { _tag: "result", value: { stdout: "", stderr: "", exitCode: 0 } },
    ]);

    const result = await client.callTool({
      name: "fleet_activate",
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
    const activateTool = toolsList.tools.find(
      (t) => t.name === "fleet_activate",
    );
    expect(activateTool).toBeDefined();
    expect(activateTool!.inputSchema.type).toBe("object");
    const required = (activateTool!.inputSchema as Record<string, unknown>)
      .required as string[];
    expect(required).toContain("skill");
  });
});

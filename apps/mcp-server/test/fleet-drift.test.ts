/**
 * MCP fleet_drift Tool Tests
 *
 * Tests for VAL-MCP-008: fleet_drift detects commit divergence with
 * per-host commit data and drift status.
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

const SHA_A = "abc1234567890abcdef1234567890abcdef1234";
const SHA_B = "def4567890abcdef1234567890abcdef12345678";

describe("MCP fleet_drift tool", () => {
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

  it("returns per-host commit data when all hosts are in sync", async () => {
    // checkDrift calls getHead on all hosts via SkillOps.checkDrift:
    // 1. getHead for reference host (shuvtest)
    // 2. getHead for shuvbot
    // Both return the same SHA => in_sync
    await setup([
      // shuvtest getHead (reference)
      { _tag: "result", value: { stdout: `${SHA_A}\n`, stderr: "", exitCode: 0 } },
      // shuvbot getHead
      { _tag: "result", value: { stdout: `${SHA_A}\n`, stderr: "", exitCode: 0 } },
    ]);

    const result = await client.callTool({
      name: "fleet_drift",
      arguments: {},
    });

    expect(result.isError).not.toBe(true);
    expect(result.content).toHaveLength(1);

    const parsed = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(parsed.referenceSha).toBe(SHA_A);
    expect(parsed.referenceHost).toBe("shuvtest");
    expect(parsed.hasDrift).toBe(false);
    expect(parsed.driftedCount).toBe(0);
    expect(parsed.inSyncCount).toBe(2);
    expect(parsed.hosts).toHaveLength(2);

    const host1 = parsed.hosts.find(
      (h: { host: string }) => h.host === "shuvtest",
    );
    expect(host1.status).toBe("in_sync");
    expect(host1.sha).toBe(SHA_A);

    const host2 = parsed.hosts.find(
      (h: { host: string }) => h.host === "shuvbot",
    );
    expect(host2.status).toBe("in_sync");
    expect(host2.sha).toBe(SHA_A);
  });

  it("detects drift when hosts have different commits", async () => {
    // Reference host (shuvtest) has SHA_A, shuvbot has SHA_B
    // checkDrift calls:
    // 1. getHead on reference (shuvtest) => SHA_A
    // 2. getHead on shuvbot => SHA_B
    // 3. rev-list --left-right --count on shuvbot => "1\t2" (behind 1, ahead 2)
    await setup([
      // shuvtest getHead (reference)
      { _tag: "result", value: { stdout: `${SHA_A}\n`, stderr: "", exitCode: 0 } },
      // shuvbot getHead
      { _tag: "result", value: { stdout: `${SHA_B}\n`, stderr: "", exitCode: 0 } },
      // shuvbot rev-list --left-right --count
      { _tag: "result", value: { stdout: "0\t3\n", stderr: "", exitCode: 0 } },
    ]);

    const result = await client.callTool({
      name: "fleet_drift",
      arguments: {},
    });

    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(parsed.referenceSha).toBe(SHA_A);
    expect(parsed.hasDrift).toBe(true);
    expect(parsed.driftedCount).toBe(1);
    expect(parsed.inSyncCount).toBe(1);

    const drifted = parsed.hosts.find(
      (h: { host: string }) => h.host === "shuvbot",
    );
    expect(drifted.status).toBe("drifted");
    expect(drifted.sha).toBe(SHA_B);
    expect(drifted.direction).toBe("ahead");
    expect(drifted.ahead).toBe(3);
    expect(drifted.behind).toBe(0);
  });

  it("handles unreachable host in drift check", async () => {
    // Reference host (shuvtest) responds, shuvbot fails
    await setup([
      // shuvtest getHead (reference)
      { _tag: "result", value: { stdout: `${SHA_A}\n`, stderr: "", exitCode: 0 } },
      // shuvbot getHead fails
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvbot",
          command: "git rev-parse HEAD",
          exitCode: 255,
          stdout: "",
          stderr: "ssh: connect to host shuvbot port 22: Connection refused",
        }),
      },
    ]);

    const result = await client.callTool({
      name: "fleet_drift",
      arguments: {},
    });

    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(parsed.referenceSha).toBe(SHA_A);
    expect(parsed.unreachableCount).toBe(1);

    const unreachable = parsed.hosts.find(
      (h: { host: string }) => h.host === "shuvbot",
    );
    expect(unreachable.status).toBe("unreachable");
    expect(unreachable.error).toBeDefined();
  });

  it("returns isError:true when reference host fails", async () => {
    // Reference host (shuvtest) fails => DriftCheckFailed
    await setup([
      // shuvtest getHead fails
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
    ]);

    const result = await client.callTool({
      name: "fleet_drift",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(parsed.error).toBeDefined();
  });

  it("respects custom referenceHost parameter", async () => {
    // Use shuvbot as reference instead of default first host
    await setup([
      // shuvbot getHead (reference)
      { _tag: "result", value: { stdout: `${SHA_B}\n`, stderr: "", exitCode: 0 } },
      // shuvtest getHead
      { _tag: "result", value: { stdout: `${SHA_B}\n`, stderr: "", exitCode: 0 } },
    ]);

    const result = await client.callTool({
      name: "fleet_drift",
      arguments: { referenceHost: "shuvbot" },
    });

    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(parsed.referenceHost).toBe("shuvbot");
    expect(parsed.referenceSha).toBe(SHA_B);
    expect(parsed.hasDrift).toBe(false);
  });

  it("has valid inputSchema with optional hosts and referenceHost parameters", async () => {
    await setup([]);

    const toolsList = await client.listTools();
    const driftTool = toolsList.tools.find((t) => t.name === "fleet_drift");
    expect(driftTool).toBeDefined();
    expect(driftTool!.inputSchema.type).toBe("object");
    // Both hosts and referenceHost are optional
    const required = (driftTool!.inputSchema as Record<string, unknown>)
      .required as string[] | undefined;
    expect(!required || required.length === 0).toBe(true);
  });
});

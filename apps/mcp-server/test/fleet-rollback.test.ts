/**
 * MCP fleet_rollback Tool Tests
 *
 * Tests for VAL-MCP-009: fleet_rollback checks out specified ref
 * with resulting HEAD per host.
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

const SHA_TARGET = "aaa1111222233334444555566667777888899990";

describe("MCP fleet_rollback tool", () => {
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

  it("checks out ref and returns resulting HEAD per host", async () => {
    // For each host, checkoutRef then getHead:
    // shuvtest: checkoutRef => success, getHead => SHA_TARGET
    // shuvbot:  checkoutRef => success, getHead => SHA_TARGET
    await setup([
      // shuvtest checkoutRef (git checkout <ref>)
      { _tag: "result", value: { stdout: "", stderr: "Switched to branch 'v1.0'\n", exitCode: 0 } },
      // shuvtest getHead
      { _tag: "result", value: { stdout: `${SHA_TARGET}\n`, stderr: "", exitCode: 0 } },
      // shuvbot checkoutRef
      { _tag: "result", value: { stdout: "", stderr: "Switched to branch 'v1.0'\n", exitCode: 0 } },
      // shuvbot getHead
      { _tag: "result", value: { stdout: `${SHA_TARGET}\n`, stderr: "", exitCode: 0 } },
    ]);

    const result = await client.callTool({
      name: "fleet_rollback",
      arguments: { ref: "v1.0" },
    });

    expect(result.isError).not.toBe(true);
    expect(result.content).toHaveLength(1);

    const parsed = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(parsed.ref).toBe("v1.0");
    expect(parsed.results).toHaveLength(2);

    // shuvtest
    const host1 = parsed.results.find(
      (r: { name: string }) => r.name === "shuvtest",
    );
    expect(host1).toBeDefined();
    expect(host1.status).toBe("ok");
    expect(host1.head).toBe(SHA_TARGET);

    // shuvbot
    const host2 = parsed.results.find(
      (r: { name: string }) => r.name === "shuvbot",
    );
    expect(host2).toBeDefined();
    expect(host2.status).toBe("ok");
    expect(host2.head).toBe(SHA_TARGET);
  });

  it("handles checkout failure gracefully per host", async () => {
    // shuvtest succeeds, shuvbot fails
    await setup([
      // shuvtest checkoutRef
      { _tag: "result", value: { stdout: "", stderr: "Switched to branch 'v1.0'\n", exitCode: 0 } },
      // shuvtest getHead
      { _tag: "result", value: { stdout: `${SHA_TARGET}\n`, stderr: "", exitCode: 0 } },
      // shuvbot checkoutRef fails (invalid ref)
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvbot",
          command: "git checkout v1.0",
          exitCode: 1,
          stdout: "",
          stderr: "error: pathspec 'v1.0' did not match any file(s) known to git",
        }),
      },
    ]);

    const result = await client.callTool({
      name: "fleet_rollback",
      arguments: { ref: "v1.0" },
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
    expect(host1.head).toBe(SHA_TARGET);

    const host2 = parsed.results.find(
      (r: { name: string }) => r.name === "shuvbot",
    );
    expect(host2.status).toBe("fail");
    expect(host2.error).toBeDefined();
  });

  it("returns isError:true when all hosts fail", async () => {
    await setup([
      // shuvtest checkoutRef fails
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvtest",
          command: "git checkout nonexistent",
          exitCode: 1,
          stdout: "",
          stderr: "error: pathspec 'nonexistent' did not match any file(s) known to git",
        }),
      },
      // shuvbot checkoutRef fails
      {
        _tag: "error",
        value: new CommandFailed({
          host: "shuvbot",
          command: "git checkout nonexistent",
          exitCode: 1,
          stdout: "",
          stderr: "error: pathspec 'nonexistent' did not match any file(s) known to git",
        }),
      },
    ]);

    const result = await client.callTool({
      name: "fleet_rollback",
      arguments: { ref: "nonexistent" },
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
      { _tag: "result", value: { stdout: "", stderr: "Switched to branch 'v1.0'\n", exitCode: 0 } },
      { _tag: "result", value: { stdout: `${SHA_TARGET}\n`, stderr: "", exitCode: 0 } },
    ]);

    const result = await client.callTool({
      name: "fleet_rollback",
      arguments: { ref: "v1.0", hosts: ["shuvbot"] },
    });

    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text,
    );
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].name).toBe("shuvbot");
    expect(parsed.results[0].head).toBe(SHA_TARGET);
  });

  it("has valid inputSchema with required ref and optional hosts", async () => {
    await setup([]);

    const toolsList = await client.listTools();
    const rollbackTool = toolsList.tools.find(
      (t) => t.name === "fleet_rollback",
    );
    expect(rollbackTool).toBeDefined();
    expect(rollbackTool!.inputSchema.type).toBe("object");
    // ref is required
    const required = (rollbackTool!.inputSchema as Record<string, unknown>)
      .required as string[] | undefined;
    expect(required).toContain("ref");
  });
});

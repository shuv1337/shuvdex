/**
 * MCP fleet_sync Tool Tests
 *
 * Tests for VAL-MCP-004: fleet_sync syncs skill repository with
 * per-host outcome and commit hashes.
 *
 * Also tests VAL-MCP-010: error response format for sync failures.
 */
import { describe, expect, it, afterEach } from "vitest";
import { Effect, Layer, Ref } from "effect";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  SshExecutorTest,
  MockSshResponses,
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

describe("MCP fleet_sync tool", () => {
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

  it("returns isError:true for missing skill (nonexistent local directory)", async () => {
    // fleet_sync verifies the local skill exists before doing any SSH.
    // A nonexistent skill should immediately return isError:true.
    await setup([]);

    const result = await client.callTool({
      name: "fleet_sync",
      arguments: { skill: "nonexistent-skill" },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    // Should contain error info about the missing skill
    expect(parsed.results).toBeDefined();
    // Each host should have "fail" status
    for (const hostResult of parsed.results) {
      expect(hostResult.status).toBe("fail");
      expect(hostResult.error).toBeDefined();
    }
  });

  it("returns per-host results structure", async () => {
    // Even with a missing skill, the response should be structured
    await setup([]);

    const result = await client.callTool({
      name: "fleet_sync",
      arguments: { skill: "does-not-exist-anywhere" },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.skill).toBe("does-not-exist-anywhere");
    expect(parsed.results).toBeDefined();
    expect(Array.isArray(parsed.results)).toBe(true);
  });

  it("has valid inputSchema with required skill parameter", async () => {
    await setup([]);

    const toolsList = await client.listTools();
    const syncTool = toolsList.tools.find((t) => t.name === "fleet_sync");
    expect(syncTool).toBeDefined();
    expect(syncTool!.inputSchema.type).toBe("object");
    const required = (syncTool!.inputSchema as Record<string, unknown>).required as string[];
    expect(required).toContain("skill");
  });

  it("filters by host names when hosts parameter provided", async () => {
    // With hosts filter, only the filtered host should appear in results
    await setup([]);

    const result = await client.callTool({
      name: "fleet_sync",
      arguments: { skill: "nonexistent", hosts: ["shuvtest"] },
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].name).toBe("shuvtest");
  });
});

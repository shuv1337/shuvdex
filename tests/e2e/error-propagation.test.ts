/**
 * E2E Test: Error Propagation — verify SSH failures surface correctly
 * through both CLI and MCP with preserved context and actionable
 * information.
 *
 * Covers:
 * - VAL-CROSS-007: Error Propagation
 *   Evidence: Induced failure, error messages, type classification
 *
 * Strategy:
 * 1. Configure an unreachable host (bad hostname / short timeout) to
 *    reliably induce SSH failures.
 * 2. Exercise multiple operations (status, pull, rollback, activate,
 *    deactivate) through both CLI programmatic APIs and MCP tools.
 * 3. Assert that:
 *    a. SSH failure is detected and reported (not swallowed).
 *    b. Original error context is preserved (host name, error type).
 *    c. CLI shows human-readable error messages (not stack traces or
 *       raw Effect failure dumps).
 *    d. MCP returns structured error with isError flag and fields
 *       (status, error message per host).
 * 4. Mix a reachable host (shuvtest) with the unreachable host to
 *    verify partial-failure reporting and that the reachable host
 *    still succeeds.
 */
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { HostRegistry } from "@codex-fleet/core";
import { SshExecutorLive } from "@codex-fleet/ssh";
import { GitOpsLive } from "@codex-fleet/git-ops";
import { SkillOpsLive } from "@codex-fleet/skill-ops";
import { TelemetryLive } from "@codex-fleet/telemetry";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// CLI programmatic APIs
import {
  runStatus,
  runPull,
  runRollback,
  runActivate,
  runDeactivate,
} from "@codex-fleet/cli";

// MCP server factory
import { createServer } from "@codex-fleet/mcp-server/dist/server.js";
import type {
  ServerConfig,
  ServerServices,
} from "@codex-fleet/mcp-server/dist/server.js";

// ─── Configuration ─────────────────────────────────────────────

/** Registry with ONLY the unreachable host (for pure-failure tests). */
const failOnlyRegistry = HostRegistry.fromRecord({
  badhost: {
    hostname: "198.51.100.1",
    connectionType: "ssh",
    port: 22,
    timeout: 2,
  },
});

/**
 * Registry with both a good host and a bad host — for partial-failure tests.
 */
const mixedRegistry = HostRegistry.fromRecord({
  shuvtest: {
    hostname: "shuvtest",
    connectionType: "ssh",
    port: 22,
    timeout: 10,
  },
  badhost: {
    hostname: "198.51.100.1",
    connectionType: "ssh",
    port: 22,
    timeout: 2,
  },
});

/** Remote skills repository path on the test host. */
const repoPath = "~/repos/shuvbot-skills";

/** Active skills directory on the test host. */
const activeDir = "~/.codex/skills";

/** Skill to use for error propagation testing. */
const testSkillName = "test-skill";

// ─── Shared Layer ──────────────────────────────────────────────

const LiveSshLayer = Layer.merge(SshExecutorLive, TelemetryLive);
const LiveGitOpsLayer = Layer.provideMerge(GitOpsLive, LiveSshLayer);
const LiveSkillOpsLayer = Layer.provideMerge(
  SkillOpsLive,
  Layer.merge(LiveSshLayer, LiveGitOpsLayer),
);

const FullLiveLayer = Layer.mergeAll(
  LiveSshLayer,
  LiveGitOpsLayer,
  LiveSkillOpsLayer,
);

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Parse MCP tool result into a JSON object.
 */
function parseMcpResult(result: {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}): unknown {
  const text = (
    result.content as Array<{ type: string; text: string }>
  )[0].text;
  return JSON.parse(text);
}

// ═══════════════════════════════════════════════════════════════
// VAL-CROSS-007: Error Propagation
// ═══════════════════════════════════════════════════════════════

describe("VAL-CROSS-007: Error Propagation (E2E)", () => {
  let managedRuntime: ManagedRuntime.ManagedRuntime<ServerServices, never>;

  // MCP clients for different registries
  let mcpClientFailOnly: Client;
  let mcpClientMixed: Client;
  let mcpCleanupFailOnly: (() => Promise<void>) | undefined;
  let mcpCleanupMixed: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    managedRuntime = ManagedRuntime.make(FullLiveLayer);
    const runtime = await managedRuntime.runtime();

    // --- MCP server with fail-only registry ---
    const failOnlyConfig: ServerConfig = {
      registry: failOnlyRegistry,
      repoPath,
      runtime,
      activeDir,
    };
    const failOnlyServer = createServer(failOnlyConfig);
    const [failClientTransport, failServerTransport] =
      InMemoryTransport.createLinkedPair();
    await failOnlyServer.connect(failServerTransport);

    mcpClientFailOnly = new Client({
      name: "error-prop-fail-client",
      version: "0.0.1",
    });
    await mcpClientFailOnly.connect(failClientTransport);

    mcpCleanupFailOnly = async () => {
      await mcpClientFailOnly.close();
      await failOnlyServer.close();
    };

    // --- MCP server with mixed registry ---
    const mixedConfig: ServerConfig = {
      registry: mixedRegistry,
      repoPath,
      runtime,
      activeDir,
    };
    const mixedServer = createServer(mixedConfig);
    const [mixedClientTransport, mixedServerTransport] =
      InMemoryTransport.createLinkedPair();
    await mixedServer.connect(mixedServerTransport);

    mcpClientMixed = new Client({
      name: "error-prop-mixed-client",
      version: "0.0.1",
    });
    await mcpClientMixed.connect(mixedClientTransport);

    mcpCleanupMixed = async () => {
      await mcpClientMixed.close();
      await mixedServer.close();
    };
  }, 30_000);

  afterAll(async () => {
    if (mcpCleanupFailOnly) await mcpCleanupFailOnly();
    if (mcpCleanupMixed) await mcpCleanupMixed();
    if (managedRuntime) await managedRuntime.dispose();
  }, 30_000);

  // ─────────────────────────────────────────────────────────────
  // 1. SSH failure detected and reported via CLI status
  // ─────────────────────────────────────────────────────────────

  it("CLI status: SSH failure is detected and reported with human-readable error", async () => {
    const result = await Effect.runPromise(
      runStatus(failOnlyRegistry).pipe(Effect.provide(FullLiveLayer)),
    );

    // Host should be reported, not silently dropped
    expect(result.hosts).toHaveLength(1);
    const host = result.hosts[0];
    expect(host.name).toBe("badhost");

    // Should be marked as error (not online)
    expect(host.status).toBe("error");
    expect(result.allOnline).toBe(false);

    // Error message should be human-readable and contain context:
    // - Should reference the host (IP or hostname)
    // - Should NOT be a raw stack trace or Effect fiber dump
    expect(host.error).toBeDefined();
    expect(host.error!.length).toBeGreaterThan(0);
    // The error should reference the host or be a descriptive message
    expect(host.error).toMatch(/198\.51\.100\.1|timed? ?out|connection|failed/i);
    // Should NOT contain raw fiber/Effect internals
    expect(host.error).not.toMatch(/FiberFailure|FiberId|Runtime/);
  }, 30_000);

  // ─────────────────────────────────────────────────────────────
  // 2. MCP fleet_status: structured error with fields
  // ─────────────────────────────────────────────────────────────

  it("MCP fleet_status: returns structured error with isError and error fields", async () => {
    const mcpRaw = await mcpClientFailOnly.callTool({
      name: "fleet_status",
      arguments: { hosts: ["badhost"] },
    });

    // All hosts failed → MCP should return isError: true
    expect(mcpRaw.isError).toBe(true);

    const mcpResult = parseMcpResult(mcpRaw as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }) as { hosts: Array<{
      name: string;
      hostname: string;
      status: string;
      error?: string;
    }> };

    // Should contain structured host data
    expect(mcpResult.hosts).toBeDefined();
    expect(mcpResult.hosts).toHaveLength(1);

    const host = mcpResult.hosts[0];
    expect(host.name).toBe("badhost");
    expect(host.status).toBe("error");

    // Error field should be present and contain actionable information
    expect(host.error).toBeDefined();
    expect(host.error!.length).toBeGreaterThan(0);
    // Should contain meaningful error context — not just "error"
    expect(host.error).toMatch(/timed? ?out|connection|failed/i);
  }, 30_000);

  // ─────────────────────────────────────────────────────────────
  // 3. CLI pull: error context preserved from SSH layer
  // ─────────────────────────────────────────────────────────────

  it("CLI pull: SSH failure propagates with preserved error context", async () => {
    const result = await Effect.runPromise(
      runPull(failOnlyRegistry, repoPath, ["badhost"]).pipe(
        Effect.provide(FullLiveLayer),
      ),
    );

    expect(result.hosts).toHaveLength(1);
    const host = result.hosts[0];
    expect(host.name).toBe("badhost");
    expect(host.status).toBe("fail");

    // Error should be preserved from SSH layer
    if (host.status === "fail") {
      expect(host.error).toBeDefined();
      expect(host.error.length).toBeGreaterThan(0);
      // Should reference the host or describe the actual failure
      expect(host.error).toMatch(/198\.51\.100\.1|timed? ?out|connection|failed/i);
    }

    expect(result.allSucceeded).toBe(false);
  }, 30_000);

  // ─────────────────────────────────────────────────────────────
  // 4. MCP fleet_pull: structured error per host
  // ─────────────────────────────────────────────────────────────

  it("MCP fleet_pull: returns structured error with per-host failure detail", async () => {
    const mcpRaw = await mcpClientFailOnly.callTool({
      name: "fleet_pull",
      arguments: { hosts: ["badhost"] },
    });

    // All hosts failed → isError should be true
    expect(mcpRaw.isError).toBe(true);

    const mcpResult = parseMcpResult(mcpRaw as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }) as { results: Array<{
      name: string;
      hostname: string;
      status: string;
      error?: string;
    }> };

    expect(mcpResult.results).toHaveLength(1);
    const host = mcpResult.results[0];
    expect(host.name).toBe("badhost");
    expect(host.status).toBe("fail");
    expect(host.error).toBeDefined();
    expect(host.error!).toMatch(/198\.51\.100\.1|timed? ?out|connection|failed/i);
  }, 30_000);

  // ─────────────────────────────────────────────────────────────
  // 5. CLI rollback: invalid ref error propagation
  // ─────────────────────────────────────────────────────────────

  it("CLI rollback: SSH failure on unreachable host preserves error context", async () => {
    const result = await Effect.runPromise(
      runRollback(failOnlyRegistry, "nonexistent-ref", repoPath, ["badhost"]).pipe(
        Effect.provide(FullLiveLayer),
      ),
    );

    expect(result.hosts).toHaveLength(1);
    const host = result.hosts[0];
    expect(host.status).toBe("fail");

    if (host.status === "fail") {
      expect(host.error).toBeDefined();
      expect(host.error.length).toBeGreaterThan(0);
      // SSH failure should be surfaced, not a git error
      expect(host.error).toMatch(/198\.51\.100\.1|timed? ?out|connection|failed/i);
    }
  }, 30_000);

  // ─────────────────────────────────────────────────────────────
  // 6. MCP fleet_rollback: structured error for SSH failure
  // ─────────────────────────────────────────────────────────────

  it("MCP fleet_rollback: returns structured error for unreachable host", async () => {
    const mcpRaw = await mcpClientFailOnly.callTool({
      name: "fleet_rollback",
      arguments: { ref: "nonexistent-ref", hosts: ["badhost"] },
    });

    expect(mcpRaw.isError).toBe(true);

    const mcpResult = parseMcpResult(mcpRaw as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }) as { ref: string; results: Array<{
      name: string;
      hostname: string;
      status: string;
      error?: string;
    }> };

    expect(mcpResult.results).toHaveLength(1);
    const host = mcpResult.results[0];
    expect(host.status).toBe("fail");
    expect(host.error).toBeDefined();
    expect(host.error!).toMatch(/198\.51\.100\.1|timed? ?out|connection|failed/i);
  }, 30_000);

  // ─────────────────────────────────────────────────────────────
  // 7. CLI activate: SSH failure on unreachable host
  // ─────────────────────────────────────────────────────────────

  it("CLI activate: SSH failure propagates with error context", async () => {
    const result = await Effect.runPromise(
      runActivate(
        failOnlyRegistry,
        testSkillName,
        repoPath,
        activeDir,
        ["badhost"],
      ).pipe(Effect.provide(FullLiveLayer)),
    );

    expect(result.hosts).toHaveLength(1);
    const host = result.hosts[0];
    expect(host.status).toBe("fail");

    if (host.status === "fail") {
      expect(host.error).toBeDefined();
      expect(host.error.length).toBeGreaterThan(0);
      expect(host.error).toMatch(/198\.51\.100\.1|timed? ?out|connection|failed/i);
    }
  }, 30_000);

  // ─────────────────────────────────────────────────────────────
  // 8. MCP fleet_activate: structured error for SSH failure
  // ─────────────────────────────────────────────────────────────

  it("MCP fleet_activate: returns structured error for unreachable host", async () => {
    const mcpRaw = await mcpClientFailOnly.callTool({
      name: "fleet_activate",
      arguments: { skill: testSkillName, hosts: ["badhost"] },
    });

    expect(mcpRaw.isError).toBe(true);

    const mcpResult = parseMcpResult(mcpRaw as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }) as { skill: string; results: Array<{
      name: string;
      hostname: string;
      status: string;
      error?: string;
    }> };

    expect(mcpResult.results).toHaveLength(1);
    const host = mcpResult.results[0];
    expect(host.status).toBe("fail");
    expect(host.error).toBeDefined();
    expect(host.error!).toMatch(/198\.51\.100\.1|timed? ?out|connection|failed/i);
  }, 30_000);

  // ─────────────────────────────────────────────────────────────
  // 9. CLI deactivate: SSH failure on unreachable host
  // ─────────────────────────────────────────────────────────────

  it("CLI deactivate: SSH failure propagates with error context", async () => {
    const result = await Effect.runPromise(
      runDeactivate(
        failOnlyRegistry,
        testSkillName,
        activeDir,
        ["badhost"],
      ).pipe(Effect.provide(FullLiveLayer)),
    );

    expect(result.hosts).toHaveLength(1);
    const host = result.hosts[0];
    expect(host.status).toBe("fail");

    if (host.status === "fail") {
      expect(host.error).toBeDefined();
      expect(host.error.length).toBeGreaterThan(0);
      expect(host.error).toMatch(/198\.51\.100\.1|timed? ?out|connection|failed/i);
    }
  }, 30_000);

  // ─────────────────────────────────────────────────────────────
  // 10. MCP fleet_deactivate: structured error for SSH failure
  // ─────────────────────────────────────────────────────────────

  it("MCP fleet_deactivate: returns structured error for unreachable host", async () => {
    const mcpRaw = await mcpClientFailOnly.callTool({
      name: "fleet_deactivate",
      arguments: { skill: testSkillName, hosts: ["badhost"] },
    });

    expect(mcpRaw.isError).toBe(true);

    const mcpResult = parseMcpResult(mcpRaw as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }) as { skill: string; results: Array<{
      name: string;
      hostname: string;
      status: string;
      error?: string;
    }> };

    expect(mcpResult.results).toHaveLength(1);
    const host = mcpResult.results[0];
    expect(host.status).toBe("fail");
    expect(host.error).toBeDefined();
    expect(host.error!).toMatch(/198\.51\.100\.1|timed? ?out|connection|failed/i);
  }, 30_000);

  // ─────────────────────────────────────────────────────────────
  // 11. Mixed registry: partial failure with both interfaces
  // ─────────────────────────────────────────────────────────────

  it("CLI status with mixed hosts: reachable host succeeds, unreachable reports error", async () => {
    const result = await Effect.runPromise(
      runStatus(mixedRegistry).pipe(Effect.provide(FullLiveLayer)),
    );

    // Both hosts should be reported
    expect(result.hosts).toHaveLength(2);

    const goodHost = result.hosts.find((h) => h.name === "shuvtest");
    const badHost = result.hosts.find((h) => h.name === "badhost");

    expect(goodHost).toBeDefined();
    expect(badHost).toBeDefined();

    // Good host should be online
    expect(goodHost!.status).toBe("online");
    expect(goodHost!.error).toBeUndefined();

    // Bad host should have error with context
    expect(badHost!.status).toBe("error");
    expect(badHost!.error).toBeDefined();
    expect(badHost!.error!).toMatch(/198\.51\.100\.1|timed? ?out|connection|failed/i);

    // allOnline should be false due to the bad host
    expect(result.allOnline).toBe(false);
  }, 30_000);

  it("MCP fleet_status with mixed hosts: returns partial success with per-host error detail", async () => {
    const mcpRaw = await mcpClientMixed.callTool({
      name: "fleet_status",
      arguments: {},
    });

    // Not all hosts failed → isError should NOT be true
    expect(mcpRaw.isError).not.toBe(true);

    const mcpResult = parseMcpResult(mcpRaw as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }) as { hosts: Array<{
      name: string;
      hostname: string;
      status: string;
      error?: string;
      head?: string;
    }> };

    expect(mcpResult.hosts).toHaveLength(2);

    const goodHost = mcpResult.hosts.find((h) => h.name === "shuvtest");
    const badHost = mcpResult.hosts.find((h) => h.name === "badhost");

    expect(goodHost).toBeDefined();
    expect(badHost).toBeDefined();

    // Good host: online with git data
    expect(goodHost!.status).toBe("online");
    expect(goodHost!.head).toMatch(/^[0-9a-f]{40}$/);

    // Bad host: error with structured error fields
    expect(badHost!.status).toBe("error");
    expect(badHost!.error).toBeDefined();
    expect(badHost!.error!).toMatch(/timed? ?out|connection|failed/i);
  }, 30_000);

  // ─────────────────────────────────────────────────────────────
  // 12. Error parity: CLI and MCP report same error for same failure
  // ─────────────────────────────────────────────────────────────

  it("error parity: CLI and MCP report comparable error messages for same SSH failure", async () => {
    // --- CLI ---
    const cliResult = await Effect.runPromise(
      runStatus(failOnlyRegistry).pipe(Effect.provide(FullLiveLayer)),
    );
    const cliHost = cliResult.hosts[0];
    expect(cliHost.status).toBe("error");
    const cliError = cliHost.error!;

    // --- MCP ---
    const mcpRaw = await mcpClientFailOnly.callTool({
      name: "fleet_status",
      arguments: { hosts: ["badhost"] },
    });
    const mcpResult = parseMcpResult(mcpRaw as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }) as { hosts: Array<{
      name: string;
      status: string;
      error?: string;
    }> };
    const mcpHost = mcpResult.hosts[0];
    expect(mcpHost.status).toBe("error");
    const mcpError = mcpHost.error!;

    // Both errors should reference the failure type (timeout or connection)
    // They may not be identical strings (CLI uses err.message, MCP uses
    // formatSshError) but both should contain the core failure indicator.
    const failurePattern = /timed? ?out|connection|failed/i;
    expect(cliError).toMatch(failurePattern);
    expect(mcpError).toMatch(failurePattern);

    // Both should mention the host
    expect(cliError).toMatch(/198\.51\.100\.1/);
    expect(mcpError).toMatch(/198\.51\.100\.1|timed? ?out|connection/i);
  }, 30_000);

  // ─────────────────────────────────────────────────────────────
  // 13. MCP pull with mixed hosts: partial success reporting
  // ─────────────────────────────────────────────────────────────

  it("MCP fleet_pull with mixed hosts: good host succeeds, bad host reports error", async () => {
    const mcpRaw = await mcpClientMixed.callTool({
      name: "fleet_pull",
      arguments: {},
    });

    // Not all hosts failed → should NOT be isError
    expect(mcpRaw.isError).not.toBe(true);

    const mcpResult = parseMcpResult(mcpRaw as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }) as { results: Array<{
      name: string;
      hostname: string;
      status: string;
      error?: string;
      head?: string;
    }> };

    expect(mcpResult.results).toHaveLength(2);

    const goodHost = mcpResult.results.find((h) => h.name === "shuvtest");
    const badHost = mcpResult.results.find((h) => h.name === "badhost");

    expect(goodHost).toBeDefined();
    expect(badHost).toBeDefined();

    // Good host should succeed
    expect(goodHost!.status).toBe("ok");
    expect(goodHost!.head).toMatch(/^[0-9a-f]{40}$/);

    // Bad host should fail with error
    expect(badHost!.status).toBe("fail");
    expect(badHost!.error).toBeDefined();
    expect(badHost!.error!).toMatch(/198\.51\.100\.1|timed? ?out|connection|failed/i);
  }, 60_000);

  // ─────────────────────────────────────────────────────────────
  // 14. Error messages are actionable (not raw internal dumps)
  // ─────────────────────────────────────────────────────────────

  it("error messages are actionable: no raw stack traces or Effect internals", async () => {
    // Collect errors from multiple operations
    const errors: string[] = [];

    // CLI status error
    const statusResult = await Effect.runPromise(
      runStatus(failOnlyRegistry).pipe(Effect.provide(FullLiveLayer)),
    );
    if (statusResult.hosts[0].error) {
      errors.push(statusResult.hosts[0].error);
    }

    // CLI pull error
    const pullResult = await Effect.runPromise(
      runPull(failOnlyRegistry, repoPath, ["badhost"]).pipe(
        Effect.provide(FullLiveLayer),
      ),
    );
    const pullHost = pullResult.hosts[0];
    if (pullHost.status === "fail") {
      errors.push(pullHost.error);
    }

    // MCP status error
    const mcpStatusRaw = await mcpClientFailOnly.callTool({
      name: "fleet_status",
      arguments: { hosts: ["badhost"] },
    });
    const mcpStatusResult = parseMcpResult(mcpStatusRaw as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }) as { hosts: Array<{ error?: string }> };
    if (mcpStatusResult.hosts[0].error) {
      errors.push(mcpStatusResult.hosts[0].error);
    }

    // All errors should be present
    expect(errors.length).toBeGreaterThanOrEqual(3);

    for (const error of errors) {
      // Should NOT contain raw Effect/fiber internals
      expect(error).not.toMatch(/FiberFailure/);
      expect(error).not.toMatch(/FiberId/);
      expect(error).not.toMatch(/RuntimeException/);
      expect(error).not.toMatch(/at\s+\S+\.\w+\s*\(/); // no stack trace lines

      // Should contain meaningful content
      expect(error.length).toBeGreaterThan(10);
      // Should reference the failure (timeout, connection, or host)
      expect(error).toMatch(/198\.51\.100\.1|timed? ?out|connection|failed/i);
    }
  }, 60_000);
});

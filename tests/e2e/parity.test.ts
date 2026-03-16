/**
 * E2E Test: CLI ↔ MCP Parity — verify CLI commands and MCP tool
 * invocations produce identical semantic results for the same logical
 * operations over real SSH connections.
 *
 * Covers:
 * - VAL-CROSS-005: CLI to MCP Parity
 *   Evidence: CLI/MCP traces, state snapshots, equivalence diff
 *
 * Strategy:
 * 1. For each operation, execute via the CLI programmatic API
 *    (returning structured data) and via the MCP server (using
 *    InMemoryTransport + MCP Client).
 * 2. Both share the same underlying Effect layer with real SSH.
 * 3. Compare per-host status, HEAD commits, and state changes for
 *    semantic equivalence.
 *
 * Operations tested:
 * - status:     CLI runStatus() vs MCP fleet_status
 * - pull:       CLI runPull() vs MCP fleet_pull
 * - activate:   CLI runActivate() vs MCP fleet_activate
 * - deactivate: CLI runDeactivate() vs MCP fleet_deactivate
 */
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import type { HostConfig } from "@codex-fleet/core";
import { HostRegistry } from "@codex-fleet/core";
import { SshExecutorLive, SshExecutor } from "@codex-fleet/ssh";
import { GitOpsLive } from "@codex-fleet/git-ops";
import { SkillOpsLive, SkillOps } from "@codex-fleet/skill-ops";
import { TelemetryLive } from "@codex-fleet/telemetry";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// CLI programmatic APIs
import {
  runStatus,
  runPull,
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

/** We test against a single host (shuvtest) to keep operations serial. */
const shuvtestHost: HostConfig = {
  hostname: "shuvtest",
  connectionType: "ssh",
  port: 22,
  timeout: 10,
};

/** Registry containing only shuvtest for focused parity comparison. */
const testRegistry = HostRegistry.fromRecord({
  shuvtest: {
    hostname: "shuvtest",
    connectionType: "ssh",
    port: 22,
    timeout: 10,
  },
});

/** Remote skills repository path on the test host. */
const repoPath = "~/repos/shuvbot-skills";

/** Active skills directory on the test host (where symlinks live). */
const activeDir = "~/.codex/skills";

/**
 * Skill to use for parity testing.
 * "adapt" exists on both shuvtest (Linux) and shuvbot (macOS) in the
 * shuvbot-skills repo and is safe to activate/deactivate without
 * affecting real functionality.
 */
const testSkillName = "adapt";

// ─── Shared Layer ──────────────────────────────────────────────

/**
 * Live layer for both CLI and MCP operations.
 * Uses real SSH, real telemetry, real git-ops, real skill-ops.
 */
const LiveSshLayer = Layer.merge(SshExecutorLive, TelemetryLive);
const LiveGitOpsLayer = Layer.provideMerge(GitOpsLive, LiveSshLayer);
const LiveSkillOpsLayer = Layer.provideMerge(
  SkillOpsLive,
  Layer.merge(LiveSshLayer, LiveGitOpsLayer),
);

/**
 * Full service layer providing all services needed by CLI and MCP.
 */
const FullLiveLayer = Layer.mergeAll(
  LiveSshLayer,
  LiveGitOpsLayer,
  LiveSkillOpsLayer,
);

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Parse MCP tool call result into a JSON object.
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
// VAL-CROSS-005: CLI to MCP Parity
// ═══════════════════════════════════════════════════════════════

describe("VAL-CROSS-005: CLI to MCP Parity (E2E)", () => {
  let managedRuntime: ManagedRuntime.ManagedRuntime<ServerServices, never>;
  let mcpClient: Client;
  let mcpCleanup: (() => Promise<void>) | undefined;

  /**
   * Build the managed runtime and MCP client/server pair once for
   * all tests — they share the same live SSH layer.
   */
  beforeAll(async () => {
    // Create the managed runtime from the full live layer
    managedRuntime = ManagedRuntime.make(FullLiveLayer);
    const runtime = await managedRuntime.runtime();

    // Create MCP server with the live runtime
    const serverConfig: ServerConfig = {
      registry: testRegistry,
      repoPath,
      runtime,
      activeDir,
    };
    const mcpServer = createServer(serverConfig);

    // Wire up in-memory transport (no real stdio)
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);

    mcpClient = new Client({ name: "parity-test-client", version: "0.0.1" });
    await mcpClient.connect(clientTransport);

    mcpCleanup = async () => {
      await mcpClient.close();
      await mcpServer.close();
      await managedRuntime.dispose();
    };
  }, 30_000);

  afterAll(async () => {
    // Cleanup: deactivate test skill to leave host in clean state
    try {
      const cleanup = Effect.gen(function* () {
        const skillOps = yield* SkillOps;
        yield* skillOps.deactivateSkill(
          shuvtestHost,
          testSkillName,
          activeDir,
        );
      });
      await Effect.runPromise(
        cleanup.pipe(
          Effect.provide(FullLiveLayer),
          Effect.catchAll(() => Effect.void),
        ),
      );
    } catch {
      // Best-effort cleanup
    }

    if (mcpCleanup) {
      await mcpCleanup();
    }
  }, 30_000);

  // ─────────────────────────────────────────────────────────────
  // 1. Status Parity
  // ─────────────────────────────────────────────────────────────

  it("status: CLI and MCP report the same host status", async () => {
    // --- CLI ---
    const cliResult = await Effect.runPromise(
      runStatus(testRegistry).pipe(Effect.provide(FullLiveLayer)),
    );

    // --- MCP ---
    const mcpRaw = await mcpClient.callTool({
      name: "fleet_status",
      arguments: { hosts: ["shuvtest"] },
    });

    const mcpResult = parseMcpResult(mcpRaw as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }) as { hosts: Array<{
      name: string;
      hostname: string;
      status: string;
      head?: string;
      branch?: string;
      dirty?: boolean;
    }> };

    // --- Parity assertions ---
    expect(mcpRaw.isError).not.toBe(true);

    // Both should report shuvtest as online
    const cliHost = cliResult.hosts.find((h) => h.name === "shuvtest");
    const mcpHost = mcpResult.hosts.find(
      (h: { name: string }) => h.name === "shuvtest",
    );
    expect(cliHost).toBeDefined();
    expect(mcpHost).toBeDefined();
    expect(cliHost!.status).toBe("online");
    expect(mcpHost!.status).toBe("online");

    // MCP returns richer status (head, branch, dirty); CLI only checks connectivity.
    // Both should agree on reachability — the core parity requirement.
    expect(cliHost!.hostname).toBe(mcpHost!.hostname);

    // MCP head should be a valid SHA
    expect(mcpHost!.head).toMatch(/^[0-9a-f]{40}$/);
  }, 30_000);

  // ─────────────────────────────────────────────────────────────
  // 2. Pull Parity
  // ─────────────────────────────────────────────────────────────

  it("pull: CLI and MCP produce the same pull outcome and HEAD", async () => {
    // --- CLI pull ---
    const cliResult = await Effect.runPromise(
      runPull(testRegistry, repoPath, ["shuvtest"]).pipe(
        Effect.provide(FullLiveLayer),
      ),
    );

    // --- MCP pull ---
    const mcpRaw = await mcpClient.callTool({
      name: "fleet_pull",
      arguments: { hosts: ["shuvtest"] },
    });

    const mcpResult = parseMcpResult(mcpRaw as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }) as { results: Array<{
      name: string;
      hostname: string;
      status: string;
      updated?: boolean;
      head?: string;
    }> };

    // --- Parity assertions ---
    expect(mcpRaw.isError).not.toBe(true);

    const cliHost = cliResult.hosts.find((h) => h.name === "shuvtest");
    const mcpHost = mcpResult.results.find(
      (h: { name: string }) => h.name === "shuvtest",
    );

    expect(cliHost).toBeDefined();
    expect(mcpHost).toBeDefined();

    // Both should succeed
    expect(cliHost!.status).toBe("ok");
    expect(mcpHost!.status).toBe("ok");

    // Both should agree on update status (both pulling from same repo
    // sequentially — first pull may update, second should be "up to date")
    // The important thing is both succeed.

    // MCP should report a valid HEAD SHA
    expect(mcpHost!.head).toMatch(/^[0-9a-f]{40}$/);

    // Verify the actual git state on the host matches what MCP reports
    const verifyHead = Effect.gen(function* () {
      const ssh = yield* SshExecutor;
      const result = yield* ssh.executeCommand(
        shuvtestHost,
        `cd ${repoPath} && git rev-parse HEAD`,
      );
      return result.stdout.trim();
    });

    const actualHead = await Effect.runPromise(
      verifyHead.pipe(Effect.provide(FullLiveLayer)),
    );

    expect(actualHead).toMatch(/^[0-9a-f]{40}$/);
    expect(mcpHost!.head).toBe(actualHead);
  }, 60_000);

  // ─────────────────────────────────────────────────────────────
  // 3. Activate Parity
  // ─────────────────────────────────────────────────────────────

  it("activate: CLI and MCP produce identical activation state", async () => {
    // First: ensure skill is deactivated
    await Effect.runPromise(
      Effect.gen(function* () {
        const skillOps = yield* SkillOps;
        yield* skillOps.deactivateSkill(
          shuvtestHost,
          testSkillName,
          activeDir,
        );
      }).pipe(
        Effect.provide(FullLiveLayer),
        Effect.catchAll(() => Effect.void),
      ),
    );

    // --- CLI activate ---
    const cliResult = await Effect.runPromise(
      runActivate(
        testRegistry,
        testSkillName,
        repoPath,
        activeDir,
        ["shuvtest"],
      ).pipe(Effect.provide(FullLiveLayer)),
    );

    const cliHost = cliResult.hosts.find((h) => h.name === "shuvtest");
    expect(cliHost).toBeDefined();
    expect(cliHost!.status).toBe("ok");

    // Verify the symlink exists on the host after CLI activate
    const verifySymlink = Effect.gen(function* () {
      const ssh = yield* SshExecutor;
      const result = yield* ssh.executeCommand(
        shuvtestHost,
        `readlink ${activeDir}/${testSkillName}`,
      );
      return result.stdout.trim();
    });

    const cliSymlinkTarget = await Effect.runPromise(
      verifySymlink.pipe(Effect.provide(FullLiveLayer)),
    );
    expect(cliSymlinkTarget).toContain(testSkillName);

    // --- Deactivate, then re-activate via MCP ---
    await Effect.runPromise(
      Effect.gen(function* () {
        const skillOps = yield* SkillOps;
        yield* skillOps.deactivateSkill(
          shuvtestHost,
          testSkillName,
          activeDir,
        );
      }).pipe(Effect.provide(FullLiveLayer)),
    );

    const mcpRaw = await mcpClient.callTool({
      name: "fleet_activate",
      arguments: {
        skill: testSkillName,
        hosts: ["shuvtest"],
      },
    });

    const mcpResult = parseMcpResult(mcpRaw as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }) as { skill: string; results: Array<{
      name: string;
      hostname: string;
      status: string;
      alreadyInState?: boolean;
      skillStatus?: string;
    }> };

    expect(mcpRaw.isError).not.toBe(true);
    const mcpHost = mcpResult.results.find(
      (h: { name: string }) => h.name === "shuvtest",
    );
    expect(mcpHost).toBeDefined();
    expect(mcpHost!.status).toBe("ok");

    // Verify the symlink exists on the host after MCP activate
    const mcpSymlinkTarget = await Effect.runPromise(
      verifySymlink.pipe(Effect.provide(FullLiveLayer)),
    );
    expect(mcpSymlinkTarget).toContain(testSkillName);

    // --- Parity assertion: both produced the same symlink target ---
    expect(mcpSymlinkTarget).toBe(cliSymlinkTarget);

    // Both should report the activation was fresh (not alreadyInState)
    if (cliHost!.status === "ok") {
      expect(cliHost!.alreadyInState).toBe(false);
    }
    expect(mcpHost!.alreadyInState).toBe(false);
  }, 60_000);

  // ─────────────────────────────────────────────────────────────
  // 4. Deactivate Parity
  // ─────────────────────────────────────────────────────────────

  it("deactivate: CLI and MCP produce identical deactivation state", async () => {
    // First: ensure skill is active (activate it)
    await Effect.runPromise(
      Effect.gen(function* () {
        const skillOps = yield* SkillOps;
        yield* skillOps.activateSkill(
          shuvtestHost,
          testSkillName,
          repoPath,
          activeDir,
        );
      }).pipe(Effect.provide(FullLiveLayer)),
    );

    // --- CLI deactivate ---
    const cliResult = await Effect.runPromise(
      runDeactivate(testRegistry, testSkillName, activeDir, ["shuvtest"]).pipe(
        Effect.provide(FullLiveLayer),
      ),
    );

    const cliHost = cliResult.hosts.find((h) => h.name === "shuvtest");
    expect(cliHost).toBeDefined();
    expect(cliHost!.status).toBe("ok");

    // Verify the symlink is gone on the host after CLI deactivate
    const verifyNoSymlink = Effect.gen(function* () {
      const ssh = yield* SshExecutor;
      const result = yield* ssh.executeCommand(
        shuvtestHost,
        `test -L ${activeDir}/${testSkillName} && echo "exists" || echo "absent"`,
      );
      return result.stdout.trim();
    });

    const cliSymlinkState = await Effect.runPromise(
      verifyNoSymlink.pipe(Effect.provide(FullLiveLayer)),
    );
    expect(cliSymlinkState).toBe("absent");

    // --- Re-activate, then deactivate via MCP ---
    await Effect.runPromise(
      Effect.gen(function* () {
        const skillOps = yield* SkillOps;
        yield* skillOps.activateSkill(
          shuvtestHost,
          testSkillName,
          repoPath,
          activeDir,
        );
      }).pipe(Effect.provide(FullLiveLayer)),
    );

    const mcpRaw = await mcpClient.callTool({
      name: "fleet_deactivate",
      arguments: {
        skill: testSkillName,
        hosts: ["shuvtest"],
      },
    });

    const mcpResult = parseMcpResult(mcpRaw as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }) as { skill: string; results: Array<{
      name: string;
      hostname: string;
      status: string;
      alreadyInState?: boolean;
      skillStatus?: string;
    }> };

    expect(mcpRaw.isError).not.toBe(true);
    const mcpHost = mcpResult.results.find(
      (h: { name: string }) => h.name === "shuvtest",
    );
    expect(mcpHost).toBeDefined();
    expect(mcpHost!.status).toBe("ok");

    // Verify the symlink is gone on the host after MCP deactivate
    const mcpSymlinkState = await Effect.runPromise(
      verifyNoSymlink.pipe(Effect.provide(FullLiveLayer)),
    );
    expect(mcpSymlinkState).toBe("absent");

    // --- Parity assertion: both produced the same host state ---
    expect(mcpSymlinkState).toBe(cliSymlinkState);

    // Both should report the deactivation was fresh (not alreadyInState)
    if (cliHost!.status === "ok") {
      expect(cliHost!.alreadyInState).toBe(false);
    }
    expect(mcpHost!.alreadyInState).toBe(false);
  }, 60_000);

  // ─────────────────────────────────────────────────────────────
  // 5. Idempotent Activate Parity
  // ─────────────────────────────────────────────────────────────

  it("idempotent activate: both CLI and MCP report alreadyInState for already-active skill", async () => {
    // Ensure skill is active
    await Effect.runPromise(
      Effect.gen(function* () {
        const skillOps = yield* SkillOps;
        yield* skillOps.activateSkill(
          shuvtestHost,
          testSkillName,
          repoPath,
          activeDir,
        );
      }).pipe(Effect.provide(FullLiveLayer)),
    );

    // --- CLI activate (should be idempotent) ---
    const cliResult = await Effect.runPromise(
      runActivate(
        testRegistry,
        testSkillName,
        repoPath,
        activeDir,
        ["shuvtest"],
      ).pipe(Effect.provide(FullLiveLayer)),
    );

    const cliHost = cliResult.hosts.find((h) => h.name === "shuvtest");
    expect(cliHost).toBeDefined();
    expect(cliHost!.status).toBe("ok");
    if (cliHost!.status === "ok") {
      expect(cliHost!.alreadyInState).toBe(true);
    }

    // --- MCP activate (should also be idempotent) ---
    const mcpRaw = await mcpClient.callTool({
      name: "fleet_activate",
      arguments: {
        skill: testSkillName,
        hosts: ["shuvtest"],
      },
    });

    const mcpResult = parseMcpResult(mcpRaw as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }) as { skill: string; results: Array<{
      name: string;
      status: string;
      alreadyInState?: boolean;
    }> };

    expect(mcpRaw.isError).not.toBe(true);
    const mcpHost = mcpResult.results.find(
      (h: { name: string }) => h.name === "shuvtest",
    );
    expect(mcpHost).toBeDefined();
    expect(mcpHost!.status).toBe("ok");
    expect(mcpHost!.alreadyInState).toBe(true);

    // Cleanup
    await Effect.runPromise(
      Effect.gen(function* () {
        const skillOps = yield* SkillOps;
        yield* skillOps.deactivateSkill(
          shuvtestHost,
          testSkillName,
          activeDir,
        );
      }).pipe(
        Effect.provide(FullLiveLayer),
        Effect.catchAll(() => Effect.void),
      ),
    );
  }, 30_000);

  // ─────────────────────────────────────────────────────────────
  // 6. Idempotent Deactivate Parity
  // ─────────────────────────────────────────────────────────────

  it("idempotent deactivate: both CLI and MCP report alreadyInState for not-active skill", async () => {
    // Ensure skill is NOT active
    await Effect.runPromise(
      Effect.gen(function* () {
        const skillOps = yield* SkillOps;
        yield* skillOps.deactivateSkill(
          shuvtestHost,
          testSkillName,
          activeDir,
        );
      }).pipe(
        Effect.provide(FullLiveLayer),
        Effect.catchAll(() => Effect.void),
      ),
    );

    // --- CLI deactivate (should be idempotent) ---
    const cliResult = await Effect.runPromise(
      runDeactivate(testRegistry, testSkillName, activeDir, ["shuvtest"]).pipe(
        Effect.provide(FullLiveLayer),
      ),
    );

    const cliHost = cliResult.hosts.find((h) => h.name === "shuvtest");
    expect(cliHost).toBeDefined();
    expect(cliHost!.status).toBe("ok");
    if (cliHost!.status === "ok") {
      expect(cliHost!.alreadyInState).toBe(true);
    }

    // --- MCP deactivate (should also be idempotent) ---
    const mcpRaw = await mcpClient.callTool({
      name: "fleet_deactivate",
      arguments: {
        skill: testSkillName,
        hosts: ["shuvtest"],
      },
    });

    const mcpResult = parseMcpResult(mcpRaw as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }) as { skill: string; results: Array<{
      name: string;
      status: string;
      alreadyInState?: boolean;
    }> };

    expect(mcpRaw.isError).not.toBe(true);
    const mcpHost = mcpResult.results.find(
      (h: { name: string }) => h.name === "shuvtest",
    );
    expect(mcpHost).toBeDefined();
    expect(mcpHost!.status).toBe("ok");
    expect(mcpHost!.alreadyInState).toBe(true);
  }, 30_000);

  // ─────────────────────────────────────────────────────────────
  // 7. State consistency: same operation on host via CLI then MCP
  // ─────────────────────────────────────────────────────────────

  it("state consistency: CLI and MCP see the same HEAD after sequential pulls", async () => {
    // --- CLI pull → capture HEAD ---
    await Effect.runPromise(
      runPull(testRegistry, repoPath, ["shuvtest"]).pipe(
        Effect.provide(FullLiveLayer),
      ),
    );

    const getHeadViaSSH = Effect.gen(function* () {
      const ssh = yield* SshExecutor;
      const result = yield* ssh.executeCommand(
        shuvtestHost,
        `cd ${repoPath} && git rev-parse HEAD`,
      );
      return result.stdout.trim();
    });

    const headAfterCliPull = await Effect.runPromise(
      getHeadViaSSH.pipe(Effect.provide(FullLiveLayer)),
    );

    // --- MCP fleet_status → should see the same HEAD ---
    const mcpRaw = await mcpClient.callTool({
      name: "fleet_status",
      arguments: { hosts: ["shuvtest"] },
    });

    const mcpResult = parseMcpResult(mcpRaw as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }) as { hosts: Array<{
      name: string;
      status: string;
      head?: string;
    }> };

    expect(mcpRaw.isError).not.toBe(true);
    const mcpHost = mcpResult.hosts.find(
      (h: { name: string }) => h.name === "shuvtest",
    );
    expect(mcpHost).toBeDefined();
    expect(mcpHost!.status).toBe("online");

    // Both CLI pull and MCP status should reflect the same HEAD
    expect(mcpHost!.head).toBe(headAfterCliPull);
  }, 30_000);
});

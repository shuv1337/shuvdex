/**
 * Live SSH integration tests for CLI commands.
 *
 * These tests use the real SshExecutorLive layer against the test host
 * (shuvtest) to verify that the CLI's SSH auth path works end-to-end
 * with key-based authentication and no password prompts.
 *
 * Covers:
 * - VAL-CLI-021: Standard SSH authentication without password prompts
 *   (live path — complements the mock-based tests in ssh-handling.test.ts)
 */
import { it, layer } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Layer } from "effect";
import { HostRegistry } from "@codex-fleet/core";
import type { HostConfig } from "@codex-fleet/core";
import { SshExecutorLive } from "@codex-fleet/ssh";
import { TelemetryTest } from "@codex-fleet/telemetry";
import { GitOpsLive } from "@codex-fleet/git-ops";
import { runStatus, formatTable } from "../src/commands/status.js";
import { runPull, formatPullTable } from "../src/commands/pull.js";

// ─── Host configs ──────────────────────────────────────────────

const shuvtestHost: HostConfig = {
  hostname: "shuvtest",
  connectionType: "ssh",
  port: 22,
  timeout: 10,
};

const singleHostRegistry = HostRegistry.fromRecord({
  shuvtest: shuvtestHost,
});

const repoPath = "~/repos/shuvbot-skills";

// ─── Test layers ───────────────────────────────────────────────

/**
 * Live SSH executor + test telemetry for integration tests.
 * Uses the real SSH binary to connect to shuvtest.
 */
const LiveSshLayer = Layer.merge(SshExecutorLive, TelemetryTest);

const LiveGitOpsLayer = Layer.provideMerge(GitOpsLive, LiveSshLayer);

// ═══════════════════════════════════════════════════════════════
// VAL-CLI-021: Live SSH key-based authentication
// ═══════════════════════════════════════════════════════════════

describe("VAL-CLI-021: Live SSH key-based authentication", () => {
  layer(LiveSshLayer)(
    "status command over real SSH connection",
    (it) => {
      it.effect(
        "connects to shuvtest via real SSH with key auth and reports online",
        () =>
          Effect.gen(function* () {
            const result = yield* runStatus(singleHostRegistry);

            // The status command should succeed — key-based auth works
            expect(result.hosts).toHaveLength(1);
            expect(result.hosts[0].status).toBe("online");
            expect(result.hosts[0].hostname).toBe("shuvtest");
            expect(result.allOnline).toBe(true);
          }),
        { timeout: 15_000 },
      );

      it.effect(
        "produces no password prompt indicators in output",
        () =>
          Effect.gen(function* () {
            const result = yield* runStatus(singleHostRegistry);
            const output = formatTable(result);

            // Output should show the host as online, not an auth error
            expect(output).toContain("[OK]");
            expect(output).not.toContain("Permission denied");
            expect(output).not.toContain("password");
            expect(output).not.toContain("Password");
            expect(output).toContain("1 succeeded, 0 failed");
          }),
        { timeout: 15_000 },
      );

      it.effect(
        "does not hang waiting for interactive input (BatchMode=yes enforced)",
        () =>
          Effect.gen(function* () {
            // This test relies on the overall timeout — if BatchMode=yes is not
            // set, SSH could hang indefinitely waiting for a password.
            // The 15-second timeout ensures we fail fast if auth hangs.
            const start = Date.now();
            const result = yield* runStatus(singleHostRegistry);
            const elapsed = Date.now() - start;

            expect(result.allOnline).toBe(true);
            // Auth + echo should complete well under 10 seconds
            expect(elapsed).toBeLessThan(10_000);
          }),
        { timeout: 15_000 },
      );
    },
  );

  layer(LiveGitOpsLayer)(
    "pull command over real SSH connection",
    (it) => {
      it.effect(
        "pulls from shuvtest via real SSH with key auth",
        () =>
          Effect.gen(function* () {
            const result = yield* runPull(singleHostRegistry, repoPath);

            // Pull should succeed on shuvtest
            expect(result.hosts).toHaveLength(1);
            expect(result.hosts[0].status).toBe("ok");
            expect(result.allSucceeded).toBe(true);
          }),
        { timeout: 30_000 },
      );

      it.effect(
        "pull output contains no password prompts or auth errors",
        () =>
          Effect.gen(function* () {
            const result = yield* runPull(singleHostRegistry, repoPath);
            const output = formatPullTable(result);

            expect(output).toContain("[OK]");
            expect(output).not.toContain("Permission denied");
            expect(output).not.toContain("password");
            expect(output).not.toContain("Password");
          }),
        { timeout: 30_000 },
      );
    },
  );
});

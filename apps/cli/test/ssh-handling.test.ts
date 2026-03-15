/**
 * Tests for CLI SSH handling behavior.
 *
 * Covers:
 * - VAL-CLI-021: Standard SSH authentication without password prompts
 * - VAL-CLI-022: Graceful timeout handling with continued processing
 */
import { it, layer } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Layer, Ref } from "effect";
import { HostRegistry } from "@codex-fleet/core";
import type { HostConfig } from "@codex-fleet/core";
import {
  SshExecutorTest,
  MockSshResponses,
  RecordedSshCalls,
  ConnectionFailed,
  ConnectionTimeout,
} from "@codex-fleet/ssh";
import { TelemetryTest } from "@codex-fleet/telemetry";
import { GitOpsLive } from "@codex-fleet/git-ops";
import { SkillOpsLive } from "@codex-fleet/skill-ops";
import { runStatus, formatTable } from "../src/commands/status.js";
import { runPull, formatPullTable } from "../src/commands/pull.js";
import {
  runActivate,
  formatActivateTable,
} from "../src/commands/activate.js";
import {
  runRollback,
  formatRollbackTable,
} from "../src/commands/rollback.js";

// ─── Host configs ──────────────────────────────────────────────

const host1: HostConfig = {
  hostname: "shuvtest",
  connectionType: "ssh",
  port: 22,
  timeout: 10,
};

const host2: HostConfig = {
  hostname: "shuvbot",
  connectionType: "ssh",
  port: 22,
  timeout: 10,
};

const host3: HostConfig = {
  hostname: "unreachable-host",
  connectionType: "ssh",
  port: 22,
  timeout: 5,
};

const threeHostRegistry = HostRegistry.fromRecord({
  shuvtest: host1,
  shuvbot: host2,
  unreachable: host3,
});

const twoHostRegistry = HostRegistry.fromRecord({
  shuvtest: host1,
  shuvbot: host2,
});

const repoPath = "~/repos/shuvbot-skills";

// ─── Test layers ───────────────────────────────────────────────

const TestLayer = Layer.merge(SshExecutorTest, TelemetryTest);

const GitOpsTestLayer = Layer.provideMerge(
  GitOpsLive,
  TestLayer,
);

const FullTestLayer = Layer.provideMerge(
  SkillOpsLive,
  GitOpsTestLayer,
);

// ═══════════════════════════════════════════════════════════════
// VAL-CLI-021: SSH Connection - Authentication
// ═══════════════════════════════════════════════════════════════

describe("VAL-CLI-021: SSH key-based authentication", () => {
  layer(TestLayer)("SSH auth in status command", (it) => {
    it.effect(
      "uses SSH key auth — no password prompts (auth failure reports clear error, not a hang)",
      () =>
        Effect.gen(function* () {
          // Simulate an auth failure scenario: if PasswordAuthentication=no and
          // BatchMode=yes are not set, SSH would hang waiting for a password.
          // Instead, with those flags the SSH connection fails immediately with
          // a clear error message. This test verifies the CLI surfaces that error.
          const responsesRef = yield* MockSshResponses;
          yield* Ref.set(responsesRef, [
            {
              _tag: "error" as const,
              value: new ConnectionFailed({
                host: "shuvtest",
                cause:
                  "Permission denied (publickey,password).",
              }),
            },
            {
              _tag: "result" as const,
              value: { stdout: "ok\n", stderr: "", exitCode: 0 },
            },
          ]);

          const result = yield* runStatus(twoHostRegistry);

          // The failed host should report an auth error, not hang
          const failed = result.hosts.find((h) => h.status === "error");
          expect(failed).toBeDefined();
          expect(failed!.error).toContain("Permission denied");

          // The other host should still succeed
          const online = result.hosts.find((h) => h.status === "online");
          expect(online).toBeDefined();
        }),
    );

    it.effect(
      "passes host config including keyPath to SSH executor",
      () =>
        Effect.gen(function* () {
          const hostWithKey: HostConfig = {
            hostname: "keyhost",
            connectionType: "ssh",
            port: 22,
            timeout: 10,
            keyPath: "/home/user/.ssh/custom_key",
          };

          const keyRegistry = HostRegistry.fromRecord({
            keyhost: hostWithKey,
          });

          // Reset recorded calls before this test
          const callsRef = yield* RecordedSshCalls;
          yield* Ref.set(callsRef, []);

          const responsesRef = yield* MockSshResponses;
          yield* Ref.set(responsesRef, [
            {
              _tag: "result" as const,
              value: { stdout: "ok\n", stderr: "", exitCode: 0 },
            },
          ]);

          const result = yield* runStatus(keyRegistry);
          expect(result.allOnline).toBe(true);

          // Verify the SSH executor was called with the correct host config
          const calls = yield* Ref.get(callsRef);
          expect(calls).toHaveLength(1);
          expect(calls[0].host.keyPath).toBe("/home/user/.ssh/custom_key");
          expect(calls[0].host.hostname).toBe("keyhost");
        }),
    );

    it.effect(
      "respects SSH config by passing host configuration through to executor",
      () =>
        Effect.gen(function* () {
          // The CLI passes the HostConfig (including hostname, port, user, keyPath)
          // directly to the SSH executor, which builds the ssh command.
          // The system ssh command then reads ~/.ssh/config for any additional
          // matching host configuration.
          const hostWithUser: HostConfig = {
            hostname: "custom-alias",
            connectionType: "ssh",
            port: 2222,
            user: "deploy",
            timeout: 15,
          };

          const customRegistry = HostRegistry.fromRecord({
            custom: hostWithUser,
          });

          // Reset recorded calls before this test
          const callsRef = yield* RecordedSshCalls;
          yield* Ref.set(callsRef, []);

          const responsesRef = yield* MockSshResponses;
          yield* Ref.set(responsesRef, [
            {
              _tag: "result" as const,
              value: { stdout: "ok\n", stderr: "", exitCode: 0 },
            },
          ]);

          const result = yield* runStatus(customRegistry);
          expect(result.allOnline).toBe(true);

          const calls = yield* Ref.get(callsRef);
          expect(calls).toHaveLength(1);
          expect(calls[0].host.hostname).toBe("custom-alias");
          expect(calls[0].host.port).toBe(2222);
          expect(calls[0].host.user).toBe("deploy");
          expect(calls[0].host.timeout).toBe(15);
        }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// VAL-CLI-022: SSH Connection - Timeout Handling
// ═══════════════════════════════════════════════════════════════

describe("VAL-CLI-022: SSH timeout handling with continued processing", () => {
  // --- Status command: timeout on one host, others continue ---

  layer(TestLayer)("status - timeout does not block other hosts", (it) => {
    it.effect(
      "one host times out, other hosts still report their status",
      () =>
        Effect.gen(function* () {
          const responsesRef = yield* MockSshResponses;
          yield* Ref.set(responsesRef, [
            {
              _tag: "result" as const,
              value: { stdout: "ok\n", stderr: "", exitCode: 0 },
            },
            {
              _tag: "error" as const,
              value: new ConnectionTimeout({
                host: "shuvbot",
                timeoutMs: 10000,
              }),
            },
            {
              _tag: "result" as const,
              value: { stdout: "ok\n", stderr: "", exitCode: 0 },
            },
          ]);

          const result = yield* runStatus(threeHostRegistry);

          // All 3 hosts should be in the results
          expect(result.hosts).toHaveLength(3);

          // The timed-out host should be reported with an error
          const timedOut = result.hosts.find((h) =>
            h.error?.includes("timed out"),
          );
          expect(timedOut).toBeDefined();
          expect(timedOut!.status).toBe("error");

          // Online hosts should still be reported
          const onlineHosts = result.hosts.filter(
            (h) => h.status === "online",
          );
          expect(onlineHosts.length).toBeGreaterThanOrEqual(1);

          // Overall result is not allOnline
          expect(result.allOnline).toBe(false);
        }),
    );

    it.effect(
      "timeout error message contains host name and timeout duration",
      () =>
        Effect.gen(function* () {
          const responsesRef = yield* MockSshResponses;
          yield* Ref.set(responsesRef, [
            {
              _tag: "error" as const,
              value: new ConnectionTimeout({
                host: "shuvtest",
                timeoutMs: 5000,
              }),
            },
            {
              _tag: "result" as const,
              value: { stdout: "ok\n", stderr: "", exitCode: 0 },
            },
          ]);

          const result = yield* runStatus(twoHostRegistry);
          const timedOut = result.hosts.find((h) => h.status === "error");
          expect(timedOut).toBeDefined();
          expect(timedOut!.error).toContain("shuvtest");
          expect(timedOut!.error).toContain("timed out");
          expect(timedOut!.error).toContain("5000");
        }),
    );

    it.effect(
      "table output shows timeout error clearly for affected host",
      () =>
        Effect.gen(function* () {
          const responsesRef = yield* MockSshResponses;
          yield* Ref.set(responsesRef, [
            {
              _tag: "result" as const,
              value: { stdout: "ok\n", stderr: "", exitCode: 0 },
            },
            {
              _tag: "error" as const,
              value: new ConnectionTimeout({
                host: "shuvbot",
                timeoutMs: 10000,
              }),
            },
          ]);

          const result = yield* runStatus(twoHostRegistry);
          const output = formatTable(result);

          // Table should contain both hosts
          expect(output).toContain("shuvtest");
          expect(output).toContain("shuvbot");

          // Timed-out host should show [FAIL]
          expect(output).toContain("[FAIL]");
          expect(output).toContain("timed out");

          // Online host should show [OK]
          expect(output).toContain("[OK]");

          // Summary should show partial
          expect(output).toContain("1 succeeded, 1 failed");
        }),
    );
  });

  // --- Pull command: timeout on one host, others continue ---

  layer(GitOpsTestLayer)("pull - timeout does not block other hosts", (it) => {
    it.effect(
      "pull continues on remaining hosts after one times out",
      () =>
        Effect.gen(function* () {
          const responsesRef = yield* MockSshResponses;
          // Host 1 succeeds (git rev-parse HEAD for pull)
          yield* Ref.set(responsesRef, [
            {
              _tag: "error" as const,
              value: new ConnectionTimeout({
                host: "shuvtest",
                timeoutMs: 10000,
              }),
            },
            {
              _tag: "result" as const,
              value: {
                stdout: "Already up to date.\n",
                stderr: "",
                exitCode: 0,
              },
            },
          ]);

          const result = yield* runPull(twoHostRegistry, repoPath);

          // Both hosts should be in results
          expect(result.hosts).toHaveLength(2);

          // One should have failed with timeout
          const failed = result.hosts.find((h) => h.status === "fail");
          expect(failed).toBeDefined();
          // git-ops wraps ConnectionTimeout as "Network timeout during ..."
          expect(failed!.error).toContain("timeout");

          // The other should have succeeded
          const succeeded = result.hosts.find((h) => h.status === "ok");
          expect(succeeded).toBeDefined();

          // Partial result
          expect(result.allSucceeded).toBe(false);
        }),
    );

    it.effect(
      "pull table output shows timeout clearly per host",
      () =>
        Effect.gen(function* () {
          const responsesRef = yield* MockSshResponses;
          yield* Ref.set(responsesRef, [
            {
              _tag: "result" as const,
              value: {
                stdout: "Already up to date.\n",
                stderr: "",
                exitCode: 0,
              },
            },
            {
              _tag: "error" as const,
              value: new ConnectionTimeout({
                host: "shuvbot",
                timeoutMs: 10000,
              }),
            },
          ]);

          const result = yield* runPull(twoHostRegistry, repoPath);
          const output = formatPullTable(result);

          expect(output).toContain("[OK]");
          expect(output).toContain("[FAIL]");
          // git-ops wraps timeout as "Network timeout during ..."
          expect(output).toContain("timeout");
          expect(output).toContain("1 succeeded, 1 failed");
        }),
    );
  });

  // --- Activate command: timeout on one host, others continue ---

  layer(FullTestLayer)("activate - timeout does not block other hosts", (it) => {
    it.effect(
      "activate continues on remaining hosts after one times out",
      () =>
        Effect.gen(function* () {
          const responsesRef = yield* MockSshResponses;
          yield* Ref.set(responsesRef, [
            {
              _tag: "error" as const,
              value: new ConnectionTimeout({
                host: "shuvtest",
                timeoutMs: 10000,
              }),
            },
            // shuvbot: check symlink existence
            {
              _tag: "result" as const,
              value: { stdout: "", stderr: "", exitCode: 0 },
            },
          ]);

          const result = yield* runActivate(
            twoHostRegistry,
            "my-skill",
            repoPath,
            "~/.codex/skills",
          );

          expect(result.hosts).toHaveLength(2);

          const failed = result.hosts.find((h) => h.status === "fail");
          expect(failed).toBeDefined();
          expect(failed!.error).toContain("timed out");

          const succeeded = result.hosts.find((h) => h.status === "ok");
          expect(succeeded).toBeDefined();

          expect(result.allSucceeded).toBe(false);
        }),
    );
  });

  // --- Rollback command: timeout on one host, others continue ---

  layer(GitOpsTestLayer)(
    "rollback - timeout does not block other hosts",
    (it) => {
      it.effect(
        "rollback continues on remaining hosts after one times out",
        () =>
          Effect.gen(function* () {
            const responsesRef = yield* MockSshResponses;
            yield* Ref.set(responsesRef, [
              {
                _tag: "error" as const,
                value: new ConnectionTimeout({
                  host: "shuvtest",
                  timeoutMs: 10000,
                }),
              },
              // shuvbot: checkout succeeds
              {
                _tag: "result" as const,
                value: {
                  stdout: "",
                  stderr: "HEAD is now at abc1234 some commit\n",
                  exitCode: 0,
                },
              },
              // shuvbot: get new HEAD
              {
                _tag: "result" as const,
                value: {
                  stdout: "abc1234abc1234abc1234abc1234abc1234abc1234\n",
                  stderr: "",
                  exitCode: 0,
                },
              },
            ]);

            const result = yield* runRollback(
              twoHostRegistry,
              "v1.0.0",
              repoPath,
            );

            expect(result.hosts).toHaveLength(2);

            const failed = result.hosts.find((h) => h.status === "fail");
            expect(failed).toBeDefined();
            // git-ops wraps ConnectionTimeout as "Network timeout during ..."
            expect(failed!.error).toContain("timeout");

            const succeeded = result.hosts.find((h) => h.status === "ok");
            expect(succeeded).toBeDefined();

            expect(result.allSucceeded).toBe(false);
          }),
      );
    },
  );

  // --- Verify configurable timeout from host config ---

  layer(TestLayer)("configurable timeout per host", (it) => {
    it.effect(
      "each host's timeout is passed to SSH executor via options.timeoutMs",
      () =>
        Effect.gen(function* () {
          const shortTimeoutHost: HostConfig = {
            hostname: "fast-host",
            connectionType: "ssh",
            port: 22,
            timeout: 5,
          };
          const longTimeoutHost: HostConfig = {
            hostname: "slow-host",
            connectionType: "ssh",
            port: 22,
            timeout: 60,
          };

          const mixedRegistry = HostRegistry.fromRecord({
            fast: shortTimeoutHost,
            slow: longTimeoutHost,
          });

          const responsesRef = yield* MockSshResponses;
          yield* Ref.set(responsesRef, [
            {
              _tag: "result" as const,
              value: { stdout: "ok\n", stderr: "", exitCode: 0 },
            },
            {
              _tag: "result" as const,
              value: { stdout: "ok\n", stderr: "", exitCode: 0 },
            },
          ]);

          yield* runStatus(mixedRegistry);

          // Verify the executor was called with the correct timeout from
          // each host's config
          const callsRef = yield* RecordedSshCalls;
          const calls = yield* Ref.get(callsRef);
          expect(calls).toHaveLength(2);

          // The status command passes timeoutMs: config.timeout * 1000
          const fastCall = calls.find(
            (c) => c.host.hostname === "fast-host",
          );
          const slowCall = calls.find(
            (c) => c.host.hostname === "slow-host",
          );

          expect(fastCall).toBeDefined();
          expect(fastCall!.options?.timeoutMs).toBe(5000);
          expect(slowCall).toBeDefined();
          expect(slowCall!.options?.timeoutMs).toBe(60000);
        }),
    );
  });
});

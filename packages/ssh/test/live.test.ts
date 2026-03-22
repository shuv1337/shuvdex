import { it, layer } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Layer } from "effect";
import {
  SshExecutor,
  SshExecutorLive,
  ConnectionFailed,
  ConnectionTimeout,
  CommandFailed,
} from "../src/index.js";
import { TelemetryTest } from "@shuvdex/telemetry";
import type { HostConfig } from "@shuvdex/core";

/**
 * Test host configuration for shuvtest (confirmed accessible).
 */
const shuvtestHost: HostConfig = {
  hostname: "shuvtest",
  connectionType: "ssh",
  port: 22,
  timeout: 10,
};

/**
 * Host config with unreachable address for timeout tests.
 * Uses RFC 5737 TEST-NET address that should never route.
 */
const unreachableHost: HostConfig = {
  hostname: "192.0.2.1",
  connectionType: "ssh",
  port: 22,
  timeout: 3,
};

/**
 * Live SSH executor + test telemetry for integration tests.
 */
const IntegrationLayer = Layer.merge(SshExecutorLive, TelemetryTest);

describe("SshExecutorLive (integration)", () => {
  layer(IntegrationLayer)("command execution on real host", (it) => {
    it.effect(
      "executes command on remote host and returns stdout",
      () =>
        Effect.gen(function* () {
          const executor = yield* SshExecutor;
          const result = yield* executor.executeCommand(
            shuvtestHost,
            "echo hello",
          );

          expect(result.stdout.trim()).toBe("hello");
          expect(result.exitCode).toBe(0);
        }),
      { timeout: 15_000 },
    );

    it.effect(
      "captures stdout and stderr separately",
      () =>
        Effect.gen(function* () {
          const executor = yield* SshExecutor;
          const result = yield* executor.executeCommand(
            shuvtestHost,
            "echo out && echo err >&2",
          );

          expect(result.stdout.trim()).toBe("out");
          // stderr may contain SSH warnings (e.g., post-quantum key exchange)
          // so check that our output is present in stderr
          expect(result.stderr).toContain("err");
          expect(result.exitCode).toBe(0);
        }),
      { timeout: 15_000 },
    );

    it.effect(
      "detects non-zero exit code as CommandFailed",
      () =>
        Effect.gen(function* () {
          const executor = yield* SshExecutor;
          const result = yield* executor
            .executeCommand(shuvtestHost, "exit 42")
            .pipe(Effect.either);

          expect(result._tag).toBe("Left");
          if (result._tag === "Left") {
            expect(result.left).toBeInstanceOf(CommandFailed);
            expect((result.left as CommandFailed).exitCode).toBe(42);
          }
        }),
      { timeout: 15_000 },
    );

    it.effect(
      "detects exit code 127 (command not found) as CommandFailed",
      () =>
        Effect.gen(function* () {
          const executor = yield* SshExecutor;
          const result = yield* executor
            .executeCommand(
              shuvtestHost,
              "nonexistent_command_xyz_123",
            )
            .pipe(Effect.either);

          expect(result._tag).toBe("Left");
          if (result._tag === "Left") {
            expect(result.left).toBeInstanceOf(CommandFailed);
            const err = result.left as CommandFailed;
            expect(err.exitCode).toBe(127);
            expect(err.stderr).toContain("not found");
          }
        }),
      { timeout: 15_000 },
    );

    it.effect(
      "uses SSH key-based auth without password prompt",
      () =>
        Effect.gen(function* () {
          const executor = yield* SshExecutor;
          // If this succeeds without hanging, key-based auth works
          const result = yield* executor.executeCommand(
            shuvtestHost,
            "whoami",
          );

          expect(result.exitCode).toBe(0);
          expect(result.stdout.trim()).toBeTruthy();
        }),
      { timeout: 15_000 },
    );
  });

  layer(IntegrationLayer)("connection timeout handling", (it) => {
    it.effect(
      "produces ConnectionTimeout for unreachable host",
      () =>
        Effect.gen(function* () {
          const executor = yield* SshExecutor;
          const result = yield* executor
            .executeCommand(unreachableHost, "echo test", {
              timeoutMs: 3000,
            })
            .pipe(Effect.either);

          expect(result._tag).toBe("Left");
          if (result._tag === "Left") {
            // Should be either ConnectionTimeout or ConnectionFailed
            // (depending on network behavior)
            expect(
              result.left._tag === "ConnectionTimeout" ||
                result.left._tag === "ConnectionFailed",
            ).toBe(true);
          }
        }),
      { timeout: 30_000 },
    );
  });

  layer(IntegrationLayer)("error type discrimination", (it) => {
    it.effect(
      "CommandFailed is distinct from ConnectionFailed",
      () =>
        Effect.gen(function* () {
          const executor = yield* SshExecutor;

          // CommandFailed: valid host, bad command
          const cmdResult = yield* executor
            .executeCommand(shuvtestHost, "exit 1")
            .pipe(Effect.either);

          expect(cmdResult._tag).toBe("Left");
          if (cmdResult._tag === "Left") {
            expect(cmdResult.left._tag).toBe("CommandFailed");
          }
        }),
      { timeout: 15_000 },
    );
  });
});

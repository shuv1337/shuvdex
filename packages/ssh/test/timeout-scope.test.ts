import { it, layer } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Layer, Ref } from "effect";
import {
  SshExecutor,
  SshExecutorLive,
  SshExecutorTest,
  MockSshResponses,
  RecordedSshCalls,
  ConnectionTimeout,
  CommandTimeout,
} from "../src/index.js";
import { TelemetryTest, CollectedSpans } from "@codex-fleet/telemetry";
import type { HostConfig } from "@codex-fleet/core";

/**
 * Test host configuration for shuvtest (confirmed accessible).
 */
const shuvtestHost: HostConfig = {
  hostname: "shuvtest",
  connectionType: "ssh",
  port: 22,
  timeout: 2, // 2-second connection timeout
};

/**
 * Host config with unreachable address for timeout tests.
 * Uses RFC 5737 TEST-NET address that should never route.
 */
const unreachableHost: HostConfig = {
  hostname: "192.0.2.1",
  connectionType: "ssh",
  port: 22,
  timeout: 2,
};

/**
 * Live SSH executor + test telemetry for integration tests.
 */
const IntegrationLayer = Layer.merge(SshExecutorLive, TelemetryTest);

/**
 * Mock SSH executor + test telemetry for unit tests.
 */
const TestLayer = Layer.merge(SshExecutorTest, TelemetryTest);

describe("SSH timeout scope separation (integration)", () => {
  layer(IntegrationLayer)(
    "ConnectTimeout does NOT kill long-running commands",
    (it) => {
      it.effect(
        "a 3-second command completes with a 2-second ConnectTimeout",
        () =>
          Effect.gen(function* () {
            const executor = yield* SshExecutor;
            // ConnectTimeout is 2 seconds (from host config timeout=2),
            // but the command sleeps for 3 seconds then echoes.
            // If the timeout were applied to the whole process, this would fail.
            const result = yield* executor.executeCommand(
              shuvtestHost,
              "sleep 3 && echo done",
              { timeoutMs: 2000 }, // 2-second connect timeout
            );

            expect(result.stdout.trim()).toBe("done");
            expect(result.exitCode).toBe(0);
          }),
        { timeout: 30_000 },
      );

      it.effect(
        "a command running longer than connect timeout returns output",
        () =>
          Effect.gen(function* () {
            const executor = yield* SshExecutor;
            // This command takes 2 seconds, with a 1-second connect timeout.
            // Should still succeed because ConnectTimeout only applies to connection.
            const result = yield* executor.executeCommand(
              shuvtestHost,
              "sleep 2 && echo completed",
              { timeoutMs: 1000 }, // 1-second connect timeout
            );

            expect(result.stdout.trim()).toBe("completed");
            expect(result.exitCode).toBe(0);
          }),
        { timeout: 30_000 },
      );
    },
  );

  layer(IntegrationLayer)(
    "unreachable hosts still timeout correctly via ConnectTimeout",
    (it) => {
      it.effect(
        "unreachable host produces timeout or connection error",
        () =>
          Effect.gen(function* () {
            const executor = yield* SshExecutor;
            const result = yield* executor
              .executeCommand(unreachableHost, "echo test", {
                timeoutMs: 2000,
              })
              .pipe(Effect.either);

            expect(result._tag).toBe("Left");
            if (result._tag === "Left") {
              // Should be either ConnectionTimeout or ConnectionFailed
              expect(
                result.left._tag === "ConnectionTimeout" ||
                  result.left._tag === "ConnectionFailed",
              ).toBe(true);
            }
          }),
        { timeout: 30_000 },
      );
    },
  );

  layer(IntegrationLayer)(
    "commandTimeoutMs kills long-running commands",
    (it) => {
      it.effect(
        "command exceeding commandTimeoutMs is killed with CommandTimeout error",
        () =>
          Effect.gen(function* () {
            const executor = yield* SshExecutor;
            const start = Date.now();
            const result = yield* executor
              .executeCommand(
                shuvtestHost,
                "sleep 30", // Runs for 30s normally
                {
                  timeoutMs: 5000, // 5-second connect timeout (generous)
                  commandTimeoutMs: 2000, // 2-second command timeout
                },
              )
              .pipe(Effect.either);
            const elapsed = Date.now() - start;

            expect(result._tag).toBe("Left");
            if (result._tag === "Left") {
              expect(result.left._tag).toBe("CommandTimeout");
              if (result.left._tag === "CommandTimeout") {
                expect(result.left.timeoutMs).toBe(2000);
                expect(result.left.host).toBe("shuvtest");
              }
            }
            // Should have been killed roughly around 2s, not 30s
            expect(elapsed).toBeLessThan(15_000);
          }),
        { timeout: 30_000 },
      );
    },
  );

  layer(IntegrationLayer)(
    "span attributes reflect separated timeouts",
    (it) => {
      it.effect(
        "span includes connect_timeout_ms attribute",
        () =>
          Effect.gen(function* () {
            const spansRef = yield* CollectedSpans;
            const spansBefore = yield* Ref.get(spansRef);
            const countBefore = spansBefore.length;

            const executor = yield* SshExecutor;
            yield* executor.executeCommand(shuvtestHost, "echo span-test", {
              timeoutMs: 5000,
            });

            const spansAfter = yield* Ref.get(spansRef);
            const newSpans = spansAfter.slice(countBefore);
            const span = newSpans.find((s) => s.name === "ssh.executeCommand");

            expect(span).toBeDefined();
            expect(span!.attributes["ssh.connect_timeout_ms"]).toBe(5000);
          }),
        { timeout: 15_000 },
      );

      it.effect(
        "span includes command_timeout_ms when set",
        () =>
          Effect.gen(function* () {
            const spansRef = yield* CollectedSpans;
            const spansBefore = yield* Ref.get(spansRef);
            const countBefore = spansBefore.length;

            const executor = yield* SshExecutor;
            yield* executor.executeCommand(shuvtestHost, "echo span-test", {
              timeoutMs: 5000,
              commandTimeoutMs: 10000,
            });

            const spansAfter = yield* Ref.get(spansRef);
            const newSpans = spansAfter.slice(countBefore);
            const span = newSpans.find((s) => s.name === "ssh.executeCommand");

            expect(span).toBeDefined();
            expect(span!.attributes["ssh.connect_timeout_ms"]).toBe(5000);
            expect(span!.attributes["ssh.command_timeout_ms"]).toBe(10000);
          }),
        { timeout: 15_000 },
      );
    },
  );
});

describe("SSH timeout scope separation (unit)", () => {
  layer(TestLayer)("CommandTimeout error type", (it) => {
    it.effect("fails with CommandTimeout mock error", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandTimeout({
              host: "testhost",
              command: "sleep 30",
              timeoutMs: 2000,
            }),
          },
        ]);

        const executor = yield* SshExecutor;
        const result = yield* executor
          .executeCommand(
            {
              hostname: "testhost",
              connectionType: "ssh",
              port: 22,
              timeout: 5,
            },
            "sleep 30",
            { commandTimeoutMs: 2000 },
          )
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(CommandTimeout);
          expect((result.left as CommandTimeout).timeoutMs).toBe(2000);
          expect((result.left as CommandTimeout).command).toBe("sleep 30");
        }
      }),
    );
  });
});

describe("CommandTimeout error type", () => {
  it("has correct _tag", () => {
    const err = new CommandTimeout({
      host: "h",
      command: "sleep 100",
      timeoutMs: 5000,
    });
    expect(err._tag).toBe("CommandTimeout");
    expect(err.host).toBe("h");
    expect(err.command).toBe("sleep 100");
    expect(err.timeoutMs).toBe(5000);
    expect(err.message).toContain("5000");
    expect(err.message).toContain("sleep 100");
  });

  it("is distinct from ConnectionTimeout", () => {
    const cmdTimeout = new CommandTimeout({
      host: "h",
      command: "sleep 100",
      timeoutMs: 5000,
    });
    const connTimeout = new ConnectionTimeout({
      host: "h",
      timeoutMs: 5000,
    });
    expect(cmdTimeout._tag).not.toBe(connTimeout._tag);
  });
});

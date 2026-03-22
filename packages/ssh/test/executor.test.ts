import { it, layer } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Ref } from "effect";
import {
  SshExecutor,
  SshExecutorTest,
  MockSshResponses,
  RecordedSshCalls,
  ConnectionFailed,
  ConnectionTimeout,
  CommandFailed,
} from "../src/index.js";
import { TelemetryTest, CollectedSpans } from "@shuvdex/telemetry";
import type { HostConfig } from "@shuvdex/core";
import { Layer } from "effect";

/**
 * Test host configuration for a standard SSH host.
 */
const testHost: HostConfig = {
  hostname: "testhost",
  connectionType: "ssh",
  port: 22,
  user: "testuser",
  timeout: 30,
};

/**
 * Combined test layer: mock SSH + test telemetry.
 */
const TestLayer = Layer.merge(SshExecutorTest, TelemetryTest);

describe("SshExecutor", () => {
  layer(TestLayer)("executeCommand with mock responses", (it) => {
    it.effect("executes command and returns stdout, stderr, exitCode", () =>
      Effect.gen(function* () {
        // Arrange: push a mock response
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "hello world\n",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        // Act
        const executor = yield* SshExecutor;
        const result = yield* executor.executeCommand(testHost, "echo hello world");

        // Assert
        expect(result.stdout).toBe("hello world\n");
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
      }),
    );

    it.effect("records executed calls for verification", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const executor = yield* SshExecutor;
        yield* executor.executeCommand(testHost, "hostname");

        const callsAfter = yield* Ref.get(callsRef);
        expect(callsAfter).toHaveLength(countBefore + 1);
        const lastCall = callsAfter[callsAfter.length - 1];
        expect(lastCall.host).toEqual(testHost);
        expect(lastCall.command).toBe("hostname");
      }),
    );

    it.effect("returns default empty success when no mock response queued", () =>
      Effect.gen(function* () {
        const executor = yield* SshExecutor;
        const result = yield* executor.executeCommand(testHost, "ls");

        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
      }),
    );

    it.effect("captures stderr from command output", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "",
              stderr: "warning: something\n",
              exitCode: 0,
            },
          },
        ]);

        const executor = yield* SshExecutor;
        const result = yield* executor.executeCommand(testHost, "some-cmd");

        expect(result.stderr).toBe("warning: something\n");
      }),
    );

    it.effect("fails with ConnectionFailed for connection errors", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new ConnectionFailed({
              host: "badhost",
              cause: "Connection refused",
            }),
          },
        ]);

        const executor = yield* SshExecutor;
        const result = yield* executor
          .executeCommand(
            { ...testHost, hostname: "badhost" },
            "echo test",
          )
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(ConnectionFailed);
          expect((result.left as ConnectionFailed).host).toBe("badhost");
        }
      }),
    );

    it.effect("fails with ConnectionTimeout for timeout errors", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new ConnectionTimeout({
              host: "slowhost",
              timeoutMs: 5000,
            }),
          },
        ]);

        const executor = yield* SshExecutor;
        const result = yield* executor
          .executeCommand(
            { ...testHost, hostname: "slowhost" },
            "echo test",
            { timeoutMs: 5000 },
          )
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(ConnectionTimeout);
          expect((result.left as ConnectionTimeout).timeoutMs).toBe(5000);
        }
      }),
    );

    it.effect("fails with CommandFailed for non-zero exit codes", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "false",
              exitCode: 1,
              stdout: "",
              stderr: "command not found\n",
            }),
          },
        ]);

        const executor = yield* SshExecutor;
        const result = yield* executor
          .executeCommand(testHost, "false")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(CommandFailed);
          const err = result.left as CommandFailed;
          expect(err.exitCode).toBe(1);
          expect(err.host).toBe("testhost");
          expect(err.command).toBe("false");
        }
      }),
    );

    it.effect("consumes mock responses in FIFO order", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: "first\n", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "second\n", stderr: "", exitCode: 0 },
          },
        ]);

        const executor = yield* SshExecutor;
        const r1 = yield* executor.executeCommand(testHost, "cmd1");
        const r2 = yield* executor.executeCommand(testHost, "cmd2");

        expect(r1.stdout).toBe("first\n");
        expect(r2.stdout).toBe("second\n");
      }),
    );
  });
});

describe("SshError types", () => {
  it("ConnectionFailed has correct _tag", () => {
    const err = new ConnectionFailed({ host: "h", cause: "reason" });
    expect(err._tag).toBe("ConnectionFailed");
    expect(err.host).toBe("h");
    expect(err.message).toContain("h");
    expect(err.message).toContain("reason");
  });

  it("ConnectionTimeout has correct _tag", () => {
    const err = new ConnectionTimeout({ host: "h", timeoutMs: 5000 });
    expect(err._tag).toBe("ConnectionTimeout");
    expect(err.host).toBe("h");
    expect(err.timeoutMs).toBe(5000);
    expect(err.message).toContain("5000");
  });

  it("CommandFailed has correct _tag", () => {
    const err = new CommandFailed({
      host: "h",
      command: "false",
      exitCode: 127,
      stdout: "",
      stderr: "not found",
    });
    expect(err._tag).toBe("CommandFailed");
    expect(err.exitCode).toBe(127);
    expect(err.host).toBe("h");
    expect(err.message).toContain("127");
  });

  it("ConnectionFailed is distinct from CommandFailed", () => {
    const connErr = new ConnectionFailed({ host: "h", cause: "refused" });
    const cmdErr = new CommandFailed({
      host: "h",
      command: "ls",
      exitCode: 1,
      stdout: "",
      stderr: "",
    });
    expect(connErr._tag).not.toBe(cmdErr._tag);
  });

  it("ConnectionTimeout is distinct from ConnectionFailed", () => {
    const timeoutErr = new ConnectionTimeout({ host: "h", timeoutMs: 5000 });
    const connErr = new ConnectionFailed({ host: "h", cause: "refused" });
    expect(timeoutErr._tag).not.toBe(connErr._tag);
  });
});

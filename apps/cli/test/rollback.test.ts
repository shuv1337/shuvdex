import { it, layer } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Layer, Ref } from "effect";
import { HostRegistry } from "@codex-fleet/core";
import type { HostConfig } from "@codex-fleet/core";
import {
  SshExecutorTest,
  MockSshResponses,
  ConnectionFailed,
  ConnectionTimeout,
  CommandFailed,
} from "@codex-fleet/ssh";
import { TelemetryTest } from "@codex-fleet/telemetry";
import { GitOpsLive } from "@codex-fleet/git-ops";
import {
  runRollback,
  formatRollbackTable,
  formatRollbackJson,
} from "../src/commands/rollback.js";
import type { RollbackCommandResult } from "../src/commands/rollback.js";

/**
 * Test host configurations.
 */
const host1: HostConfig = {
  hostname: "shuvtest",
  connectionType: "ssh",
  port: 22,
  timeout: 30,
};

const host2: HostConfig = {
  hostname: "shuvbot",
  connectionType: "ssh",
  port: 22,
  timeout: 30,
};

const testRegistry = HostRegistry.fromRecord({
  shuvtest: host1,
  shuvbot: host2,
});

const singleRegistry = HostRegistry.fromRecord({
  shuvtest: host1,
});

const repoPath = "~/repos/shuvbot-skills";

/**
 * Combined test layer: mock SSH + test telemetry + GitOpsLive (backed by mock SSH).
 */
const TestLayer = Layer.mergeAll(
  SshExecutorTest,
  TelemetryTest,
  Layer.provideMerge(GitOpsLive, SshExecutorTest),
);

describe("fleet rollback", () => {
  // --- runRollback single host ---

  layer(TestLayer)("runRollback single host", (it) => {
    it.effect("returns success when checkout succeeds on single host", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        // git checkout succeeds (empty stdout, empty stderr, exit 0)
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "",
              stderr: "Switched to branch 'main'\n",
              exitCode: 0,
            },
          },
        ]);

        const result = yield* runRollback(
          singleRegistry,
          "v1.0.0",
          repoPath,
        );
        expect(result.hosts).toHaveLength(1);
        expect(result.hosts[0].name).toBe("shuvtest");
        expect(result.hosts[0].status).toBe("ok");
        if (result.hosts[0].status === "ok") {
          expect(result.hosts[0].ref).toBe("v1.0.0");
        }
        expect(result.allSucceeded).toBe(true);
      }),
    );

    it.effect("returns failure for invalid ref", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        // git checkout fails with invalid ref error (non-zero exit → CommandFailed)
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "shuvtest",
              command: "cd ~/repos/shuvbot-skills && git checkout 'nonexistent-ref'",
              exitCode: 1,
              stdout: "",
              stderr:
                "error: pathspec 'nonexistent-ref' did not match any file(s) known to git\n",
            }),
          },
        ]);

        const result = yield* runRollback(
          singleRegistry,
          "nonexistent-ref",
          repoPath,
        );
        expect(result.hosts[0].status).toBe("fail");
        if (result.hosts[0].status === "fail") {
          expect(result.hosts[0].error).toBeDefined();
          expect(result.hosts[0].error.length).toBeGreaterThan(0);
        }
        expect(result.allSucceeded).toBe(false);
      }),
    );
  });

  // --- runRollback multiple hosts ---

  layer(TestLayer)("runRollback multiple hosts", (it) => {
    it.effect("returns success when all hosts succeed", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "",
              stderr: "HEAD is now at abc1234 some commit\n",
              exitCode: 0,
            },
          },
          {
            _tag: "result" as const,
            value: {
              stdout: "",
              stderr: "HEAD is now at abc1234 some commit\n",
              exitCode: 0,
            },
          },
        ]);

        const result = yield* runRollback(testRegistry, "abc1234", repoPath);
        expect(result.hosts).toHaveLength(2);
        expect(result.allSucceeded).toBe(true);
        expect(result.hosts.every((h) => h.status === "ok")).toBe(true);
      }),
    );

    it.effect("returns partial failure when some hosts fail", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "",
              stderr: "HEAD is now at abc1234 some commit\n",
              exitCode: 0,
            },
          },
          {
            _tag: "error" as const,
            value: new ConnectionFailed({
              host: "shuvbot",
              cause: "Connection refused",
            }),
          },
        ]);

        const result = yield* runRollback(testRegistry, "abc1234", repoPath);
        expect(result.hosts).toHaveLength(2);
        expect(result.allSucceeded).toBe(false);

        const ok = result.hosts.filter((h) => h.status === "ok");
        const fail = result.hosts.filter((h) => h.status === "fail");
        expect(ok).toHaveLength(1);
        expect(fail).toHaveLength(1);
        if (fail[0].status === "fail") {
          expect(fail[0].error).toBeDefined();
        }
      }),
    );

    it.effect("returns all failed when all hosts fail", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new ConnectionFailed({
              host: "shuvtest",
              cause: "Connection refused",
            }),
          },
          {
            _tag: "error" as const,
            value: new ConnectionFailed({
              host: "shuvbot",
              cause: "Connection refused",
            }),
          },
        ]);

        const result = yield* runRollback(testRegistry, "abc1234", repoPath);
        expect(result.allSucceeded).toBe(false);
        expect(result.hosts.every((h) => h.status === "fail")).toBe(true);
      }),
    );

    it.effect("handles timeout errors", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new ConnectionTimeout({
              host: "shuvtest",
              timeoutMs: 30000,
            }),
          },
        ]);

        const result = yield* runRollback(
          singleRegistry,
          "v1.0.0",
          repoPath,
        );
        expect(result.hosts[0].status).toBe("fail");
        if (result.hosts[0].status === "fail") {
          expect(result.hosts[0].error).toContain("timeout");
        }
        expect(result.allSucceeded).toBe(false);
      }),
    );
  });

  // --- runRollback with host filter ---

  layer(TestLayer)("runRollback with host filter", (it) => {
    it.effect("rolls back only specified hosts", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "",
              stderr: "HEAD is now at abc1234 some commit\n",
              exitCode: 0,
            },
          },
        ]);

        const result = yield* runRollback(testRegistry, "abc1234", repoPath, [
          "shuvtest",
        ]);
        expect(result.hosts).toHaveLength(1);
        expect(result.hosts[0].name).toBe("shuvtest");
        expect(result.allSucceeded).toBe(true);
      }),
    );
  });

  // --- formatRollbackTable ---

  describe("formatRollbackTable", () => {
    it("displays all hosts with rollback results", () => {
      const result: RollbackCommandResult = {
        ref: "v1.0.0",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            ref: "v1.0.0",
          },
          {
            name: "shuvbot",
            hostname: "shuvbot",
            status: "ok",
            ref: "v1.0.0",
          },
        ],
        allSucceeded: true,
      };

      const output = formatRollbackTable(result);
      expect(output).toContain("shuvtest");
      expect(output).toContain("shuvbot");
      expect(output).toContain("[OK]");
      expect(output).toContain("checked out v1.0.0");
      expect(output).toContain("2 succeeded, 0 failed");
    });

    it("displays error hosts with error message", () => {
      const result: RollbackCommandResult = {
        ref: "nonexistent-ref",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            ref: "nonexistent-ref",
          },
          {
            name: "shuvbot",
            hostname: "shuvbot",
            status: "fail",
            error: "Connection refused",
          },
        ],
        allSucceeded: false,
      };

      const output = formatRollbackTable(result);
      expect(output).toContain("shuvtest");
      expect(output).toContain("[OK]");
      expect(output).toContain("shuvbot");
      expect(output).toContain("[FAIL]");
      expect(output).toContain("Connection refused");
      expect(output).toContain("1 succeeded, 1 failed");
    });

    it("shows header row", () => {
      const result: RollbackCommandResult = {
        ref: "v1.0.0",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            ref: "v1.0.0",
          },
        ],
        allSucceeded: true,
      };

      const output = formatRollbackTable(result);
      expect(output).toContain("HOST");
      expect(output).toContain("STATUS");
    });
  });

  // --- formatRollbackJson ---

  describe("formatRollbackJson", () => {
    it("outputs valid JSON with host data", () => {
      const result: RollbackCommandResult = {
        ref: "v1.0.0",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            ref: "v1.0.0",
          },
          {
            name: "shuvbot",
            hostname: "shuvbot",
            status: "ok",
            ref: "v1.0.0",
          },
        ],
        allSucceeded: true,
      };

      const output = formatRollbackJson(result);
      const parsed = JSON.parse(output);
      expect(parsed.ref).toBe("v1.0.0");
      expect(parsed.hosts).toHaveLength(2);
      expect(parsed.allSucceeded).toBe(true);
      expect(parsed.hosts[0].name).toBe("shuvtest");
      expect(parsed.hosts[0].status).toBe("ok");
      expect(parsed.hosts[0].ref).toBe("v1.0.0");
    });

    it("includes error field only when host has error", () => {
      const result: RollbackCommandResult = {
        ref: "v1.0.0",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            ref: "v1.0.0",
          },
          {
            name: "shuvbot",
            hostname: "shuvbot",
            status: "fail",
            error: "Connection refused",
          },
        ],
        allSucceeded: false,
      };

      const output = formatRollbackJson(result);
      const parsed = JSON.parse(output);
      expect(parsed.allSucceeded).toBe(false);
      expect(parsed.hosts[0]).not.toHaveProperty("error");
      expect(parsed.hosts[1].error).toBe("Connection refused");
    });

    it("produces parseable JSON", () => {
      const result: RollbackCommandResult = {
        ref: "v1.0.0",
        hosts: [],
        allSucceeded: true,
      };

      const output = formatRollbackJson(result);
      expect(() => JSON.parse(output)).not.toThrow();
    });
  });
});

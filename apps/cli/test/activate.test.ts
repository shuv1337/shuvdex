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
} from "@codex-fleet/ssh";
import { TelemetryTest } from "@codex-fleet/telemetry";
import { SkillOpsLive } from "@codex-fleet/skill-ops";
import { GitOpsLive } from "@codex-fleet/git-ops";
import {
  runActivate,
  formatActivateTable,
  formatActivateJson,
} from "../src/commands/activate.js";
import type { ActivateCommandResult } from "../src/commands/activate.js";

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
const activeDir = "~/.codex/skills";

/**
 * Combined test layer: mock SSH + test telemetry + GitOpsLive + SkillOpsLive.
 */
const BaseLayer = Layer.mergeAll(
  SshExecutorTest,
  TelemetryTest,
  Layer.provideMerge(GitOpsLive, SshExecutorTest),
);

const TestLayer = Layer.provideMerge(SkillOpsLive, BaseLayer);

describe("fleet activate", () => {
  // --- runActivate single host success ---

  layer(TestLayer)("runActivate single host success", (it) => {
    it.effect("returns success when activation creates symlink", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        // Mock responses for activateSkill:
        // 1. checkSymlink: test -L ... && test -e ... => "inactive"
        // 2. mkdir -p activeDir
        // 3. test -L ... && rm ... || true (remove existing)
        // 4. ln -s targetPath symlinkPath
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const result = yield* runActivate(
          singleRegistry,
          "my-skill",
          repoPath,
          activeDir,
        );

        expect(result.skillName).toBe("my-skill");
        expect(result.hosts).toHaveLength(1);
        expect(result.hosts[0].name).toBe("shuvtest");
        expect(result.hosts[0].status).toBe("ok");
        if (result.hosts[0].status === "ok") {
          expect(result.hosts[0].alreadyInState).toBe(false);
          expect(result.hosts[0].skillStatus).toBe("active");
        }
        expect(result.allSucceeded).toBe(true);
      }),
    );
  });

  // --- runActivate already active (idempotent) ---

  layer(TestLayer)("runActivate already active", (it) => {
    it.effect("returns 'already active' when skill is already active", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        // Mock responses for activateSkill:
        // 1. checkSymlink => "active"
        // 2. readSymlinkTarget => correct path
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: "active\n", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: {
              stdout: `${repoPath}/my-skill\n`,
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const result = yield* runActivate(
          singleRegistry,
          "my-skill",
          repoPath,
          activeDir,
        );

        expect(result.hosts).toHaveLength(1);
        expect(result.hosts[0].status).toBe("ok");
        if (result.hosts[0].status === "ok") {
          expect(result.hosts[0].alreadyInState).toBe(true);
          expect(result.hosts[0].skillStatus).toBe("active");
        }
        expect(result.allSucceeded).toBe(true);
      }),
    );
  });

  // --- runActivate multiple hosts ---

  layer(TestLayer)("runActivate multiple hosts", (it) => {
    it.effect("returns success when all hosts succeed", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        // Two hosts, each needs: checkSymlink + mkdir + rm + ln
        yield* Ref.set(responsesRef, [
          // Host 1: inactive -> activate
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          // Host 2: inactive -> activate
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const result = yield* runActivate(
          testRegistry,
          "my-skill",
          repoPath,
          activeDir,
        );

        expect(result.hosts).toHaveLength(2);
        expect(result.allSucceeded).toBe(true);
        expect(result.hosts.every((h) => h.status === "ok")).toBe(true);
      }),
    );

    it.effect("returns partial failure when some hosts fail", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        // Host 1: inactive -> activate success
        // Host 2: connection fails
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          {
            _tag: "error" as const,
            value: new ConnectionFailed({
              host: "shuvbot",
              cause: "Connection refused",
            }),
          },
        ]);

        const result = yield* runActivate(
          testRegistry,
          "my-skill",
          repoPath,
          activeDir,
        );

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
  });

  // --- runActivate with host filter ---

  layer(TestLayer)("runActivate with host filter", (it) => {
    it.effect("activates only on specified hosts", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        // Only 1 host (filtered to shuvtest)
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const result = yield* runActivate(
          testRegistry,
          "my-skill",
          repoPath,
          activeDir,
          ["shuvtest"],
        );

        expect(result.hosts).toHaveLength(1);
        expect(result.hosts[0].name).toBe("shuvtest");
        expect(result.allSucceeded).toBe(true);
      }),
    );
  });

  // --- runActivate timeout handling ---

  layer(TestLayer)("runActivate timeout handling", (it) => {
    it.effect("handles timeout errors gracefully", () =>
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

        const result = yield* runActivate(
          singleRegistry,
          "my-skill",
          repoPath,
          activeDir,
        );

        expect(result.hosts[0].status).toBe("fail");
        if (result.hosts[0].status === "fail") {
          expect(result.hosts[0].error).toContain("timed out");
        }
        expect(result.allSucceeded).toBe(false);
      }),
    );
  });

  // --- formatActivateTable ---

  describe("formatActivateTable", () => {
    it("displays all hosts with activation results", () => {
      const result: ActivateCommandResult = {
        skillName: "my-skill",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            alreadyInState: false,
            skillStatus: "active",
          },
          {
            name: "shuvbot",
            hostname: "shuvbot",
            status: "ok",
            alreadyInState: false,
            skillStatus: "active",
          },
        ],
        allSucceeded: true,
      };

      const output = formatActivateTable(result);
      expect(output).toContain("shuvtest");
      expect(output).toContain("shuvbot");
      expect(output).toContain("[OK]");
      expect(output).toContain("2 succeeded, 0 failed");
    });

    it("shows 'already active' when idempotent", () => {
      const result: ActivateCommandResult = {
        skillName: "my-skill",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            alreadyInState: true,
            skillStatus: "active",
          },
        ],
        allSucceeded: true,
      };

      const output = formatActivateTable(result);
      expect(output).toContain("already active");
    });

    it("displays error hosts with error message", () => {
      const result: ActivateCommandResult = {
        skillName: "my-skill",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            alreadyInState: false,
            skillStatus: "active",
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

      const output = formatActivateTable(result);
      expect(output).toContain("[OK]");
      expect(output).toContain("[FAIL]");
      expect(output).toContain("Connection refused");
      expect(output).toContain("1 succeeded, 1 failed");
    });

    it("shows header row", () => {
      const result: ActivateCommandResult = {
        skillName: "my-skill",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            alreadyInState: false,
            skillStatus: "active",
          },
        ],
        allSucceeded: true,
      };

      const output = formatActivateTable(result);
      expect(output).toContain("HOST");
      expect(output).toContain("STATUS");
    });
  });

  // --- formatActivateJson ---

  describe("formatActivateJson", () => {
    it("outputs valid JSON with host data", () => {
      const result: ActivateCommandResult = {
        skillName: "my-skill",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            alreadyInState: false,
            skillStatus: "active",
          },
          {
            name: "shuvbot",
            hostname: "shuvbot",
            status: "ok",
            alreadyInState: true,
            skillStatus: "active",
          },
        ],
        allSucceeded: true,
      };

      const output = formatActivateJson(result);
      const parsed = JSON.parse(output);
      expect(parsed.skillName).toBe("my-skill");
      expect(parsed.hosts).toHaveLength(2);
      expect(parsed.allSucceeded).toBe(true);
      expect(parsed.hosts[0].name).toBe("shuvtest");
      expect(parsed.hosts[0].status).toBe("ok");
      expect(parsed.hosts[0].alreadyInState).toBe(false);
      expect(parsed.hosts[1].alreadyInState).toBe(true);
    });

    it("includes error field only when host has error", () => {
      const result: ActivateCommandResult = {
        skillName: "my-skill",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            alreadyInState: false,
            skillStatus: "active",
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

      const output = formatActivateJson(result);
      const parsed = JSON.parse(output);
      expect(parsed.allSucceeded).toBe(false);
      expect(parsed.hosts[0]).not.toHaveProperty("error");
      expect(parsed.hosts[1].error).toBe("Connection refused");
    });

    it("produces parseable JSON", () => {
      const result: ActivateCommandResult = {
        skillName: "test",
        hosts: [],
        allSucceeded: true,
      };

      const output = formatActivateJson(result);
      expect(() => JSON.parse(output)).not.toThrow();
    });
  });
});

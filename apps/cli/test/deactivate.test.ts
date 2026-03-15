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
  runDeactivate,
  formatDeactivateTable,
  formatDeactivateJson,
} from "../src/commands/deactivate.js";
import type { DeactivateCommandResult } from "../src/commands/deactivate.js";

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

describe("fleet deactivate", () => {
  // --- runDeactivate single host success ---

  layer(TestLayer)("runDeactivate single host success", (it) => {
    it.effect("returns success when deactivation removes symlink", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        // Mock responses for deactivateSkill:
        // 1. test -L ... && echo "exists" || echo "absent" => "exists"
        // 2. rm symlinkPath
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const result = yield* runDeactivate(
          singleRegistry,
          "my-skill",
          activeDir,
        );

        expect(result.skillName).toBe("my-skill");
        expect(result.hosts).toHaveLength(1);
        expect(result.hosts[0].name).toBe("shuvtest");
        expect(result.hosts[0].status).toBe("ok");
        if (result.hosts[0].status === "ok") {
          expect(result.hosts[0].alreadyInState).toBe(false);
          expect(result.hosts[0].skillStatus).toBe("inactive");
        }
        expect(result.allSucceeded).toBe(true);
      }),
    );
  });

  // --- runDeactivate already inactive (idempotent) ---

  layer(TestLayer)("runDeactivate already inactive", (it) => {
    it.effect(
      "returns 'not active' when skill is already inactive",
      () =>
        Effect.gen(function* () {
          const responsesRef = yield* MockSshResponses;
          // Mock responses for deactivateSkill:
          // 1. test -L ... && echo "exists" || echo "absent" => "absent"
          yield* Ref.set(responsesRef, [
            {
              _tag: "result" as const,
              value: { stdout: "absent\n", stderr: "", exitCode: 0 },
            },
          ]);

          const result = yield* runDeactivate(
            singleRegistry,
            "my-skill",
            activeDir,
          );

          expect(result.hosts).toHaveLength(1);
          expect(result.hosts[0].status).toBe("ok");
          if (result.hosts[0].status === "ok") {
            expect(result.hosts[0].alreadyInState).toBe(true);
            expect(result.hosts[0].skillStatus).toBe("inactive");
          }
          expect(result.allSucceeded).toBe(true);
        }),
    );
  });

  // --- runDeactivate multiple hosts ---

  layer(TestLayer)("runDeactivate multiple hosts", (it) => {
    it.effect("returns success when all hosts succeed", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        // Two hosts, each needs: check + rm
        yield* Ref.set(responsesRef, [
          // Host 1: active -> deactivate
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          // Host 2: active -> deactivate
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const result = yield* runDeactivate(
          testRegistry,
          "my-skill",
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
        // Host 1: active -> deactivate success
        // Host 2: connection fails
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
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

        const result = yield* runDeactivate(
          testRegistry,
          "my-skill",
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

  // --- runDeactivate with host filter ---

  layer(TestLayer)("runDeactivate with host filter", (it) => {
    it.effect("deactivates only on specified hosts", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        // Only 1 host (filtered to shuvtest)
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const result = yield* runDeactivate(
          testRegistry,
          "my-skill",
          activeDir,
          ["shuvtest"],
        );

        expect(result.hosts).toHaveLength(1);
        expect(result.hosts[0].name).toBe("shuvtest");
        expect(result.allSucceeded).toBe(true);
      }),
    );
  });

  // --- runDeactivate timeout handling ---

  layer(TestLayer)("runDeactivate timeout handling", (it) => {
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

        const result = yield* runDeactivate(
          singleRegistry,
          "my-skill",
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

  // --- formatDeactivateTable ---

  describe("formatDeactivateTable", () => {
    it("displays all hosts with deactivation results", () => {
      const result: DeactivateCommandResult = {
        skillName: "my-skill",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            alreadyInState: false,
            skillStatus: "inactive",
          },
          {
            name: "shuvbot",
            hostname: "shuvbot",
            status: "ok",
            alreadyInState: false,
            skillStatus: "inactive",
          },
        ],
        allSucceeded: true,
      };

      const output = formatDeactivateTable(result);
      expect(output).toContain("shuvtest");
      expect(output).toContain("shuvbot");
      expect(output).toContain("✓");
      expect(output).toContain("2/2 hosts deactivated successfully");
    });

    it("shows 'not active' when idempotent", () => {
      const result: DeactivateCommandResult = {
        skillName: "my-skill",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            alreadyInState: true,
            skillStatus: "inactive",
          },
        ],
        allSucceeded: true,
      };

      const output = formatDeactivateTable(result);
      expect(output).toContain("not active");
    });

    it("displays error hosts with error message", () => {
      const result: DeactivateCommandResult = {
        skillName: "my-skill",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            alreadyInState: false,
            skillStatus: "inactive",
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

      const output = formatDeactivateTable(result);
      expect(output).toContain("✓");
      expect(output).toContain("✗");
      expect(output).toContain("Connection refused");
      expect(output).toContain("1/2 hosts deactivated successfully");
    });

    it("shows header row", () => {
      const result: DeactivateCommandResult = {
        skillName: "my-skill",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            alreadyInState: false,
            skillStatus: "inactive",
          },
        ],
        allSucceeded: true,
      };

      const output = formatDeactivateTable(result);
      expect(output).toContain("HOST");
      expect(output).toContain("STATUS");
    });
  });

  // --- formatDeactivateJson ---

  describe("formatDeactivateJson", () => {
    it("outputs valid JSON with host data", () => {
      const result: DeactivateCommandResult = {
        skillName: "my-skill",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            alreadyInState: false,
            skillStatus: "inactive",
          },
          {
            name: "shuvbot",
            hostname: "shuvbot",
            status: "ok",
            alreadyInState: true,
            skillStatus: "inactive",
          },
        ],
        allSucceeded: true,
      };

      const output = formatDeactivateJson(result);
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
      const result: DeactivateCommandResult = {
        skillName: "my-skill",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            alreadyInState: false,
            skillStatus: "inactive",
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

      const output = formatDeactivateJson(result);
      const parsed = JSON.parse(output);
      expect(parsed.allSucceeded).toBe(false);
      expect(parsed.hosts[0]).not.toHaveProperty("error");
      expect(parsed.hosts[1].error).toBe("Connection refused");
    });

    it("produces parseable JSON", () => {
      const result: DeactivateCommandResult = {
        skillName: "test",
        hosts: [],
        allSucceeded: true,
      };

      const output = formatDeactivateJson(result);
      expect(() => JSON.parse(output)).not.toThrow();
    });
  });
});

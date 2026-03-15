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
  runSync,
  formatSyncTable,
  formatSyncJson,
} from "../src/commands/sync.js";
import type { SyncCommandResult } from "../src/commands/sync.js";

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
 * Combined test layer: mock SSH + test telemetry + GitOpsLive + SkillOpsLive.
 */
const BaseLayer = Layer.mergeAll(
  SshExecutorTest,
  TelemetryTest,
  Layer.provideMerge(GitOpsLive, SshExecutorTest),
);

const TestLayer = Layer.provideMerge(SkillOpsLive, BaseLayer);

describe("fleet sync", () => {
  // --- runSync missing skill (local validation) ---

  describe("runSync local validation", () => {
    it("returns error before SSH when skill does not exist locally", () => {
      const result = runSync(
        singleRegistry,
        "nonexistent-skill-xyz",
        "/tmp/no-such-repo",
        repoPath,
      );

      // Should return an error result without needing any SSH layer
      // We run it through the test layer but it should fail before
      // contacting any host
      const program = result.pipe(Effect.provide(TestLayer));
      return Effect.runPromise(program).then((res) => {
        expect(res.allSucceeded).toBe(false);
        expect(res.skillError).toBeDefined();
        expect(res.skillError).toContain("not found");
        expect(res.hosts).toHaveLength(0);
      });
    });
  });

  // --- runSync single host ---

  layer(TestLayer)("runSync single host success", (it) => {
    it.effect("returns success when sync succeeds on single host", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        // Mock responses for syncSkill:
        // 1. mkdir -p (ensure remote dir exists)
        // 2. find ... | wc -l (count files)
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "3\n", stderr: "", exitCode: 0 },
          },
        ]);

        // Use a local path that exists (this test dir itself)
        const result = yield* runSync(
          singleRegistry,
          "test",
          "/home/shuv/repos/codex-fleet/apps/cli",
          repoPath,
        );

        expect(result.hosts).toHaveLength(1);
        expect(result.hosts[0].name).toBe("shuvtest");
        expect(result.hosts[0].status).toBe("ok");
        expect(result.allSucceeded).toBe(true);
        expect(result.skillError).toBeUndefined();
      }),
    );
  });

  // --- runSync multiple hosts ---

  layer(TestLayer)("runSync multiple hosts", (it) => {
    it.effect("returns success when all hosts succeed", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        // Two hosts, each needs: mkdir + find (rsync is exec'd locally)
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "3\n", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "3\n", stderr: "", exitCode: 0 },
          },
        ]);

        const result = yield* runSync(
          testRegistry,
          "test",
          "/home/shuv/repos/codex-fleet/apps/cli",
          repoPath,
        );

        expect(result.hosts).toHaveLength(2);
        expect(result.allSucceeded).toBe(true);
        expect(result.hosts.every((h) => h.status === "ok")).toBe(true);
      }),
    );

    it.effect("returns partial failure when some hosts fail", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        // First host succeeds: mkdir + find
        // Second host fails at mkdir
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "3\n", stderr: "", exitCode: 0 },
          },
          {
            _tag: "error" as const,
            value: new ConnectionFailed({
              host: "shuvbot",
              cause: "Connection refused",
            }),
          },
        ]);

        const result = yield* runSync(
          testRegistry,
          "test",
          "/home/shuv/repos/codex-fleet/apps/cli",
          repoPath,
        );

        expect(result.hosts).toHaveLength(2);
        expect(result.allSucceeded).toBe(false);

        const ok = result.hosts.filter((h) => h.status === "ok");
        const fail = result.hosts.filter((h) => h.status === "fail");
        expect(ok).toHaveLength(1);
        expect(fail).toHaveLength(1);
        expect(fail[0].error).toBeDefined();
      }),
    );
  });

  // --- runSync with host filter ---

  layer(TestLayer)("runSync with host filter", (it) => {
    it.effect("syncs only specified hosts", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        // One host: mkdir + find
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "3\n", stderr: "", exitCode: 0 },
          },
        ]);

        const result = yield* runSync(
          testRegistry,
          "test",
          "/home/shuv/repos/codex-fleet/apps/cli",
          repoPath,
          ["shuvtest"],
        );

        expect(result.hosts).toHaveLength(1);
        expect(result.hosts[0].name).toBe("shuvtest");
        expect(result.allSucceeded).toBe(true);
      }),
    );
  });

  // --- runSync with timeout ---

  layer(TestLayer)("runSync timeout handling", (it) => {
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

        const result = yield* runSync(
          singleRegistry,
          "test",
          "/home/shuv/repos/codex-fleet/apps/cli",
          repoPath,
        );

        expect(result.hosts[0].status).toBe("fail");
        expect(result.hosts[0].error).toContain("timed out");
        expect(result.allSucceeded).toBe(false);
      }),
    );
  });

  // --- formatSyncTable ---

  describe("formatSyncTable", () => {
    it("displays all hosts with sync results", () => {
      const result: SyncCommandResult = {
        skillName: "my-skill",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            filesTransferred: 5,
          },
          {
            name: "shuvbot",
            hostname: "shuvbot",
            status: "ok",
            filesTransferred: 5,
          },
        ],
        allSucceeded: true,
      };

      const output = formatSyncTable(result);
      expect(output).toContain("shuvtest");
      expect(output).toContain("shuvbot");
      expect(output).toContain("✓");
      expect(output).toContain("2/2 hosts synced successfully");
    });

    it("displays error hosts with error message", () => {
      const result: SyncCommandResult = {
        skillName: "my-skill",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            filesTransferred: 5,
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

      const output = formatSyncTable(result);
      expect(output).toContain("shuvtest");
      expect(output).toContain("✓");
      expect(output).toContain("shuvbot");
      expect(output).toContain("✗");
      expect(output).toContain("Connection refused");
      expect(output).toContain("1/2 hosts synced successfully");
    });

    it("displays skill error when skill is missing", () => {
      const result: SyncCommandResult = {
        skillName: "nonexistent",
        hosts: [],
        allSucceeded: false,
        skillError: 'Skill "nonexistent" not found at /some/path/nonexistent',
      };

      const output = formatSyncTable(result);
      expect(output).toContain("nonexistent");
      expect(output).toContain("not found");
    });

    it("shows header row", () => {
      const result: SyncCommandResult = {
        skillName: "my-skill",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            filesTransferred: 5,
          },
        ],
        allSucceeded: true,
      };

      const output = formatSyncTable(result);
      expect(output).toContain("HOST");
      expect(output).toContain("STATUS");
    });
  });

  // --- formatSyncJson ---

  describe("formatSyncJson", () => {
    it("outputs valid JSON with host data", () => {
      const result: SyncCommandResult = {
        skillName: "my-skill",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            filesTransferred: 5,
          },
          {
            name: "shuvbot",
            hostname: "shuvbot",
            status: "ok",
            filesTransferred: 3,
          },
        ],
        allSucceeded: true,
      };

      const output = formatSyncJson(result);
      const parsed = JSON.parse(output);
      expect(parsed.skillName).toBe("my-skill");
      expect(parsed.hosts).toHaveLength(2);
      expect(parsed.allSucceeded).toBe(true);
      expect(parsed.hosts[0].name).toBe("shuvtest");
      expect(parsed.hosts[0].status).toBe("ok");
      expect(parsed.hosts[0].filesTransferred).toBe(5);
    });

    it("includes error field only when host has error", () => {
      const result: SyncCommandResult = {
        skillName: "my-skill",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            filesTransferred: 5,
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

      const output = formatSyncJson(result);
      const parsed = JSON.parse(output);
      expect(parsed.allSucceeded).toBe(false);
      expect(parsed.hosts[0]).not.toHaveProperty("error");
      expect(parsed.hosts[1].error).toBe("Connection refused");
    });

    it("includes skillError when present", () => {
      const result: SyncCommandResult = {
        skillName: "nonexistent",
        hosts: [],
        allSucceeded: false,
        skillError: 'Skill "nonexistent" not found',
      };

      const output = formatSyncJson(result);
      const parsed = JSON.parse(output);
      expect(parsed.skillError).toBe('Skill "nonexistent" not found');
      expect(parsed.allSucceeded).toBe(false);
    });

    it("produces parseable JSON", () => {
      const result: SyncCommandResult = {
        skillName: "test",
        hosts: [],
        allSucceeded: true,
      };

      const output = formatSyncJson(result);
      expect(() => JSON.parse(output)).not.toThrow();
    });
  });
});

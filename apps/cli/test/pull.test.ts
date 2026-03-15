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
import { GitOpsLive } from "@codex-fleet/git-ops";
import {
  runPull,
  formatPullTable,
  formatPullJson,
} from "../src/commands/pull.js";
import type { PullCommandResult } from "../src/commands/pull.js";

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

describe("fleet pull", () => {
  // --- runPull single host ---

  layer(TestLayer)("runPull single host", (it) => {
    it.effect("returns success when pull succeeds on single host", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        // git pull origin returns "Already up to date."
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "Already up to date.\n",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const result = yield* runPull(singleRegistry, repoPath);
        expect(result.hosts).toHaveLength(1);
        expect(result.hosts[0].name).toBe("shuvtest");
        expect(result.hosts[0].status).toBe("ok");
        expect(result.hosts[0].summary).toContain("Already up to date");
        expect(result.allSucceeded).toBe(true);
      }),
    );

    it.effect("returns success when pull fetches new changes", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout:
                "Updating abc1234..def5678\nFast-forward\n file.txt | 1 +\n 1 file changed\n",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const result = yield* runPull(singleRegistry, repoPath);
        expect(result.hosts[0].status).toBe("ok");
        expect(result.hosts[0].updated).toBe(true);
        expect(result.allSucceeded).toBe(true);
      }),
    );
  });

  // --- runPull multiple hosts ---

  layer(TestLayer)("runPull multiple hosts", (it) => {
    it.effect("returns success when all hosts succeed", () =>
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
            _tag: "result" as const,
            value: {
              stdout: "Already up to date.\n",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const result = yield* runPull(testRegistry, repoPath);
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
              stdout: "Already up to date.\n",
              stderr: "",
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

        const result = yield* runPull(testRegistry, repoPath);
        expect(result.hosts).toHaveLength(2);
        expect(result.allSucceeded).toBe(false);

        const ok = result.hosts.filter((h) => h.status === "ok");
        const fail = result.hosts.filter((h) => h.status === "fail");
        expect(ok).toHaveLength(1);
        expect(fail).toHaveLength(1);
        expect(fail[0].error).toBeDefined();
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

        const result = yield* runPull(testRegistry, repoPath);
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

        const result = yield* runPull(singleRegistry, repoPath);
        expect(result.hosts[0].status).toBe("fail");
        expect(result.hosts[0].error).toContain("timeout");
        expect(result.allSucceeded).toBe(false);
      }),
    );
  });

  // --- runPull with host filter ---

  layer(TestLayer)("runPull with host filter", (it) => {
    it.effect("pulls only specified hosts", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        // Only one response needed since we filter to one host
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "Already up to date.\n",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const result = yield* runPull(testRegistry, repoPath, ["shuvtest"]);
        expect(result.hosts).toHaveLength(1);
        expect(result.hosts[0].name).toBe("shuvtest");
        expect(result.allSucceeded).toBe(true);
      }),
    );
  });

  // --- formatPullTable ---

  describe("formatPullTable", () => {
    it("displays all hosts with pull results", () => {
      const result: PullCommandResult = {
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            updated: false,
            summary: "Already up to date.",
          },
          {
            name: "shuvbot",
            hostname: "shuvbot",
            status: "ok",
            updated: true,
            summary: "Fast-forward",
          },
        ],
        allSucceeded: true,
      };

      const output = formatPullTable(result);
      expect(output).toContain("shuvtest");
      expect(output).toContain("shuvbot");
      expect(output).toContain("✓");
      expect(output).toContain("2/2 hosts pulled successfully");
    });

    it("displays error hosts with error message", () => {
      const result: PullCommandResult = {
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            updated: false,
            summary: "Already up to date.",
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

      const output = formatPullTable(result);
      expect(output).toContain("shuvtest");
      expect(output).toContain("✓");
      expect(output).toContain("shuvbot");
      expect(output).toContain("✗");
      expect(output).toContain("Connection refused");
      expect(output).toContain("1/2 hosts pulled successfully");
    });

    it("shows header row", () => {
      const result: PullCommandResult = {
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            updated: false,
            summary: "Already up to date.",
          },
        ],
        allSucceeded: true,
      };

      const output = formatPullTable(result);
      expect(output).toContain("HOST");
      expect(output).toContain("STATUS");
    });
  });

  // --- formatPullJson ---

  describe("formatPullJson", () => {
    it("outputs valid JSON with host data", () => {
      const result: PullCommandResult = {
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            updated: false,
            summary: "Already up to date.",
          },
          {
            name: "shuvbot",
            hostname: "shuvbot",
            status: "ok",
            updated: true,
            summary: "Fast-forward",
          },
        ],
        allSucceeded: true,
      };

      const output = formatPullJson(result);
      const parsed = JSON.parse(output);
      expect(parsed.hosts).toHaveLength(2);
      expect(parsed.allSucceeded).toBe(true);
      expect(parsed.hosts[0].name).toBe("shuvtest");
      expect(parsed.hosts[0].status).toBe("ok");
      expect(parsed.hosts[0].updated).toBe(false);
      expect(parsed.hosts[0].summary).toBe("Already up to date.");
    });

    it("includes error field only when host has error", () => {
      const result: PullCommandResult = {
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            updated: false,
            summary: "Already up to date.",
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

      const output = formatPullJson(result);
      const parsed = JSON.parse(output);
      expect(parsed.allSucceeded).toBe(false);
      expect(parsed.hosts[0]).not.toHaveProperty("error");
      expect(parsed.hosts[1].error).toBe("Connection refused");
    });

    it("produces parseable JSON", () => {
      const result: PullCommandResult = {
        hosts: [],
        allSucceeded: true,
      };

      const output = formatPullJson(result);
      expect(() => JSON.parse(output)).not.toThrow();
    });
  });
});

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
  runTag,
  formatTagTable,
  formatTagJson,
} from "../src/commands/tag.js";
import type { TagCommandResult } from "../src/commands/tag.js";

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

describe("fleet tag", () => {
  // --- runTag single host ---

  layer(TestLayer)("runTag single host", (it) => {
    it.effect("returns success when tag creation succeeds on single host", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        // git tag succeeds (empty stdout, empty stderr, exit 0)
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const result = yield* runTag(singleRegistry, "v1.0.0", repoPath);
        expect(result.hosts).toHaveLength(1);
        expect(result.hosts[0].name).toBe("shuvtest");
        expect(result.hosts[0].status).toBe("ok");
        if (result.hosts[0].status === "ok") {
          expect(result.hosts[0].tagName).toBe("v1.0.0");
        }
        expect(result.allSucceeded).toBe(true);
      }),
    );

    it.effect("returns failure for duplicate tag", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        // git tag fails because tag already exists (non-zero exit → CommandFailed)
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "shuvtest",
              command: "cd ~/repos/shuvbot-skills && git tag -- 'v1.0.0'",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: tag 'v1.0.0' already exists\n",
            }),
          },
        ]);

        const result = yield* runTag(singleRegistry, "v1.0.0", repoPath);
        expect(result.hosts[0].status).toBe("fail");
        if (result.hosts[0].status === "fail") {
          expect(result.hosts[0].error).toBeDefined();
          expect(result.hosts[0].error.length).toBeGreaterThan(0);
        }
        expect(result.allSucceeded).toBe(false);
      }),
    );
  });

  // --- runTag multiple hosts ---

  layer(TestLayer)("runTag multiple hosts", (it) => {
    it.effect("returns success when all hosts succeed", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "",
              stderr: "",
              exitCode: 0,
            },
          },
          {
            _tag: "result" as const,
            value: {
              stdout: "",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const result = yield* runTag(testRegistry, "v2.0.0", repoPath);
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

        const result = yield* runTag(testRegistry, "v2.0.0", repoPath);
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

        const result = yield* runTag(testRegistry, "v2.0.0", repoPath);
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

        const result = yield* runTag(singleRegistry, "v1.0.0", repoPath);
        expect(result.hosts[0].status).toBe("fail");
        if (result.hosts[0].status === "fail") {
          expect(result.hosts[0].error).toContain("timeout");
        }
        expect(result.allSucceeded).toBe(false);
      }),
    );

    it.effect("handles duplicate tag on some hosts", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "",
              stderr: "",
              exitCode: 0,
            },
          },
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "shuvbot",
              command: "cd ~/repos/shuvbot-skills && git tag -- 'v1.0.0'",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: tag 'v1.0.0' already exists\n",
            }),
          },
        ]);

        const result = yield* runTag(testRegistry, "v1.0.0", repoPath);
        expect(result.allSucceeded).toBe(false);
        const ok = result.hosts.filter((h) => h.status === "ok");
        const fail = result.hosts.filter((h) => h.status === "fail");
        expect(ok).toHaveLength(1);
        expect(fail).toHaveLength(1);
      }),
    );
  });

  // --- runTag with host filter ---

  layer(TestLayer)("runTag with host filter", (it) => {
    it.effect("tags only specified hosts", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const result = yield* runTag(testRegistry, "v1.0.0", repoPath, [
          "shuvtest",
        ]);
        expect(result.hosts).toHaveLength(1);
        expect(result.hosts[0].name).toBe("shuvtest");
        expect(result.allSucceeded).toBe(true);
      }),
    );
  });

  // --- formatTagTable ---

  describe("formatTagTable", () => {
    it("displays all hosts with tag results", () => {
      const result: TagCommandResult = {
        tagName: "v1.0.0",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            tagName: "v1.0.0",
          },
          {
            name: "shuvbot",
            hostname: "shuvbot",
            status: "ok",
            tagName: "v1.0.0",
          },
        ],
        allSucceeded: true,
      };

      const output = formatTagTable(result);
      expect(output).toContain("shuvtest");
      expect(output).toContain("shuvbot");
      expect(output).toContain("✓");
      expect(output).toContain("tag 'v1.0.0' created");
      expect(output).toContain("2/2 hosts tagged successfully");
    });

    it("displays error hosts with error message", () => {
      const result: TagCommandResult = {
        tagName: "v1.0.0",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            tagName: "v1.0.0",
          },
          {
            name: "shuvbot",
            hostname: "shuvbot",
            status: "fail",
            error: "tag 'v1.0.0' already exists",
          },
        ],
        allSucceeded: false,
      };

      const output = formatTagTable(result);
      expect(output).toContain("shuvtest");
      expect(output).toContain("✓");
      expect(output).toContain("shuvbot");
      expect(output).toContain("✗");
      expect(output).toContain("tag 'v1.0.0' already exists");
      expect(output).toContain("1/2 hosts tagged successfully");
    });

    it("shows header row", () => {
      const result: TagCommandResult = {
        tagName: "v1.0.0",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            tagName: "v1.0.0",
          },
        ],
        allSucceeded: true,
      };

      const output = formatTagTable(result);
      expect(output).toContain("HOST");
      expect(output).toContain("STATUS");
    });
  });

  // --- formatTagJson ---

  describe("formatTagJson", () => {
    it("outputs valid JSON with host data", () => {
      const result: TagCommandResult = {
        tagName: "v1.0.0",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            tagName: "v1.0.0",
          },
          {
            name: "shuvbot",
            hostname: "shuvbot",
            status: "ok",
            tagName: "v1.0.0",
          },
        ],
        allSucceeded: true,
      };

      const output = formatTagJson(result);
      const parsed = JSON.parse(output);
      expect(parsed.tagName).toBe("v1.0.0");
      expect(parsed.hosts).toHaveLength(2);
      expect(parsed.allSucceeded).toBe(true);
      expect(parsed.hosts[0].name).toBe("shuvtest");
      expect(parsed.hosts[0].status).toBe("ok");
      expect(parsed.hosts[0].tagName).toBe("v1.0.0");
    });

    it("includes error field only when host has error", () => {
      const result: TagCommandResult = {
        tagName: "v1.0.0",
        hosts: [
          {
            name: "shuvtest",
            hostname: "shuvtest",
            status: "ok",
            tagName: "v1.0.0",
          },
          {
            name: "shuvbot",
            hostname: "shuvbot",
            status: "fail",
            error: "tag 'v1.0.0' already exists",
          },
        ],
        allSucceeded: false,
      };

      const output = formatTagJson(result);
      const parsed = JSON.parse(output);
      expect(parsed.allSucceeded).toBe(false);
      expect(parsed.hosts[0]).not.toHaveProperty("error");
      expect(parsed.hosts[1].error).toBe("tag 'v1.0.0' already exists");
    });

    it("produces parseable JSON", () => {
      const result: TagCommandResult = {
        tagName: "v1.0.0",
        hosts: [],
        allSucceeded: true,
      };

      const output = formatTagJson(result);
      expect(() => JSON.parse(output)).not.toThrow();
    });
  });
});

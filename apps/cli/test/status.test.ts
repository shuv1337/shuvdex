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
import {
  runStatus,
  checkHost,
  formatTable,
  formatJson,
} from "../src/commands/status.js";
import type { StatusResult } from "../src/commands/status.js";

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

/**
 * Combined test layer: mock SSH + test telemetry.
 */
const TestLayer = Layer.merge(SshExecutorTest, TelemetryTest);

describe("fleet status", () => {
  // --- checkHost ---

  layer(TestLayer)("checkHost", (it) => {
    it.effect("returns online when SSH succeeds", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: "ok\n", stderr: "", exitCode: 0 },
          },
        ]);

        const result = yield* checkHost("shuvtest", host1);
        expect(result.name).toBe("shuvtest");
        expect(result.hostname).toBe("shuvtest");
        expect(result.status).toBe("online");
        expect(result.error).toBeUndefined();
      }),
    );

    it.effect("returns error when SSH connection fails", () =>
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
        ]);

        const result = yield* checkHost("shuvtest", host1);
        expect(result.name).toBe("shuvtest");
        expect(result.status).toBe("error");
        expect(result.error).toBeDefined();
        expect(result.error).toContain("shuvtest");
      }),
    );

    it.effect("returns error when SSH connection times out", () =>
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

        const result = yield* checkHost("shuvtest", host1);
        expect(result.status).toBe("error");
        expect(result.error).toContain("timed out");
      }),
    );
  });

  // --- runStatus ---

  layer(TestLayer)("runStatus", (it) => {
    it.effect(
      "returns allOnline=true when all hosts respond",
      () =>
        Effect.gen(function* () {
          const responsesRef = yield* MockSshResponses;
          // Two hosts → two responses
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

          const result = yield* runStatus(testRegistry);
          expect(result.hosts).toHaveLength(2);
          expect(result.allOnline).toBe(true);
          expect(
            result.hosts.every((h) => h.status === "online"),
          ).toBe(true);
        }),
    );

    it.effect(
      "returns allOnline=false when some hosts fail",
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
              value: new ConnectionFailed({
                host: "shuvbot",
                cause: "Connection refused",
              }),
            },
          ]);

          const result = yield* runStatus(testRegistry);
          expect(result.hosts).toHaveLength(2);
          expect(result.allOnline).toBe(false);

          const online = result.hosts.filter(
            (h) => h.status === "online",
          );
          const errors = result.hosts.filter(
            (h) => h.status === "error",
          );
          expect(online).toHaveLength(1);
          expect(errors).toHaveLength(1);
        }),
    );

    it.effect(
      "returns allOnline=false when all hosts fail",
      () =>
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

          const result = yield* runStatus(testRegistry);
          expect(result.allOnline).toBe(false);
          expect(
            result.hosts.every((h) => h.status === "error"),
          ).toBe(true);
        }),
    );

    it.effect(
      "includes host names in results",
      () =>
        Effect.gen(function* () {
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

          const result = yield* runStatus(testRegistry);
          const names = result.hosts.map((h) => h.name);
          expect(names).toContain("shuvtest");
          expect(names).toContain("shuvbot");
        }),
    );
  });

  // --- formatTable ---

  describe("formatTable", () => {
    it("displays all hosts with status indicator", () => {
      const result: StatusResult = {
        hosts: [
          { name: "shuvtest", hostname: "shuvtest", status: "online" },
          { name: "shuvbot", hostname: "shuvbot", status: "online" },
        ],
        allOnline: true,
      };

      const output = formatTable(result);
      expect(output).toContain("shuvtest");
      expect(output).toContain("shuvbot");
      expect(output).toContain("[OK]");
      expect(output).toContain("online");
      expect(output).toContain("2 succeeded, 0 failed");
    });

    it("displays error hosts with error message", () => {
      const result: StatusResult = {
        hosts: [
          { name: "shuvtest", hostname: "shuvtest", status: "online" },
          {
            name: "shuvbot",
            hostname: "shuvbot",
            status: "error",
            error: "Connection refused",
          },
        ],
        allOnline: false,
      };

      const output = formatTable(result);
      expect(output).toContain("shuvtest");
      expect(output).toContain("[OK]");
      expect(output).toContain("online");
      expect(output).toContain("shuvbot");
      expect(output).toContain("[FAIL]");
      expect(output).toContain("Connection refused");
      expect(output).toContain("1 succeeded, 1 failed");
    });

    it("shows header row", () => {
      const result: StatusResult = {
        hosts: [
          { name: "shuvtest", hostname: "shuvtest", status: "online" },
        ],
        allOnline: true,
      };

      const output = formatTable(result);
      expect(output).toContain("HOST");
      expect(output).toContain("STATUS");
    });

    it("displays hostname from config, not registry name", () => {
      const result: StatusResult = {
        hosts: [
          { name: "prod-server", hostname: "192.168.1.100", status: "online" },
        ],
        allOnline: true,
      };

      const output = formatTable(result);
      expect(output).toContain("192.168.1.100");
      expect(output).not.toContain("prod-server");
    });
  });

  // --- formatJson ---

  describe("formatJson", () => {
    it("outputs valid JSON with host data", () => {
      const result: StatusResult = {
        hosts: [
          { name: "shuvtest", hostname: "shuvtest", status: "online" },
          { name: "shuvbot", hostname: "shuvbot", status: "online" },
        ],
        allOnline: true,
      };

      const output = formatJson(result);
      const parsed = JSON.parse(output);
      expect(parsed.hosts).toHaveLength(2);
      expect(parsed.allOnline).toBe(true);
      expect(parsed.hosts[0].name).toBe("shuvtest");
      expect(parsed.hosts[0].status).toBe("online");
    });

    it("includes error field only when host has error", () => {
      const result: StatusResult = {
        hosts: [
          { name: "shuvtest", hostname: "shuvtest", status: "online" },
          {
            name: "shuvbot",
            hostname: "shuvbot",
            status: "error",
            error: "Connection refused",
          },
        ],
        allOnline: false,
      };

      const output = formatJson(result);
      const parsed = JSON.parse(output);
      expect(parsed.allOnline).toBe(false);
      expect(parsed.hosts[0]).not.toHaveProperty("error");
      expect(parsed.hosts[1].error).toBe("Connection refused");
    });

    it("produces parseable JSON", () => {
      const result: StatusResult = {
        hosts: [],
        allOnline: true,
      };

      const output = formatJson(result);
      expect(() => JSON.parse(output)).not.toThrow();
    });
  });
});

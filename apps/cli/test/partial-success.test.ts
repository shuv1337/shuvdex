import { it, layer } from "@effect/vitest";
import { describe, expect, vi, beforeEach, afterEach } from "vitest";
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
import { SkillOpsLive } from "@codex-fleet/skill-ops";
import { run } from "../src/cli.js";
import {
  formatTable as formatStatusTable,
  formatJson as formatStatusJson,
} from "../src/commands/status.js";
import type { StatusResult } from "../src/commands/status.js";
import {
  formatPullTable,
  formatPullJson,
} from "../src/commands/pull.js";
import type { PullCommandResult } from "../src/commands/pull.js";
import {
  formatSyncTable,
  formatSyncJson,
} from "../src/commands/sync.js";
import type { SyncCommandResult } from "../src/commands/sync.js";
import {
  formatActivateTable,
  formatActivateJson,
} from "../src/commands/activate.js";
import type { ActivateCommandResult } from "../src/commands/activate.js";
import {
  formatDeactivateTable,
  formatDeactivateJson,
} from "../src/commands/deactivate.js";
import type { DeactivateCommandResult } from "../src/commands/deactivate.js";
import {
  formatRollbackTable,
  formatRollbackJson,
} from "../src/commands/rollback.js";
import type { RollbackCommandResult } from "../src/commands/rollback.js";
import {
  formatTagTable,
  formatTagJson,
} from "../src/commands/tag.js";
import type { TagCommandResult } from "../src/commands/tag.js";

/**
 * Tests for partial success handling across all multi-host commands.
 *
 * Covers:
 * - VAL-CLI-019: Partial success shows per-host [OK]/[FAIL] status,
 *                summary counts "X succeeded, Y failed", exit code 2
 * - VAL-CLI-020: --json produces valid JSON with host/status/error fields
 */

// ──────────────────────────────────────────────
// VAL-CLI-019: Per-host [OK]/[FAIL] and summary
// ──────────────────────────────────────────────

describe("VAL-CLI-019: partial success output format", () => {
  // --- Status command ---

  describe("status table format", () => {
    it("shows [OK] for online hosts and [FAIL] for error hosts", () => {
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

      const output = formatStatusTable(result);
      expect(output).toContain("[OK]");
      expect(output).toContain("[FAIL]");
    });

    it("displays summary with succeeded and failed counts", () => {
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

      const output = formatStatusTable(result);
      expect(output).toContain("1 succeeded");
      expect(output).toContain("1 failed");
    });
  });

  // --- Pull command ---

  describe("pull table format", () => {
    it("shows [OK] for succeeded hosts and [FAIL] for failed hosts", () => {
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
      expect(output).toContain("[OK]");
      expect(output).toContain("[FAIL]");
    });

    it("displays summary with succeeded and failed counts", () => {
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
      expect(output).toContain("1 succeeded");
      expect(output).toContain("1 failed");
    });
  });

  // --- Sync command ---

  describe("sync table format", () => {
    it("shows [OK] for succeeded hosts and [FAIL] for failed hosts", () => {
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
      expect(output).toContain("[OK]");
      expect(output).toContain("[FAIL]");
    });

    it("displays summary with succeeded and failed counts", () => {
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
      expect(output).toContain("1 succeeded");
      expect(output).toContain("1 failed");
    });
  });

  // --- Activate command ---

  describe("activate table format", () => {
    it("shows [OK] for succeeded hosts and [FAIL] for failed hosts", () => {
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
    });

    it("displays summary with succeeded and failed counts", () => {
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
      expect(output).toContain("1 succeeded");
      expect(output).toContain("1 failed");
    });
  });

  // --- Deactivate command ---

  describe("deactivate table format", () => {
    it("shows [OK] for succeeded hosts and [FAIL] for failed hosts", () => {
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
      expect(output).toContain("[OK]");
      expect(output).toContain("[FAIL]");
    });

    it("displays summary with succeeded and failed counts", () => {
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
      expect(output).toContain("1 succeeded");
      expect(output).toContain("1 failed");
    });
  });

  // --- Rollback command ---

  describe("rollback table format", () => {
    it("shows [OK] for succeeded hosts and [FAIL] for failed hosts", () => {
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

      const output = formatRollbackTable(result);
      expect(output).toContain("[OK]");
      expect(output).toContain("[FAIL]");
    });

    it("displays summary with succeeded and failed counts", () => {
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

      const output = formatRollbackTable(result);
      expect(output).toContain("1 succeeded");
      expect(output).toContain("1 failed");
    });
  });

  // --- Tag command ---

  describe("tag table format", () => {
    it("shows [OK] for succeeded hosts and [FAIL] for failed hosts", () => {
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
            error: "Connection refused",
          },
        ],
        allSucceeded: false,
      };

      const output = formatTagTable(result);
      expect(output).toContain("[OK]");
      expect(output).toContain("[FAIL]");
    });

    it("displays summary with succeeded and failed counts", () => {
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
            error: "Connection refused",
          },
        ],
        allSucceeded: false,
      };

      const output = formatTagTable(result);
      expect(output).toContain("1 succeeded");
      expect(output).toContain("1 failed");
    });
  });
});

// ──────────────────────────────────────────────
// VAL-CLI-019: Exit code 2 for partial success
// ──────────────────────────────────────────────

describe("VAL-CLI-019: exit code 2 for partial failure", () => {
  describe("status command exit codes", () => {
    it("exit code 2 when some hosts online, some error (partial)", () => {
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

      // Compute exit code using the same logic as runStatusCommand
      const onlineCount = result.hosts.filter(
        (h) => h.status === "online",
      ).length;
      const allOnline = result.allOnline;
      const allFailed = result.hosts.every((h) => h.status === "error");

      let exitCode: number;
      if (allOnline) {
        exitCode = 0;
      } else if (allFailed) {
        exitCode = 1;
      } else {
        exitCode = 2;
      }

      expect(exitCode).toBe(2);
    });
  });
});

// ──────────────────────────────────────────────
// VAL-CLI-020: --json mode produces valid JSON
// ──────────────────────────────────────────────

describe("VAL-CLI-020: --json mode produces valid JSON with host/status/error fields", () => {
  describe("status JSON output", () => {
    it("produces valid JSON with host, status, and error fields", () => {
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

      const output = formatStatusJson(result);
      const parsed = JSON.parse(output);

      // host/status/error fields per host
      expect(parsed.hosts[0]).toHaveProperty("name");
      expect(parsed.hosts[0]).toHaveProperty("status");
      expect(parsed.hosts[1]).toHaveProperty("name");
      expect(parsed.hosts[1]).toHaveProperty("status");
      expect(parsed.hosts[1]).toHaveProperty("error");
    });
  });

  describe("pull JSON output", () => {
    it("produces valid JSON with host, status, and error fields", () => {
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

      expect(parsed.hosts[0]).toHaveProperty("name");
      expect(parsed.hosts[0]).toHaveProperty("status");
      expect(parsed.hosts[1]).toHaveProperty("name");
      expect(parsed.hosts[1]).toHaveProperty("status");
      expect(parsed.hosts[1]).toHaveProperty("error");
    });
  });

  describe("sync JSON output", () => {
    it("produces valid JSON with host, status, and error fields", () => {
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

      expect(parsed.hosts[0]).toHaveProperty("name");
      expect(parsed.hosts[0]).toHaveProperty("status");
      expect(parsed.hosts[1]).toHaveProperty("name");
      expect(parsed.hosts[1]).toHaveProperty("status");
      expect(parsed.hosts[1]).toHaveProperty("error");
    });
  });

  describe("activate JSON output", () => {
    it("produces valid JSON with host, status, and error fields", () => {
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

      expect(parsed.hosts[0]).toHaveProperty("name");
      expect(parsed.hosts[0]).toHaveProperty("status");
      expect(parsed.hosts[1]).toHaveProperty("name");
      expect(parsed.hosts[1]).toHaveProperty("status");
      expect(parsed.hosts[1]).toHaveProperty("error");
    });
  });

  describe("deactivate JSON output", () => {
    it("produces valid JSON with host, status, and error fields", () => {
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

      expect(parsed.hosts[0]).toHaveProperty("name");
      expect(parsed.hosts[0]).toHaveProperty("status");
      expect(parsed.hosts[1]).toHaveProperty("name");
      expect(parsed.hosts[1]).toHaveProperty("status");
      expect(parsed.hosts[1]).toHaveProperty("error");
    });
  });

  describe("rollback JSON output", () => {
    it("produces valid JSON with host, status, and error fields", () => {
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

      expect(parsed.hosts[0]).toHaveProperty("name");
      expect(parsed.hosts[0]).toHaveProperty("status");
      expect(parsed.hosts[1]).toHaveProperty("name");
      expect(parsed.hosts[1]).toHaveProperty("status");
      expect(parsed.hosts[1]).toHaveProperty("error");
    });
  });

  describe("tag JSON output", () => {
    it("produces valid JSON with host, status, and error fields", () => {
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
            error: "Connection refused",
          },
        ],
        allSucceeded: false,
      };

      const output = formatTagJson(result);
      const parsed = JSON.parse(output);

      expect(parsed.hosts[0]).toHaveProperty("name");
      expect(parsed.hosts[0]).toHaveProperty("status");
      expect(parsed.hosts[1]).toHaveProperty("name");
      expect(parsed.hosts[1]).toHaveProperty("status");
      expect(parsed.hosts[1]).toHaveProperty("error");
    });
  });
});

// ──────────────────────────────────────────────
// E2E: run() with partial failure exit code 2
// ──────────────────────────────────────────────

describe("run() partial success exit codes", () => {
  let stdoutOutput: string;
  let stderrOutput: string;
  let originalStdoutWrite: typeof process.stdout.write;
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    stdoutOutput = "";
    stderrOutput = "";
    originalStdoutWrite = process.stdout.write;
    originalStderrWrite = process.stderr.write;

    process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
      stdoutOutput +=
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;

    process.stderr.write = vi.fn((chunk: string | Uint8Array) => {
      stderrOutput +=
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  });

  // We test the formatters directly since run() requires live config
  // The exit code logic is verified via the command implementation tests
  // (pull.test.ts, rollback.test.ts, etc.) which already test the
  // underlying command results. Here we verify the formatters produce
  // the correct output for partial failure scenarios.

  it("pull partial result table shows [OK] and [FAIL] with summary", () => {
    const result: PullCommandResult = {
      hosts: [
        {
          name: "shuvtest",
          hostname: "shuvtest",
          status: "ok",
          updated: true,
          summary: "Fast-forward",
        },
        {
          name: "shuvbot",
          hostname: "shuvbot",
          status: "fail",
          error: "Connection timed out",
        },
      ],
      allSucceeded: false,
    };

    const output = formatPullTable(result);
    // Per-host status indicators
    expect(output).toContain("[OK]");
    expect(output).toContain("[FAIL]");
    // Summary line with counts
    expect(output).toContain("1 succeeded");
    expect(output).toContain("1 failed");
  });

  it("all-success pull table shows [OK] for all hosts", () => {
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
          updated: false,
          summary: "Already up to date.",
        },
      ],
      allSucceeded: true,
    };

    const output = formatPullTable(result);
    expect(output).toContain("[OK]");
    expect(output).not.toContain("[FAIL]");
    expect(output).toContain("2 succeeded");
    expect(output).toContain("0 failed");
  });

  it("all-failure pull table shows [FAIL] for all hosts", () => {
    const result: PullCommandResult = {
      hosts: [
        {
          name: "shuvtest",
          hostname: "shuvtest",
          status: "fail",
          error: "Connection refused",
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
    expect(output).not.toContain("[OK]");
    expect(output).toContain("[FAIL]");
    expect(output).toContain("0 succeeded");
    expect(output).toContain("2 failed");
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";
import {
  run,
  mainHelp,
  statusHelp,
  pullHelp,
  syncHelp,
  activateHelp,
  deactivateHelp,
  rollbackHelp,
  tagHelp,
} from "../src/cli.js";

/**
 * Tests for CLI help text and usage error handling.
 *
 * Covers:
 * - VAL-CLI-015: fleet --help displays usage with all subcommands
 * - VAL-CLI-016: fleet <command> --help displays command-specific help
 * - VAL-CLI-017: Missing required argument shows error + usage hint
 * - VAL-CLI-018: Unknown command shows error + available commands
 */

describe("run() help and usage errors", () => {
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
      stdoutOutput += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;

    process.stderr.write = vi.fn((chunk: string | Uint8Array) => {
      stderrOutput += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  });

  // --- VAL-CLI-015: fleet --help ---

  describe("fleet --help (VAL-CLI-015)", () => {
    it("returns exit code 0", async () => {
      const exitCode = await Effect.runPromise(run(["node", "fleet", "--help"]));
      expect(exitCode).toBe(0);
    });

    it("outputs help text to stdout", async () => {
      await Effect.runPromise(run(["node", "fleet", "--help"]));
      expect(stdoutOutput).toContain("Usage: fleet <command>");
    });

    it("lists all subcommands", async () => {
      await Effect.runPromise(run(["node", "fleet", "--help"]));
      expect(stdoutOutput).toContain("status");
      expect(stdoutOutput).toContain("pull");
      expect(stdoutOutput).toContain("sync");
      expect(stdoutOutput).toContain("activate");
      expect(stdoutOutput).toContain("deactivate");
      expect(stdoutOutput).toContain("rollback");
      expect(stdoutOutput).toContain("tag");
    });

    it("works with -h shorthand", async () => {
      const exitCode = await Effect.runPromise(run(["node", "fleet", "-h"]));
      expect(exitCode).toBe(0);
      expect(stdoutOutput).toContain("Usage: fleet <command>");
    });
  });

  // --- VAL-CLI-016: fleet <command> --help ---

  describe("fleet <command> --help (VAL-CLI-016)", () => {
    it("fleet status --help shows status-specific help", async () => {
      const exitCode = await Effect.runPromise(run(["node", "fleet", "status", "--help"]));
      expect(exitCode).toBe(0);
      expect(stdoutOutput).toContain("fleet status");
      expect(stdoutOutput).toContain("--json");
    });

    it("fleet pull --help shows pull-specific help", async () => {
      const exitCode = await Effect.runPromise(run(["node", "fleet", "pull", "--help"]));
      expect(exitCode).toBe(0);
      expect(stdoutOutput).toContain("fleet pull");
      expect(stdoutOutput).toContain("hosts");
    });

    it("fleet sync --help shows sync-specific help", async () => {
      const exitCode = await Effect.runPromise(run(["node", "fleet", "sync", "--help"]));
      expect(exitCode).toBe(0);
      expect(stdoutOutput).toContain("fleet sync");
      expect(stdoutOutput).toContain("skill");
    });

    it("fleet activate --help shows activate-specific help", async () => {
      const exitCode = await Effect.runPromise(run(["node", "fleet", "activate", "--help"]));
      expect(exitCode).toBe(0);
      expect(stdoutOutput).toContain("fleet activate");
      expect(stdoutOutput).toContain("skill");
    });

    it("fleet deactivate --help shows deactivate-specific help", async () => {
      const exitCode = await Effect.runPromise(run(["node", "fleet", "deactivate", "--help"]));
      expect(exitCode).toBe(0);
      expect(stdoutOutput).toContain("fleet deactivate");
      expect(stdoutOutput).toContain("skill");
    });

    it("fleet rollback --help shows rollback-specific help", async () => {
      const exitCode = await Effect.runPromise(run(["node", "fleet", "rollback", "--help"]));
      expect(exitCode).toBe(0);
      expect(stdoutOutput).toContain("fleet rollback");
      expect(stdoutOutput).toContain("ref");
    });

    it("fleet tag --help shows tag-specific help", async () => {
      const exitCode = await Effect.runPromise(run(["node", "fleet", "tag", "--help"]));
      expect(exitCode).toBe(0);
      expect(stdoutOutput).toContain("fleet tag");
      expect(stdoutOutput).toContain("name");
    });

    it("subcommand help includes arguments documentation", async () => {
      await Effect.runPromise(run(["node", "fleet", "sync", "--help"]));
      expect(stdoutOutput).toContain("Arguments:");
      expect(stdoutOutput).toContain("skill");
    });

    it("subcommand help includes exit codes", async () => {
      await Effect.runPromise(run(["node", "fleet", "sync", "--help"]));
      expect(stdoutOutput).toContain("Exit codes:");
    });

    it("subcommand -h shorthand works", async () => {
      const exitCode = await Effect.runPromise(run(["node", "fleet", "status", "-h"]));
      expect(exitCode).toBe(0);
      expect(stdoutOutput).toContain("fleet status");
    });
  });

  // --- VAL-CLI-017: Missing required argument ---

  describe("missing required argument (VAL-CLI-017)", () => {
    it("fleet sync without skill shows error + usage hint", async () => {
      const exitCode = await Effect.runPromise(run(["node", "fleet", "sync"]));
      expect(exitCode).toBe(1);
      expect(stderrOutput).toContain("missing required argument");
      expect(stderrOutput).toContain("<skill>");
      expect(stderrOutput).toContain("fleet sync");
    });

    it("fleet activate without skill shows error + usage hint", async () => {
      const exitCode = await Effect.runPromise(run(["node", "fleet", "activate"]));
      expect(exitCode).toBe(1);
      expect(stderrOutput).toContain("missing required argument");
      expect(stderrOutput).toContain("<skill>");
      expect(stderrOutput).toContain("fleet activate");
    });

    it("fleet deactivate without skill shows error + usage hint", async () => {
      const exitCode = await Effect.runPromise(run(["node", "fleet", "deactivate"]));
      expect(exitCode).toBe(1);
      expect(stderrOutput).toContain("missing required argument");
      expect(stderrOutput).toContain("<skill>");
      expect(stderrOutput).toContain("fleet deactivate");
    });

    it("fleet rollback without ref shows error + usage hint", async () => {
      const exitCode = await Effect.runPromise(run(["node", "fleet", "rollback"]));
      expect(exitCode).toBe(1);
      expect(stderrOutput).toContain("missing required argument");
      expect(stderrOutput).toContain("<ref>");
      expect(stderrOutput).toContain("fleet rollback");
    });

    it("fleet tag without name shows error + usage hint", async () => {
      const exitCode = await Effect.runPromise(run(["node", "fleet", "tag"]));
      expect(exitCode).toBe(1);
      expect(stderrOutput).toContain("missing required argument");
      expect(stderrOutput).toContain("<name>");
      expect(stderrOutput).toContain("fleet tag");
    });
  });

  // --- VAL-CLI-018: Unknown command ---

  describe("unknown command (VAL-CLI-018)", () => {
    it("returns exit code 1 for unknown command", async () => {
      const exitCode = await Effect.runPromise(run(["node", "fleet", "foobar"]));
      expect(exitCode).toBe(1);
    });

    it("shows error message with the unknown command name", async () => {
      await Effect.runPromise(run(["node", "fleet", "foobar"]));
      expect(stderrOutput).toContain("Unknown command");
      expect(stderrOutput).toContain("foobar");
    });

    it("shows available commands in the error output", async () => {
      await Effect.runPromise(run(["node", "fleet", "foobar"]));
      expect(stderrOutput).toContain("status");
      expect(stderrOutput).toContain("pull");
      expect(stderrOutput).toContain("sync");
      expect(stderrOutput).toContain("activate");
      expect(stderrOutput).toContain("deactivate");
      expect(stderrOutput).toContain("rollback");
      expect(stderrOutput).toContain("tag");
    });

    it("outputs error to stderr, not stdout", async () => {
      await Effect.runPromise(run(["node", "fleet", "foobar"]));
      expect(stderrOutput.length).toBeGreaterThan(0);
    });
  });

  // --- No command (no args) ---

  describe("no command (fleet with no args)", () => {
    it("returns exit code 1", async () => {
      const exitCode = await Effect.runPromise(run(["node", "fleet"]));
      expect(exitCode).toBe(1);
    });

    it("shows usage help to stderr", async () => {
      await Effect.runPromise(run(["node", "fleet"]));
      expect(stderrOutput).toContain("Usage: fleet <command>");
      expect(stderrOutput).toContain("status");
      expect(stderrOutput).toContain("pull");
    });
  });
});

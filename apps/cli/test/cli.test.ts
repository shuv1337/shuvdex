import { describe, expect, it } from "vitest";
import { parseArgs, mainHelp, statusHelp } from "../src/cli.js";

describe("parseArgs", () => {
  it("parses status command", () => {
    const result = parseArgs(["node", "fleet", "status"]);
    expect(result.command).toBe("status");
    expect(result.flags.json).toBe(false);
    expect(result.flags.help).toBe(false);
  });

  it("parses --json flag", () => {
    const result = parseArgs(["node", "fleet", "status", "--json"]);
    expect(result.command).toBe("status");
    expect(result.flags.json).toBe(true);
  });

  it("parses --help flag", () => {
    const result = parseArgs(["node", "fleet", "--help"]);
    expect(result.command).toBeUndefined();
    expect(result.flags.help).toBe(true);
  });

  it("parses --help on subcommand", () => {
    const result = parseArgs(["node", "fleet", "status", "--help"]);
    expect(result.command).toBe("status");
    expect(result.flags.help).toBe(true);
  });

  it("parses -h as help", () => {
    const result = parseArgs(["node", "fleet", "-h"]);
    expect(result.flags.help).toBe(true);
  });

  it("parses --config flag", () => {
    const result = parseArgs([
      "node",
      "fleet",
      "status",
      "--config",
      "/path/to/fleet.yaml",
    ]);
    expect(result.command).toBe("status");
    expect(result.flags.config).toBe("/path/to/fleet.yaml");
  });

  it("parses -c as config shorthand", () => {
    const result = parseArgs([
      "node",
      "fleet",
      "status",
      "-c",
      "custom.yaml",
    ]);
    expect(result.flags.config).toBe("custom.yaml");
  });

  it("defaults config to fleet.yaml", () => {
    const result = parseArgs(["node", "fleet", "status"]);
    expect(result.flags.config).toBe("fleet.yaml");
  });

  it("handles no command", () => {
    const result = parseArgs(["node", "fleet"]);
    expect(result.command).toBeUndefined();
  });

  it("handles unknown command", () => {
    const result = parseArgs(["node", "fleet", "foobar"]);
    expect(result.command).toBe("foobar");
  });
});

describe("help text", () => {
  it("mainHelp lists all commands", () => {
    const help = mainHelp();
    expect(help).toContain("status");
    expect(help).toContain("pull");
    expect(help).toContain("sync");
    expect(help).toContain("activate");
    expect(help).toContain("deactivate");
    expect(help).toContain("rollback");
    expect(help).toContain("tag");
    expect(help).toContain("--config");
    expect(help).toContain("--help");
  });

  it("statusHelp describes the command", () => {
    const help = statusHelp();
    expect(help).toContain("fleet status");
    expect(help).toContain("--json");
    expect(help).toContain("--config");
  });
});

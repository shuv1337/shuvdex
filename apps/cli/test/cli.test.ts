import { describe, expect, it } from "vitest";
import {
  parseArgs,
  mainHelp,
  statusHelp,
  pullHelp,
  syncHelp,
  activateHelp,
  deactivateHelp,
} from "../src/cli.js";

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

  it("parses pull command with positional hosts", () => {
    const result = parseArgs(["node", "fleet", "pull", "shuvtest", "shuvbot"]);
    expect(result.command).toBe("pull");
    expect(result.positional).toEqual(["shuvtest", "shuvbot"]);
  });

  it("parses pull command with no hosts", () => {
    const result = parseArgs(["node", "fleet", "pull"]);
    expect(result.command).toBe("pull");
    expect(result.positional).toEqual([]);
  });

  it("parses --repo flag", () => {
    const result = parseArgs([
      "node",
      "fleet",
      "pull",
      "--repo",
      "/custom/repo/path",
    ]);
    expect(result.command).toBe("pull");
    expect(result.flags.repo).toBe("/custom/repo/path");
  });

  it("parses -r as repo shorthand", () => {
    const result = parseArgs([
      "node",
      "fleet",
      "pull",
      "-r",
      "/custom/repo",
    ]);
    expect(result.flags.repo).toBe("/custom/repo");
  });

  it("defaults repo to ~/repos/shuvbot-skills", () => {
    const result = parseArgs(["node", "fleet", "pull"]);
    expect(result.flags.repo).toBe("~/repos/shuvbot-skills");
  });

  it("parses sync command with skill and hosts", () => {
    const result = parseArgs(["node", "fleet", "sync", "my-skill", "shuvtest", "shuvbot"]);
    expect(result.command).toBe("sync");
    expect(result.positional).toEqual(["my-skill", "shuvtest", "shuvbot"]);
  });

  it("parses sync command with skill only", () => {
    const result = parseArgs(["node", "fleet", "sync", "my-skill"]);
    expect(result.command).toBe("sync");
    expect(result.positional).toEqual(["my-skill"]);
  });

  it("parses sync command with no args", () => {
    const result = parseArgs(["node", "fleet", "sync"]);
    expect(result.command).toBe("sync");
    expect(result.positional).toEqual([]);
  });

  it("parses --active-dir flag", () => {
    const result = parseArgs([
      "node",
      "fleet",
      "activate",
      "my-skill",
      "--active-dir",
      "/custom/active/dir",
    ]);
    expect(result.command).toBe("activate");
    expect(result.flags.activeDir).toBe("/custom/active/dir");
    expect(result.positional).toEqual(["my-skill"]);
  });

  it("parses -a as active-dir shorthand", () => {
    const result = parseArgs([
      "node",
      "fleet",
      "activate",
      "my-skill",
      "-a",
      "/custom/dir",
    ]);
    expect(result.flags.activeDir).toBe("/custom/dir");
  });

  it("defaults activeDir to ~/.codex/skills", () => {
    const result = parseArgs(["node", "fleet", "activate", "my-skill"]);
    expect(result.flags.activeDir).toBe("~/.codex/skills");
  });

  it("parses activate command with skill and hosts", () => {
    const result = parseArgs(["node", "fleet", "activate", "my-skill", "shuvtest", "shuvbot"]);
    expect(result.command).toBe("activate");
    expect(result.positional).toEqual(["my-skill", "shuvtest", "shuvbot"]);
  });

  it("parses deactivate command with skill and hosts", () => {
    const result = parseArgs(["node", "fleet", "deactivate", "my-skill", "shuvtest"]);
    expect(result.command).toBe("deactivate");
    expect(result.positional).toEqual(["my-skill", "shuvtest"]);
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

  it("pullHelp describes the command", () => {
    const help = pullHelp();
    expect(help).toContain("fleet pull");
    expect(help).toContain("hosts");
    expect(help).toContain("--json");
    expect(help).toContain("--repo");
    expect(help).toContain("--config");
  });

  it("syncHelp describes the command", () => {
    const help = syncHelp();
    expect(help).toContain("fleet sync");
    expect(help).toContain("skill");
    expect(help).toContain("hosts");
    expect(help).toContain("--json");
    expect(help).toContain("--repo");
    expect(help).toContain("--config");
  });

  it("activateHelp describes the command", () => {
    const help = activateHelp();
    expect(help).toContain("fleet activate");
    expect(help).toContain("skill");
    expect(help).toContain("hosts");
    expect(help).toContain("--json");
    expect(help).toContain("--repo");
    expect(help).toContain("--active-dir");
    expect(help).toContain("--config");
  });

  it("deactivateHelp describes the command", () => {
    const help = deactivateHelp();
    expect(help).toContain("fleet deactivate");
    expect(help).toContain("skill");
    expect(help).toContain("hosts");
    expect(help).toContain("--json");
    expect(help).toContain("--active-dir");
    expect(help).toContain("--config");
  });
});

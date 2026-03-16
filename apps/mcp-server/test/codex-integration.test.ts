/**
 * MCP Server Codex Desktop Integration Tests
 *
 * Tests for VAL-MCP-013: Server discoverable and launchable by Codex Desktop.
 *
 * Verifies:
 * - .codex/config.toml exists with correct MCP server entry
 * - Config references a valid command that launches the server
 * - Full Codex init sequence (initialize → initialized → tools/list) works
 * - All 7 fleet tools are visible after initialization
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../..");
const CODEX_CONFIG_PATH = resolve(PROJECT_ROOT, ".codex/config.toml");
const SERVER_ENTRY = resolve(PROJECT_ROOT, "apps/mcp-server/dist/index.js");

/**
 * Minimal TOML parser for the fields we care about.
 * Parses [mcp_servers.codex_fleet] section for command and args.
 */
function parseCodexFleetConfig(toml: string): {
  command?: string;
  args?: string[];
} {
  const lines = toml.split("\n");
  let inSection = false;
  let command: string | undefined;
  let args: string[] | undefined;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect section header
    if (trimmed.startsWith("[")) {
      inSection = trimmed === "[mcp_servers.codex_fleet]";
      continue;
    }

    if (!inSection) continue;

    // Parse command = "..."
    const cmdMatch = trimmed.match(/^command\s*=\s*"([^"]+)"/);
    if (cmdMatch) {
      command = cmdMatch[1];
      continue;
    }

    // Parse args = ["...", "..."]
    const argsMatch = trimmed.match(/^args\s*=\s*\[(.+)\]/);
    if (argsMatch) {
      args = argsMatch[1]
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""));
      continue;
    }
  }

  return { command, args };
}

/**
 * Helper: spawn the MCP server with the command from config, simulating
 * how Codex Desktop would launch it.
 *
 * Uses the project root as cwd (matching Codex project-scoped behavior).
 */
function spawnFromCodexConfig(
  command: string,
  args: string[],
  input: string,
  timeoutMs = 8000,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: PROJECT_ROOT,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        reject(new Error("Server did not exit within timeout"));
      }
    }, timeoutMs);

    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code });
      }
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    // Write input and close stdin to signal EOF
    child.stdin!.write(input);
    child.stdin!.end();
  });
}

describe("VAL-MCP-013: Codex Desktop Integration Discovery", () => {
  // --- Config path exists and is valid ---

  describe("config path", () => {
    it(".codex/config.toml exists in project root", () => {
      expect(existsSync(CODEX_CONFIG_PATH)).toBe(true);
    });

    it("config contains [mcp_servers.codex_fleet] section", () => {
      const content = readFileSync(CODEX_CONFIG_PATH, "utf-8");
      expect(content).toContain("[mcp_servers.codex_fleet]");
    });

    it("config specifies command and args for stdio server", () => {
      const content = readFileSync(CODEX_CONFIG_PATH, "utf-8");
      const config = parseCodexFleetConfig(content);

      expect(config.command).toBe("node");
      expect(config.args).toBeDefined();
      expect(config.args!.length).toBeGreaterThan(0);
      expect(config.args![0]).toContain("mcp-server");
    });

    it("referenced server entry point exists as built artifact", () => {
      expect(existsSync(SERVER_ENTRY)).toBe(true);
    });
  });

  // --- Server launches from Codex config ---

  describe("server launch from config", () => {
    it("server starts and responds to initialize within 5 seconds", { timeout: 10000 }, async () => {
      const content = readFileSync(CODEX_CONFIG_PATH, "utf-8");
      const config = parseCodexFleetConfig(content);

      const initRequest = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "codex-desktop", version: "1.0.0" },
        },
      });

      const { stdout, exitCode } = await spawnFromCodexConfig(
        config.command!,
        config.args!,
        initRequest + "\n",
        5000,
      );

      const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
      expect(lines.length).toBeGreaterThan(0);

      const response = JSON.parse(lines[0]);
      expect(response.id).toBe(1);
      expect(response.result).toBeDefined();
      expect(response.result.serverInfo.name).toBe("codex-fleet");
      expect(exitCode).toBe(0);
    });
  });

  // --- Tools visible after init sequence ---

  describe("tools visible after initialization", () => {
    it("full Codex init sequence returns all 7 fleet tools", { timeout: 10000 }, async () => {
      const content = readFileSync(CODEX_CONFIG_PATH, "utf-8");
      const config = parseCodexFleetConfig(content);

      // Simulate exact Codex Desktop init sequence:
      // 1. initialize
      // 2. notifications/initialized
      // 3. tools/list
      const messages = [
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "codex-desktop", version: "1.0.0" },
          },
        }),
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
      ];

      const { stdout } = await spawnFromCodexConfig(
        config.command!,
        config.args!,
        messages.join("\n") + "\n",
        5000,
      );

      const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
      const toolsResponse = lines
        .map((l) => JSON.parse(l))
        .find((msg: Record<string, unknown>) => msg.id === 2);

      expect(toolsResponse).toBeDefined();
      expect(toolsResponse.result.tools).toHaveLength(7);

      // Verify all expected tool names are present
      const toolNames = toolsResponse.result.tools.map(
        (t: { name: string }) => t.name,
      );
      expect(toolNames).toContain("fleet_status");
      expect(toolNames).toContain("fleet_sync");
      expect(toolNames).toContain("fleet_activate");
      expect(toolNames).toContain("fleet_deactivate");
      expect(toolNames).toContain("fleet_pull");
      expect(toolNames).toContain("fleet_drift");
      expect(toolNames).toContain("fleet_rollback");
    });

    it("each tool has name, description, and inputSchema", { timeout: 10000 }, async () => {
      const content = readFileSync(CODEX_CONFIG_PATH, "utf-8");
      const config = parseCodexFleetConfig(content);

      const messages = [
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "codex-desktop", version: "1.0.0" },
          },
        }),
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
      ];

      const { stdout } = await spawnFromCodexConfig(
        config.command!,
        config.args!,
        messages.join("\n") + "\n",
        5000,
      );

      const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
      const toolsResponse = lines
        .map((l) => JSON.parse(l))
        .find((msg: Record<string, unknown>) => msg.id === 2);

      for (const tool of toolsResponse.result.tools) {
        expect(tool.name).toBeDefined();
        expect(typeof tool.name).toBe("string");
        expect(tool.description).toBeDefined();
        expect(typeof tool.description).toBe("string");
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
      }
    });
  });
});
